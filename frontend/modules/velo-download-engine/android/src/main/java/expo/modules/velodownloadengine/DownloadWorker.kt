package expo.modules.velodownloadengine

import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import java.io.File

class DownloadWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
  private val id = params.inputData.getString("taskId") ?: ""
  private val store = TaskStore.get(ctx)
  private val nid get() = Notifications.notificationId(id)

  override suspend fun getForegroundInfo(): ForegroundInfo = foreground(store.get(id)?.title ?: "Downloading", 0, null, State.DOWNLOADING)

  private fun foreground(title: String, bytes: Long, total: Long?, state: String): ForegroundInfo {
    val n = Notifications.progress(applicationContext, title, bytes, total, state)
    return if (Build.VERSION.SDK_INT >= 29) ForegroundInfo(nid, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else ForegroundInfo(nid, n)
  }

  override suspend fun doWork(): Result = TaskLocks.mutexFor(id).withLock {
    // Re-read inside the lock: the state may have changed (paused again, canceled) while we waited for the previous run to exit.
    val task = store.get(id) ?: return@withLock Result.success()
    if (State.isTerminal(task.state) || task.state == State.PAUSED) return@withLock Result.success()
    gate.withPermit { run(task) }
  }

  private suspend fun run(task: TaskRecord): Result {
    runCatching { setForeground(foreground(task.title, task.bytesDone, task.totalBytes, State.DOWNLOADING)) } // not allowed in every background state; the download continues either way
    store.setState(id, State.DOWNLOADING)
    EngineEvents.state(id, State.DOWNLOADING)

    val downloader = Downloader()
    try {
      downloader.runCancellable { execute(store.get(id) ?: task, downloader) }
      return Result.success()
    } catch (e: DownloadCancelled) {
      interrupted()
      throw CancellationException("download stopped")
    } catch (e: CancellationException) {
      interrupted()
      throw e
    } catch (e: EngineError) {
      Log.w(TAG, "task=$id postProcess=${task.postProcess} code=${e.code}: ${e.message}")
      fail(task, e.code, e.message)
      return Result.success() // failure is recorded; retries are decided by JS (network) or the user
    } catch (e: Throwable) {
      // Anything not modeled as EngineError lands here as an opaque UNKNOWN with no detail in the
      // UI — this Log.e is the only place the real cause survives, so it's the first thing to
      // check (adb logcat -s DownloadWorker) whenever a download fails with "UNKNOWN".
      Log.e(TAG, "task=$id postProcess=${task.postProcess} unexpected failure", e)
      fail(task, Code.UNKNOWN, e.message)
      return Result.success()
    }
  }

  /** Stopped by pause/cancel (state already set) or by the system (constraints lost): the latter stays queued and reschedules itself. */
  private fun interrupted() {
    val s = store.get(id)?.state
    if (s == State.DOWNLOADING || s == State.PROCESSING) {
      store.setState(id, State.QUEUED)
      EngineEvents.state(id, State.QUEUED)
    }
  }

  private fun fail(task: TaskRecord, code: String, message: String?) {
    store.setState(id, State.FAILED, code, message)
    EngineEvents.state(id, State.FAILED, code, message)
    Notifications.failed(applicationContext, id, task.title, code)
  }

  private suspend fun execute(task: TaskRecord, downloader: Downloader) {
    val ctx = applicationContext
    val dir = DownloadScheduler.tempDir(ctx)
    val bins = mutableListOf<File>()
    val totals = task.parts.map { it.expectedSize }.toMutableList()
    var lastTick = 0L
    var lastBytes = 0L
    var speed = 0L

    task.parts.forEachIndexed { i, part ->
      val bin = File(dir, "$id.$i.bin")
      if (!bin.exists()) {
        val partial = File(dir, "$id.$i.part")
        val etag = task.etag?.takeIf { it.startsWith("$i|") }?.substringAfter('|')
        val doneBefore = bins.sumOf { it.length() }
        val result = downloader.download(part.url, part.headers, partial, etag) { bytes, total ->
          if (stopRequested()) throw DownloadCancelled()
          total?.let { totals[i] = it }
          val overall = doneBefore + bytes
          val overallTotal = if (totals.all { it != null }) totals.sumOf { it!! } else null
          val now = System.currentTimeMillis()
          if (now - lastTick >= 1000) {
            speed = if (lastTick == 0L) 0 else (overall - lastBytes) * 1000 / (now - lastTick)
            lastTick = now; lastBytes = overall
            store.setProgress(id, overall, overallTotal, null)
            EngineEvents.progress(id, overall, overallTotal, speed)
            applicationContext.getSystemService(NotificationManager::class.java)
              .notify(nid, Notifications.progress(ctx, task.title, overall, overallTotal, State.DOWNLOADING))
          }
        }
        result.etag?.let { store.setProgress(id, doneBefore + result.bytes, null, "$i|$it") }
        if (!partial.renameTo(bin)) throw EngineError(Code.STORAGE_FULL, "Could not finalize the downloaded file")
      }
      bins += bin
    }
    val downloaded = bins.sumOf { it.length() }
    store.setProgress(id, downloaded, downloaded, null)
    EngineEvents.progress(id, downloaded, downloaded, 0)

    val out: File = when (task.postProcess) {
      "mux" -> {
        enterProcessing(task)
        val v = bins[task.parts.indexOfFirst { it.role == "video" }.coerceAtLeast(0)]
        val a = bins[task.parts.indexOfFirst { it.role == "audio" }.let { if (it < 0) 1 else it }]
        File(dir, "$id.out.mp4").also { MediaProcessor.mux(v, a, it) }
      }
      // Codec combos MediaMuxer's MP4 writer can't mux (VP9/AV1 video-only + audio — Instagram
      // Reels) — the format picker (quality.ts) only offers this postProcess for exactly that
      // case, so no MediaMuxer attempt first. See FfmpegRunner.
      "mux-ffmpeg" -> {
        enterProcessing(task)
        val v = bins[task.parts.indexOfFirst { it.role == "video" }.coerceAtLeast(0)]
        val a = bins[task.parts.indexOfFirst { it.role == "audio" }.let { if (it < 0) 1 else it }]
        val mkv = File(dir, "$id.out.mkv")
        FfmpegRunner.mergeToMkv(applicationContext, v, a, mkv)
        mkv
      }
      "extract-audio" -> {
        enterProcessing(task)
        File(dir, "$id.out.m4a").also { MediaProcessor.extractAudioM4a(bins[0], it) }
      }
      else -> bins[0]
    }

    if (stopRequested()) throw DownloadCancelled() // paused/canceled while post-processing: never publish the file
    val uri = MediaStoreWriter.save(ctx, out, task.kind, task.relativePath, task.filename, task.mime)
    store.complete(id, uri.toString(), out.length())
    DownloadScheduler.cleanup(ctx, id)
    Notifications.done(ctx, id, task.title)
    EngineEvents.state(id, State.COMPLETED)
    EngineEvents.complete(id, uri.toString(), task.filename, out.length())
  }

  private fun stopRequested(): Boolean = store.get(id)?.state.let { it == State.PAUSED || it == State.CANCELED }

  private fun enterProcessing(task: TaskRecord) {
    store.setState(id, State.PROCESSING)
    EngineEvents.state(id, State.PROCESSING)
    applicationContext.getSystemService(NotificationManager::class.java)
      .notify(nid, Notifications.progress(applicationContext, task.title, 0, null, State.PROCESSING))
  }

  companion object {
    private const val TAG = "DownloadWorker"
    // Concurrency cap is read once per process; changing it applies to the next process start.
    @Volatile private var permits = 3
    val gate: Semaphore by lazy { Semaphore(permits) }
    fun configure(max: Int) { permits = max }
  }
}
