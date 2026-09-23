// Orchestrates a download across the state machine, SQLite mirror and the native engine (docs plan §7.2, §8).
// JS drives the pre-download states; native events drive the rest; reconcile() heals any gap after a process death.
import type { NativePart, NativeTaskStatus, EngineErrorCode } from "@velo/native";
import { eq, isNull } from "drizzle-orm";

import { createDownload, dispatch, setLocalFile, type Download } from "@/db/queries/downloads";
import { getNaming } from "@/db/queries/settings";
import { getDeviceId } from "@/domain/sync/device";
import { getSource, type Source } from "@/db/queries/sources";
import { downloads, type DownloadStatus, type FailureCode } from "@/db/schema";
import type { Db } from "@/db/types";
import { shouldAutoRetry } from "@/domain/downloads/failure";
import { buildJob, metaOf, partsFor, reselect, type Selection, type SelectionMeta } from "@/domain/downloads/job";
import { canTransition, type DownloadEvent } from "@/domain/downloads/state-machine";
import type { MediaVariant } from "@/domain/resolve/schema";
import type { DownloadEngineApi } from "@/native/types";

export type ReResolve = (sourceUrl: string) => Promise<MediaVariant[] | null>;
export type Deps = { db: Db; engine: DownloadEngineApi; reResolve?: ReResolve };

const parseMeta = (d: Download): SelectionMeta | null => {
  try {
    return d.variantJson ? (JSON.parse(d.variantJson) as SelectionMeta) : null;
  } catch {
    return null;
  }
};

/** Apply events in order, skipping any that are not legal from the current state (idempotent under duplicate/missed native events). */
function advance(db: Db, id: string, events: DownloadEvent[]): Download | undefined {
  let last: Download | undefined;
  for (const e of events) {
    const cur = db.select().from(downloads).where(eq(downloads.id, id)).get();
    if (!cur || !canTransition(cur.status, e.type)) continue;
    last = dispatch(db, id, e);
  }
  return last ?? db.select().from(downloads).where(eq(downloads.id, id)).get();
}

const PRE_ENGINE: DownloadEvent[] = [{ type: "START" }, { type: "VALID" }, { type: "DETECTED" }, { type: "RESOLVED" }, { type: "AUTO_SELECT" }];

export function engineCodeToFailure(code: EngineErrorCode | null | undefined): FailureCode {
  switch (code) {
    case "NETWORK_ERROR": case "AUTH_REQUIRED": case "MEDIA_NOT_FOUND": case "RATE_LIMITED": case "SERVER_ERROR": case "FORMAT_UNAVAILABLE":
      return code;
    case "URL_EXPIRED": return "PROVIDER_CHANGED"; // only when re-resolving is impossible
    default: return "UNKNOWN"; // STORAGE_FULL etc.: the message tells the user
  }
}

/** Save the chosen format as a download and hand it to the engine. The URLs never touch SQLite. */
export async function startDownload(deps: Deps, source: Source, selection: Selection): Promise<Download> {
  const job0 = buildJob({ taskId: "pending", title: source.title, platform: source.platform, creator: source.creatorName, selection, naming: getNaming(deps.db) }); // throws UnsupportedSelectionError before anything is written
  const v = selection.mode === "mux" ? selection.video : selection.variant;
  const total = partsFor(selection).reduce((n, p) => n + (p.expectedSize ?? 0), 0) || null;

  const row = createDownload(deps.db, {
    sourceId: source.id, deviceId: getDeviceId(deps.db), variantJson: JSON.stringify(metaOf(selection)), container: job0.filename.split(".").pop(),
    resolution: v.height ? `${v.height}p` : null, filename: job0.filename, totalBytes: total,
  });
  advance(deps.db, row.id, PRE_ENGINE);
  try {
    await deps.engine.enqueue({ ...job0, taskId: row.id });
  } catch {
    return dispatch(deps.db, row.id, { type: "FAIL", code: "UNKNOWN" });
  }
  return advance(deps.db, row.id, [])!;
}

export type EngineEvent =
  | { kind: "state"; taskId: string; state: NativeTaskStatus["state"]; errorCode?: EngineErrorCode | null }
  | { kind: "complete"; taskId: string; uri: string; filename: string };

export async function applyEngineEvent(deps: Deps, e: EngineEvent): Promise<void> {
  const { db } = deps;
  const cur = db.select().from(downloads).where(eq(downloads.id, e.taskId)).get();
  if (!cur) return;

  if (e.kind === "complete") {
    setLocalFile(db, cur.id, e.uri, e.filename);
    advance(db, cur.id, [
      { type: "ENGINE_START" }, { type: "DOWNLOAD_DONE", needsProcessing: false }, { type: "PROCESS_DONE" }, { type: "ORGANIZED" },
    ]);
    await deps.engine.ack(cur.id).catch(() => {});
    return;
  }

  switch (e.state) {
    case "DOWNLOADING": advance(db, cur.id, [{ type: "ENGINE_START" }]); break;
    case "PROCESSING": advance(db, cur.id, [{ type: "ENGINE_START" }, { type: "DOWNLOAD_DONE", needsProcessing: true }]); break;
    case "PAUSED": advance(db, cur.id, [{ type: "PAUSE" }]); break;
    case "QUEUED": advance(db, cur.id, [{ type: "RESUME" }, { type: "REQUEUE" }]); break; // no-op while DOWNLOADING (system interruption)
    case "CANCELED": advance(db, cur.id, [{ type: "CANCEL" }]); await deps.engine.ack(cur.id).catch(() => {}); break;
    case "FAILED": await handleFailure(deps, cur, e.errorCode ?? "UNKNOWN"); break;
    case "COMPLETED": break; // handled by the "complete" event which carries the uri
  }
}

async function handleFailure(deps: Deps, d: Download, code: EngineErrorCode) {
  const { db, engine } = deps;
  const meta = parseMeta(d);

  // Expired direct URL (403/410): re-resolve once and continue where we left off (some platforms bind URLs to the resolver's IP).
  if (code === "URL_EXPIRED" && deps.reResolve && meta && !meta.reResolved) {
    if (await reResolveAndRequeue(deps, d, meta)) return;
  }
  const failure = engineCodeToFailure(code);
  const failed = advance(db, d.id, [{ type: "FAIL", code: failure }]);
  if (failed && shouldAutoRetry(failure, failed.attempts)) {
    advance(db, d.id, [{ type: "RETRY" }]);
    await engine.retry(d.id, null);
    advance(db, d.id, [{ type: "REQUEUE" }]);
  }
}

async function reResolveAndRequeue(deps: Deps, d: Download, meta: SelectionMeta): Promise<boolean> {
  const source = getSource(deps.db, d.sourceId);
  if (!source || !deps.reResolve) return false;
  advance(deps.db, d.id, [{ type: "FAIL", code: "PROVIDER_CHANGED" }, { type: "RETRY" }, { type: "RE_RESOLVE" }]);
  const variants = await deps.reResolve(source.originalUrl).catch(() => null);
  const sel = variants && reselect(meta, variants);
  if (!sel) {
    advance(deps.db, d.id, [{ type: "FAIL", code: "FORMAT_UNAVAILABLE" }]);
    return true;
  }
  deps.db.update(downloads).set({ variantJson: JSON.stringify({ ...metaOf(sel), reResolved: true }) }).where(eq(downloads.id, d.id)).run();
  advance(deps.db, d.id, [{ type: "RESOLVED" }, { type: "AUTO_SELECT" }]);
  await deps.engine.retry(d.id, partsFor(sel) as NativePart[]);
  return true;
}

// ---- user actions -------------------------------------------------------------------------------

export async function pauseDownload(deps: Deps, id: string) {
  await deps.engine.pause(id);
  advance(deps.db, id, [{ type: "PAUSE" }]);
}

export async function resumeDownload(deps: Deps, id: string) {
  await deps.engine.resume(id);
  advance(deps.db, id, [{ type: "RESUME" }]);
}

export async function cancelDownload(deps: Deps, id: string) {
  await deps.engine.cancel(id);
  advance(deps.db, id, [{ type: "CANCEL" }]);
}

/** Retry a failed/canceled download: reuse the native task (keeps partial data) or, if it is gone, resolve again. */
export async function retryDownload(deps: Deps, id: string) {
  const d = deps.db.select().from(downloads).where(eq(downloads.id, id)).get();
  if (!d) return;
  const native = await deps.engine.getStatus(id);
  if (native) {
    advance(deps.db, id, [{ type: "RETRY" }]);
    await deps.engine.retry(id, null);
    advance(deps.db, id, [{ type: "REQUEUE" }]);
    return;
  }
  const meta = parseMeta(d);
  if (meta && deps.reResolve) {
    advance(deps.db, id, [{ type: "RETRY" }]);
    // re-enter through the same path as an expired URL, but the engine has no task: enqueue a fresh one
    const source = getSource(deps.db, d.sourceId);
    const variants = source ? await deps.reResolve(source.originalUrl).catch(() => null) : null;
    const sel = variants && reselect(meta, variants);
    if (!source || !sel) {
      advance(deps.db, id, [{ type: "RE_RESOLVE" }, { type: "FAIL", code: "FORMAT_UNAVAILABLE" }]);
      return;
    }
    advance(deps.db, id, [{ type: "RE_RESOLVE" }, { type: "RESOLVED" }, { type: "AUTO_SELECT" }]);
    await deps.engine.enqueue(buildJob({ taskId: id, title: source.title, platform: source.platform, creator: source.creatorName, selection: sel, naming: getNaming(deps.db) }));
  }
}

// ---- reconciliation -----------------------------------------------------------------------------

const ACTIVE_IN_DB: DownloadStatus[] = ["QUEUED", "DOWNLOADING", "PROCESSING", "PAUSED", "RETRYING"];

/** Align SQLite with the engine's authoritative task table (app start / foreground). Native terminal tasks are acked once mirrored. */
export async function reconcile(deps: Deps): Promise<void> {
  const tasks = await deps.engine.listAll();
  const known = new Set(tasks.map((t) => t.taskId));

  for (const t of tasks) {
    if (t.state === "COMPLETED" && t.uri) {
      await applyEngineEvent(deps, { kind: "complete", taskId: t.taskId, uri: t.uri, filename: t.filename });
    } else if (t.state === "FAILED" || t.state === "CANCELED") {
      await applyEngineEvent(deps, { kind: "state", taskId: t.taskId, state: t.state, errorCode: t.errorCode });
      if (t.state === "FAILED") await deps.engine.ack(t.taskId).catch(() => {}); // failure is mirrored; a retry re-creates the native task state
    } else {
      await applyEngineEvent(deps, { kind: "state", taskId: t.taskId, state: t.state });
    }
  }

  // Downloads the DB thinks are running but the engine has never heard of (crash between rows and enqueue).
  for (const d of deps.db.select().from(downloads).where(isNull(downloads.deletedAt)).all()) {
    if (!ACTIVE_IN_DB.includes(d.status) || known.has(d.id)) continue;
    advance(deps.db, d.id, [{ type: "FAIL", code: "UNKNOWN" }, { type: "CANCEL" }]);
  }
}
