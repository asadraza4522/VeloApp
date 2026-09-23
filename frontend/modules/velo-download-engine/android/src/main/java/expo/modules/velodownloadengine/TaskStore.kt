package expo.modules.velodownloadengine

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject

/**
 * The engine's own persistent task table. It is authoritative for byte-level state and survives process
 * death and reboot; JS mirrors it into its SQLite and reconciles on start (docs plan §7.2).
 * Plain SQLiteOpenHelper on purpose: no annotation processing needed for one small table.
 */
class TaskStore private constructor(ctx: Context) : SQLiteOpenHelper(ctx.applicationContext, "velo_engine.db", null, 1) {
  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL(
      """CREATE TABLE tasks (
        id TEXT PRIMARY KEY, parts TEXT NOT NULL, kind TEXT NOT NULL, rel_path TEXT NOT NULL, filename TEXT NOT NULL,
        mime TEXT NOT NULL, post_process TEXT NOT NULL, title TEXT NOT NULL, state TEXT NOT NULL,
        bytes_done INTEGER NOT NULL DEFAULT 0, total_bytes INTEGER, etag TEXT, error_code TEXT, error_message TEXT,
        output_uri TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)""",
    )
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}

  fun insert(t: TaskRecord) {
    writableDatabase.insertWithOnConflict("tasks", null, values(t), SQLiteDatabase.CONFLICT_REPLACE)
  }

  fun get(id: String): TaskRecord? =
    readableDatabase.query("tasks", null, "id = ?", arrayOf(id), null, null, null).use { if (it.moveToFirst()) read(it) else null }

  fun all(): List<TaskRecord> =
    readableDatabase.query("tasks", null, null, null, null, null, "created_at ASC").use { c -> buildList { while (c.moveToNext()) add(read(c)) } }

  fun setState(id: String, state: String, errorCode: String? = null, errorMessage: String? = null) {
    val v = ContentValues().apply {
      put("state", state); put("error_code", errorCode); put("error_message", errorMessage); put("updated_at", System.currentTimeMillis())
    }
    writableDatabase.update("tasks", v, "id = ?", arrayOf(id))
  }

  fun setProgress(id: String, bytes: Long, total: Long?, etag: String?) {
    val v = ContentValues().apply {
      put("bytes_done", bytes); put("total_bytes", total); if (etag != null) put("etag", etag); put("updated_at", System.currentTimeMillis())
    }
    writableDatabase.update("tasks", v, "id = ?", arrayOf(id))
  }

  fun complete(id: String, outputUri: String, size: Long) {
    val v = ContentValues().apply {
      put("state", State.COMPLETED); put("output_uri", outputUri); put("bytes_done", size); put("total_bytes", size)
      putNull("error_code"); put("updated_at", System.currentTimeMillis())
    }
    writableDatabase.update("tasks", v, "id = ?", arrayOf(id))
  }

  fun replaceParts(id: String, parts: List<Part>) {
    writableDatabase.update("tasks", ContentValues().apply { put("parts", encodeParts(parts)) }, "id = ?", arrayOf(id))
  }

  fun delete(id: String) {
    writableDatabase.delete("tasks", "id = ?", arrayOf(id))
  }

  private fun values(t: TaskRecord) = ContentValues().apply {
    put("id", t.id); put("parts", encodeParts(t.parts)); put("kind", t.kind); put("rel_path", t.relativePath)
    put("filename", t.filename); put("mime", t.mime); put("post_process", t.postProcess); put("title", t.title)
    put("state", t.state); put("bytes_done", t.bytesDone); put("total_bytes", t.totalBytes); put("etag", t.etag)
    put("error_code", t.errorCode); put("error_message", t.errorMessage); put("output_uri", t.outputUri)
    put("created_at", t.createdAt); put("updated_at", t.updatedAt)
  }

  private fun read(c: Cursor) = TaskRecord(
    id = c.str("id")!!, parts = decodeParts(c.str("parts")!!), kind = c.str("kind")!!, relativePath = c.str("rel_path")!!,
    filename = c.str("filename")!!, mime = c.str("mime")!!, postProcess = c.str("post_process")!!, title = c.str("title")!!,
    state = c.str("state")!!, bytesDone = c.lng("bytes_done") ?: 0, totalBytes = c.lng("total_bytes"), etag = c.str("etag"),
    errorCode = c.str("error_code"), errorMessage = c.str("error_message"), outputUri = c.str("output_uri"),
    createdAt = c.lng("created_at") ?: 0, updatedAt = c.lng("updated_at") ?: 0,
  )

  private fun Cursor.str(col: String): String? = getColumnIndexOrThrow(col).let { if (isNull(it)) null else getString(it) }
  private fun Cursor.lng(col: String): Long? = getColumnIndexOrThrow(col).let { if (isNull(it)) null else getLong(it) }

  companion object {
    @Volatile private var instance: TaskStore? = null
    fun get(ctx: Context): TaskStore = instance ?: synchronized(this) { instance ?: TaskStore(ctx).also { instance = it } }

    fun encodeParts(parts: List<Part>): String = JSONArray().also { arr ->
      parts.forEach { p ->
        arr.put(JSONObject().put("url", p.url).put("role", p.role).put("expected", p.expectedSize ?: JSONObject.NULL)
          .put("headers", JSONObject(p.headers as Map<*, *>)))
      }
    }.toString()

    fun decodeParts(json: String): List<Part> {
      val arr = JSONArray(json)
      return (0 until arr.length()).map { i ->
        val o = arr.getJSONObject(i)
        val h = o.getJSONObject("headers")
        Part(o.getString("url"), h.keys().asSequence().associateWith { h.getString(it) }, if (o.isNull("expected")) null else o.getLong("expected"), o.getString("role"))
      }
    }
  }
}
