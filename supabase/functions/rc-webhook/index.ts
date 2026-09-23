import { createClient } from "npm:@supabase/supabase-js@2.116.0";

import { createHandler } from "./handler.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

Deno.serve(createHandler({
  secret: Deno.env.get("RC_WEBHOOK_SECRET") ?? "",
  async apply(userId, enabled, expiresAt, eventMs) {
    const { data, error } = await admin.rpc("apply_subscription", { p_user: userId, p_enabled: enabled, p_expires: expiresAt, p_event_ms: eventMs });
    if (error) throw error;
    return Boolean(data);
  },
}));
