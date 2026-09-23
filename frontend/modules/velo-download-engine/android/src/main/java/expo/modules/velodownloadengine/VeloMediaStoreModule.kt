package expo.modules.velodownloadengine

import android.content.Context
import android.content.Intent
import android.database.ContentObserver
import android.net.Uri
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Missing-file detection and open/share for downloaded media (PRD §14). Never deletes a source; only the file. */
class VeloMediaStoreModule : Module() {
  private val ctx: Context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private val handler = Handler(Looper.getMainLooper())
  private var pending: Runnable? = null
  private var observer: ContentObserver? = null

  override fun definition() = ModuleDefinition {
    Name("VeloMediaStore")

    Events("onMediaChanged")

    OnCreate {
      val obs = object : ContentObserver(handler) {
        override fun onChange(selfChange: Boolean) {
          pending?.let { handler.removeCallbacks(it) }
          pending = Runnable { sendEvent("onMediaChanged", android.os.Bundle()) }.also { handler.postDelayed(it, 500) } // debounce bursts
        }
      }
      observer = obs
      MediaStoreWriter.watchedCollections.forEach { ctx.contentResolver.registerContentObserver(it, true, obs) }
    }
    OnDestroy {
      observer?.let { ctx.contentResolver.unregisterContentObserver(it) }
      pending?.let { handler.removeCallbacks(it) }
    }

    AsyncFunction("exists") { uri: String -> MediaStoreWriter.exists(ctx, Uri.parse(uri)) }
    AsyncFunction("existsMany") { uris: List<String> -> uris.map { MediaStoreWriter.exists(ctx, Uri.parse(it)) } }
    AsyncFunction("delete") { uri: String -> MediaStoreWriter.delete(ctx, Uri.parse(uri)) }

    AsyncFunction("openInFiles") { uri: String, mime: String ->
      launch(Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(uri), mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
    }
    AsyncFunction("shareFile") { uri: String, mime: String ->
      val send = Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, Uri.parse(uri)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      launch(Intent.createChooser(send, null))
    }
  }

  private fun launch(intent: Intent) {
    val host = appContext.currentActivity ?: ctx
    if (host !is android.app.Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    host.startActivity(intent)
  }
}
