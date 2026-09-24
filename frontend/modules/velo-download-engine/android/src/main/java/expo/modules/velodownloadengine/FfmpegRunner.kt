package expo.modules.velodownloadengine

import android.content.Context
import android.util.Log
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runInterruptible
import java.io.File
import java.io.IOException
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
 * On-device verification (2026-09-24) found the executable isn't where the library's `FFmpeg.init()`
 * extracts to — that call only unpacks `libffmpeg.zip.so` into noBackupFilesDir, and that archive
 * turns out to hold ffmpeg's *shared library dependencies* (libavcodec.so, libavformat.so, ...), not
 * the ffmpeg binary itself. The actual executable ships as `libffmpeg.so` directly under the app's
 * own native lib dir (`applicationInfo.nativeLibraryDir`) — Android extracts and marks it executable
 * automatically like any other native lib, which is exactly why `useLegacyPackaging` (app.config.ts)
 * had to be turned on: without it, native libs are mapped straight from the APK and never written to
 * a real file at all, so nothing here would be runnable as a subprocess.
 *
 * ffmpeg's own dependency chain (libavfilter → libharfbuzz-cairo/libfontconfig/libx265/glib, pulled
 * in eagerly by the dynamic linker at process start even though our `-c copy` command never uses
 * those code paths) needs a few more shared libs than the `ffmpeg` package alone ships — libexpat,
 * libcrypto and two small Termux compat shims. Traced via `readelf -d` against every extracted .so
 * (2026-09-24). `youtubedl-android`'s own `YoutubeDL.executeImpl()` (its actual yt-dlp-invocation
 * code, read from source) hits the exact same problem and solves it the same way this does: point
 * `LD_LIBRARY_PATH` at *both* the `ffmpeg` package's lib dir and the `python` package's lib dir —
 * Python's own build needs the same base libs for its ssl/xml stdlib modules, so its extraction
 * already carries the ones `ffmpeg`'s package is missing. Hence `YoutubeDL.getInstance().init(ctx)`
 * below even though this class never runs Python — it's only used for its side effect of extracting
 * that lib directory.
 */
object FfmpegRunner {
  private var binaryPath: File? = null
  private var ldLibraryPath: String? = null

  @Synchronized
  private fun paths(ctx: Context): Pair<File, String> {
    binaryPath?.let { bin -> ldLibraryPath?.let { lib -> return bin to lib } }
    // Both throw their own *Exception on extraction failure — wrap so it's classified instead of
    // falling through DownloadWorker's generic catch as an unlogged, detail-less UNKNOWN.
    try {
      FFmpeg.getInstance().init(ctx)
      YoutubeDL.getInstance().init(ctx)
    } catch (e: Exception) {
      Log.e("FfmpegRunner", "FFmpeg/YoutubeDL init failed", e)
      throw EngineError(Code.FORMAT_UNAVAILABLE, "FFmpeg init failed: ${e.message} (cause: ${e.cause})")
    }
    val bin = File(ctx.applicationInfo.nativeLibraryDir, "libffmpeg.so")
    if (!bin.isFile) throw EngineError(Code.FORMAT_UNAVAILABLE, "FFmpeg binary not found at ${bin.path}")
    val packages = File(ctx.noBackupFilesDir, "youtubedl-android/packages")
    val lib = listOf(File(packages, "python/usr/lib"), File(packages, "ffmpeg/usr/lib"), File(ctx.applicationInfo.nativeLibraryDir))
      .joinToString(":") { it.absolutePath }
    binaryPath = bin
    ldLibraryPath = lib
    return bin to lib
  }

  /**
   * Stream-copy a video-only + audio-only file into one Matroska container. Throws EngineError on
   * failure. Suspend + runInterruptible so pause/cancel (which cancels the enclosing coroutine)
   * actually interrupts the blocking waitFor() and kills the subprocess, instead of leaving it
   * running in the background until it finishes on its own — the same class of bug the sequential
   * downloader (Downloader.kt's runCancellable) was fixed for earlier.
   */
  suspend fun mergeToMkv(ctx: Context, video: File, audio: File, out: File) {
    val (ffmpeg, ldLibraryPath) = paths(ctx)
    val cmd = listOf(ffmpeg.absolutePath, "-y", "-i", video.absolutePath, "-i", audio.absolutePath, "-c", "copy", "-map", "0:v:0", "-map", "1:a:0", out.absolutePath)
    val builder = ProcessBuilder(cmd).redirectErrorStream(true)
    builder.environment()["LD_LIBRARY_PATH"] = ldLibraryPath
    val process = try {
      builder.start()
    } catch (e: IOException) {
      // e.g. exec blocked (SELinux/W^X) or the binary isn't actually executable — surfaces as a
      // classified failure instead of an unlogged UNKNOWN.
      throw EngineError(Code.FORMAT_UNAVAILABLE, "Could not start FFmpeg: ${e.message}")
    }
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
