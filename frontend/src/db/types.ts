import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

import type * as schema from "@/db/schema";

// Both drivers (expo-sqlite in the app, better-sqlite3 in tests) are synchronous.
export type Db = BaseSQLiteDatabase<"sync", any, typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;
