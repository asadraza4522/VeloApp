package expo.modules.velodownloadengine

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import java.io.File

/** Scoped-storage writes into shared media collections. No storage permission needed (minSdk 29). */
object MediaStoreWriter {
  private const val ROOT = "Velo"

  private fun collection(kind: String): Uri = when (kind) {
    "video" -> MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    "audio" -> MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    "image" -> MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    else -> MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
  }

  private fun rootDir(kind: String) = when (kind) {
    "video" -> Environment.DIRECTORY_MOVIES
    "audio" -> Environment.DIRECTORY_MUSIC
    "image" -> Environment.DIRECTORY_PICTURES
    else -> Environment.DIRECTORY_DOWNLOADS
  }

  /** Copies [src] into MediaStore (pending → visible once complete) and returns its content:// URI. */
  fun save(ctx: Context, src: File, kind: String, relativePath: String, filename: String, mime: String): Uri {
    val rel = listOf(rootDir(kind), ROOT, relativePath.trim('/')).filter { it.isNotEmpty() }.joinToString("/") + "/"
    val resolver = ctx.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, filename)
      put(MediaStore.MediaColumns.MIME_TYPE, mime)
      put(MediaStore.MediaColumns.RELATIVE_PATH, rel)
      put(MediaStore.MediaColumns.IS_PENDING, 1)
    }
    val uri = resolver.insert(collection(kind), values) ?: throw EngineError(Code.STORAGE_FULL, "Could not create the file in shared storage")
    try {
      resolver.openOutputStream(uri, "w").use { out ->
        if (out == null) throw EngineError(Code.STORAGE_FULL, "Could not open the destination file")
        src.inputStream().use { it.copyTo(out, 256 * 1024) }
      }
      resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
    } catch (e: Exception) {
      resolver.delete(uri, null, null) // never leave a half-written entry behind
      throw if (e is EngineError) e else EngineError(Code.STORAGE_FULL, e.message ?: "Write failed")
    }
    return uri
  }

  fun exists(ctx: Context, uri: Uri): Boolean = try {
    ctx.contentResolver.query(uri, arrayOf(MediaStore.MediaColumns._ID), null, null, null)?.use { it.moveToFirst() } ?: false
  } catch (_: Exception) {
    false // permission lost / provider gone: treat as missing (PRD §14)
  }

  fun delete(ctx: Context, uri: Uri): Boolean = try {
    ctx.contentResolver.delete(uri, null, null) > 0
  } catch (_: Exception) {
    false
  }

  /** Name/size/folder of one of our media entries (null when it is gone). */
  fun describe(ctx: Context, uri: Uri): Map<String, Any?>? = try {
    val cols = arrayOf(MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.RELATIVE_PATH, MediaStore.MediaColumns.SIZE, MediaStore.MediaColumns.MIME_TYPE)
    ctx.contentResolver.query(uri, cols, null, null, null)?.use { c ->
      if (!c.moveToFirst()) null
      else mapOf("name" to c.getString(0), "relativePath" to c.getString(1), "size" to c.getLong(2).toDouble(), "mime" to c.getString(3))
    }
  } catch (_: Exception) { null }

  /** Rename / move within the same root (Movies|Music|Pictures|Download). Works for files this app created. */
  fun move(ctx: Context, uri: Uri, relativePath: String, name: String, kind: String): Boolean = try {
    val rel = listOf(rootDir(kind), ROOT, relativePath.trim('/')).filter { it.isNotEmpty() }.joinToString("/") + "/"
    val v = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, name)
      put(MediaStore.MediaColumns.RELATIVE_PATH, rel)
    }
    ctx.contentResolver.update(uri, v, null, null) > 0
  } catch (_: Exception) { false }

  fun uriFor(kind: String, id: Long): Uri = ContentUris.withAppendedId(collection(kind), id)

  val watchedCollections: List<Uri> by lazy {
    listOf("video", "audio", "image", "file").map { collection(it) }
  }
}
