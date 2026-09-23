package expo.modules.velodownloadengine

import android.os.Bundle

/** Bridges the worker (which may outlive the JS runtime) to the Expo module's events. No listener = dropped; JS reconciles from TaskStore. */
object EngineEvents {
  @Volatile var listener: ((name: String, payload: Bundle) -> Unit)? = null

  private fun emit(name: String, payload: Bundle) = listener?.invoke(name, payload)

  fun progress(id: String, bytes: Long, total: Long?, bytesPerSec: Long) = emit(
    "onProgress",
    Bundle().apply { putString("taskId", id); putDouble("bytes", bytes.toDouble()); total?.let { putDouble("total", it.toDouble()) }; putDouble("bytesPerSec", bytesPerSec.toDouble()) },
  )

  fun state(id: String, state: String, errorCode: String? = null, errorMessage: String? = null) = emit(
    "onStateChange",
    Bundle().apply { putString("taskId", id); putString("state", state); errorCode?.let { putString("errorCode", it) }; errorMessage?.let { putString("errorMessage", it) } },
  )

  fun complete(id: String, uri: String, filename: String, size: Long) = emit(
    "onComplete",
    Bundle().apply { putString("taskId", id); putString("uri", uri); putString("filename", filename); putDouble("size", size.toDouble()) },
  )
}
