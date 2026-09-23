package expo.modules.velodownloadengine

import kotlinx.coroutines.sync.Mutex
import java.util.concurrent.ConcurrentHashMap

/**
 * One worker per task at a time. A pause→resume (or retry) enqueues a new worker while the old one may still be
 * unwinding; without this both could write the same `.part` file and report progress, which shows up as the
 * progress bar jumping (e.g. 10% → 60%).
 */
object TaskLocks {
  private val locks = ConcurrentHashMap<String, Mutex>()
  fun mutexFor(id: String): Mutex = locks.getOrPut(id) { Mutex() }
  fun forget(id: String) { locks.remove(id) }
}
