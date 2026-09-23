import { eq } from "drizzle-orm";

import { settings } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidv7 } from "@/utils/uuid";

/** Device-local values (never synced, never queued): stored in `settings` but written directly, not through the outbox. */
export function getLocalSetting(db: Db, key: string): string | null {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? null;
}

export function setLocalSetting(db: Db, key: string, value: string, now = Date.now()) {
  db.insert(settings).values({ key, value, updatedAt: now, dirty: false })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now, dirty: false } }).run();
}

/** Stable per-install id: tells apart which device downloaded a file (history syncs, files do not). */
export function getDeviceId(db: Db): string {
  const existing = getLocalSetting(db, "device_id");
  if (existing) return existing;
  const id = uuidv7();
  setLocalSetting(db, "device_id", id);
  return id;
}
