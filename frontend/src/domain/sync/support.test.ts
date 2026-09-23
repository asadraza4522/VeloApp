import { premiumUntil, getFlag, hasEntitlement, refreshServerCaches, rewardedSecondsToday, CACHE_TTL_MS } from "@/domain/sync/caches";
import { FakeRemote } from "@/domain/sync/fake-remote";
import { SyncManager, type Timers } from "@/domain/sync/manager";
import type { SyncOutcome } from "@/domain/sync/engine";
import { processPendingResolves } from "@/domain/sync/resolve-queue";
import { createSource } from "@/db/queries/sources";
import { createTestDb } from "@/db/test-db";
import type { ResolveOutcome } from "@/domain/resolve/client";
import { mediaSources } from "@/db/schema";
import { eq } from "drizzle-orm";

const ok = (over: Partial<SyncOutcome> = {}): SyncOutcome => ({ ok: true, at: 1, pushed: 0, pulled: 0, parked: 0, pending: 0, ...over });

describe("SyncManager timing", () => {
  let now = 0;
  let queue: { at: number; fn: () => void; id: number }[] = [];
  let next = 1;
  const timers: Timers = {
    set: (fn, ms) => { const h = { at: now + ms, fn, id: next++ }; queue.push(h); return h.id; },
    clear: (h) => { queue = queue.filter((q) => q.id !== h); },
  };
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = queue.filter((q) => q.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      queue = queue.filter((q) => q !== due);
      now = due.at;
      due.fn();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    }
    now = end;
  };
  beforeEach(() => { now = 0; queue = []; });

  it("collapses a burst of requests into one run", async () => {
    const run = jest.fn(async () => ok());
    const m = new SyncManager(run, { timers, debounceMs: 1000 });
    for (let i = 0; i < 20; i++) m.request();
    await advance(999);
    expect(run).not.toHaveBeenCalled();
    await advance(2);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("never runs two syncs at once; a request during a run schedules one follow-up", async () => {
    let release!: () => void;
    let running = 0, maxRunning = 0, calls = 0;
    const run = jest.fn(() => { calls++; running++; maxRunning = Math.max(maxRunning, running); return new Promise<SyncOutcome>((res) => { release = () => { running--; res(ok()); }; }); });
    const m = new SyncManager(run, { timers, debounceMs: 100 });
    m.request();
    await advance(100);
    m.request(); m.request();
    await advance(500);
    expect(calls).toBe(1);
    release();
    for (let i = 0; i < 10; i++) await Promise.resolve(); // let the run's promise chain settle and schedule the follow-up
    await advance(200);
    expect(calls).toBe(2);
    release();
    expect(maxRunning).toBe(1);
  });

  it("backs off exponentially on retryable failures, capped, and resets after success", async () => {
    const results = [ok({ ok: false, error: "network" }), ok({ ok: false, error: "network" }), ok({ ok: false, error: "server" }), ok()];
    const times: number[] = [];
    const run = jest.fn(async () => { times.push(now); return results[Math.min(times.length - 1, results.length - 1)]; });
    const m = new SyncManager(run, { timers, debounceMs: 0, baseBackoffMs: 1000, maxBackoffMs: 3000 });
    m.request();
    await advance(20_000);
    expect(times.slice(0, 4)).toEqual([0, 1000, 3000, 6000]); // +1s, +2s, +3s (capped)
    expect(run).toHaveBeenCalledTimes(4); // success stops the retries
  });

  it("a rejected row (parked) does not cause retry loops", async () => {
    const run = jest.fn(async () => ok({ ok: false, error: "row" }));
    const m = new SyncManager(run, { timers, debounceMs: 0, baseBackoffMs: 1000 });
    m.request();
    await advance(60_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("syncNow shares the in-flight run and stop() cancels everything", async () => {
    const run = jest.fn(async () => ok());
    const m = new SyncManager(run, { timers, debounceMs: 1000 });
    m.request();
    const [a, b] = await Promise.all([m.syncNow(), m.syncNow()]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    m.request();
    m.stop();
    await advance(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("server caches (offline-safe)", () => {
  it("refreshes at most once per TTL and answers flags/entitlements locally afterwards", async () => {
    const db = createTestDb();
    const remote = new FakeRemote();
    remote.entitlementRows = [{ feature: "premium", enabled: true, expires_at: new Date(10_000_000).toISOString() }];
    const spy = jest.spyOn(remote, "flags");
    expect(getFlag(db, "rewarded_hours_per_day", 3)).toBe(3); // nothing cached yet → default
    expect(await refreshServerCaches(db, remote, 1_000)).toBe(true);
    expect(await refreshServerCaches(db, remote, 1_000 + CACHE_TTL_MS - 1)).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await refreshServerCaches(db, remote, 1_000 + CACHE_TTL_MS)).toBe(true);

    remote.offline = true; // now offline: everything still readable
    expect(getFlag(db, "rewarded_hours_per_day", 3)).toBe(4);
    expect(hasEntitlement(db, "premium", 5_000_000)).toBe(true);
  });

  it("premium stops counting the moment it expires, even offline", async () => {
    const db = createTestDb();
    const remote = new FakeRemote();
    remote.entitlementRows = [{ feature: "premium", enabled: true, expires_at: new Date(10_000).toISOString() }];
    await refreshServerCaches(db, remote, 1);
    expect(hasEntitlement(db, "premium", 9_999)).toBe(true);
    expect(hasEntitlement(db, "premium", 10_000)).toBe(false);
    expect(premiumUntil(db, 5_000)).toBe(10_000);
    expect(premiumUntil(db, 20_000)).toBeNull();
    expect(hasEntitlement(db, "adfree", 1)).toBe(false);
  });
});

describe("usage snapshot", () => {
  it("rewarded seconds count for the same UTC day only", async () => {
    const db = createTestDb();
    const remote = new FakeRemote();
    remote.usage = { rewarded_seconds: 7200 };
    const noon = Date.parse("2026-09-21T12:00:00Z");
    await refreshServerCaches(db, remote, noon);
    expect(rewardedSecondsToday(db, noon + 3_600_000)).toBe(7200);
    expect(rewardedSecondsToday(db, Date.parse("2026-09-22T00:00:01Z"))).toBe(0); // new day: cap resets
    expect(rewardedSecondsToday(createTestDb())).toBe(0);
  });
});

describe("offline resolve queue", () => {
  const meta = (title: string): ResolveOutcome => ({
    ok: true,
    result: { resolver_id: "ytdlp", resolved_at: 1, degraded: false, variants: [], metadata: { source_url: "u", platform: "YouTube", title, media_type: "video" } },
  });

  it("resolves links saved offline once the network is back", async () => {
    const db = createTestDb();
    const a = createSource(db, { url: "https://example.com/a" }, 1).source;
    const b = createSource(db, { url: "https://example.com/b" }, 2).source;
    const r = await processPendingResolves(db, async (u) => meta(`T ${u.slice(-1)}`));
    expect(r).toEqual({ resolved: 2, failed: 0, offline: false });
    expect(db.select().from(mediaSources).where(eq(mediaSources.id, a.id)).get()).toMatchObject({ title: "T a", resolveState: "done", status: "resolved" });
    expect(db.select().from(mediaSources).where(eq(mediaSources.id, b.id)).get()!.title).toBe("T b");
    expect((await processPendingResolves(db, async () => meta("x"))).resolved).toBe(0); // nothing pending any more
  });

  it("stops at the first network error and keeps the rest pending; real failures are recorded", async () => {
    const db = createTestDb();
    createSource(db, { url: "https://example.com/1" }, 1);
    createSource(db, { url: "https://example.com/2" }, 2);
    createSource(db, { url: "https://example.com/3" }, 3);
    let n = 0;
    const r = await processPendingResolves(db, async () => (++n === 1 ? ({ ok: false, code: "AUTH_REQUIRED", message: "" } as const) : ({ ok: false, code: "NETWORK_ERROR", message: "" } as const)));
    expect(r).toMatchObject({ failed: 1, resolved: 0, offline: true });
    const rows = db.select().from(mediaSources).all();
    expect(rows.filter((x) => x.status === "failed")).toHaveLength(1);
    expect(rows.filter((x) => x.resolveState === "pending")).toHaveLength(2);
    expect(n).toBe(2); // did not hammer the third one
  });

  it("respects the per-pass limit", async () => {
    const db = createTestDb();
    for (let i = 0; i < 8; i++) createSource(db, { url: `https://example.com/${i}` }, i);
    const r = await processPendingResolves(db, async () => meta("t"), 3);
    expect(r.resolved).toBe(3);
  });
});
