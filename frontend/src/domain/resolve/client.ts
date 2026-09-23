import { FAILURE_CODES, type FailureCode } from "@/db/schema";
import { isLite } from "@/distribution";
import { responseSchema, type MediaResult } from "@/domain/resolve/schema";

export type ResolveOutcome = { ok: true; result: MediaResult } | { ok: false; code: FailureCode; message: string };

// Transport-agnostic so it can be unit-tested; the default uses supabase.functions.invoke.
export type Invoke = (body: { url: string; distribution: "full" | "lite" }) => Promise<{ status: number; body: unknown }>;

const asCode = (c: string): FailureCode => ((FAILURE_CODES as readonly string[]).includes(c) ? (c as FailureCode) : "UNKNOWN");

export async function resolveUrl(url: string, invoke: Invoke): Promise<ResolveOutcome> {
  let res: { status: number; body: unknown };
  try {
    res = await invoke({ url, distribution: isLite ? "lite" : "full" });
  } catch (e) {
    return { ok: false, code: "NETWORK_ERROR", message: e instanceof Error ? e.message : "Network error" };
  }
  const parsed = responseSchema.safeParse(res.body);
  if (!parsed.success) {
    // 401/429/5xx with a non-standard body, or a worker that changed shape
    return { ok: false, code: res.status === 429 ? "RATE_LIMITED" : res.status >= 500 ? "SERVER_ERROR" : "UNKNOWN", message: `Unexpected response (${res.status})` };
  }
  return parsed.data.ok
    ? { ok: true, result: parsed.data.result }
    : { ok: false, code: asCode(parsed.data.error.code), message: parsed.data.error.message };
}

// Dev-only shortcut (scripts/dev-worker.sh --lan): talk to a worker on your LAN, skipping Supabase.
// `__DEV__` and the env var are both compile-time constants, so this is stripped from release builds.
const DEV_WORKER_URL = __DEV__ ? process.env.EXPO_PUBLIC_DEV_WORKER_URL : undefined;
const DEV_WORKER_SECRET = __DEV__ ? process.env.EXPO_PUBLIC_DEV_WORKER_SECRET : undefined;

export async function invokeResolveFunction(body: { url: string; distribution: "full" | "lite" }) {
  if (DEV_WORKER_URL && DEV_WORKER_SECRET) {
    const res = await fetch(`${DEV_WORKER_URL}/v1/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${DEV_WORKER_SECRET}` },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  const { getSupabase } = await import("@/services/supabase");
  const { ensureSession } = await import("@/services/auth");
  await ensureSession();
  const { data, error } = await getSupabase().functions.invoke("resolve", { body });
  if (!error) return { status: 200, body: data };
  const ctx = (error as { context?: unknown }).context;
  if (ctx instanceof Response) return { status: ctx.status, body: await ctx.json().catch(() => null) };
  throw error; // FunctionsFetchError etc. → network error upstream
}
