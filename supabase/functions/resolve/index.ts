import { createClient } from "npm:@supabase/supabase-js@2.116.0";

import { createHandler } from "./handler.ts";

const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
};

const supabaseUrl = env("SUPABASE_URL");
const anonKey = env("SUPABASE_ANON_KEY");
const admin = createClient(supabaseUrl, env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

Deno.serve(createHandler({
  async authenticate(req) {
    const auth = req.headers.get("Authorization");
    if (!auth) return null;
    const client = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data, error } = await client.auth.getUser();
    return error ? null : data.user?.id ?? null;
  },

  async dailyLimit(userId) {
    const [{ data: flags }, { data: ent }] = await Promise.all([
      admin.from("feature_flags").select("key, value").in("key", ["resolves_per_day_free", "resolves_per_day_premium"]),
      admin.from("entitlements").select("expires_at").eq("user_id", userId).eq("feature", "premium").eq("enabled", true)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).limit(1),
    ]);
    const flag = (k: string, d: number) => Number(flags?.find((f) => f.key === k)?.value ?? d);
    return ent && ent.length > 0 ? flag("resolves_per_day_premium", 1000) : flag("resolves_per_day_free", 200);
  },

  async consumeResolve(userId, limit) {
    const { data, error } = await admin.rpc("consume_resolve", { p_user: userId, p_limit: limit });
    if (error) throw error;
    return data as number | null;
  },

  worker: (body, signal) =>
    fetch(`${env("WORKER_URL").replace(/\/$/, "")}/v1/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${env("WORKER_SHARED_SECRET")}` },
      body: JSON.stringify(body),
      signal,
    }),
}));
