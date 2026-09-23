import { createClient } from "npm:@supabase/supabase-js@2.116.0";

import { createHandler, type VerifierKey } from "./handler.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

let cache: { at: number; keys: VerifierKey[] } | null = null;
const KEYS_URL = "https://www.gstatic.com/admob/reward/verifier-keys.json";

Deno.serve(createHandler({
  async fetchKeys(force) {
    if (!force && cache && Date.now() - cache.at < 24 * 3600_000) return cache.keys;
    const res = await fetch(KEYS_URL);
    if (!res.ok) throw new Error(`verifier keys: ${res.status}`);
    cache = { at: Date.now(), keys: (await res.json()).keys as VerifierKey[] };
    return cache.keys;
  },

  async capHours() {
    const { data } = await admin.from("feature_flags").select("value").eq("key", "rewarded_hours_per_day").maybeSingle();
    return Number(data?.value ?? 4);
  },

  async grant(userId, txn, network, capHours) {
    const { data, error } = await admin.rpc("grant_rewarded_hour", { p_user: userId, p_txn: txn, p_network: network, p_cap_hours: capHours });
    if (error) throw error;
    return (data as string | null) ?? null;
  },

  allowedUnits: (Deno.env.get("ADMOB_AD_UNITS") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  allowAnyUnit: Deno.env.get("ADMOB_ALLOW_ANY_UNIT") === "1", // dev only: Google's test units
}));
