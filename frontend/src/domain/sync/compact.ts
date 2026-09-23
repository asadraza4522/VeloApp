import { and, eq, isNotNull, lt } from "drizzle-orm";

import { downloadAttempts, downloads, mediaSources, organizationRules, outbox, sourceUrls } from "@/db/schema";
import type { Db } from "@/db/types";

export const TOMBSTONE_DAYS = 30;

/** Hard-delete tombstones that are old AND already on the server (not dirty, nothing queued). Children before parents. */
export function compactTombstones(db: Db, now = Date.now(), days = TOMBSTONE_DAYS): number {
  const cutoff = now - days * 86_400_000;
  const queued = new Set(db.select().from(outbox).all().map((o) => `${o.tableName}:${o.rowId}`));
  let removed = 0;
  for (const [name, t] of [["download_attempts", downloadAttempts], ["downloads", downloads], ["source_urls", sourceUrls], ["media_sources", mediaSources], ["organization_rules", organizationRules]] as const) {
    const tb = t as never as { id: never; deletedAt: never; dirty: never };
    const rows = db.select().from(t as never).where(and(isNotNull(tb.deletedAt), lt(tb.deletedAt, cutoff), eq(tb.dirty, false))).all() as { id: string }[];
    for (const r of rows) {
      if (queued.has(`${name}:${r.id}`)) continue;
      try {
        db.delete(t as never).where(eq(tb.id, r.id as never)).run();
        removed++;
      } catch { /* still referenced by a live child: keep the tombstone */ }
    }
  }
  return removed;
}
