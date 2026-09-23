import { RemoteError, type Cursor, type Remote, type Row } from "@/domain/sync/remote";
import { ensureSession } from "@/services/auth";
import { getSupabase } from "@/services/supabase";

type PgError = { code?: string; message?: string; status?: number };

/** Map a supabase-js / PostgREST failure onto what the sync engine can act on. */
export function toRemoteError(e: unknown): RemoteError {
  if (e instanceof RemoteError) return e;
  const err = (e ?? {}) as PgError;
  const msg = err.message ?? String(e);
  const code = err.code ?? "";
  if (code.startsWith("23") || code === "42501") return new RemoteError("row", msg, code); // constraint / RLS: this row is rejected
  if (err.status === 401 || code === "PGRST301" || code === "PGRST303" || /jwt/i.test(msg)) return new RemoteError("auth", msg, code);
  if ((err.status ?? 0) >= 500 || code.startsWith("XX")) return new RemoteError("server", msg, code);
  if (/network|fetch|timeout|connection|offline/i.test(msg) || err.status === 0 || err.status === undefined) return new RemoteError("network", msg, code);
  return new RemoteError("row", msg, code); // other 4xx: bad request for this payload
}

async function check<T>(p: PromiseLike<{ data: T; error: PgError | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw toRemoteError(error);
  return data;
}

export function createSupabaseRemote(): Remote {
  const sb = () => getSupabase();
  return {
    async userId() {
      try {
        const session = await ensureSession();
        if (!session) throw new RemoteError("auth", "No session");
        return session.user.id;
      } catch (e) {
        throw toRemoteError(e);
      }
    },

    async upsert(table: string, rows: Row[], onConflict: string) {
      await check(sb().from(table).upsert(rows, { onConflict }));
    },

    async pull(table: string, cursor: Cursor, limit: number) {
      // keyset: updated_at > at OR (updated_at = at AND id > id); values are quoted because ISO timestamps contain "+"
      const filter = `updated_at.gt."${cursor.at}",and(updated_at.eq."${cursor.at}",id.gt.${cursor.id})`;
      const data = await check(sb().from(table).select("*").or(filter).order("updated_at", { ascending: true }).order("id", { ascending: true }).limit(limit));
      return (data ?? []) as Row[];
    },

    async pullSettings(sinceIso: string) {
      const data = await check(sb().from("settings").select("*").gt("updated_at", sinceIso || "1970-01-01T00:00:00Z").maybeSingle());
      return (data ?? null) as Row | null;
    },

    async flags() {
      return (await check(sb().from("feature_flags").select("key, value"))) as { key: string; value: unknown }[];
    },

    async usageToday() {
      const day = new Date().toISOString().slice(0, 10);
      const data = await check(sb().from("usage_daily").select("rewarded_seconds").eq("day", day).maybeSingle());
      return (data ?? null) as { rewarded_seconds: number } | null;
    },

    async entitlements() {
      return ((await check(sb().from("entitlements").select("feature, enabled, expires_at"))) ?? []) as Row[];
    },
  };
}
