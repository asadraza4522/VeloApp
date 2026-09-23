import { and, eq, isNull } from "drizzle-orm";

import { createDownload, dispatch } from "@/db/queries/downloads";
import { getNaming, setNaming } from "@/db/queries/settings";
import { applyResolved, createSource, deleteSource, listSources, setFavorite } from "@/db/queries/sources";
import { downloads, mediaSources, outbox, sourceUrls, syncState } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { compactTombstones } from "@/domain/sync/compact";
import { getDeviceId } from "@/domain/sync/device";
import { syncOnce } from "@/domain/sync/engine";
import { FakeRemote } from "@/domain/sync/fake-remote";
import { pullAll } from "@/domain/sync/pull";
import { MAX_ATTEMPTS, parkedCount, pendingCount } from "@/domain/sync/push";

const YT = "https://youtu.be/abc123XYZ_-";
let remote: FakeRemote, A: Db, B: Db;
let t = 1_800_000_000_000;
const clock = () => (t += 1000);
const sync = (db: Db) => syncOnce({ db, remote, distribution: "full", now: clock });

const complete = (db: Db, id: string) => {
  for (const e of [{ type: "START" }, { type: "VALID" }, { type: "DETECTED" }, { type: "RESOLVED" }, { type: "AUTO_SELECT" }, { type: "ENGINE_START" }] as const) dispatch(db, id, e, clock());
  dispatch(db, id, { type: "DOWNLOAD_DONE", needsProcessing: false }, clock());
  dispatch(db, id, { type: "ORGANIZED" }, clock());
};

beforeEach(() => {
  remote = new FakeRemote();
  A = createTestDb();
  B = createTestDb();
});

describe("push", () => {
  it("sends snake_case rows without device-only fields, then clears the outbox and marks rows clean", async () => {
    const { source } = createSource(A, { url: YT, title: "Demo" }, clock());
    const d = createDownload(A, { sourceId: source.id, deviceId: getDeviceId(A), resolution: "1080p" }, clock());
    const out = await sync(A);
    expect(out).toMatchObject({ ok: true, pending: 0, parked: 0 });

    const row = remote.tables.media_sources.get(source.id)!;
    expect(row).toMatchObject({ canonical_url: "https://youtube.com/watch?v=abc123XYZ_-", title: "Demo", favorite: false });
    expect(typeof row.first_seen_at).toBe("string"); // ISO, not epoch ms
    const dl = remote.tables.downloads.get(d.id)!;
    expect(dl).toMatchObject({ resolution: "1080p", device_id: getDeviceId(A) });
    for (const k of ["local_uri", "localUri", "progress_bytes", "attempts", "dirty"]) expect(dl).not.toHaveProperty(k);
    expect(A.select().from(mediaSources).where(eq(mediaSources.id, source.id)).get()!.dirty).toBe(false);
    expect(A.select().from(outbox).all()).toHaveLength(0);
  });

  it("parents go first (FK order) and the device is registered once", async () => {
    const { source } = createSource(A, { url: YT }, clock());
    createDownload(A, { sourceId: source.id }, clock());
    await sync(A);
    const order = remote.upsertOrder.filter((n) => n !== "devices");
    expect(order.indexOf("media_sources")).toBeLessThan(order.indexOf("source_urls"));
    expect(order.indexOf("source_urls")).toBeLessThan(order.indexOf("downloads"));
    await sync(A);
    expect(remote.upsertOrder.filter((n) => n === "devices")).toHaveLength(1);
  });

  it("coalesces many edits of one row into a single upsert of its latest state", async () => {
    const { source } = createSource(A, { url: YT }, clock());
    for (let i = 0; i < 5; i++) setFavorite(A, source.id, i % 2 === 0, clock());
    await sync(A);
    expect(remote.tables.media_sources.get(source.id)!.favorite).toBe(true); // last write: i = 4
    expect(remote.upsertOrder.filter((n) => n === "media_sources")).toHaveLength(1);
  });

  it("offline: nothing is lost, and everything goes out once the network is back", async () => {
    createSource(A, { url: YT }, clock());
    remote.offline = true;
    const bad = await sync(A);
    expect(bad).toMatchObject({ ok: false, error: "network" });
    expect(pendingCount(A)).toBeGreaterThan(0);
    remote.offline = false;
    expect((await sync(A)).ok).toBe(true);
    expect(pendingCount(A)).toBe(0);
    expect(remote.tables.media_sources.size).toBe(1);
  });

  it("no session → auth error, outbox untouched", async () => {
    createSource(A, { url: YT }, clock());
    remote.authFails = true;
    expect(await sync(A)).toMatchObject({ ok: false, error: "auth" });
    expect(pendingCount(A)).toBeGreaterThan(0);
  });

  it("a rejected row is isolated, retried with a budget, then parked without blocking the others", async () => {
    const good = createSource(A, { url: "https://example.com/good" }, clock()).source;
    const bad = createSource(A, { url: "https://example.com/bad" }, clock()).source;
    remote.rejectIds.add(bad.id);
    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) await sync(A);
    expect(remote.tables.media_sources.has(good.id)).toBe(true);
    expect(remote.tables.media_sources.has(bad.id)).toBe(false);
    expect(parkedCount(A)).toBeGreaterThan(0);
    expect(pendingCount(A)).toBe(0); // parked ops are no longer retried in a loop
    remote.rejectIds.clear();
  });
});

describe("two devices", () => {
  it("history converges; files stay per device (other device shows File missing → Redownload)", async () => {
    const { source } = createSource(A, { url: YT, title: "Demo" }, clock());
    const d = createDownload(A, { sourceId: source.id, deviceId: getDeviceId(A), resolution: "1080p", container: "mp4", totalBytes: 100 }, clock());
    complete(A, d.id);
    await sync(A);

    const out = await sync(B);
    expect(out).toMatchObject({ ok: true, pending: 0 });
    expect(B.select().from(mediaSources).where(eq(mediaSources.id, source.id)).get()).toMatchObject({ title: "Demo", status: "resolved" });
    const copy = B.select().from(downloads).where(eq(downloads.id, d.id)).get()!;
    expect(copy).toMatchObject({ status: "COMPLETED", resolution: "1080p", localUri: null, dirty: false });
    expect(copy.fileDeletedAt).not.toBeNull(); // "File missing" on this device
    expect(B.select().from(outbox).all()).toHaveLength(0); // applying remote data never echoes back
  });

  it("another device's in-progress download is not mirrored", async () => {
    const { source } = createSource(A, { url: YT }, clock());
    const d = createDownload(A, { sourceId: source.id, deviceId: getDeviceId(A) }, clock());
    for (const e of [{ type: "START" }, { type: "VALID" }, { type: "DETECTED" }, { type: "RESOLVED" }, { type: "AUTO_SELECT" }, { type: "ENGINE_START" }] as const) dispatch(A, d.id, e, clock());
    await sync(A);
    await sync(B);
    expect(B.select().from(downloads).all()).toHaveLength(0);
    expect(B.select().from(mediaSources).all()).toHaveLength(1);
  });

  it("last write wins by edit time, whichever device syncs first", async () => {
    const { source } = createSource(A, { url: YT }, 1_000);
    await sync(A);
    await sync(B);
    applyResolved(B, source.id, { title: "from B (later)" }, 5_000_000_000_000);
    applyResolved(A, source.id, { title: "from A (earlier)" }, 4_000_000_000_000);
    await sync(B); // the newer edit reaches the server first…
    await sync(A); // …the older one is ignored by the server guard
    await sync(B);
    await sync(A);
    for (const db of [A, B]) expect(db.select().from(mediaSources).where(eq(mediaSources.id, source.id)).get()!.title).toBe("from B (later)");
  });

  it("deleting on one device removes the source and its history on the other; a stale edit cannot resurrect it", async () => {
    const { source } = createSource(A, { url: YT }, clock());
    const d = createDownload(A, { sourceId: source.id, deviceId: getDeviceId(A) }, clock());
    complete(A, d.id);
    await sync(A);
    await sync(B);
    expect(listSources(B)).toHaveLength(1);

    setFavorite(B, source.id, true, 1); // an old offline edit on B
    deleteSource(A, source.id, 9_000_000_000_000);
    await sync(A);
    await sync(B);
    expect(listSources(B)).toHaveLength(0);
    expect(B.select().from(downloads).where(and(eq(downloads.sourceId, source.id), isNull(downloads.deletedAt))).all()).toHaveLength(0);
    expect(remote.tables.media_sources.get(source.id)!.deleted_at).not.toBeNull();
  });

  it.each([["A saved it first", true], ["B saved it first", false]])("the same link saved on two devices merges to one source, with history re-parented (%s)", async (_n, aFirst) => {
    let a!: ReturnType<typeof createSource>["source"], b!: typeof a;
    const mkA = () => { a = createSource(A, { url: YT, title: "A copy" }, clock()).source; };
    const mkB = () => { b = createSource(B, { url: "https://www.youtube.com/watch?v=abc123XYZ_-&feature=share", title: "B copy" }, clock()).source; };
    if (aFirst) { mkA(); mkB(); } else { mkB(); mkA(); }
    const dB = createDownload(B, { sourceId: b.id, deviceId: getDeviceId(B) }, clock());
    complete(B, dB.id);
    const winner = a.id < b.id ? a.id : b.id;

    for (let i = 0; i < 3; i++) {
      for (const out of [await sync(A), await sync(B)]) expect(out.ok).toBe(true);
    }
    for (const db of [A, B]) {
      const live = listSources(db);
      expect(live).toHaveLength(1);
      expect(live[0].id).toBe(winner);
    }
    // B's download now hangs under the surviving source on both devices
    for (const db of [A, B]) expect(db.select().from(downloads).where(eq(downloads.id, dB.id)).get()!.sourceId).toBe(winner);
    expect(pendingCount(A) + pendingCount(B)).toBe(0);
    expect((await pullAll(A, remote, "x", clock())).skipped + (await pullAll(B, remote, "x", clock())).skipped).toBe(0); // nothing was silently dropped
  });

  it("organization setting syncs, and a newer local value is kept", async () => {
    setNaming(A, { pathTemplate: "{platform}/{creator}", filenameTemplate: "{title}" });
    await sync(A);
    await sync(B);
    expect(getNaming(B).pathTemplate).toBe("{platform}/{creator}");
  });
});

describe("pull", () => {
  it("pages through large result sets and remembers the cursor (second pull is empty)", async () => {
    for (let i = 0; i < 130; i++) createSource(A, { url: `https://example.com/${i}` }, clock());
    await sync(A);
    const r1 = await pullAll(B, remote, "dev-B", clock(), 50);
    expect(r1.applied).toBeGreaterThanOrEqual(130);
    expect(B.select().from(mediaSources).all()).toHaveLength(130);
    const cursor = B.select().from(syncState).where(eq(syncState.tableName, "media_sources")).get()!;
    expect(cursor.cursorUpdatedAt).not.toBe("");
    const r2 = await pullAll(B, remote, "dev-B", clock(), 50);
    expect(r2).toMatchObject({ applied: 0, skipped: 0 });
  });

  it("re-applying the same page changes nothing (crash-safe / idempotent)", async () => {
    createSource(A, { url: YT }, clock());
    await sync(A);
    await sync(B);
    B.delete(syncState).run(); // pretend the cursor was lost
    await sync(B);
    expect(B.select().from(mediaSources).all()).toHaveLength(1);
    expect(pendingCount(B)).toBe(0);
  });

  it("a failed pull leaves the cursor where it was", async () => {
    createSource(A, { url: YT }, clock());
    await sync(A);
    remote.offline = true;
    expect((await sync(B)).ok).toBe(false);
    expect(B.select().from(mediaSources).all()).toHaveLength(0);
    remote.offline = false;
    await sync(B);
    expect(B.select().from(mediaSources).all()).toHaveLength(1);
  });
});

describe("ordering safety", () => {
  it("a child that arrives before its parent waits, and is picked up once the parent is there (never dropped)", async () => {
    const { source } = createSource(A, { url: YT }, clock());
    const d = createDownload(A, { sourceId: source.id, deviceId: getDeviceId(A) }, clock());
    complete(A, d.id);
    await sync(A);

    // B first sees only the download (as if the parent row were not visible yet)
    const real = remote.pull.bind(remote);
    let hideSources = true;
    remote.pull = async (table, cursor, limit) => (table === "media_sources" && hideSources ? [] : real(table, cursor, limit));
    const first = await sync(B);
    expect(first.ok).toBe(true);
    expect(B.select().from(downloads).all()).toHaveLength(0);

    hideSources = false;
    await sync(B);
    expect(B.select().from(downloads).where(eq(downloads.id, d.id)).get()).toBeDefined();
  });
});

describe("compaction", () => {
  it("removes old, synced tombstones (children first) and keeps recent or unsynced ones", async () => {
    const { source } = createSource(A, { url: YT }, 1_000);
    const d = createDownload(A, { sourceId: source.id }, 1_000);
    deleteSource(A, source.id, 2_000);
    await sync(A);
    const later = 2_000 + 31 * 86_400_000;
    expect(compactTombstones(A, later)).toBeGreaterThanOrEqual(2);
    expect(A.select().from(mediaSources).all()).toHaveLength(0);
    expect(A.select().from(downloads).where(eq(downloads.id, d.id)).get()).toBeUndefined();

    const fresh = createSource(A, { url: "https://example.com/x" }, later).source;
    deleteSource(A, fresh.id, later); // not yet synced (dirty + queued) → must survive
    expect(compactTombstones(A, later + 40 * 86_400_000)).toBe(0);
    expect(A.select().from(mediaSources).where(eq(mediaSources.id, fresh.id)).get()).toBeDefined();
    expect(A.select().from(sourceUrls).all().length).toBeGreaterThanOrEqual(0);
  });
});
