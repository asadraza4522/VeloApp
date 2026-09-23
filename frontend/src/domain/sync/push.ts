// Outbox → server. Every local write left an outbox row (same transaction as the write); here they are
// coalesced per row, sent parents-first, and cleared only after the server accepted them (plan §5).
import { and, asc, eq, inArray, lt } from "drizzle-orm";

import { outbox, settings } from "@/db/schema";
import type { Db } from "@/db/types";
import { RemoteError, type Remote, type Row } from "@/domain/sync/remote";
import { TABLE_ORDER, tableDef, toRemote } from "@/domain/sync/tables";

export const MAX_ATTEMPTS = 8;   // then the op is parked (visible in Settings → Sync), never dropped silently
const BATCH = 100;
export const SYNCED_SETTING_KEYS = ["organization"] as const; // device-specific settings (Wi-Fi only…) stay local

export type PushResult = { pushed: number; parked: number; error?: RemoteError };

type Pending = { table: string; ids: Map<string, number> }; // id → highest outbox seq seen for it

function collect(db: Db): Map<string, Pending> {
  const ops = db.select().from(outbox).where(lt(outbox.attempts, MAX_ATTEMPTS)).orderBy(asc(outbox.seq)).limit(1000).all();
  const byTable = new Map<string, Pending>();
  for (const o of ops) {
    const p = byTable.get(o.tableName) ?? { table: o.tableName, ids: new Map() };
    p.ids.set(o.rowId, Math.max(p.ids.get(o.rowId) ?? 0, o.seq));
    byTable.set(o.tableName, p);
  }
  return byTable;
}

function clear(db: Db, table: string, sent: { id: string; seq: number; updatedAt?: number }[]) {
  db.transaction((tx) => {
    for (const s of sent) {
      tx.delete(outbox).where(and(eq(outbox.tableName, table), eq(outbox.rowId, s.id), lt(outbox.seq, s.seq + 1))).run();
      const def = tableDef(table);
      // Mark clean only if the row was not edited again while the request was in flight.
      if (def && s.updatedAt != null) {
        const t = def.table as never as { id: never; updatedAt: never; dirty: never };
        tx.update(def.table as never).set({ dirty: false } as never).where(and(eq(t.id, s.id), eq(t.updatedAt, s.updatedAt))).run();
      }
    }
  });
}

function bump(db: Db, table: string, ids: string[]) {
  const rows = db.select().from(outbox).where(and(eq(outbox.tableName, table), inArray(outbox.rowId, ids))).all();
  for (const r of rows) db.update(outbox).set({ attempts: r.attempts + 1 }).where(eq(outbox.seq, r.seq)).run();
}

export async function pushOutbox(db: Db, remote: Remote): Promise<PushResult> {
  const pending = collect(db);
  let pushed = 0;
  let parked = 0;

  for (const name of TABLE_ORDER) {
    const p = pending.get(name);
    if (!p) continue;
    const def = tableDef(name)!;
    const t = def.table as never as Record<string, never>;
    const ids = [...p.ids.keys()];

    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      const local = (db.select().from(def.table as never).where(inArray(t.id, chunk)).all() as Record<string, unknown>[])
        // Tombstones first: they free a canonical URL before another live row (a merged duplicate) claims it.
        .sort((a, b) => Number(a.deletedAt == null) - Number(b.deletedAt == null));
      const found = new Set(local.map((r) => r.id as string));
      // A queued op whose row is gone (compacted / never created) has nothing to send.
      clear(db, name, chunk.filter((id) => !found.has(id)).map((id) => ({ id, seq: p.ids.get(id)! })));
      if (!local.length) continue;

      const send = async (rows: Record<string, unknown>[]) => {
        await remote.upsert(name, rows.map((r) => toRemote(def, r)), "id");
        clear(db, name, rows.map((r) => ({ id: r.id as string, seq: p.ids.get(r.id as string)!, updatedAt: r.updatedAt as number })));
        pushed += rows.length;
      };

      try {
        await send(local);
      } catch (e) {
        if (!(e instanceof RemoteError) || e.kind !== "row") return { pushed, parked, error: asRemoteError(e) };
        // One bad row must not block the rest: retry individually, count attempts on the rejected ones.
        for (const row of local) {
          try {
            await send([row]);
          } catch (e2) {
            if (!(e2 instanceof RemoteError) || e2.kind !== "row") return { pushed, parked, error: asRemoteError(e2) };
            bump(db, name, [row.id as string]);
            if (bumpedToPark(db, name, row.id as string)) parked++;
          }
        }
      }
    }
  }

  const s = await pushSettings(db, remote).catch((e) => ({ error: asRemoteError(e), count: 0 }));
  pushed += s.count;
  return { pushed, parked, error: s.error };
}

function bumpedToPark(db: Db, table: string, id: string) {
  return db.select().from(outbox).where(and(eq(outbox.tableName, table), eq(outbox.rowId, id))).all().some((o) => o.attempts >= MAX_ATTEMPTS);
}

const asRemoteError = (e: unknown) => (e instanceof RemoteError ? e : new RemoteError("network", e instanceof Error ? e.message : String(e)));

/** Settings are one blob per user, merged per key: {key: {v, t}} so two devices editing different keys do not clobber each other. */
async function pushSettings(db: Db, remote: Remote): Promise<{ count: number; error?: RemoteError }> {
  const ops = db.select().from(outbox).where(and(eq(outbox.tableName, "settings"), lt(outbox.attempts, MAX_ATTEMPTS))).all();
  if (!ops.length) return { count: 0 };
  const maxSeq = Math.max(...ops.map((o) => o.seq));
  const rows = db.select().from(settings).where(inArray(settings.key, [...SYNCED_SETTING_KEYS])).all();
  if (rows.length) {
    const data: Record<string, { v: unknown; t: number }> = {};
    for (const r of rows) data[r.key] = { v: JSON.parse(r.value), t: r.updatedAt };
    const row: Row = { data, client_updated_at: new Date(Math.max(...rows.map((r) => r.updatedAt))).toISOString() };
    await remote.upsert("settings", [row], "user_id");
  }
  db.delete(outbox).where(and(eq(outbox.tableName, "settings"), lt(outbox.seq, maxSeq + 1))).run();
  db.update(settings).set({ dirty: false }).where(inArray(settings.key, [...SYNCED_SETTING_KEYS])).run();
  return { count: rows.length };
}

export const pendingCount = (db: Db) => db.select().from(outbox).where(lt(outbox.attempts, MAX_ATTEMPTS)).all().length;
export const parkedCount = (db: Db) => db.select().from(outbox).all().length - pendingCount(db);
