// AdMob rewarded-ad server-side verification (SSV) → +1 h Premium (PRD §52, §56).
// Google calls this URL after a user finishes a rewarded ad. The client never grants itself Premium.
// https://developers.google.com/admob/android/rewarded-video-ssv

export type VerifierKey = { keyId: number | string; base64: string }; // base64 = SPKI DER, from gstatic verifier-keys.json

export type Deps = {
  /** Google's public keys. `force` bypasses any cache (used once when a key_id is unknown = rotation). */
  fetchKeys: (force: boolean) => Promise<VerifierKey[]>;
  capHours: () => Promise<number>;
  /** Idempotent per transaction id, capped per day. Returns the new premium end, or null when duplicate/capped. */
  grant: (userId: string, txn: string, network: string, capHours: number) => Promise<string | null>;
  /** Ad unit ids that may reward users here. Empty + !allowAnyUnit = reject everything. */
  allowedUnits: string[];
  allowAnyUnit?: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const b64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));

/** ECDSA signatures from Google are ASN.1 DER; WebCrypto wants the raw r||s form. */
export function derToRaw(der: Uint8Array, size = 32): Uint8Array<ArrayBuffer> {
  let i = 2; // 0x30 len (assumes short/long form handled below)
  if (der[0] !== 0x30) throw new Error("bad DER");
  if (der[1] & 0x80) i = 2 + (der[1] & 0x7f);
  const readInt = () => {
    if (der[i++] !== 0x02) throw new Error("bad DER integer");
    const len = der[i++];
    let v = der.slice(i, i + len);
    i += len;
    while (v.length > size && v[0] === 0) v = v.slice(1);
    if (v.length > size) throw new Error("integer too large");
    const out = new Uint8Array(size);
    out.set(v, size - v.length);
    return out;
  };
  const r = readInt();
  const s = readInt();
  const raw = new Uint8Array(size * 2);
  raw.set(r, 0);
  raw.set(s, size);
  return raw;
}

/** Verifies `signature` over the query string that precedes `&signature=` using the key named by `key_id`. */
export async function verifySsv(rawQuery: string, keys: VerifierKey[]): Promise<{ ok: boolean; keyKnown: boolean }> {
  const sigAt = rawQuery.indexOf("&signature=");
  if (sigAt < 0) return { ok: false, keyKnown: true };
  const data = rawQuery.slice(0, sigAt);
  const tail = new URLSearchParams(rawQuery.slice(sigAt + 1));
  const signature = tail.get("signature");
  const keyId = tail.get("key_id");
  if (!signature || !keyId) return { ok: false, keyKnown: true };
  const key = keys.find((k) => String(k.keyId) === keyId);
  if (!key) return { ok: false, keyKnown: false };
  try {
    const pub = await crypto.subtle.importKey("spki", b64(key.base64), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, derToRaw(b64(signature)), new TextEncoder().encode(data));
    return { ok, keyKnown: true };
  } catch {
    return { ok: false, keyKnown: true };
  }
}

export function createHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "GET") return json(405, { ok: false });
    const rawQuery = new URL(req.url).search.slice(1);

    let verdict = await verifySsv(rawQuery, await deps.fetchKeys(false));
    if (!verdict.ok && !verdict.keyKnown) verdict = await verifySsv(rawQuery, await deps.fetchKeys(true)); // key rotation
    if (!verdict.ok) return json(400, { ok: false, error: "bad signature" });

    const q = new URLSearchParams(rawQuery);
    const userId = q.get("user_id") ?? "";
    const txn = q.get("transaction_id") ?? "";
    const unit = q.get("ad_unit") ?? "";
    if (!UUID.test(userId) || !txn) return json(400, { ok: false, error: "missing user or transaction" });
    if (!deps.allowAnyUnit && !deps.allowedUnits.includes(unit)) return json(400, { ok: false, error: "unknown ad unit" });

    const granted = await deps.grant(userId, txn, q.get("ad_network") ?? "admob", await deps.capHours());
    // 200 even when capped/duplicate: the callback was valid, Google must not retry it.
    return json(200, { ok: true, granted: granted !== null });
  };
}
