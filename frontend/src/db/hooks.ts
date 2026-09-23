import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";

import { db } from "@/db/client";
import { buildQueueQuery } from "@/db/queries/downloads";
import { buildSourcesQuery, type SourceFilters } from "@/db/queries/sources";
import { downloads, kvCache, mediaSources, outbox, settings, type DownloadStatus } from "@/db/schema";
import { MAX_ATTEMPTS } from "@/domain/sync/push";
import type { SyncOutcome } from "@/domain/sync/engine";

// Live queries re-run when the tables change. Lists page by growing `limit` (onEndReached) rather than
// holding every row: at 5k+ rows the visible window is all the UI ever reads.
export function useSources(filters: SourceFilters, limit: number) {
  const key = `${filters.status}|${filters.mediaType}|${filters.platform}|${filters.favorite}|${filters.search}|${limit}`;
  return useLiveQuery(buildSourcesQuery(db, filters, limit), [key]).data;
}

export function useQueue(statuses: readonly DownloadStatus[], limit: number) {
  return useLiveQuery(buildQueueQuery(db, statuses, limit), [statuses.join(), limit]).data;
}

export function useSource(id: string) {
  return useLiveQuery(db.select().from(mediaSources).where(eq(mediaSources.id, id)), [id]).data[0];
}

export function useSourceDownloads(sourceId: string) {
  return useLiveQuery(
    db.select().from(downloads).where(and(eq(downloads.sourceId, sourceId), isNull(downloads.deletedAt))).orderBy(desc(downloads.createdAt)),
    [sourceId],
  ).data;
}

export function useSettingValue<T>(key: string, fallback: T): T {
  const row = useLiveQuery(db.select().from(settings).where(eq(settings.key, key)), [key]).data[0];
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function useSyncStatus(): SyncOutcome | null {
  const row = useLiveQuery(db.select().from(kvCache).where(eq(kvCache.key, "sync_status")), []).data[0];
  try {
    return row ? (JSON.parse(row.value) as SyncOutcome) : null;
  } catch {
    return null;
  }
}

export function useOutboxCounts() {
  const pending = useLiveQuery(db.select({ n: sql<number>`count(*)` }).from(outbox).where(lt(outbox.attempts, MAX_ATTEMPTS)), []).data[0]?.n ?? 0;
  const parked = useLiveQuery(db.select({ n: sql<number>`count(*)` }).from(outbox).where(gte(outbox.attempts, MAX_ATTEMPTS)), []).data[0]?.n ?? 0;
  return { pending, parked };
}
