package expo.modules.velodownloadengine

import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking

class DownloaderTest {
  @get:Rule val tmp = TemporaryFolder()
  private lateinit var server: MockWebServer
  private val payload = ByteArray(300_000) { (it % 251).toByte() }

  @Before fun setUp() { server = MockWebServer().also { it.start() } }
  @After fun tearDown() { server.shutdown() }

  private fun body(bytes: ByteArray) = Buffer().write(bytes)
  private fun url() = server.url("/file.mp4").toString()

  @Test fun downloadsWholeFileAndReportsProgress() {
    server.enqueue(MockResponse().setBody(body(payload)).setHeader("ETag", "\"v1\""))
    val dest = tmp.newFile("a.part").also { it.delete() }
    var last = 0L
    val r = Downloader().download(url(), mapOf("User-Agent" to "T"), dest, null) { b, _ -> last = b }
    assertEquals(payload.size.toLong(), r.bytes)
    assertEquals("\"v1\"", r.etag)
    assertEquals(payload.size.toLong(), last)
    assertTrue(payload.contentEquals(dest.readBytes()))
    assertEquals("T", server.takeRequest().getHeader("User-Agent"))
  }

  @Test fun resumesFromPartialFileWithRangeAndIfRange() {
    val dest = tmp.newFile("b.part").also { it.writeBytes(payload.copyOfRange(0, 100_000)) }
    server.enqueue(
      MockResponse().setResponseCode(206).setHeader("Content-Range", "bytes 100000-299999/300000")
        .setBody(body(payload.copyOfRange(100_000, payload.size))),
    )
    val r = Downloader().download(url(), emptyMap(), dest, "\"v1\"") { _, _ -> }
    val req = server.takeRequest()
    assertEquals("bytes=100000-8488607", req.getHeader("Range")) // bounded to one 8 MiB chunk
    assertEquals("\"v1\"", req.getHeader("If-Range"))
    assertEquals(300_000L, r.total)
    assertTrue(payload.contentEquals(dest.readBytes()))
  }

  @Test fun restartsWhenServerIgnoresRange() {
    val dest = tmp.newFile("c.part").also { it.writeBytes(ByteArray(50_000) { 9 }) }
    server.enqueue(MockResponse().setResponseCode(200).setBody(body(payload))) // 200, not 206: file changed
    Downloader().download(url(), emptyMap(), dest, "\"old\"") { _, _ -> }
    assertTrue(payload.contentEquals(dest.readBytes()))
  }

  @Test fun partialAlreadyCompleteIs416ButAccepted() {
    val dest = tmp.newFile("d.part").also { it.writeBytes(payload) }
    server.enqueue(MockResponse().setResponseCode(416).setHeader("Content-Range", "bytes */300000"))
    val r = Downloader().download(url(), emptyMap(), dest, null) { _, _ -> }
    assertEquals(300_000L, r.bytes)
  }

  @Test fun oversizedPartialRestartsOnce() {
    val dest = tmp.newFile("e.part").also { it.writeBytes(ByteArray(400_000)) }
    server.enqueue(MockResponse().setResponseCode(416).setHeader("Content-Range", "bytes */300000"))
    server.enqueue(MockResponse().setBody(body(payload)))
    Downloader().download(url(), emptyMap(), dest, null) { _, _ -> }
    assertTrue(payload.contentEquals(dest.readBytes()))
  }

  private fun codeOf(status: Int): String {
    server.enqueue(MockResponse().setResponseCode(status))
    val dest = tmp.newFile("err$status.part").also { it.delete() }
    try {
      Downloader().download(url(), emptyMap(), dest, null) { _, _ -> }
      fail("expected EngineError")
    } catch (e: EngineError) {
      return e.code
    }
    return ""
  }

  @Test fun mapsHttpErrorsToCodes() {
    assertEquals(Code.URL_EXPIRED, codeOf(403))
    assertEquals(Code.URL_EXPIRED, codeOf(410))
    assertEquals(Code.MEDIA_NOT_FOUND, codeOf(404))
    assertEquals(Code.AUTH_REQUIRED, codeOf(401))
    assertEquals(Code.RATE_LIMITED, codeOf(429))
    assertEquals(Code.SERVER_ERROR, codeOf(503))
  }

  @Test fun truncatedBodyIsNetworkErrorAndKeepsPartialForResume() {
    server.enqueue(
      MockResponse().setHeader("Content-Length", "300000").setBody(body(payload.copyOfRange(0, 120_000)))
        .setSocketPolicy(okhttp3.mockwebserver.SocketPolicy.DISCONNECT_DURING_RESPONSE_BODY),
    )
    val dest = tmp.newFile("f.part").also { it.delete() }
    try {
      Downloader(retries = 0).download(url(), emptyMap(), dest, null) { _, _ -> }
      fail("expected EngineError")
    } catch (e: EngineError) {
      assertEquals(Code.NETWORK_ERROR, e.code)
    }
    assertTrue(dest.exists())
    assertFalse(dest.length() == 300_000L)
  }

  @Test fun cancelStopsTheDownload() {
    server.enqueue(MockResponse().setBody(body(payload)).throttleBody(20_000, 100, java.util.concurrent.TimeUnit.MILLISECONDS))
    val dest = tmp.newFile("g.part").also { it.delete() }
    val dl = Downloader()
    var threw: Throwable? = null
    val t = Thread {
      try { dl.download(url(), emptyMap(), dest, null) { _, _ -> } } catch (e: Throwable) { threw = e }
    }
    t.start()
    Thread.sleep(300)
    dl.cancel()
    t.join(5000)
    assertNotNull(threw)
    assertTrue(threw is DownloadCancelled)
  }

  @Test fun coroutineCancellationAbortsTheBlockedDownloadPromptly() = runBlocking {
    // Slow body: without the watcher this would keep reading for ~15 s after cancellation (the reported bug).
    server.enqueue(MockResponse().setBody(body(payload)).throttleBody(1_000, 100, java.util.concurrent.TimeUnit.MILLISECONDS))
    val dest = tmp.newFile("h.part").also { it.delete() }
    val dl = Downloader()
    val started = System.nanoTime()
    val job = CoroutineScope(Dispatchers.Default).async { dl.runCancellable { dl.download(url(), emptyMap(), dest, null) { _, _ -> } } }
    delay(400)
    job.cancel()
    var cancelled = false
    try { job.await() } catch (e: CancellationException) { cancelled = true } catch (e: DownloadCancelled) { cancelled = true }
    val ms = (System.nanoTime() - started) / 1_000_000
    assertTrue("expected cancellation", cancelled)
    assertTrue("download kept running for ${ms}ms after cancel", ms < 3_000)
    assertTrue("stopped early, file incomplete", dest.length() < payload.size)
  }

  // ---- bounded-range behaviour (the YouTube throttling fix) ------------------------------------------------

  private class RangeServer(val data: ByteArray, val etag: String = "\"v1\"") : okhttp3.mockwebserver.Dispatcher() {
    val ranges = java.util.concurrent.CopyOnWriteArrayList<String>()
    @Volatile var failNext = 0
    override fun dispatch(request: okhttp3.mockwebserver.RecordedRequest): MockResponse {
      val r = request.getHeader("Range") ?: return MockResponse().setBody(Buffer().write(data)).setHeader("ETag", etag)
      ranges += r
      if (failNext > 0) { failNext--; return MockResponse().setSocketPolicy(okhttp3.mockwebserver.SocketPolicy.DISCONNECT_AFTER_REQUEST) }
      val m = Regex("bytes=(\\d+)-(\\d+)").find(r)!!
      val a = m.groupValues[1].toInt()
      val b = minOf(m.groupValues[2].toInt(), data.size - 1)
      if (a >= data.size) return MockResponse().setResponseCode(416).setHeader("Content-Range", "bytes */${data.size}")
      return MockResponse().setResponseCode(206).setHeader("ETag", etag).setHeader("Content-Range", "bytes $a-$b/${data.size}")
        .setBody(Buffer().write(data.copyOfRange(a, b + 1)))
    }
  }

  @Test fun fetchesInBoundedRangeRequests() {
    val srv = RangeServer(payload); server.dispatcher = srv
    val dest = tmp.newFile("i.part").also { it.delete() }
    val chunk = 100_000L
    Downloader(chunkSize = chunk).download(url(), emptyMap(), dest, null) { _, _ -> }
    assertTrue(payload.contentEquals(dest.readBytes()))
    assertEquals(3, srv.ranges.size) // 300 000 bytes / 100 000 per request
    assertTrue("every request must be bounded", srv.ranges.all { Regex("bytes=\\d+-\\d+").matches(it) })
    assertEquals("bytes=0-99999", srv.ranges.first())
  }

  @Test fun resumesInBoundedChunksFromWherePartialStopped() {
    val srv = RangeServer(payload); server.dispatcher = srv
    val dest = tmp.newFile("j.part").also { it.writeBytes(payload.copyOfRange(0, 150_000)) }
    val r = Downloader(chunkSize = 100_000).download(url(), emptyMap(), dest, "\"v1\"") { _, _ -> }
    assertTrue(payload.contentEquals(dest.readBytes()))
    assertEquals("bytes=150000-249999", srv.ranges.first())
    assertEquals(300_000L, r.total)
  }

  @Test fun retriesATransientFailureWithoutRestarting() {
    val srv = RangeServer(payload); server.dispatcher = srv
    srv.failNext = 1
    val dest = tmp.newFile("k.part").also { it.delete() }
    Downloader(chunkSize = 100_000, retries = 2).download(url(), emptyMap(), dest, null) { _, _ -> }
    assertTrue(payload.contentEquals(dest.readBytes()))
  }

  @Test fun givesUpAfterTheRetryBudgetAndKeepsThePartial() {
    val srv = RangeServer(payload); server.dispatcher = srv
    srv.failNext = 10
    val dest = tmp.newFile("l.part").also { it.delete() }
    try {
      Downloader(chunkSize = 100_000, retries = 1).download(url(), emptyMap(), dest, null) { _, _ -> }
      fail("expected EngineError")
    } catch (e: EngineError) {
      assertEquals(Code.NETWORK_ERROR, e.code)
    }
  }

  @Test fun progressIsMonotonicAcrossChunks() {
    val srv = RangeServer(payload); server.dispatcher = srv
    val dest = tmp.newFile("m.part").also { it.delete() }
    val seen = mutableListOf<Long>()
    Downloader(chunkSize = 100_000).download(url(), emptyMap(), dest, null) { b, _ -> seen += b }
    assertEquals(seen.sorted(), seen)
    assertEquals(300_000L, seen.last())
  }
}
