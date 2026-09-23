// Local ⇄ remote column mapping for every synced table (plan §4). Local rows use Drizzle's camelCase keys and epoch-ms
// times; remote rows use snake_case and ISO timestamps. Local-only columns (dirty, attempts, progress, local_uri…) never leave the device.
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import { downloadAttempts, downloads, mediaSources, organizationRules, sourceUrls } from "@/db/schema";
import type { SyncTable } from "@/db/outbox";

type Kind = "text" | "int" | "bool" | "ts" | "json";
export type Col = { local: string; remote: string; kind: Kind };

export type TableDef = {
  name: Exclude<SyncTable, "settings">;
  table: SQLiteTable & { id: never };
  cols: Col[];
  /** Which local column mirrors `created_at` when the remote has none. */
  createdFrom: string;
};

const c = (local: string, remote = local, kind: Kind = "text"): Col => ({ local, remote, kind });

export const TABLES: TableDef[] = [
  {
    name: "media_sources", table: mediaSources as never, createdFrom: "firstSeenAt",
    cols: [
      c("id"), c("originalUrl", "original_url"), c("canonicalUrl", "canonical_url"), c("platform"), c("platformMediaId", "platform_media_id"),
      c("creatorId", "creator_id"), c("creatorName", "creator_name"), c("title"), c("description"), c("thumbnailUrl", "thumbnail_url"),
      c("mediaType", "media_type"), c("durationMs", "duration_ms", "int"), c("publishedAt", "published_at", "ts"),
      c("firstSeenAt", "first_seen_at", "ts"), c("lastCheckedAt", "last_checked_at", "ts"), c("status"), c("failureCode", "failure_code"),
      c("favorite", "favorite", "bool"), c("deletedAt", "deleted_at", "ts"),
    ],
  },
  {
    name: "source_urls", table: sourceUrls as never, createdFrom: "seenAt",
    cols: [c("id"), c("sourceId", "source_id"), c("url"), c("kind"), c("seenAt", "seen_at", "ts"), c("deletedAt", "deleted_at", "ts")],
  },
  {
    name: "downloads", table: downloads as never, createdFrom: "createdAt",
    cols: [
      c("id"), c("sourceId", "source_id"), c("deviceId", "device_id"), c("variantJson", "variant", "json"), c("container"), c("resolution"),
      c("filename"), c("totalBytes", "filesize", "int"), c("status"), c("failureCode", "failure_code"), c("resolverId", "resolver_id"),
      c("createdAt", "created_at", "ts"), c("completedAt", "completed_at", "ts"), c("fileDeletedAt", "file_deleted_at", "ts"),
      c("deletedAt", "deleted_at", "ts"),
    ],
  },
  {
    name: "download_attempts", table: downloadAttempts as never, createdFrom: "startedAt",
    cols: [
      c("id"), c("downloadId", "download_id"), c("resolverId", "resolver_id"), c("startedAt", "started_at", "ts"),
      c("endedAt", "ended_at", "ts"), c("failureCode", "failure_code"), c("detail"), c("deletedAt", "deleted_at", "ts"),
    ],
  },
  {
    name: "organization_rules", table: organizationRules as never, createdFrom: "updatedAt",
    cols: [c("id"), c("template"), c("filenameTemplate", "filename_template"), c("scope"), c("deletedAt", "deleted_at", "ts")],
  },
];

/** Parents before children (FK order). */
export const TABLE_ORDER = TABLES.map((t) => t.name);
export const tableDef = (name: string) => TABLES.find((t) => t.name === name);

const iso = (ms: number) => new Date(ms).toISOString();

export function toRemote(def: TableDef, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of def.cols) {
    const v = row[col.local];
    out[col.remote] =
      v == null ? null
      : col.kind === "ts" ? iso(v as number)
      : col.kind === "bool" ? Boolean(v)
      : col.kind === "json" ? safeParse(v as string)
      : v;
  }
  out.client_updated_at = iso(row.updatedAt as number);
  return out;
}

export function fromRemote(def: TableDef, r: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of def.cols) {
    const v = r[col.remote];
    out[col.local] =
      v == null ? null
      : col.kind === "ts" ? Date.parse(v as string)
      : col.kind === "bool" ? Boolean(v)
      : col.kind === "json" ? JSON.stringify(v)
      : v;
  }
  out.updatedAt = Date.parse(r.client_updated_at as string);
  out.createdAt = (out[def.createdFrom] as number | null) ?? out.updatedAt;
  out.dirty = false;
  return out;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
