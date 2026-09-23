// Server → local. Keyset-paged by (updated_at, id); each page is applied in one transaction with its cursor,
// so a crash mid-pull just re-reads the page. Conflicts: last write wins by the row's client time (plan §5).
import { and, eq, isNull } from "drizzle-orm";

import { enqueue } from "@/db/outbox";
import { downloads, kvCache, mediaSources, settings, sourceUrls, syncState } from "@/db/schema";
import type { Db, Tx } from "@/db/types";
import { RemoteError, type Cursor, type Remote, type Row } from "@/domain/sync/remote";
import { SYNCED_SETTING_KEYS } from "@/domain/sync/push";
import { fromRemote, TABLE_ORDER, tableDef, type TableDef } from "@/domain/sync/tables";

export const PAGE = 500;
const EPOCH: Cursor = { at: "1970-01-01T00:00:00Z", id: "00000000-0000-0000-0000-000000000000" };
const TERMINAL = new Set(["COMPLETED", "FAILED", "AUTH_REQUIRED", "UNSUPPORTED", "SOURCE_UNAVAILABLE", "CANCELED"]);
const ALIAS_KEY = "source_alias";

export type PullResult = { applied: number; kept: number; skipped: number; deferred: number; error?: RemoteError };
type Ctx = { deviceId: string; now: number; alias: Record<string, string>; aliasDirty: boolean };

const getCursor = (db: Db, table: string): Cursor => {
  const r = db.select().from(syncState).where(eq(syncState.tableName, table)).get();
  return r && r.cursorUpdatedAt ? { at: r.cursorUpdatedAt, id: r.cursorId } : EPOCH;
};
const setCursor = (tx: Tx | Db, table: string, c: Cursor) =>
  tx.insert(syncState).values({ tableName: table, cursorUpdatedAt: c.at, cursorId: c.id })
    .onConflictDoUpdate({ target: syncState.tableName, set: { cursorUpdatedAt: c.at, cursorId: c.id } }).run();

function loadAlias(db: Db): Record<string, string> {
  const r = db.select().from(kvCache).where(eq(kvCache.key, ALIAS_KEY)).get();
  try { return r ? (JSON.parse(r.value) as Record<string, string>) : {}; } catch { return {}; }
}
const saveAlias = (tx: Tx | Db, alias: Record<string, string>, now: number) =>
  tx.insert(kvCache).values({ key: ALIAS_KEY, value: JSON.stringify(alias), fetchedAt: now })
    .onConflictDoUpdate({ target: kvCache.key, set: { value: JSON.stringify(alias), fetchedAt: now } }).run();

const resolveAlias = (alias: Record<string, string>, id: string) => {
  let cur = id;
  for (let i = 0; i < 5 && alias[cur]; i++) cur = alias[cur]; // chains are short; the cap guards against cycles
  return cur;
};

/**
 * Two devices saved the same link: both converge on the lexicographically smaller id (UUIDv7 → the earlier one).
 * Returns which side lost plus an `after` step that must run once the winner row exists (re-parenting children needs it).
 */
function mergeDuplicateSource(tx: Tx, v: Record<string, unknown>, ctx: Ctx): { loser: "incoming" | "existing"; after?: () => void } | null {
  const clash = tx.select().from(mediaSources)
    .where(and(eq(mediaSources.canonicalUrl, v.canonicalUrl as string), isNull(mediaSources.deletedAt))).all()
    .find((s) => s.id !== v.id);
  if (!clash) return null;

  if (clash.id < (v.id as string)) {
    ctx.alias[v.id as string] = clash.id; // incoming loses: stored as a tombstone; its children later re-parent to the winner
    ctx.aliasDirty = true;
    return { loser: "incoming" };
  }

  // Existing loses: tombstone it now (frees the unique canonical URL for the incoming row)…
  tx.update(mediaSources).set({ deletedAt: ctx.now, updatedAt: ctx.now, dirty: true }).where(eq(mediaSources.id, clash.id)).run();
  const dead = tx.select().from(mediaSources).where(eq(mediaSources.id, clash.id)).get();
  if (dead) enqueue(tx, "media_sources", clash.id, "upsert", dead, ctx.now);
  ctx.alias[clash.id] = v.id as string;
  ctx.aliasDirty = true;

  // …and move its local children under the winner after the winner has been inserted.
  return {
    loser: "existing",
    after: () => {
      for (const d of tx.select().from(downloads).where(eq(downloads.sourceId, clash.id)).all()) {
        tx.update(downloads).set({ sourceId: v.id as string, updatedAt: ctx.now, dirty: true }).where(eq(downloads.id, d.id)).run();
        const row = tx.select().from(downloads).where(eq(downloads.id, d.id)).get();
        if (row) enqueue(tx, "downloads", d.id, "upsert", row, ctx.now);
      }
      for (const u of tx.select().from(sourceUrls).where(eq(sourceUrls.sourceId, clash.id)).all()) {
        tx.update(sourceUrls).set({ sourceId: v.id as string, updatedAt: ctx.now, dirty: true }).where(eq(sourceUrls.id, u.id)).run();
        const row = tx.select().from(sourceUrls).where(eq(sourceUrls.id, u.id)).get();
        if (row) enqueue(tx, "source_urls", u.id, "upsert", row, ctx.now);
      }
    },
  };
}

function applyRow(tx: Tx, def: TableDef, r: Row, ctx: Ctx): "applied" | "kept" | "skipped" | "deferred" {
  const v = fromRemote(def, r);
  const t = def.table as never as Record<string, never>;
  const local = tx.select().from(def.table as never).where(eq(t.id, v.id as never)).get() as { updatedAt: number; localUri?: string | null } | undefined;
  if (local && local.updatedAt > (v.updatedAt as number)) return "kept"; // our edit is newer
  let after: (() => void) | undefined;

  if (def.name === "media_sources") {
    v.resolveState = v.status === "resolved" || v.title ? "done" : "pending"; // unresolved links resolve on this device too
    const merge = v.deletedAt ? null : mergeDuplicateSource(tx, v, ctx);
    if (merge?.loser === "incoming") Object.assign(v, { deletedAt: ctx.now, updatedAt: ctx.now, dirty: true });
    after = merge?.after;
  }
  if (def.name === "source_urls" || def.name === "downloads") v.sourceId = resolveAlias(ctx.alias, v.sourceId as string);

  // A child whose parent has not been pulled yet must wait (never skipped: that would lose it for good).
  const parentOf = { source_urls: [mediaSources, v.sourceId], downloads: [mediaSources, v.sourceId], download_attempts: [downloads, v.downloadId] }[def.name as string] as [{ id: never }, string] | undefined;
  if (parentOf && !tx.select().from(parentOf[0] as never).where(eq(parentOf[0].id, parentOf[1] as never)).get()) return "deferred";

  if (def.name === "downloads") {
    // In-progress work on another device is theirs; only finished history is mirrored.
    if (!TERMINAL.has(v.status as string)) return "skipped";
    // Files are per device: without a local file the entry is history with "File missing → Redownload".
    if (v.status === "COMPLETED" && !local?.localUri) v.fileDeletedAt = (v.fileDeletedAt as number | null) ?? ctx.now;
  }

  const { id: _id, ...set } = v;
  tx.insert(def.table as never).values(v as never).onConflictDoUpdate({ target: t.id, set: set as never }).run();
  if (v.dirty) enqueue(tx, def.name, v.id as string, "upsert", v, ctx.now);
  after?.();
  return "applied";
}

export async function pullAll(db: Db, remote: Remote, deviceId: string, now = Date.now(), pageSize = PAGE): Promise<PullResult> {
  const res: PullResult = { applied: 0, kept: 0, skipped: 0, deferred: 0 };
  const ctx: Ctx = { deviceId, now, alias: loadAlias(db), aliasDirty: false };

  try {
    for (const name of TABLE_ORDER) {
      const def = tableDef(name)!;
      for (;;) {
        const cursor = getCursor(db, name);
        const page = await remote.pull(name, cursor, pageSize);
        if (!page.length) break;
        let stop = false;
        db.transaction((tx) => {
          let last: Row | null = null;
          for (const r of page) {
            let out: ReturnType<typeof applyRow>;
            try {
              out = applyRow(tx, def, r, ctx);
            } catch (e) {
              if (e instanceof RemoteError) throw e;
              out = "skipped"; // unexpected per-row failure: count it (surfaced in sync status) but never stall the cursor
            }
            if (out === "deferred") { res.deferred++; stop = true; break; } // parent not here yet: resume from this row next pass
            res[out === "applied" ? "applied" : out]++;
            last = r;
          }
          if (ctx.aliasDirty) saveAlias(tx, ctx.alias, now);
          if (last) setCursor(tx, name, { at: last.updated_at as string, id: last.id as string });
        });
        if (stop || page.length < pageSize) break;
      }
    }
    await pullSettings(db, remote, res);
  } catch (e) {
    res.error = e instanceof RemoteError ? e : new RemoteError("network", e instanceof Error ? e.message : String(e));
  }
  return res;
}

async function pullSettings(db: Db, remote: Remote, res: PullResult) {
  const cur = getCursor(db, "settings");
  const row = await remote.pullSettings(cur.at);
  if (!row) return;
  const data = (row.data ?? {}) as Record<string, { v: unknown; t: number }>;
  db.transaction((tx) => {
    for (const key of SYNCED_SETTING_KEYS) {
      const entry = data[key];
      if (!entry) continue;
      const local = tx.select().from(settings).where(eq(settings.key, key)).get();
      if (local && local.updatedAt >= entry.t) { res.kept++; continue; }
      const value = JSON.stringify(entry.v);
      tx.insert(settings).values({ key, value, updatedAt: entry.t, dirty: false })
        .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: entry.t, dirty: false } }).run();
      res.applied++;
    }
    setCursor(tx, "settings", { at: row.updated_at as string, id: "" });
  });
}
