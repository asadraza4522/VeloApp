package expo.modules.velodownloadengine

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import androidx.core.app.NotificationCompat

object Notifications {
  const val CH_ACTIVE = "downloads-active"
  const val CH_DONE = "downloads-done"
  const val CH_FAILED = "downloads-failed"

  fun ensureChannels(ctx: Context) {
    val nm = ctx.getSystemService(NotificationManager::class.java)
    nm.createNotificationChannel(NotificationChannel(CH_ACTIVE, "Active downloads", NotificationManager.IMPORTANCE_LOW))
    nm.createNotificationChannel(NotificationChannel(CH_DONE, "Completed downloads", NotificationManager.IMPORTANCE_DEFAULT))
    nm.createNotificationChannel(NotificationChannel(CH_FAILED, "Failed downloads", NotificationManager.IMPORTANCE_DEFAULT))
  }

  private fun openApp(ctx: Context): PendingIntent? {
    val intent = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return null
    return PendingIntent.getActivity(ctx, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  fun progress(ctx: Context, title: String, bytes: Long, total: Long?, state: String): Notification {
    ensureChannels(ctx)
    val b = NotificationCompat.Builder(ctx, CH_ACTIVE)
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setContentTitle(title)
      .setOnlyAlertOnce(true).setOngoing(true).setContentIntent(openApp(ctx))
    if (state == State.PROCESSING) b.setContentText("Processing…").setProgress(0, 0, true)
    else if (total != null && total > 0) b.setContentText("${(bytes * 100 / total).toInt()}%").setProgress(100, (bytes * 100 / total).toInt(), false)
    else b.setContentText("Downloading…").setProgress(0, 0, true)
    return b.build()
  }

  fun done(ctx: Context, id: String, title: String) {
    ensureChannels(ctx)
    val n = NotificationCompat.Builder(ctx, CH_DONE).setSmallIcon(android.R.drawable.stat_sys_download_done)
      .setContentTitle(title).setContentText("Download complete").setAutoCancel(true).setContentIntent(openApp(ctx)).build()
    notify(ctx, id, n)
  }

  fun failed(ctx: Context, id: String, title: String, code: String) {
    ensureChannels(ctx)
    val n = NotificationCompat.Builder(ctx, CH_FAILED).setSmallIcon(android.R.drawable.stat_notify_error)
      .setContentTitle(title).setContentText("Download failed ($code)").setAutoCancel(true).setContentIntent(openApp(ctx)).build()
    notify(ctx, id, n)
  }

  fun notificationId(taskId: String) = taskId.hashCode() and 0x7fffffff

  private fun notify(ctx: Context, id: String, n: Notification) {
    // POST_NOTIFICATIONS may be denied on Android 13+; the download itself must never depend on it.
    runCatching { ctx.getSystemService(NotificationManager::class.java).notify(notificationId(id) + 1, n) }
  }
}
