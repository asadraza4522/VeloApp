// Test-only: an in-memory better-sqlite3 database migrated with the exact SQL the app ships.
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";

import * as schema from "@/db/schema";
import type { Db } from "@/db/types";

export function createTestDb(): Db {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(__dirname, "migrations") });
  return db as unknown as Db;
}
