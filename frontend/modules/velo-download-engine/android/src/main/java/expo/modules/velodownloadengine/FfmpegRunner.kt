package expo.modules.velodownloadengine

import android.content.Context
import com.yausername.ffmpeg.FFmpeg
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runInterruptible
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Fallback merge path for codec combinations MediaProcessor's MediaMuxer can't mux into MP4
 * (VP9/AV1 video-only tracks, seen on Instagram Reels — MediaMuxer's MP4 writer only accepts
 * H.264/AAC, no re-encode). Runs the ffmpeg binary bundled by `io.github.junkfood02.youtubedl-android:ffmpeg`
 * (GPLv3, Termux's ffmpeg build — same artifact Seal ships) as a genuinely separate subprocess via
 * ProcessBuilder, never linked into our process. Stream-copies (`-c copy`, lossless, no re-encode)
 * into Matroska (.mkv), which accepts any codec combination without the MP4-spec questions VP9-in-MP4
 * raises — Android's own player (and ours, expo-video/ExoPlayer) plays MKV natively.
 *
 * The `FFmpeg` object from that library only extracts the bundled binary (see its `init`); it has
 * no execute method, so invocation here is our own ProcessBuilder code against the extracted path.
 */
object FfmpegRunner {
  private var binary: File? = null

  @Synchronized
  private fun binary(ctx: Context): File {
    binary?.let { return it }
    FFmpeg.getInstance().init(ctx)
    val root = File(ctx.noBackupFilesDir, "youtubedl-android/packages/ffmpeg")
    // Exact internal layout of the extracted zip isn't part of the library's public API, so this
    // searches for a file literally named "ffmpeg" rather than hardcoding a path — robust to that
    // layout changing between library versions. NEEDS ON-DEVICE VERIFICATION: this couldn't be
    // tested against a real extraction in this environment (no way to run compiled Kotlin here).
    val found = root.walkTopDown().firstOrNull { it.isFile && it.name.equals("ffmpeg", ignoreCase = true) }
      ?: throw EngineError(Code.FORMAT_UNAVAILABLE, "FFmpeg binary not found after extraction")
    found.setExecutable(true)
    binary = found
    return found
  }

  /**
   * Stream-copy a video-only + audio-only file into one Matroska container. Throws EngineError on
   * failure. Suspend + runInterruptible so pause/cancel (which cancels the enclosing coroutine)
   * actually interrupts the blocking waitFor() and kills the subprocess, instead of leaving it
   * running in the background until it finishes on its own — the same class of bug the sequential
   * downloader (Downloader.kt's runCancellable) was fixed for earlier.
   */
  suspend fun mergeToMkv(ctx: Context, video: File, audio: File, out: File) {
    val ffmpeg = binary(ctx)
    val cmd = listOf(ffmpeg.absolutePath, "-y", "-i", video.absolutePath, "-i", audio.absolutePath, "-c", "copy", "-map", "0:v:0", "-map", "1:a:0", out.absolutePath)
    val process = ProcessBuilder(cmd).redirectErrorStream(true).start()
    try {
      val finished = runInterruptible(Dispatchers.IO) { process.waitFor(5, TimeUnit.MINUTES) }
      if (!finished) {
        process.destroyForcibly()
        throw EngineError(Code.FORMAT_UNAVAILABLE, "FFmpeg merge timed out")
      }
      if (process.exitValue() != 0) {
        val log = runCatching { process.inputStream.bufferedReader().readText().takeLast(2000) }.getOrDefault("")
        throw EngineError(Code.FORMAT_UNAVAILABLE, "FFmpeg merge failed (${process.exitValue()}): $log")
      }
    } catch (e: InterruptedException) {
      process.destroyForcibly()
      throw DownloadCancelled()
    }
  }
}
