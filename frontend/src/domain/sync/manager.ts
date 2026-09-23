// Decides *when* to sync: debounced, one at a time, exponential backoff on failure. Pure timing logic, no I/O of its own.
import type { SyncOutcome } from "@/domain/sync/engine";

export type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void };
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

export class SyncManager {
  private timer: unknown = null;
  private inflight: Promise<SyncOutcome> | null = null;
  private again = false;
  private stopped = false;
  private failures = 0;
  last: SyncOutcome | null = null;

  constructor(
    private readonly run: () => Promise<SyncOutcome>,
    private readonly opts: { debounceMs?: number; baseBackoffMs?: number; maxBackoffMs?: number; timers?: Timers; onResult?: (o: SyncOutcome) => void } = {},
  ) {}

  private get t() { return this.opts.timers ?? realTimers; }

  /** Ask for a sync soon. Bursts (many local writes, connectivity flapping) collapse into one run. */
  request() {
    if (this.stopped) return;
    if (this.inflight) { this.again = true; return; }
    this.schedule(this.opts.debounceMs ?? 1500);
  }

  /** Sync right now (Settings → Sync now). Shares the in-flight run if there is one. */
  syncNow(): Promise<SyncOutcome> {
    if (this.timer) { this.t.clear(this.timer); this.timer = null; }
    return this.inflight ?? this.execute();
  }

  stop() {
    this.stopped = true;
    if (this.timer) this.t.clear(this.timer);
    this.timer = null;
  }

  private schedule(ms: number) {
    if (this.timer) this.t.clear(this.timer);
    this.timer = this.t.set(() => { this.timer = null; void this.execute(); }, ms);
  }

  private execute(): Promise<SyncOutcome> {
    this.inflight = this.run()
      .catch((e): SyncOutcome => ({ ok: false, at: Date.now(), pushed: 0, pulled: 0, parked: 0, pending: 0, error: "network", message: String(e) }))
      .then((o) => {
        this.last = o;
        this.opts.onResult?.(o);
        this.inflight = null;
        // Retryable failures (offline, server down, no session) back off; a rejected row is parked, not retried in a loop.
        if (!o.ok && o.error !== "row") {
          this.failures++;
          const backoff = Math.min((this.opts.baseBackoffMs ?? 5000) * 2 ** (this.failures - 1), this.opts.maxBackoffMs ?? 300_000);
          if (!this.stopped) this.schedule(backoff);
        } else {
          this.failures = 0;
          if (this.again && !this.stopped) this.schedule(this.opts.debounceMs ?? 1500);
        }
        this.again = false;
        return o;
      });
    return this.inflight;
  }
}
