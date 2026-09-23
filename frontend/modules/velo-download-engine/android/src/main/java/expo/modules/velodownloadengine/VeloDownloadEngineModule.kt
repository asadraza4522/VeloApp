package expo.modules.velodownloadengine

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class PartRecord : Record {
  @Field var url: String = ""
  @Field var headers: Map<String, String> = emptyMap()
  @Field var expectedSize: Double? = null
  @Field var role: String = "main"
}

class JobRecord : Record {
  @Field var taskId: String = ""
  @Field var parts: List<PartRecord> = emptyList()
  @Field var kind: String = "video"
  @Field var relativePath: String = ""
  @Field var filename: String = ""
  @Field var mime: String = "application/octet-stream"
  @Field var postProcess: String = "none"
  @Field var title: String = ""
}

class ConstraintsRecord : Record {
  @Field var wifiOnly: Boolean = true
  @Field var maxConcurrent: Int = 3
}

private fun PartRecord.toPart() = Part(url, headers, expectedSize?.toLong(), role)

private fun TaskRecord.toMap(): Map<String, Any?> = mapOf(
  "taskId" to id, "state" to state, "bytes" to bytesDone.toDouble(), "total" to totalBytes?.toDouble(),
  "errorCode" to errorCode, "errorMessage" to errorMessage, "uri" to outputUri, "filename" to filename,
  "kind" to kind, "updatedAt" to updatedAt.toDouble(),
)

/** JS-facing download engine (PRD §59). All real work happens in DownloadWorker; this is a thin bridge. */
class VeloDownloadEngineModule : Module() {
  private val ctx: Context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("VeloDownloadEngine")

    Events("onProgress", "onStateChange", "onComplete")

    OnCreate {
      EngineEvents.listener = { name, payload -> sendEvent(name, payload) }
      Notifications.ensureChannels(ctx)
      DownloadWorker.configure(DownloadScheduler.maxConcurrent(ctx))
    }
    OnDestroy { EngineEvents.listener = null }

    AsyncFunction("enqueue") { job: JobRecord ->
      val store = TaskStore.get(ctx)
      val existing = store.get(job.taskId)
      if (existing != null && !State.isTerminal(existing.state)) return@AsyncFunction job.taskId // idempotent
      val now = System.currentTimeMillis()
      DownloadScheduler.enqueue(
        ctx,
        TaskRecord(
          id = job.taskId, parts = job.parts.map { it.toPart() }, kind = job.kind, relativePath = job.relativePath,
          filename = job.filename, mime = job.mime, postProcess = job.postProcess, title = job.title.ifEmpty { job.filename },
          state = State.QUEUED, bytesDone = 0, totalBytes = null, etag = null, errorCode = null, errorMessage = null,
          outputUri = null, createdAt = now, updatedAt = now,
        ),
      )
      job.taskId
    }

    AsyncFunction("pause") { id: String -> DownloadScheduler.pause(ctx, id) }
    AsyncFunction("resume") { id: String -> DownloadScheduler.resume(ctx, id) }
    AsyncFunction("cancel") { id: String -> DownloadScheduler.cancel(ctx, id) }
    AsyncFunction("retry") { id: String, parts: List<PartRecord>? -> DownloadScheduler.retry(ctx, id, parts?.map { it.toPart() }) }
    AsyncFunction("ack") { id: String -> DownloadScheduler.ack(ctx, id) }

    AsyncFunction("getStatus") { id: String -> TaskStore.get(ctx).get(id)?.toMap() }
    AsyncFunction("listAll") { -> TaskStore.get(ctx).all().map { it.toMap() } }

    AsyncFunction("setConstraints") { c: ConstraintsRecord ->
      DownloadScheduler.setConstraints(ctx, c.wifiOnly, c.maxConcurrent)
      DownloadWorker.configure(c.maxConcurrent)
    }
  }
}
