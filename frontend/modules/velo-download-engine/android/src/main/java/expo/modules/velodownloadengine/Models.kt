package expo.modules.velodownloadengine

/** Task lifecycle as seen by the engine. JS maps these onto the PRD §29 state machine. */
object State {
  const val QUEUED = "QUEUED"
  const val DOWNLOADING = "DOWNLOADING"
  const val PROCESSING = "PROCESSING"
  const val PAUSED = "PAUSED"
  const val COMPLETED = "COMPLETED"
  const val FAILED = "FAILED"
  const val CANCELED = "CANCELED"

  fun isTerminal(s: String) = s == COMPLETED || s == FAILED || s == CANCELED
}

/** Error codes are PRD §16 failure codes, plus URL_EXPIRED (403/410: JS re-resolves once) and STORAGE_FULL. */
object Code {
  const val URL_EXPIRED = "URL_EXPIRED"
  const val NETWORK_ERROR = "NETWORK_ERROR"
  const val AUTH_REQUIRED = "AUTH_REQUIRED"
  const val MEDIA_NOT_FOUND = "MEDIA_NOT_FOUND"
  const val RATE_LIMITED = "RATE_LIMITED"
  const val SERVER_ERROR = "SERVER_ERROR"
  const val FORMAT_UNAVAILABLE = "FORMAT_UNAVAILABLE"
  const val STORAGE_FULL = "STORAGE_FULL"
  const val UNKNOWN = "UNKNOWN"
}

class EngineError(val code: String, message: String) : Exception(message)

/** Thrown inside the download loop when the worker was cancelled (pause / cancel / constraint loss). */
class DownloadCancelled : Exception()

data class Part(
  val url: String,
  val headers: Map<String, String>,
  val expectedSize: Long?,
  val role: String, // "main" | "video" | "audio"
)

data class TaskRecord(
  val id: String,
  val parts: List<Part>,
  val kind: String,           // video | audio | image | file (MediaStore collection)
  val relativePath: String,   // under Movies|Music|Pictures|Download / Velo /
  val filename: String,
  val mime: String,
  val postProcess: String,    // none | mux | extract-audio
  val title: String,
  val state: String,
  val bytesDone: Long,
  val totalBytes: Long?,
  val etag: String?,
  val errorCode: String?,
  val errorMessage: String?,
  val outputUri: String?,
  val createdAt: Long,
  val updatedAt: Long,
)
