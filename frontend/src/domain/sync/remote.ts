// The server as the sync engine sees it. Small on purpose: the real implementation is supabase-js under RLS,
// tests use an in-memory fake with the same last-write-wins rule as the database trigger.

export type Row = Record<string, unknown>;
export type Cursor = { at: string; id: string }; // server `updated_at` (ISO, µs precision) + id tiebreak

/** network/server → retry later; auth → need a session; row → this row was rejected (RLS/constraint), park it. */
export type RemoteErrorKind = "network" | "auth" | "server" | "row";

export class RemoteError extends Error {
  constructor(readonly kind: RemoteErrorKind, message: string, readonly code?: string) {
    super(message);
  }
}

export interface Remote {
  /** Signed-in user id (anonymous sessions count). Throws RemoteError("auth") when there is none. */
  userId(): Promise<string>;
  upsert(table: string, rows: Row[], onConflict: string): Promise<void>;
  /** Rows strictly after `cursor` in (updated_at, id) order. */
  pull(table: string, cursor: Cursor, limit: number): Promise<Row[]>;
  pullSettings(sinceIso: string): Promise<Row | null>;
  flags(): Promise<{ key: string; value: unknown }[]>;
  entitlements(): Promise<Row[]>;
  /** Today's usage row (rewarded seconds earned), or null. */
  usageToday(): Promise<{ rewarded_seconds: number } | null>;
}
