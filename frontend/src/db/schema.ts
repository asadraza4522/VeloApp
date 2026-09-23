// Local SQLite schema — the app's source of truth (docs/VELO_TECHNICAL_PLAN.md §4.1).
// Times are epoch ms. Ids are client-generated UUIDv7. Syncable tables carry the sync columns
// and are mirrored to Supabase through the outbox; `downloads.local_uri` is device-only.

import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const MEDIA_TYPES = ["video", "audio", "image", "file", "unknown"] as const;
export const SOURCE_STATUSES = ["saved", "resolved", "unavailable", "failed"] as const;
export const RESOLVE_STATES = ["idle", "pending", "done"] as const;
export const URL_KINDS = ["original", "canonical", "redirect"] as const;
// PRD §29
export const DOWNLOAD_STATUSES = [
  "CREATED", "VALIDATING", "DETECTING_PLATFORM", "RESOLVING", "RESOLVED", "WAITING_FOR_SELECTION",
  "QUEUED", "DOWNLOADING", "PROCESSING", "ORGANIZING", "COMPLETED",
  "PAUSED", "CANCELED", "RETRYING", "FAILED", "AUTH_REQUIRED", "UNSUPPORTED", "SOURCE_UNAVAILABLE",
] as const;
// PRD §16
export const FAILURE_CODES = [
  "AUTH_REQUIRED", "PRIVATE", "RATE_LIMITED", "MEDIA_NOT_FOUND", "PROVIDER_CHANGED", "FORMAT_UNAVAILABLE",
  "NETWORK_ERROR", "UNSUPPORTED", "CAPTCHA_REQUIRED", "SERVER_ERROR", "DRM_PROTECTED", "UNKNOWN",
] as const;

export type MediaType = (typeof MEDIA_TYPES)[number];
export type SourceStatus = (typeof SOURCE_STATUSES)[number];
export type DownloadStatus = (typeof DOWNLOAD_STATUSES)[number];
export type FailureCode = (typeof FAILURE_CODES)[number];

const sync = {
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  deletedAt: integer("deleted_at"), // tombstone
  dirty: integer("dirty", { mode: "boolean" }).notNull().default(true),
  serverRev: integer("server_rev"),
};

export const mediaSources = sqliteTable(
  "media_sources",
  {
    id: text("id").primaryKey(),
    originalUrl: text("original_url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    platform: text("platform").notNull().default("Other"),
    platformMediaId: text("platform_media_id"),
    creatorId: text("creator_id"),
    creatorName: text("creator_name"),
    title: text("title"),
    description: text("description"),
    thumbnailUrl: text("thumbnail_url"),
    mediaType: text("media_type", { enum: MEDIA_TYPES }).notNull().default("unknown"),
    durationMs: integer("duration_ms"),
    publishedAt: integer("published_at"),
    firstSeenAt: integer("first_seen_at").notNull(),
    lastCheckedAt: integer("last_checked_at"),
    status: text("status", { enum: SOURCE_STATUSES }).notNull().default("saved"),
    failureCode: text("failure_code", { enum: FAILURE_CODES }),
    favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
    resolveState: text("resolve_state", { enum: RESOLVE_STATES }).notNull().default("idle"),
    ...sync,
  },
  (t) => [
    uniqueIndex("media_sources_canonical_uq").on(t.canonicalUrl).where(sql`${t.deletedAt} is null`),
    index("media_sources_updated_idx").on(t.deletedAt, t.updatedAt, t.id),
    index("media_sources_platform_idx").on(t.platform, t.mediaType),
    index("media_sources_media_id_idx").on(t.platform, t.platformMediaId),
  ],
);

export const sourceUrls = sqliteTable(
  "source_urls",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id").notNull().references(() => mediaSources.id),
    url: text("url").notNull(),
    kind: text("kind", { enum: URL_KINDS }).notNull(),
    seenAt: integer("seen_at").notNull(),
    ...sync,
  },
  (t) => [index("source_urls_source_idx").on(t.sourceId)],
);

export const downloads = sqliteTable(
  "downloads",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id").notNull().references(() => mediaSources.id),
    variantJson: text("variant_json"),
    container: text("container"),
    resolution: text("resolution"),
    filename: text("filename"),
    localUri: text("local_uri"), // device-only: never synced
    filesize: integer("filesize"),
    status: text("status", { enum: DOWNLOAD_STATUSES }).notNull().default("CREATED"),
    failureCode: text("failure_code", { enum: FAILURE_CODES }),
    attempts: integer("attempts").notNull().default(0),
    deviceId: text("device_id"), // which device downloaded it (files are per device; history syncs)
    progressBytes: integer("progress_bytes").notNull().default(0),
    totalBytes: integer("total_bytes"),
    resolverId: text("resolver_id"),
    completedAt: integer("completed_at"),
    fileDeletedAt: integer("file_deleted_at"),
    ...sync,
  },
  (t) => [
    index("downloads_source_idx").on(t.sourceId),
    index("downloads_status_idx").on(t.deletedAt, t.status, t.updatedAt),
  ],
);

export const downloadAttempts = sqliteTable(
  "download_attempts",
  {
    id: text("id").primaryKey(),
    downloadId: text("download_id").notNull().references(() => downloads.id),
    resolverId: text("resolver_id"),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at"),
    failureCode: text("failure_code", { enum: FAILURE_CODES }),
    detail: text("detail"),
    ...sync,
  },
  (t) => [index("download_attempts_download_idx").on(t.downloadId)],
);

export const organizationRules = sqliteTable("organization_rules", {
  id: text("id").primaryKey(),
  template: text("template").notNull(),
  filenameTemplate: text("filename_template").notNull(),
  scope: text("scope").notNull().default("default"),
  ...sync,
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // JSON
  updatedAt: integer("updated_at").notNull(),
  dirty: integer("dirty", { mode: "boolean" }).notNull().default(true),
});

// Every syncable mutation writes a row here in the same transaction (offline-first rule).
export const outbox = sqliteTable("outbox", {
  seq: integer("seq").primaryKey({ autoIncrement: true }),
  tableName: text("table_name").notNull(),
  rowId: text("row_id").notNull(),
  op: text("op", { enum: ["upsert", "delete"] }).notNull(),
  payload: text("payload"), // JSON of the row (upsert)
  createdAt: integer("created_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
});

export const syncState = sqliteTable("sync_state", {
  tableName: text("table_name").primaryKey(),
  cursorUpdatedAt: text("cursor_updated_at").notNull().default(""), // server timestamp as ISO text (µs precision)
  cursorId: text("cursor_id").notNull().default(""),
});

// Cached server snapshots (entitlements, flags, resolver health).
export const kvCache = sqliteTable("kv_cache", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  fetchedAt: integer("fetched_at").notNull(),
});
