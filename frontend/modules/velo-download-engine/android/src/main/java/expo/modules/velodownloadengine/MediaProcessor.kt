package expo.modules.velodownloadengine

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import java.io.File
import java.nio.ByteBuffer

/** On-device post-processing with platform APIs only (no FFmpeg): remux, never re-encode. */
object MediaProcessor {
  private const val BUFFER = 1 shl 20

  /** Combine a video-only and an audio-only stream into one MP4, interleaved by timestamp. */
  fun mux(video: File, audio: File, out: File) {
    val vs = sourceFor(video, "video/")
    val axs = runCatching { sourceFor(audio, "audio/") }.getOrElse { vs.ex.release(); throw it }
    val vx = vs.ex
    val ax = axs.ex
    val muxer = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    try {
      applyRotation(video, muxer)
      val vTrack = muxer.addTrack(vs.format)
      val aTrack = muxer.addTrack(axs.format)
      muxer.start()

      val buf = ByteBuffer.allocateDirect(BUFFER)
      val info = MediaCodec.BufferInfo()
      // Always write whichever stream is behind, so both tracks progress evenly (keeps muxer memory flat).
      while (true) {
        val vt = vx.sampleTime
        val at = ax.sampleTime
        if (vt < 0 && at < 0) break
        val useVideo = at < 0 || (vt >= 0 && vt <= at)
        val (ex, track) = if (useVideo) vx to vTrack else ax to aTrack
        copySample(ex, track, muxer, buf, info)
      }
      muxer.stop()
    } catch (e: IllegalArgumentException) {
      throw EngineError(Code.FORMAT_UNAVAILABLE, "These streams can't be merged into MP4: ${e.message}")
    } finally {
      runCatching { muxer.release() }
      vx.release(); ax.release()
    }
  }

  /** Extract the audio track into an .m4a without re-encoding. Only AAC can be remuxed at this stage. */
  fun extractAudioM4a(input: File, out: File) {
    val ex = MediaExtractor().apply { setDataSource(input.absolutePath) }
    val idx = (0 until ex.trackCount).firstOrNull { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }
      ?: run { ex.release(); throw EngineError(Code.FORMAT_UNAVAILABLE, "No audio track found") }
    val format = ex.getTrackFormat(idx)
    if (format.getString(MediaFormat.KEY_MIME) != MediaFormat.MIMETYPE_AUDIO_AAC) {
      ex.release()
      throw EngineError(Code.FORMAT_UNAVAILABLE, "Audio is not AAC; re-encoding arrives with the FFmpeg module")
    }
    ex.selectTrack(idx)
    val muxer = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    try {
      val track = muxer.addTrack(format)
      muxer.start()
      val buf = ByteBuffer.allocateDirect(BUFFER)
      val info = MediaCodec.BufferInfo()
      while (ex.sampleTime >= 0) copySample(ex, track, muxer, buf, info)
      muxer.stop()
    } finally {
      runCatching { muxer.release() }
      ex.release()
    }
  }

  private class Source(val ex: MediaExtractor, val format: MediaFormat)

  private fun sourceFor(file: File, mimePrefix: String): Source {
    val ex = MediaExtractor()
    ex.setDataSource(file.absolutePath)
    val idx = (0 until ex.trackCount).firstOrNull { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith(mimePrefix) == true }
    if (idx == null) {
      ex.release()
      throw EngineError(Code.FORMAT_UNAVAILABLE, "No $mimePrefix track in ${file.name}")
    }
    ex.selectTrack(idx)
    return Source(ex, ex.getTrackFormat(idx))
  }

  private fun copySample(ex: MediaExtractor, track: Int, muxer: MediaMuxer, buf: ByteBuffer, info: MediaCodec.BufferInfo) {
    buf.clear()
    val size = ex.readSampleData(buf, 0)
    if (size < 0) { ex.advance(); return }
    info.set(0, size, ex.sampleTime, if (ex.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
    muxer.writeSampleData(track, buf, info)
    ex.advance()
  }

  private fun applyRotation(video: File, muxer: MediaMuxer) {
    val r = MediaMetadataRetriever()
    try {
      r.setDataSource(video.absolutePath)
      r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull()?.let { muxer.setOrientationHint(it) }
    } catch (_: Exception) {
    } finally {
      r.release()
    }
  }
}
