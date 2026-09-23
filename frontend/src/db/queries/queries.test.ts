import { eq } from "drizzle-orm";

import { createTestDb } from "@/db/test-db";
import { applyResolved, createSource, deleteSource, InvalidUrlError, listSources, recordFailure, setFavorite, toFtsQuery } from "@/db/queries/sources";
import { createDownload, dispatch, listDownloadsForSource, listLibraryFiles, markFileMissing, setFilename, setLocalFile, buildQueueQuery, QUEUE_GROUPS } from "@/db/queries/downloads";
import { downloads, mediaSources, outbox } from "@/db/schema";
import { getNaming, setNaming, setSetting } from "@/db/queries/settings";
import { assertValidUrl, commitLink } from "@/domain/sources/commit";
import { seedSources } from "@/db/seed";
import { IllegalTransitionError } from "@/domain/downloads/state-machine";

const YT = "https://youtu.be/abc123XYZ_-";

describe("createSource", () => {
  it("dedupes by canonical url and records the alternate url", () => {
    const db = createTestDb();
    const a = createSource(db, { url: YT });
    const b = createSource(db, { url: "https://www.youtube.com/watch?v=abc123XYZ_-&feature=share" });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.source.id).toBe(a.source.id);
    expect(a.source).toMatchObject({ platform: "YouTube", platformMediaId: "abc123XYZ_-", resolveState: "pending", status: "saved" });
    expect(db.select().from(mediaSources).all()).toHaveLength(1);
  });

  it("writes an outbox row for every syncable write, in the same transaction", () => {
    const db = createTestDb();
    createSource(db, { url: YT });
    const ops = db.select().from(outbox).all();
    expect(ops.map((o) => o.tableName).sort()).toEqual(["media_sources", "source_urls"]);
    expect(ops.every((o) => o.op === "upsert" && o.payload)).toBe(true);
  });

  it("rejects invalid urls without writing anything", () => {
    const db = createTestDb();
    expect(() => createSource(db, { url: "javascript:alert(1)" })).toThrow(InvalidUrlError);
    expect(db.select().from(mediaSources).all()).toHaveLength(0);
    expect(db.select().from(outbox).all()).toHaveLength(0);
  });

  it("allows saving the same url again after the source was deleted", () => {
    const db = createTestDb();
    const a = createSource(db, { url: YT });
    deleteSource(db, a.source.id);
    const b = createSource(db, { url: YT });
    expect(b.created).toBe(true);
    expect(b.source.id).not.toBe(a.source.id);
  });
});

describe("resolve results", () => {
  it("failure keeps the source and records why; success clears it", () => {
    const db = createTestDb();
    const { source } = createSource(db, { url: YT });
    expect(recordFailure(db, source.id, "AUTH_REQUIRED")).toMatchObject({ status: "failed", failureCode: "AUTH_REQUIRED", deletedAt: null });
    expect(recordFailure(db, source.id, "MEDIA_NOT_FOUND")).toMatchObject({ status: "unavailable" });
    expect(applyResolved(db, source.id, { title: "T" })).toMatchObject({ status: "resolved", failureCode: null, resolveState: "done", title: "T" });
  });
});

describe("search + pagination", () => {
  it("FTS prefix search follows metadata updates and ignores deleted sources", () => {
    const db = createTestDb();
    const s = createSource(db, { url: "https://example.com/a" }).source;
    createSource(db, { url: "https://example.com/b", title: "Something else" });
    expect(listSources(db, { search: "react" })).toHaveLength(0);

    applyResolved(db, s.id, { title: "How to Build a React App", creatorName: "Tech Example" });
    expect(listSources(db, { search: "reac" }).map((r) => r.id)).toEqual([s.id]);
    expect(listSources(db, { search: "tech build" }).map((r) => r.id)).toEqual([s.id]);

    deleteSource(db, s.id);
    expect(listSources(db, { search: "react" })).toHaveLength(0);
  });

  it("search input with quotes/operators cannot break the query", () => {
    const db = createTestDb();
    createSource(db, { url: "https://example.com/a", title: "Hello" });
    expect(() => listSources(db, { search: `"; DROP TABLE x; -- AND OR NOT *` })).not.toThrow();
    expect(toFtsQuery("  ")).toBeNull();
    expect(toFtsQuery(`he"llo wor*ld`)).toBe(`"he"* "llo"* "wor"* "ld"*`);
  });

  it("keyset pagination pages through everything exactly once, newest first", () => {
    const db = createTestDb();
    seedSources(db, 250, 1_700_000_000_000);
    const seen: string[] = [];
    let after: { updatedAt: number; id: string } | undefined;
    for (;;) {
      const page = listSources(db, {}, 100, after);
      if (!page.length) break;
      seen.push(...page.map((p) => p.id));
      const last = page[page.length - 1];
      after = { updatedAt: last.updatedAt, id: last.id };
    }
    expect(seen).toHaveLength(250);
    expect(new Set(seen).size).toBe(250);
    const times = seen.map((id) => db.select().from(mediaSources).where(eq(mediaSources.id, id)).get()!.updatedAt);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("filters combine", () => {
    const db = createTestDb();
    seedSources(db, 200);
    const fav = listSources(db, {}, 1)[0];
    setFavorite(db, fav.id, true);
    expect(listSources(db, { favorite: true }).map((r) => r.id)).toEqual([fav.id]);
    expect(listSources(db, { platform: "YouTube", mediaType: "video" }, 500).every((r) => r.platform === "YouTube" && r.mediaType === "video")).toBe(true);
  });

  it("queries stay fast on 5k rows (index + FTS sanity check, not a device benchmark)", () => {
    const db = createTestDb();
    seedSources(db, 5000);
    const t0 = performance.now();
    listSources(db, {}, 50);
    listSources(db, { search: "sunset" }, 50);
    listSources(db, { status: "resolved", mediaType: "video" }, 50);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe("downloads", () => {
  const setup = () => {
    const db = createTestDb();
    const { source } = createSource(db, { url: YT });
    const d = createDownload(db, { sourceId: source.id, resolution: "1080p", container: "mp4", totalBytes: 1000 });
    return { db, source, d };
  };

  it("persists transitions, side effects and outbox rows", () => {
    const { db, source, d } = setup();
    for (const e of [{ type: "START" }, { type: "VALID" }, { type: "DETECTED" }, { type: "RESOLVED" }, { type: "AUTO_SELECT" }, { type: "ENGINE_START" }] as const) dispatch(db, d.id, e);
    dispatch(db, d.id, { type: "DOWNLOAD_DONE", needsProcessing: false });
    const done = dispatch(db, d.id, { type: "ORGANIZED" });
    expect(done).toMatchObject({ status: "COMPLETED", progressBytes: 1000 });
    expect(done.completedAt).not.toBeNull();
    expect(db.select().from(mediaSources).where(eq(mediaSources.id, source.id)).get()!.status).toBe("resolved");
  });

  it("an illegal event throws and changes nothing", () => {
    const { db, d } = setup();
    const before = db.select().from(outbox).all().length;
    expect(() => dispatch(db, d.id, { type: "ENGINE_START" })).toThrow(IllegalTransitionError);
    expect(db.select().from(downloads).where(eq(downloads.id, d.id)).get()!.status).toBe("CREATED");
    expect(db.select().from(outbox).all()).toHaveLength(before);
  });

  it("failure keeps the source, records the code, and retry counts attempts", () => {
    const { db, source, d } = setup();
    for (const e of [{ type: "START" }, { type: "VALID" }, { type: "DETECTED" }] as const) dispatch(db, d.id, e);
    const failed = dispatch(db, d.id, { type: "FAIL", code: "AUTH_REQUIRED" });
    expect(failed).toMatchObject({ status: "AUTH_REQUIRED", failureCode: "AUTH_REQUIRED" });
    const src = db.select().from(mediaSources).where(eq(mediaSources.id, source.id)).get()!;
    expect(src.deletedAt).toBeNull();
    expect(src.status).toBe("failed");
    const retried = dispatch(db, d.id, { type: "RETRY" });
    expect(retried).toMatchObject({ status: "RETRYING", attempts: 1, failureCode: null });
  });

  it("local_uri never reaches the outbox payload", () => {
    const { db, d } = setup();
    setLocalFile(db, d.id, "content://media/external/video/42");
    markFileMissing(db, d.id);
    const payloads = db.select().from(outbox).all().filter((o) => o.tableName === "downloads").map((o) => o.payload ?? "");
    expect(payloads.length).toBeGreaterThan(0);
    for (const p of payloads) expect(p).not.toContain("localUri");
  });

  it("a missing file flags the download but never the source", () => {
    const { db, source, d } = setup();
    markFileMissing(db, d.id, 123);
    expect(listDownloadsForSource(db, source.id)[0].fileDeletedAt).toBe(123);
    expect(db.select().from(mediaSources).where(eq(mediaSources.id, source.id)).get()!.deletedAt).toBeNull();
  });

  it("deleting a source tombstones its downloads and queues delete ops", () => {
    const { db, source, d } = setup();
    deleteSource(db, source.id);
    expect(db.select().from(downloads).where(eq(downloads.id, d.id)).get()!.deletedAt).not.toBeNull();
    const deletes = db.select().from(outbox).all().filter((o) => o.op === "delete").map((o) => o.tableName).sort();
    expect(deletes).toEqual(["downloads", "media_sources", "source_urls"]);
  });

  it("queue query groups by status with source fields joined", () => {
    const db = createTestDb();
    seedSources(db, 200);
    const active = buildQueueQuery(db, QUEUE_GROUPS.active, 500).all();
    expect(active.length).toBeGreaterThan(0);
    expect(active.every((r) => r.status === "DOWNLOADING" && r.title)).toBe(true);
  });
});

describe("settings + naming", () => {
  it("defaults, saves, and queues a sync op for the setting", () => {
    const db = createTestDb();
    expect(getNaming(db)).toEqual({ pathTemplate: "{platform}/{media_type}", filenameTemplate: "{title}" });
    setNaming(db, { pathTemplate: "{platform}/{creator}", filenameTemplate: "{creator} - {title}" });
    expect(getNaming(db).pathTemplate).toBe("{platform}/{creator}");
    setNaming(db, { pathTemplate: "", filenameTemplate: "{date} - {title}" }); // update, not duplicate
    expect(getNaming(db)).toEqual({ pathTemplate: "", filenameTemplate: "{date} - {title}" });
    expect(db.select().from(outbox).all().filter((o) => o.tableName === "settings")).toHaveLength(2);
  });
  it("survives a corrupt stored value", () => {
    const db = createTestDb();
    setSetting(db, "organization", "not-an-object");
    expect(getNaming(db).filenameTemplate).toBe("{title}");
  });
});

describe("commitLink (share sheet / analyze)", () => {
  const meta = { source_url: "u", platform: "YouTube", title: "Shared Video", creator: "Chan", thumbnail_url: "https://i/t.jpg", duration: 61, media_type: "video" as const };
  const ok = { ok: true as const, result: { resolver_id: "ytdlp", metadata: meta, variants: [], resolved_at: 1, degraded: false } };

  it("saves the link with the details the preview found", () => {
    const db = createTestDb();
    const { source, created } = commitLink(db, YT, ok);
    expect(created).toBe(true);
    expect(source).toMatchObject({ title: "Shared Video", creatorName: "Chan", thumbnailUrl: "https://i/t.jpg", durationMs: 61_000, status: "resolved" });
  });
  it("offline preview: saved and still pending; other failures are remembered", () => {
    const db = createTestDb();
    const a = commitLink(db, YT, { ok: false, code: "NETWORK_ERROR", message: "" }).source;
    expect(a).toMatchObject({ status: "saved", resolveState: "pending" });
    const b = commitLink(db, "https://example.com/b", { ok: false, code: "AUTH_REQUIRED", message: "" }).source;
    expect(b).toMatchObject({ status: "failed", failureCode: "AUTH_REQUIRED" });
  });
  it("rejects garbage before touching the database", () => {
    const db = createTestDb();
    expect(() => assertValidUrl("javascript:alert(1)")).toThrow(InvalidUrlError);
    expect(db.select().from(mediaSources).all()).toHaveLength(0);
  });
});

describe("library files (tools)", () => {
  it("lists only completed downloads whose file is still here; rename queues a sync op", () => {
    const db = createTestDb();
    const { source } = createSource(db, { url: YT, title: "Clip" });
    const mk = (uri: string | null) => {
      const d = createDownload(db, { sourceId: source.id, filename: "old.mp4" });
      for (const e of [{ type: "START" }, { type: "VALID" }, { type: "DETECTED" }, { type: "RESOLVED" }, { type: "AUTO_SELECT" }, { type: "ENGINE_START" }] as const) dispatch(db, d.id, e);
      dispatch(db, d.id, { type: "DOWNLOAD_DONE", needsProcessing: false });
      dispatch(db, d.id, { type: "ORGANIZED" });
      if (uri) setLocalFile(db, d.id, uri);
      return d.id;
    };
    const keep = mk("content://media/1");
    mk(null);                               // no file uri
    const gone = mk("content://media/3");
    markFileMissing(db, gone);              // file deleted outside Velo
    const rows = listLibraryFiles(db);
    expect(rows.map((r) => r.downloadId)).toEqual([keep]);
    expect(rows[0]).toMatchObject({ title: "Clip", platform: "YouTube", uri: "content://media/1" });

    const before = db.select().from(outbox).all().length;
    setFilename(db, keep, "new.mp4");
    expect(listLibraryFiles(db)[0].filename).toBe("new.mp4");
    expect(db.select().from(outbox).all().length).toBe(before + 1);
  });
});
