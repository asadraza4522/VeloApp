import { drizzle } from "drizzle-orm/expo-sqlite";
import { openDatabaseSync } from "expo-sqlite";

import * as schema from "@/db/schema";

// Opening is a cheap synchronous call; only import this module from the DB gate and hooks,
// never from pure domain code (that takes a `Db` parameter so it stays testable).
export const expoDb = openDatabaseSync("velo.db", { enableChangeListener: true });
expoDb.execSync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;");

export const db = drizzle(expoDb, { schema });
