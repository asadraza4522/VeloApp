// Pure request logic for the `resolve` Edge Function; all I/O is injected so it runs under `deno test`.
// Flow: JWT user → per-day quota → worker /v1/resolve → pass the worker's domain result through.

export type Deps = {
  /** Returns the authenticated user's id, or null. */
  authenticate: (req: Request) => Promise<string | null>;
  /** Daily resolve limit for this user (free vs premium, from feature_flags + entitlements). */
  dailyLimit: (userId: string) => Promise<number>;
  /** Atomically counts one resolve; null when the limit is already reached. */
  consumeResolve: (userId: string, limit: number) => Promise<number | null>;
  /** Calls the private resolver worker. */
  worker: (body: { url: string; distribution: "full" | "lite" }, signal: AbortSignal) => Promise<Response>;
  timeoutMs?: number;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const fail = (status: number, code: string, message: string) => json(status, { ok: false, error: { code, message, attempts: [] } });

export function createHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return fail(405, "UNSUPPORTED", "POST only");

    const userId = await deps.authenticate(req);
    if (!userId) return fail(401, "AUTH_REQUIRED", "Sign in required");

    let body: { url?: unknown; distribution?: unknown };
    try {
      body = await req.json();
    } catch {
      return fail(400, "UNSUPPORTED", "Invalid JSON");
    }
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (url.length < 10 || url.length > 2048 || !/^https?:\/\//i.test(url)) return fail(400, "UNSUPPORTED", "A http(s) URL is required");
    const distribution = body.distribution === "lite" ? "lite" : "full";

    const limit = await deps.dailyLimit(userId);
    if ((await deps.consumeResolve(userId, limit)) === null) return fail(429, "RATE_LIMITED", "Daily resolve limit reached");

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? 30_000);
    try {
      const res = await deps.worker({ url, distribution }, ctl.signal);
      if (!res.ok) return fail(502, "SERVER_ERROR", "Resolver unavailable");
      // The worker answers 200 for every domain outcome ({ok, result} | {ok:false, error}).
      return json(200, await res.json());
    } catch (e) {
      const timedOut = e instanceof DOMException && e.name === "AbortError";
      return fail(timedOut ? 504 : 502, timedOut ? "NETWORK_ERROR" : "SERVER_ERROR", timedOut ? "Resolver timed out" : "Resolver unavailable");
    } finally {
      clearTimeout(timer);
    }
  };
}
