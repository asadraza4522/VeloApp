import { eq } from "drizzle-orm";

import { createSource, type Source } from "@/db/queries/sources";
import { downloads, mediaSources, outbox } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import {
  applyEngineEvent, cancelDownload, pauseDownload, reconcile, resumeDownload, startDownload, type Deps,
} from "@/domain/downloads/controller";
import { selectionFor, UnsupportedSelectionError } from "@/domain/downloads/job";
import type { MediaVariant } from "@/domain/resolve/schema";
import type { NativeDownloadJob, NativePart, NativeTaskStatus } from "@velo/native";

const v = (o: Partial<MediaVariant>): MediaVariant => ({
  id: "x", type: "video", label: "l", container: "mp4", url: "https://cdn.example.com/x", headers: {}, protocol: "https",
  has_video: true, has_audio: true, ...o,
});
const PROGRESSIVE = v({ id: "22", height: 720, filesize: 1000, url: "https://cdn.example.com/22" });
const VIDEO_ONLY = v({ id: "137", height: 1080, has_audio: false, filesize: 4000, url: "https://cdn.example.com/137" });
const AAC = v({ id: "140", type: "audio", container: "m4a", has_video: false, audio_codec: "mp4a.40.2", bitrate: 129_000, filesize: 500, url: "https://cdn.example.com/140" });
const OPUS = v({ id: "251", type: "audio", container: "webm", has_video: false, audio_codec: "opus", bitrate: 160_000, url: "https://cdn.example.com/251" });

class FakeEngine {
  jobs: NativeDownloadJob[] = [];
  retries: { id: string; parts: NativePart[] | null }[] = [];
  calls: string[] = [];
  acked: string[] = [];
  tasks: NativeTaskStatus[] = [];
  enqueue = async (job: NativeDownloadJob) => { this.jobs.push(job); return job.taskId; };
  pause = async (id: string) => { this.calls.push(`pause:${id}`); };
  resume = async (id: string) => { this.calls.push(`resume:${id}`); };
  cancel = async (id: string) => { this.calls.push(`cancel:${id}`); };
  retry = async (id: string, parts: NativePart[] | null) => { this.retries.push({ id, parts }); };
  ack = async (id: string) => { this.acked.push(id); };
  getStatus = async (id: string) => this.tasks.find((t) => t.taskId === id) ?? null;
  listAll = async () => this.tasks;
  setConstraints = async () => {};
  addListener = () => ({ remove() {} });
}

let db: Db, engine: FakeEngine, deps: Deps, source: Source;
const status = (id: string) => db.select().from(downloads).where(eq(downloads.id, id)).get()!;

beforeEach(() => {
  db = createTestDb();
  engine = new FakeEngine();
  deps = { db, engine };
  source = createSource(db, { url: "https://www.youtube.com/watch?v=abc123XYZ_-", title: "Demo: Video?" }).source;
});

describe("startDownload", () => {
  it("queues a progressive download; URLs never reach SQLite", async () => {
    const d = await startDownload(deps, source, selectionFor(PROGRESSIVE, [PROGRESSIVE]));
    expect(d.status).toBe("QUEUED");
    expect(engine.jobs).toHaveLength(1);
    expect(engine.jobs[0]).toMatchObject({ taskId: d.id, kind: "video", postProcess: "none", filename: "Demo Video.mp4", relativePath: "YouTube/Videos", mime: "video/mp4" });
    expect(engine.jobs[0].parts[0].url).toBe("https://cdn.example.com/22");
    expect(JSON.stringify(status(d.id))).not.toContain("cdn.example.com");
    expect(db.select().from(outbox).all().some((o) => o.tableName === "downloads")).toBe(true);
  });

  it("video-only picks the best AAC partner and asks the engine to mux", async () => {
    const d = await startDownload(deps, source, selectionFor(VIDEO_ONLY, [VIDEO_ONLY, OPUS, AAC]));
    expect(engine.jobs[0].postProcess).toBe("mux");
    expect(engine.jobs[0].parts.map((p) => [p.role, p.url.split("/").pop()])).toEqual([["video", "137"], ["audio", "140"]]);
    expect(d.totalBytes).toBe(4500);
  });

  it("rejects unsupported selections before writing anything", async () => {
    const hls = v({ id: "h", protocol: "hls" });
    await expect(startDownload(deps, source, { mode: "single", variant: hls })).rejects.toThrow(UnsupportedSelectionError);
    expect(() => selectionFor(VIDEO_ONLY, [VIDEO_ONLY, OPUS])).not.toThrow(); // opus is a fallback partner…
    await expect(startDownload(deps, source, selectionFor(VIDEO_ONLY, [VIDEO_ONLY, OPUS]))).rejects.toThrow(UnsupportedSelectionError); // …but not muxable into mp4
    expect(db.select().from(downloads).all()).toHaveLength(0);
    expect(engine.jobs).toHaveLength(0);
  });

  it("fails the download (source kept) when the engine refuses the job", async () => {
    engine.enqueue = async () => { throw new Error("native down"); };
    const d = await startDownload(deps, source, { mode: "single", variant: PROGRESSIVE });
    expect(d).toMatchObject({ status: "FAILED", failureCode: "UNKNOWN" });
    expect(db.select().from(mediaSources).where(eq(mediaSources.id, source.id)).get()!.deletedAt).toBeNull();
  });
});

describe("engine events", () => {
  const started = () => startDownload(deps, source, { mode: "single", variant: PROGRESSIVE });

  it("full lifecycle to COMPLETED with the file uri and an ack", async () => {
    const d = await started();
    await applyEngineEvent(deps, { kind: "state", taskId: d.id, state: "DOWNLOADING" });
    expect(status(d.id).status).toBe("DOWNLOADING");
    await applyEngineEvent(deps, { kind: "state", taskId: d.id, state: "PROCESSING" });
    expect(status(d.id).status).toBe("PROCESSING");
    await applyEngineEvent(deps, { kind: "complete", taskId: d.id, uri: "content://media/42", filename: "Demo Video.mp4" });
    expect(status(d.id)).toMatchObject({ status: "COMPLETED", localUri: "content://media/42" });
    expect(engine.acked).toContain(d.id);
    expect(db.select().from(mediaSources).where(eq(mediaSources.id, source.id)).get()!.status).toBe("resolved");
  });

  it("tolerates missed and duplicate events", async () => {
    const d = await started();
    await applyEngineEvent(deps, { kind: "complete", taskId: d.id, uri: "content://m/1", filename: "a.mp4" }); // never saw DOWNLOADING
    await applyEngineEvent(deps, { kind: "complete", taskId: d.id, uri: "content://m/1", filename: "a.mp4" }); // duplicate
    await applyEngineEvent(deps, { kind: "state", taskId: d.id, state: "DOWNLOADING" }); // late, stale
    expect(status(d.id).status).toBe("COMPLETED");
  });

  it("ignores events for unknown tasks", async () => {
    await expect(applyEngineEvent(deps, { kind: "state", taskId: "nope", state: "DOWNLOADING" })).resolves.toBeUndefined();
  });

  it("pause / resume / cancel drive both sides", async () => {
    const d = await started();
    await applyEngineEvent(deps, { kind: "state", taskId: d.id, state: "DOWNLOADING" });
    await pauseDownload(deps, d.id);
    expect(status(d.id).status).toBe("PAUSED");
    await resumeDownload(deps, d.id);
    expect(status(d.id).status).toBe("QUEUED");
    await cancelDownload(deps, d.id);
    expect(status(d.id).status).toBe("CANCELED");
    expect(engine.calls).toEqual([`pause:${d.id}`, `resume:${d.id}`, `cancel:${d.id}`]);
  });

  it("network errors auto-retry up to 3 times, then wait for the user", async () => {
    const d = await started();
    for (let i = 0; i < 3; i++) {
      await applyEngineEvent(deps, { kind: "state", taskId: d.id, state: "DOWNLOADING" });
      await applyEngineEvent(deps, { kind: "state", taskId: d.id, state: "FAILED", errorCode: "NETWORK_ERROR" });
      expect(status(d.id).status).toBe("QUEUED");
    }
    expect(engine.retries).toHaveLength(3);
    await applyEngineEvent(deps, { kind: "state", taskId: d.id, state: "DOWNLOADING" });
    await applyEngineEvent(deps, { kind: "state", taskId: d.id, state: "FAILED", errorCode: "NETWORK_ERROR" });
    expect(status(d.id)).toMatchObject({ status: "FAILED", failureCode: "NETWORK_ERROR" });
    expect(engine.retries).toHaveLength(3);
  });

  it("auth / not-found failures are not retried automatically and keep the source", async () => {
    const d = await started();
    await applyEngineEvent(deps, { kind: "state", taskId: d.id, state: "DOWNLOADING" });
    await applyEngineEvent(deps, { kind: "state", taskId: d.id, state: "FAILED", errorCode: "AUTH_REQUIRED" });
    expect(status(d.id)).toMatchObject({ status: "AUTH_REQUIRED", failureCode: "AUTH_REQUIRED" });
    expect(engine.retries).toHaveLength(0);
  });
});

describe("expired URLs", () => {
  const fresh = [{ ...PROGRESSIVE, url: "https://cdn.example.com/22?fresh=1" }];

  it("re-resolves once and continues with the new URL", async () => {
    deps.reResolve = async () => fresh;
    const d = await startDownload(deps, source, { mode: "single", variant: PROGRESSIVE });
    await applyEngineEvent(deps, { kind: "state", taskId: d.id, state: "DOWNLOADING" });
    await applyEngineEvent(deps, { kind: "state", taskId: d.id, state: "FAILED", errorCode: "URL_EXPIRED" });
    expect(status(d.id).status).toBe("QUEUED");
    expect(engine.retries[0].parts![0].url).toBe("https://cdn.example.com/22?fresh=1");
    expect(JSON.parse(status(d.id).variantJson!).reResolved).toBe(true);

    // a second expiry is not looped forever
    await applyEngineEvent(deps, { kind: "state", taskId: d.id, state: "DOWNLOADING" });
    await applyEngineEvent(deps, { kind: "state", taskId: d.id, state: "FAILED", errorCode: "URL_EXPIRED" });
    expect(status(d.id).status).toBe("FAILED");
    expect(engine.retries).toHaveLength(1);
  });

  it("fails cleanly when the chosen format no longer exists", async () => {
    deps.reResolve = async () => [v({ id: "other" })];
    const d = await startDownload(deps, source, { mode: "single", variant: PROGRESSIVE });
    await applyEngineEvent(deps, { kind: "state", taskId: d.id, state: "DOWNLOADING" });
    await applyEngineEvent(deps, { kind: "state", taskId: d.id, state: "FAILED", errorCode: "URL_EXPIRED" });
    expect(status(d.id)).toMatchObject({ status: "FAILED", failureCode: "FORMAT_UNAVAILABLE" });
  });
});

describe("reconcile", () => {
  const task = (over: Partial<NativeTaskStatus>): NativeTaskStatus => ({
    taskId: "", state: "QUEUED", bytes: 0, total: null, errorCode: null, errorMessage: null, uri: null, filename: "f.mp4", kind: "video", updatedAt: 1, ...over,
  });

  it("heals a download that finished while the app was dead", async () => {
    const d = await startDownload(deps, source, { mode: "single", variant: PROGRESSIVE });
    await applyEngineEvent(deps, { kind: "state", taskId: d.id, state: "DOWNLOADING" });
    engine.tasks = [task({ taskId: d.id, state: "COMPLETED", uri: "content://media/7", filename: "Demo Video.mp4" })];
    await reconcile(deps);
    expect(status(d.id)).toMatchObject({ status: "COMPLETED", localUri: "content://media/7" });
    expect(engine.acked).toContain(d.id);
  });

  it("mirrors failures and pauses that happened in the background", async () => {
    const a = await startDownload(deps, source, { mode: "single", variant: PROGRESSIVE });
    engine.tasks = [task({ taskId: a.id, state: "FAILED", errorCode: "MEDIA_NOT_FOUND" })];
    await reconcile(deps);
    expect(status(a.id)).toMatchObject({ status: "SOURCE_UNAVAILABLE", failureCode: "MEDIA_NOT_FOUND" });
  });

  it("fails orphans (DB says running, engine has no such task) so the user can retry; paused ones are canceled", async () => {
    const running = await startDownload(deps, source, { mode: "single", variant: PROGRESSIVE });
    const paused = await startDownload(deps, source, { mode: "single", variant: PROGRESSIVE });
    await pauseDownload(deps, paused.id);
    engine.tasks = [];
    await reconcile(deps);
    expect(status(running.id)).toMatchObject({ status: "FAILED", failureCode: "UNKNOWN" });
    expect(status(paused.id).status).toBe("CANCELED");
  });
});
