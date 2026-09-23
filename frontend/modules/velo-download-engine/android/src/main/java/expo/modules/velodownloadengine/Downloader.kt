package expo.modules.velodownloadengine

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.util.concurrent.TimeUnit

/**
 * Resumable HTTP download of one file. Pure JVM (no Android classes) so it is unit-tested with MockWebServer.
 *
 * The file is fetched as a series of *bounded* `Range` requests ([chunkSize], default 8 MiB) instead of one
 * open-ended stream: YouTube (googlevideo) throttles long single requests to a fraction of the line speed
 * (measured 2.1 MB/s vs 5.5 MB/s for the same URL), while bounded requests are served at full speed. It also
 * makes resume trivial: the `.part` file is always a contiguous prefix, so the next request starts at its length.
 * Servers that ignore `Range` (reply 200) are handled by streaming the whole body.
 * A transient I/O error inside a chunk is retried up to [retries] times before the task fails.
 */
class Downloader(
  private val client: OkHttpClient = defaultClient,
  private val chunkSize: Long = DEFAULT_CHUNK,
  private val retries: Int = 2,
) {
  data class Result(val bytes: Long, val total: Long?, val etag: String?)

  @Volatile private var call: Call? = null
  @Volatile private var cancelled = false

  /** Aborts the in-flight request (called when the worker is cancelled). */
  fun cancel() {
    cancelled = true
    call?.cancel()
  }

  fun download(
    url: String,
    headers: Map<String, String>,
    dest: File,
    etag: String?,
    onProgress: (bytes: Long, total: Long?) -> Unit,
  ): Result {
    var restartedFromZero = false
    var total: Long? = null
    var currentEtag = etag
    var attempt = 0
    dest.parentFile?.mkdirs()

    while (true) {
      if (cancelled) throw DownloadCancelled()
      val pos = if (dest.exists()) dest.length() else 0L
      if (total != null && pos >= total) return finish(pos, total, currentEtag, onProgress)

      val end = if (total != null) minOf(pos + chunkSize - 1, total - 1) else pos + chunkSize - 1
      val builder = Request.Builder().url(url)
      headers.forEach { (k, v) -> builder.header(k, v) }
      builder.header("Range", "bytes=$pos-$end")
      if (pos > 0 && currentEtag != null) builder.header("If-Range", currentEtag)
      val c = client.newCall(builder.build())
      call = c

      try {
        c.execute().use { resp ->
          when (resp.code) {
            206 -> {
              val range = parseContentRange(resp.header("Content-Range"))
              if (range != null && range.first != pos) throw EngineError(Code.SERVER_ERROR, "Server returned the wrong range")
              total = range?.third ?: total
              currentEtag = resp.header("ETag") ?: currentEtag
              val body = resp.body ?: throw EngineError(Code.SERVER_ERROR, "Empty response body")
              val written = copyTo(body.byteStream(), dest, pos, total, onProgress)
              attempt = 0
              if (total == null && written == 0L) throw EngineError(Code.SERVER_ERROR, "Empty range response")
              if (total == null || pos + written < total) {
                if (total == null) total = pos + written // unknown length: assume this was everything
              }
            }
            200 -> {
              // Range ignored (or the file changed since our partial): stream the whole body from the start.
              currentEtag = resp.header("ETag") ?: currentEtag
              if (pos > 0) dest.delete()
              val body = resp.body ?: throw EngineError(Code.SERVER_ERROR, "Empty response body")
              val len = body.contentLength().takeIf { it >= 0 }
              val written = copyTo(body.byteStream(), dest, 0, len, onProgress)
              if (len != null && written != len) throw EngineError(Code.NETWORK_ERROR, "Connection closed early ($written of $len bytes)")
              return finish(written, len ?: written, currentEtag, onProgress)
            }
            416 -> {
              // Our partial file is at/over the end. If it matches the real size we are done, else restart once.
              val real = resp.header("Content-Range")?.substringAfter('/', "")?.toLongOrNull()
              if (real != null && pos == real) return finish(pos, real, currentEtag, onProgress)
              if (restartedFromZero) throw EngineError(Code.SERVER_ERROR, "Range not satisfiable")
              dest.delete()
              restartedFromZero = true
              total = null
            }
            401 -> throw EngineError(Code.AUTH_REQUIRED, "HTTP 401")
            403, 410 -> throw EngineError(Code.URL_EXPIRED, "HTTP ${resp.code}")
            404 -> throw EngineError(Code.MEDIA_NOT_FOUND, "HTTP 404")
            429 -> throw EngineError(Code.RATE_LIMITED, "HTTP 429")
            in 500..599 -> throw EngineError(Code.SERVER_ERROR, "HTTP ${resp.code}")
            else -> throw EngineError(Code.UNKNOWN, "HTTP ${resp.code}")
          }
        }
      } catch (e: EngineError) {
        throw e
      } catch (e: DownloadCancelled) {
        throw e
      } catch (e: IOException) {
        if (cancelled || c.isCanceled()) throw DownloadCancelled()
        val full = e.message?.contains("ENOSPC", ignoreCase = true) == true || e.message?.contains("No space left", ignoreCase = true) == true
        if (full) throw EngineError(Code.STORAGE_FULL, e.message ?: "Disk full")
        if (attempt++ < retries) { // transient: keep what we have (the next loop resumes at the file length)
          try { Thread.sleep(400L * attempt) } catch (_: InterruptedException) { throw DownloadCancelled() }
          continue
        }
        throw EngineError(Code.NETWORK_ERROR, e.message ?: "I/O error")
      }
    }
  }

  private fun finish(bytes: Long, total: Long, etag: String?, onProgress: (Long, Long?) -> Unit): Result {
    onProgress(bytes, total)
    return Result(bytes, total, etag)
  }

  /** Writes [input] into [dest] starting at [start]; returns bytes written. Throws DownloadCancelled promptly. */
  private fun copyTo(input: java.io.InputStream, dest: File, start: Long, total: Long?, onProgress: (Long, Long?) -> Unit): Long {
    var written = 0L
    var lastReport = 0L
    RandomAccessFile(dest, "rw").use { out ->
      out.seek(start)
      val buf = ByteArray(64 * 1024)
      input.use {
        while (true) {
          if (cancelled) throw DownloadCancelled()
          val n = it.read(buf)
          if (n < 0) break
          out.write(buf, 0, n)
          written += n
          val now = System.nanoTime()
          if (now - lastReport > 250_000_000L) { // ≤ 4 Hz
            lastReport = now
            onProgress(start + written, total)
          }
        }
      }
    }
    return written
  }

  /** "bytes 100-199/1000" → (100, 199, 1000). */
  private fun parseContentRange(h: String?): Triple<Long, Long, Long?>? {
    val m = Regex("""bytes (\d+)-(\d+)/(\d+|\*)""").find(h ?: return null) ?: return null
    return Triple(m.groupValues[1].toLong(), m.groupValues[2].toLong(), m.groupValues[3].toLongOrNull())
  }

  companion object {
    const val DEFAULT_CHUNK = 8L * 1024 * 1024
    val defaultClient: OkHttpClient = OkHttpClient.Builder()
      .connectTimeout(20, TimeUnit.SECONDS)
      .readTimeout(30, TimeUnit.SECONDS)
      .retryOnConnectionFailure(true)
      .build()
  }
}

/**
 * Runs blocking [block] on the IO dispatcher and aborts the in-flight request the moment the calling coroutine
 * is cancelled (pause / cancel / system stop). `invokeOnCompletion` is NOT enough: it only fires once the
 * coroutine has finished, and a blocked socket read never lets it finish. A child coroutine that suspends on
 * awaitCancellation() gets its `finally` run as soon as cancellation is requested.
 */
suspend fun <T> Downloader.runCancellable(block: () -> T): T = coroutineScope {
  val watcher = launch { try { awaitCancellation() } finally { cancel() } }
  try {
    withContext(Dispatchers.IO) { block() }
  } finally {
    watcher.cancel()
  }
}
