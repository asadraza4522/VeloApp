import { getSupabase } from "@/services/supabase";

// First launch signs in anonymously so sync, quotas and entitlements have a real user id from day one.
// Google is linked later from Settings (plan D8). Safe to call repeatedly and while offline.
export async function ensureSession() {
  const auth = getSupabase().auth;
  const { data } = await auth.getSession();
  if (data.session) return data.session;
  const { data: created, error } = await auth.signInAnonymously();
  if (error) throw error;
  return created.session;
}
