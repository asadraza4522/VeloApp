import { and, desc, eq, isNull, lt, or, sql, type SQL } from "drizzle-orm";

import { enqueue } from "@/db/outbox";
import { downloads, mediaSources, sourceUrls, type FailureCode, type MediaType, type SourceStatus } from "@/db/schema";
import type { Db } from "@/db/types";
import { canonicalize } from "@/domain/sources/url";
import { uuidv7 } from "@/utils/uuid";

export type Source = typeof mediaSources.$inferSelect;
export type SourceMetadata = Partial<
  Pick<Source, "title" | "description" | "creatorId" | "creatorName" | "thumbnailUrl" | "mediaType" | "durationMs" | "publishedAt" | "platformMediaId">
>;

export class InvalidUrlError extends Error {
  constructor(readonly url: string) {
    super(`Not a valid http(s) URL: ${url}`);
  }
}

// Save Link / Analyze: one persistent source per canonical url (PRD §8). Re-adding returns the existing one.
export function createSource(db: Db, input: { url: string } & SourceMetadata, now = Date.now()): { source: Source; created: boolean } {
  const url = input.url.trim();
  const canon = canonicalize(url);
  if (!canon) throw new InvalidUrlError(url);
  const { url: _url, ...meta } = input;

  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(mediaSources)
      .where(and(eq(mediaSources.canonicalUrl, canon.canonicalUrl), isNull(mediaSources.deletedAt)))
      .get();
    if (existing) {
      const seen = tx.select().from(sourceUrls).where(and(eq(sourceUrls.sourceId, existing.id), eq(sourceUrls.url, url))).get();
      if (!seen && url !== existing.originalUrl) {
        const row = { id: uuidv7(now), sourceId: existing.id, url, kind: "redirect" as const, seenAt: now, createdAt: now, updatedAt: now };
        tx.insert(sourceUrls).values(row).run();
        enqueue(tx, "source_urls", row.id, "upsert", row, now);
      }
      return { source: existing, created: false };
    }

    const id = uuidv7(now);
    const row = {
      ...meta,
      id,
      originalUrl: url,
      canonicalUrl: canon.canonicalUrl,
      platform: canon.platform,
      platformMediaId: meta.platformMediaId ?? canon.platformMediaId,
      firstSeenAt: now,
      resolveState: "pending" as const, // metadata is fetched when online (Save Link works offline)
      createdAt: now,
      updatedAt: now,
    };
    tx.insert(mediaSources).values(row).run();
    const source = tx.select().from(mediaSources).where(eq(mediaSources.id, id)).get()!;
    enqueue(tx, "media_sources", id, "upsert", source, now);

    const urlRow = { id: uuidv7(now), sourceId: id, url, kind: "original" as const, seenAt: now, createdAt: now, updatedAt: now };
    tx.insert(sourceUrls).values(urlRow).run();
    enqueue(tx, "source_urls", urlRow.id, "upsert", urlRow, now);
    return { source, created: true };
  });
}

function patchSource(db: Db, id: string, patch: Partial<typeof mediaSources.$inferInsert>, now: number) {
  return db.transaction((tx) => {
    tx.update(mediaSources).set({ ...patch, updatedAt: now, dirty: true }).where(eq(mediaSources.id, id)).run();
    const source = tx.select().from(mediaSources).where(eq(mediaSources.id, id)).get();
    if (source) enqueue(tx, "media_sources", id, "upsert", source, now);
    return source;
  });
}

// Result of a resolve: fills metadata and marks the source resolved.
export const applyResolved = (db: Db, id: string, meta: SourceMetadata, now = Date.now()) =>
  patchSource(db, id, { ...meta, status: "resolved", resolveState: "done", failureCode: null, lastCheckedAt: now }, now);

// A failed resolve keeps the source (PRD §15): status + reason, so the UI can offer the right actions.
export const recordFailure = (db: Db, id: string, code: FailureCode, now = Date.now()) =>
  patchSource(db, id, { status: code === "MEDIA_NOT_FOUND" ? "unavailable" : "failed", failureCode: code, resolveState: "idle", lastCheckedAt: now }, now);

export const setFavorite = (db: Db, id: string, favorite: boolean, now = Date.now()) => patchSource(db, id, { favorite }, now);

export const setSourceStatus = (db: Db, id: string, status: SourceStatus, now = Date.now()) => patchSource(db, id, { status }, now);

// Soft delete (tombstone) the source and everything under it; never touches media files.
export function deleteSource(db: Db, id: string, now = Date.now()) {
  db.transaction((tx) => {
    for (const d of tx.select().from(downloads).where(and(eq(downloads.sourceId, id), isNull(downloads.deletedAt))).all()) {
      tx.update(downloads).set({ deletedAt: now, updatedAt: now, dirty: true }).where(eq(downloads.id, d.id)).run();
      enqueue(tx, "downloads", d.id, "delete", undefined, now);
    }
    for (const u of tx.select().from(sourceUrls).where(and(eq(sourceUrls.sourceId, id), isNull(sourceUrls.deletedAt))).all()) {
      tx.update(sourceUrls).set({ deletedAt: now, updatedAt: now, dirty: true }).where(eq(sourceUrls.id, u.id)).run();
      enqueue(tx, "source_urls", u.id, "delete", undefined, now);
    }
    tx.update(mediaSources).set({ deletedAt: now, updatedAt: now, dirty: true }).where(eq(mediaSources.id, id)).run();
    enqueue(tx, "media_sources", id, "delete", undefined, now);
  });
}

export type SourceFilters = {
  status?: SourceStatus;
  mediaType?: MediaType;
  platform?: string;
  favorite?: boolean;
  search?: string;
};
export type SourceCursor = { updatedAt: number; id: string };

// "foo bar" → `"foo"* "bar"*` (prefix match, all tokens). Null when there is nothing to search.
export function toFtsQuery(text: string): string | null {
  const tokens = text.normalize("NFKC").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return tokens.length ? tokens.map((t) => `"${t}"*`).join(" ") : null;
}

export function sourceConditions(f: SourceFilters, after?: SourceCursor): SQL {
  const c: (SQL | undefined)[] = [isNull(mediaSources.deletedAt)];
  if (f.status) c.push(eq(mediaSources.status, f.status));
  if (f.mediaType) c.push(eq(mediaSources.mediaType, f.mediaType));
  if (f.platform) c.push(eq(mediaSources.platform, f.platform));
  if (f.favorite !== undefined) c.push(eq(mediaSources.favorite, f.favorite));
  const fts = f.search ? toFtsQuery(f.search) : null;
  if (fts) c.push(sql`media_sources.rowid in (select rowid from sources_fts where sources_fts match ${fts})`);
  if (after) {
    c.push(or(lt(mediaSources.updatedAt, after.updatedAt), and(eq(mediaSources.updatedAt, after.updatedAt), lt(mediaSources.id, after.id))));
  }
  return and(...c)!;
}

// Newest first. Keyset pagination (never OFFSET); the live hook re-runs this with a growing limit.
export const buildSourcesQuery = (db: Db, filters: SourceFilters, limit: number, after?: SourceCursor) =>
  db
    .select()
    .from(mediaSources)
    .where(sourceConditions(filters, after))
    .orderBy(desc(mediaSources.updatedAt), desc(mediaSources.id))
    .limit(limit);

export const listSources = (db: Db, filters: SourceFilters = {}, limit = 50, after?: SourceCursor) =>
  buildSourcesQuery(db, filters, limit, after).all();

export const getSource = (db: Db, id: string) => db.select().from(mediaSources).where(eq(mediaSources.id, id)).get();
