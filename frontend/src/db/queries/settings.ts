import { eq } from "drizzle-orm";

import { enqueue } from "@/db/outbox";
import { settings } from "@/db/schema";
import type { Db } from "@/db/types";
import { DEFAULT_NAMING, type Naming } from "@/domain/organize/template";

export function getSetting<T>(db: Db, key: string, fallback: T): T {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(db: Db, key: string, value: unknown, now = Date.now()) {
  db.transaction((tx) => {
    const json = JSON.stringify(value);
    tx.insert(settings).values({ key, value: json, updatedAt: now }).onConflictDoUpdate({ target: settings.key, set: { value: json, updatedAt: now, dirty: true } }).run();
    enqueue(tx, "settings", key, "upsert", { key, value: json, updatedAt: now }, now);
  });
}

export const NAMING_KEY = "organization";
export const getNaming = (db: Db): Naming => ({ ...DEFAULT_NAMING, ...getSetting<Partial<Naming>>(db, NAMING_KEY, {}) });
export const setNaming = (db: Db, naming: Naming) => setSetting(db, NAMING_KEY, naming);
