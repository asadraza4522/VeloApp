package expo.modules.velodownloadengine

import android.content.Context
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import java.io.File

/** Owns the transitions the app can request (enqueue / pause / resume / cancel / retry); WorkManager does the running. */
object DownloadScheduler {
  private const val PREFS = "velo_engine"

  fun wifiOnly(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("wifi_only", true)
  fun maxConcurrent(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt("max_concurrent", 3)

  fun setConstraints(ctx: Context, wifiOnly: Boolean, maxConcurrent: Int) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putBoolean("wifi_only", wifiOnly).putInt("max_concurrent", maxConcurrent.coerceIn(1, 6)).apply()
  }

  fun tempDir(ctx: Context): File = File(ctx.getExternalFilesDir(null) ?: ctx.filesDir, "downloads").also { it.mkdirs() }

  fun enqueue(ctx: Context, task: TaskRecord) {
    TaskStore.get(ctx).insert(task)
    schedule(ctx, task.id)
    EngineEvents.state(task.id, task.state)
  }

  fun pause(ctx: Context, id: String) {
    val store = TaskStore.get(ctx)
    val t = store.get(id) ?: return
    if (State.isTerminal(t.state)) return
    store.setState(id, State.PAUSED)          // set first: the worker reads it when it is stopped
    WorkManager.getInstance(ctx).cancelUniqueWork(workName(id))
    EngineEvents.state(id, State.PAUSED)
  }

  fun resume(ctx: Context, id: String) {
    val store = TaskStore.get(ctx)
    val t = store.get(id) ?: return
    if (t.state == State.COMPLETED || t.state == State.DOWNLOADING || t.state == State.PROCESSING) return
    store.setState(id, State.QUEUED)
    schedule(ctx, id)
    EngineEvents.state(id, State.QUEUED)
  }

  fun cancel(ctx: Context, id: String) {
    val store = TaskStore.get(ctx)
    val t = store.get(id) ?: return
    if (t.state == State.COMPLETED) return
    store.setState(id, State.CANCELED)
    WorkManager.getInstance(ctx).cancelUniqueWork(workName(id))
    cleanup(ctx, id)
    EngineEvents.state(id, State.CANCELED)
  }

  /** Retry a failed/canceled task, optionally with fresh URLs (after JS re-resolved an expired link). Partial data is kept. */
  fun retry(ctx: Context, id: String, newParts: List<Part>?) {
    val store = TaskStore.get(ctx)
    store.get(id) ?: return
    if (newParts != null) store.replaceParts(id, newParts)
    store.setState(id, State.QUEUED)
    schedule(ctx, id)
    EngineEvents.state(id, State.QUEUED)
  }

  /** Terminal tasks stay in the store until JS acknowledges them (it may have been dead when they finished). */
  fun ack(ctx: Context, id: String) {
    val store = TaskStore.get(ctx)
    val t = store.get(id) ?: return
    if (!State.isTerminal(t.state)) return
    cleanup(ctx, id)
    store.delete(id)
    TaskLocks.forget(id)
  }

  fun cleanup(ctx: Context, id: String) {
    tempDir(ctx).listFiles { f -> f.name.startsWith("$id.") }?.forEach { it.delete() }
  }

  private fun workName(id: String) = "velo-dl-$id"

  private fun schedule(ctx: Context, id: String) {
    val constraints = Constraints.Builder()
      .setRequiredNetworkType(if (wifiOnly(ctx)) NetworkType.UNMETERED else NetworkType.CONNECTED)
      .build()
    val req = OneTimeWorkRequestBuilder<DownloadWorker>()
      .setInputData(Data.Builder().putString("taskId", id).build())
      .setConstraints(constraints)
      .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
      .build()
    WorkManager.getInstance(ctx).enqueueUniqueWork(workName(id), ExistingWorkPolicy.REPLACE, req)
  }
}
