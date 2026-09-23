package expo.modules.velodownloadengine

import android.content.Context
import android.net.Uri
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JS-facing wrapper for [MediaTools]. Engine errors surface to JS with their code (e.g. FORMAT_UNAVAILABLE). */
class VeloMediaToolsModule : Module() {
  private val ctx: Context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun <T> guarded(block: () -> T): T = try {
    block()
  } catch (e: EngineError) {
    throw CodedException(e.code, e.message, e)
  } catch (e: DownloadCancelled) {
    throw CodedException("CANCELLED", "Cancelled", e)
  } catch (e: SecurityException) {
    throw CodedException("MEDIA_NOT_FOUND", "No permission to read this file", e)
  }

  override fun definition() = ModuleDefinition {
    Name("VeloMediaTools")
    Events("onToolProgress")

    fun progress(opId: String) = { p: Double -> sendEvent("onToolProgress", mapOf("opId" to opId, "progress" to p)) }

    AsyncFunction("probe") { uri: String -> guarded { MediaTools.probe(ctx, Uri.parse(uri)) } }
    AsyncFunction("extractAudio") { uri: String, filename: String, relPath: String, opId: String ->
      guarded { MediaTools.extractAudio(ctx, Uri.parse(uri), filename, relPath, opId, progress(opId)) }
    }
    AsyncFunction("trim") { uri: String, startMs: Double, endMs: Double, filename: String, relPath: String, opId: String ->
      guarded { MediaTools.trim(ctx, Uri.parse(uri), startMs.toLong(), endMs.toLong(), filename, relPath, opId, progress(opId)) }
    }
    AsyncFunction("frame") { uri: String, atMs: Double, format: String, filename: String, relPath: String ->
      guarded { MediaTools.frame(ctx, Uri.parse(uri), atMs.toLong(), format, filename, relPath) }
    }
    AsyncFunction("imageProcess") { uri: String, format: String, quality: Int, maxDimension: Int, filename: String, relPath: String ->
      guarded { MediaTools.imageProcess(ctx, Uri.parse(uri), format, quality, maxDimension, filename, relPath) }
    }
    AsyncFunction("sha256") { uri: String, opId: String -> guarded { MediaTools.sha256(ctx, Uri.parse(uri), opId) } }
    AsyncFunction("cancel") { opId: String -> MediaTools.cancel(opId) }

    AsyncFunction("describe") { uri: String -> MediaStoreWriter.describe(ctx, Uri.parse(uri)) }
    AsyncFunction("describeMany") { uris: List<String> -> uris.map { MediaStoreWriter.describe(ctx, Uri.parse(it)) } }
    AsyncFunction("move") { uri: String, relPath: String, name: String, kind: String -> MediaStoreWriter.move(ctx, Uri.parse(uri), relPath, name, kind) }
  }
}
