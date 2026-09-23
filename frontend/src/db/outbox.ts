import { outbox } from "@/db/schema";
import type { DbOrTx } from "@/db/types";

export type SyncTable = "media_sources" | "source_urls" | "downloads" | "download_attempts" | "organization_rules" | "settings";

// Columns that must never leave the device.
const DEVICE_ONLY: Partial<Record<SyncTable, string[]>> = { downloads: ["localUri"] };

// Call inside the same transaction as the row write (offline-first rule, CLAUDE.md).
export function enqueue(tx: DbOrTx, table: SyncTable, rowId: string, op: "upsert" | "delete", row?: object, now = Date.now()) {
  let payload: string | null = null;
  if (row) {
    const clean: Record<string, unknown> = { ...row };
    for (const k of DEVICE_ONLY[table] ?? []) delete clean[k];
    payload = JSON.stringify(clean);
  }
  tx.insert(outbox).values({ tableName: table, rowId, op, payload, createdAt: now }).run();
}
