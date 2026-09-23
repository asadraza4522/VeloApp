import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { enqueue } from "@/db/outbox";
import { downloads, mediaSources, type DownloadStatus } from "@/db/schema";
import type { Db } from "@/db/types";
import { failureState } from "@/domain/downloads/failure";
import { transition, type DownloadEvent } from "@/domain/downloads/state-machine";
import { uuidv7 } from "@/utils/uuid";

export type Download = typeof downloads.$inferSelect;

export function createDownload(
  db: Db,
  input: Partial<Pick<typeof downloads.$inferInsert, "variantJson" | "container" | "resolution" | "filename" | "totalBytes" | "resolverId" | "deviceId">> & { sourceId: string },
  now = Date.now(),
): Download {
  return db.transaction((tx) => {
    const id = uuidv7(now);
    tx.insert(downloads).values({ ...input, id, createdAt: now, updatedAt: now }).run();
    const row = tx.select().from(downloads).where(eq(downloads.id, id)).get()!;
    enqueue(tx, "downloads", id, "upsert", row, now);
    return row;
  });
}

// Applies an event through the state machine and persists the result + side effects atomically.
// Throws IllegalTransitionError for an event that is not legal in the current state.
export function dispatch(db: Db, id: string, event: DownloadEvent, now = Date.now()): Download {
  return db.transaction((tx) => {
    const cur = tx.select().from(downloads).where(eq(downloads.id, id)).get();
    if (!cur) throw new Error(`Download not found: ${id}`);
    const status = transition(cur.status, event);

    const patch: Partial<typeof downloads.$inferInsert> = { status, updatedAt: now, dirty: true };
    if (event.type === "FAIL") patch.failureCode = event.code;
    if (event.type === "RETRY") Object.assign(patch, { attempts: cur.attempts + 1, failureCode: null });
    if (status === "COMPLETED") Object.assign(patch, { completedAt: now, progressBytes: cur.totalBytes ?? cur.progressBytes });
    tx.update(downloads).set(patch).where(eq(downloads.id, id)).run();

    const next = tx.select().from(downloads).where(eq(downloads.id, id)).get()!;
    enqueue(tx, "downloads", id, "upsert", next, now);

    // Keep the parent source's status in step (PRD §36).
    const sourceStatus = event.type === "FAIL" ? (failureState(event.code) === "SOURCE_UNAVAILABLE" ? "unavailable" : "failed") : status === "COMPLETED" ? "resolved" : undefined;
    if (sourceStatus) {
      tx.update(mediaSources).set({ status: sourceStatus, updatedAt: now, dirty: true }).where(eq(mediaSources.id, cur.sourceId)).run();
      const src = tx.select().from(mediaSources).where(eq(mediaSources.id, cur.sourceId)).get();
      if (src) enqueue(tx, "media_sources", src.id, "upsert", src, now);
    }
    return next;
  });
}

// Progress is written on state change or every few seconds, never per native tick, and never synced.
export const flushProgress = (db: Db, id: string, progressBytes: number, totalBytes?: number | null) =>
  db.update(downloads).set({ progressBytes, ...(totalBytes != null && { totalBytes }) }).where(eq(downloads.id, id)).run();

export const setLocalFile = (db: Db, id: string, localUri: string, filename?: string) =>
  db.update(downloads).set({ localUri, ...(filename && { filename }) }).where(eq(downloads.id, id)).run();

// The file vanished (PRD §14): flag the download, keep the source.
export function markFileMissing(db: Db, id: string, now = Date.now()) {
  db.transaction((tx) => {
    tx.update(downloads).set({ fileDeletedAt: now, updatedAt: now, dirty: true }).where(eq(downloads.id, id)).run();
    const row = tx.select().from(downloads).where(eq(downloads.id, id)).get();
    if (row) enqueue(tx, "downloads", id, "upsert", row, now);
  });
}

export const QUEUE_GROUPS = {
  active: ["DOWNLOADING", "PROCESSING", "ORGANIZING"],
  waiting: ["CREATED", "VALIDATING", "DETECTING_PLATFORM", "RESOLVING", "RESOLVED", "WAITING_FOR_SELECTION", "QUEUED", "PAUSED", "RETRYING"],
  failed: ["FAILED", "AUTH_REQUIRED", "UNSUPPORTED", "SOURCE_UNAVAILABLE", "CANCELED"],
  completed: ["COMPLETED"],
} as const satisfies Record<string, readonly DownloadStatus[]>;

// Download joined with the fields the queue row needs.
export const buildQueueQuery = (db: Db, statuses: readonly DownloadStatus[], limit: number) =>
  db
    .select({
      id: downloads.id,
      sourceId: downloads.sourceId,
      status: downloads.status,
      failureCode: downloads.failureCode,
      progressBytes: downloads.progressBytes,
      totalBytes: downloads.totalBytes,
      resolution: downloads.resolution,
      container: downloads.container,
      updatedAt: downloads.updatedAt,
      localUri: downloads.localUri,
      filename: downloads.filename,
      fileDeletedAt: downloads.fileDeletedAt,
      title: mediaSources.title,
      platform: mediaSources.platform,
      thumbnailUrl: mediaSources.thumbnailUrl,
    })
    .from(downloads)
    .innerJoin(mediaSources, eq(mediaSources.id, downloads.sourceId))
    .where(and(isNull(downloads.deletedAt), inArray(downloads.status, [...statuses])))
    .orderBy(desc(downloads.updatedAt), desc(downloads.id))
    .limit(limit);

export type QueueRow = ReturnType<typeof buildQueueQuery> extends { all(): (infer R)[] } ? R : never;

export const listDownloadsForSource = (db: Db, sourceId: string) =>
  db.select().from(downloads).where(and(eq(downloads.sourceId, sourceId), isNull(downloads.deletedAt))).orderBy(desc(downloads.createdAt)).all();

/** Downloads that still have a file on this device, with what the tools need (Tools: pick, re-organize, duplicates, storage). */
export function listLibraryFiles(db: Db) {
  return db
    .select({
      downloadId: downloads.id, sourceId: downloads.sourceId, uri: downloads.localUri, filename: downloads.filename, size: downloads.totalBytes,
      createdAt: downloads.createdAt, completedAt: downloads.completedAt, resolution: downloads.resolution, container: downloads.container,
      title: mediaSources.title, platform: mediaSources.platform, creator: mediaSources.creatorName, mediaType: mediaSources.mediaType, thumbnailUrl: mediaSources.thumbnailUrl,
    })
    .from(downloads)
    .innerJoin(mediaSources, eq(mediaSources.id, downloads.sourceId))
    .where(and(eq(downloads.status, "COMPLETED"), isNotNull(downloads.localUri), isNull(downloads.fileDeletedAt), isNull(downloads.deletedAt)))
    .orderBy(desc(downloads.completedAt))
    .all();
}

export type LibraryFile = ReturnType<typeof listLibraryFiles>[number];

/** After a file was renamed/moved on disk. */
export function setFilename(db: Db, id: string, filename: string, now = Date.now()) {
  db.transaction((tx) => {
    tx.update(downloads).set({ filename, updatedAt: now, dirty: true }).where(eq(downloads.id, id)).run();
    const row = tx.select().from(downloads).where(eq(downloads.id, id)).get();
    if (row) enqueue(tx, "downloads", id, "upsert", row, now);
  });
}
