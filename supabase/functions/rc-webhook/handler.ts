// RevenueCat webhook → `entitlements(source = 'subscription')` (plan §9). Play Billing lives in the Lite (Play) build.
// https://www.revenuecat.com/docs/integrations/webhooks

export type Deps = {
  /** The value configured as "Authorization header" in the RevenueCat webhook settings. */
  secret: string;
  /** Applies one subscription state; false when an older (out-of-order) event was ignored. */
  apply: (userId: string, enabled: boolean, expiresAt: string | null, eventMs: number) => Promise<boolean>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Events that leave (or start) access active until `expiration_at_ms`. CANCELLATION / BILLING_ISSUE keep access until then.
const ACTIVE = new Set(["INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "NON_RENEWING_PURCHASE", "PRODUCT_CHANGE", "TEMPORARY_ENTITLEMENT_GRANT", "CANCELLATION", "BILLING_ISSUE", "SUBSCRIPTION_EXTENDED"]);
const ENDED = new Set(["EXPIRATION"]);

/** Constant-time string compare (no early exit on the first differing byte). */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function createHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return json(405, { ok: false });
    const auth = req.headers.get("Authorization") ?? "";
    if (!deps.secret || !(safeEqual(auth, deps.secret) || safeEqual(auth, `Bearer ${deps.secret}`))) return json(401, { ok: false });

    let ev: { type?: string; app_user_id?: string; expiration_at_ms?: number | null; event_timestamp_ms?: number };
    try {
      ev = (await req.json()).event ?? {};
    } catch {
      return json(400, { ok: false });
    }
    const type = ev.type ?? "";
    const user = ev.app_user_id ?? "";
    // Anonymous RevenueCat ids ($RCAnonymousID:…) are not our users; ignore them (200 so RevenueCat does not retry).
    if (!UUID.test(user) || (!ACTIVE.has(type) && !ENDED.has(type))) return json(200, { ok: true, ignored: true });

    const eventMs = Number(ev.event_timestamp_ms ?? Date.now());
    const expires = ev.expiration_at_ms ? new Date(ev.expiration_at_ms).toISOString() : null;
    const enabled = ACTIVE.has(type);
    // An ACTIVE event with no expiry would grant forever: only lifetime purchases legitimately have none.
    if (enabled && expires === null && type !== "NON_RENEWING_PURCHASE") return json(200, { ok: true, ignored: true });

    const applied = await deps.apply(user, enabled, ended(type, expires), eventMs);
    return json(200, { ok: true, applied });
  };
}

const ended = (type: string, expires: string | null) => (ENDED.has(type) ? expires ?? new Date().toISOString() : expires);
