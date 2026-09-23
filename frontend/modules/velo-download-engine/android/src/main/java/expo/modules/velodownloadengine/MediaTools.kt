package expo.modules.velodownloadengine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import android.net.Uri
import android.os.Build
import java.io.File
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/**
 * On-device media tools using only platform APIs (no FFmpeg): probe, lossless audio extraction and trim, frame grab,
 * image convert/resize/compress, and file hashing. Every result is written to MediaStore (never overwrites the input).
 * Formats that would need re-encoding fail with FORMAT_UNAVAILABLE until the FFmpeg module exists.
 */
object MediaTools {
  private val cancelled = ConcurrentHashMap.newKeySet<String>()
  fun cancel(opId: String) { cancelled.add(opId) }
  private fun checkCancel(opId: String) { if (cancelled.remove(opId)) throw DownloadCancelled() }

  private fun temp(ctx: Context, suffix: String) = File.createTempFile("tool-", suffix, DownloadScheduler.tempDir(ctx))

  private fun extractorFor(ctx: Context, uri: Uri) = MediaExtractor().apply { setDataSource(ctx, uri, null) }

  fun probe(ctx: Context, uri: Uri): Map<String, Any?> {
    val r = MediaMetadataRetriever()
    try {
      r.setDataSource(ctx, uri)
      val m = { k: Int -> r.extractMetadata(k) }
      val ex = extractorFor(ctx, uri)
      val mimes = (0 until ex.trackCount).mapNotNull { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME) }
      ex.release()
      return mapOf(
        "durationMs" to (m(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L).toDouble(),
        "hasVideo" to (m(MediaMetadataRetriever.METADATA_KEY_HAS_VIDEO) == "yes"),
        "hasAudio" to (m(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO) == "yes"),
        "width" to (m(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0),
        "height" to (m(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0),
        "audioIsAac" to mimes.any { it == MediaFormat.MIMETYPE_AUDIO_AAC },
        "mimes" to mimes,
      )
    } finally {
      r.release()
    }
  }

  /** Copies the audio track of any video/audio file into an .m4a (AAC only, no re-encode). */
  fun extractAudio(ctx: Context, uri: Uri, filename: String, relPath: String, opId: String, onProgress: (Double) -> Unit): Map<String, Any?> {
    val ex = extractorFor(ctx, uri)
    val out = temp(ctx, ".m4a")
    try {
      val idx = (0 until ex.trackCount).firstOrNull { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME) == MediaFormat.MIMETYPE_AUDIO_AAC }
        ?: throw EngineError(Code.FORMAT_UNAVAILABLE, "This file's audio isn't AAC. MP3/OPUS conversion arrives with the FFmpeg module.")
      val format = ex.getTrackFormat(idx)
      val durUs = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L
      ex.selectTrack(idx)
      val muxer = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      try {
        val track = muxer.addTrack(format)
        muxer.start()
        val buf = ByteBuffer.allocateDirect(1 shl 20)
        val info = MediaCodec.BufferInfo()
        while (true) {
          checkCancel(opId)
          val size = ex.readSampleData(buf, 0)
          if (size < 0) break
          info.set(0, size, ex.sampleTime, 0)
          muxer.writeSampleData(track, buf, info)
          if (durUs > 0) onProgress((ex.sampleTime.toDouble() / durUs).coerceIn(0.0, 1.0))
          ex.advance()
        }
        muxer.stop()
      } finally { runCatching { muxer.release() } }
      val saved = MediaStoreWriter.save(ctx, out, "audio", relPath, filename, "audio/mp4")
      return mapOf("uri" to saved.toString(), "size" to out.length().toDouble())
    } finally {
      ex.release(); out.delete()
    }
  }

  /**
   * Lossless trim between [startUs, endUs]. Without re-encoding a cut can only begin on a keyframe, so the start
   * snaps back to the previous one; the actual start is returned so the UI can say so.
   */
  fun trim(ctx: Context, uri: Uri, startMs: Long, endMs: Long, filename: String, relPath: String, opId: String, onProgress: (Double) -> Unit): Map<String, Any?> {
    val ex = extractorFor(ctx, uri)
    val out = temp(ctx, ".mp4")
    try {
      val tracks = (0 until ex.trackCount).filter {
        val mime = ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME) ?: ""
        mime.startsWith("video/") || mime.startsWith("audio/")
      }
      if (tracks.isEmpty()) throw EngineError(Code.FORMAT_UNAVAILABLE, "No audio or video track found")
      val hasVideo = tracks.any { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)!!.startsWith("video/") }

      val muxer = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      try {
        val map = HashMap<Int, Int>()
        for (t in tracks) {
          ex.selectTrack(t)
          map[t] = try { muxer.addTrack(ex.getTrackFormat(t)) } catch (e: IllegalArgumentException) {
            throw EngineError(Code.FORMAT_UNAVAILABLE, "This format can't be trimmed without re-encoding (${ex.getTrackFormat(t).getString(MediaFormat.KEY_MIME)})")
          }
        }
        rotationOf(ctx, uri)?.let { muxer.setOrientationHint(it) }
        muxer.start()

        val startUs = startMs * 1000
        val endUs = endMs * 1000
        ex.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
        val baseUs = ex.sampleTime.coerceAtLeast(0)
        val buf = ByteBuffer.allocateDirect(2 shl 20)
        val info = MediaCodec.BufferInfo()
        while (true) {
          checkCancel(opId)
          val t = ex.sampleTime
          if (t < 0 || t > endUs) break
          val size = ex.readSampleData(buf, 0)
          if (size < 0) break
          val pts = t - baseUs
          if (pts >= 0) { // audio can start a few ms before the video keyframe: drop those, they would be negative
            info.set(0, size, pts, if (ex.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
            muxer.writeSampleData(map[ex.sampleTrackIndex]!!, buf, info)
          }
          onProgress(((t - startUs).toDouble() / (endUs - startUs).coerceAtLeast(1)).coerceIn(0.0, 1.0))
          ex.advance()
        }
        muxer.stop()
        val kind = if (hasVideo) "video" else "audio"
        val mime = if (hasVideo) "video/mp4" else "audio/mp4"
        val saved = MediaStoreWriter.save(ctx, out, kind, relPath, filename, mime)
        return mapOf("uri" to saved.toString(), "size" to out.length().toDouble(), "startMs" to (baseUs / 1000).toDouble(), "kind" to kind)
      } finally { runCatching { muxer.release() } }
    } finally {
      ex.release(); out.delete()
    }
  }

  private fun rotationOf(ctx: Context, uri: Uri): Int? {
    val r = MediaMetadataRetriever()
    return try {
      r.setDataSource(ctx, uri)
      r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull()
    } catch (_: Exception) { null } finally { r.release() }
  }

  fun frame(ctx: Context, uri: Uri, atMs: Long, format: String, filename: String, relPath: String): Map<String, Any?> {
    val r = MediaMetadataRetriever()
    val out = temp(ctx, if (format == "png") ".png" else ".jpg")
    try {
      r.setDataSource(ctx, uri)
      val bmp = r.getFrameAtTime(atMs * 1000, MediaMetadataRetriever.OPTION_CLOSEST) ?: throw EngineError(Code.FORMAT_UNAVAILABLE, "Couldn't read a frame at that time")
      out.outputStream().use { bmp.compress(if (format == "png") Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG, 95, it) }
      val saved = MediaStoreWriter.save(ctx, out, "image", relPath, filename, if (format == "png") "image/png" else "image/jpeg")
      return mapOf("uri" to saved.toString(), "size" to out.length().toDouble())
    } finally {
      r.release(); out.delete()
    }
  }

  /** Convert / resize / compress one image. `maxDimension` 0 = keep size. EXIF rotation is applied so the result is upright. */
  fun imageProcess(ctx: Context, uri: Uri, format: String, quality: Int, maxDimension: Int, filename: String, relPath: String): Map<String, Any?> {
    val resolver = ctx.contentResolver
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    if (bounds.outWidth <= 0) throw EngineError(Code.FORMAT_UNAVAILABLE, "Not a readable image")

    // decode near the target size first (large photos would otherwise need hundreds of MB)
    var sample = 1
    if (maxDimension > 0) while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxDimension) sample *= 2
    var bmp = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
      ?: throw EngineError(Code.FORMAT_UNAVAILABLE, "Couldn't decode the image")

    val orientation = resolver.openInputStream(uri)?.use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) } ?: ExifInterface.ORIENTATION_NORMAL
    val m = Matrix()
    when (orientation) { ExifInterface.ORIENTATION_ROTATE_90 -> m.postRotate(90f); ExifInterface.ORIENTATION_ROTATE_180 -> m.postRotate(180f); ExifInterface.ORIENTATION_ROTATE_270 -> m.postRotate(270f) }
    val longest = maxOf(bmp.width, bmp.height)
    if (maxDimension in 1 until longest) { val s = maxDimension.toFloat() / longest; m.postScale(s, s) }
    if (!m.isIdentity) bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)

    val (compress, ext, mime) = when (format) {
      "png" -> Triple(Bitmap.CompressFormat.PNG, ".png", "image/png")
      "webp" -> Triple(if (Build.VERSION.SDK_INT >= 30) Bitmap.CompressFormat.WEBP_LOSSY else @Suppress("DEPRECATION") Bitmap.CompressFormat.WEBP, ".webp", "image/webp")
      else -> Triple(Bitmap.CompressFormat.JPEG, ".jpg", "image/jpeg")
    }
    val out = temp(ctx, ext)
    try {
      out.outputStream().use { bmp.compress(compress, quality.coerceIn(1, 100), it) }
      val saved = MediaStoreWriter.save(ctx, out, "image", relPath, filename, mime)
      return mapOf("uri" to saved.toString(), "size" to out.length().toDouble(), "width" to bmp.width, "height" to bmp.height)
    } finally {
      out.delete()
    }
  }

  fun sha256(ctx: Context, uri: Uri, opId: String): String {
    val md = MessageDigest.getInstance("SHA-256")
    ctx.contentResolver.openInputStream(uri)?.use { input ->
      val buf = ByteArray(256 * 1024)
      while (true) {
        checkCancel(opId)
        val n = input.read(buf)
        if (n < 0) break
        md.update(buf, 0, n)
      }
    } ?: throw EngineError(Code.MEDIA_NOT_FOUND, "File not found")
    return md.digest().joinToString("") { "%02x".format(it) }
  }
}
