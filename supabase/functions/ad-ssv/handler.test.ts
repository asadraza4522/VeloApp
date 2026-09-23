import { assertEquals } from "jsr:@std/assert@1";

import { createHandler, derToRaw, verifySsv, type Deps, type VerifierKey } from "./handler.ts";

const USER = "0192f3a4-7b1c-7000-8000-00000000abcd";

// ---- a real P-256 key pair standing in for Google's, signing in ASN.1 DER like Google does ----
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
const toB64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const toB64Url = (u: Uint8Array) => toB64(u).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const KEY: VerifierKey = { keyId: 3335741209, base64: toB64(spki) };

function rawToDer(raw: Uint8Array): Uint8Array {
  const enc = (v: Uint8Array) => {
    let i = 0;
    while (i < v.length - 1 && v[i] === 0) i++;
    let x = v.slice(i);
    if (x[0] & 0x80) x = Uint8Array.from([0, ...x]);
    return Uint8Array.from([0x02, x.length, ...x]);
  };
  const r = enc(raw.slice(0, 32));
  const s = enc(raw.slice(32));
  return Uint8Array.from([0x30, r.length + s.length, ...r, ...s]);
}

async function signedUrl(params: Record<string, string>, keyId: string | number = KEY.keyId, tamper = false) {
  const data = new URLSearchParams(params).toString();
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(data)));
  const url = `https://f.example/ad-ssv?${data}&signature=${toB64Url(rawToDer(sig))}&key_id=${keyId}`;
  return tamper ? url.replace("reward_amount=1", "reward_amount=99") : url;
}

const BASE = { ad_network: "5450213213286189855", ad_unit: "ca-app-pub-1/2", reward_amount: "1", reward_item: "premium", timestamp: "1758000000000", transaction_id: "tx-1", user_id: USER };

const make = (over: Partial<Deps> = {}) => {
  const granted: string[][] = [];
  const handler = createHandler({
    fetchKeys: () => Promise.resolve([KEY]),
    capHours: () => Promise.resolve(4),
    grant: (u, t, n, c) => { granted.push([u, t, n, String(c)]); return Promise.resolve("2026-09-21T12:00:00Z"); },
    allowedUnits: ["ca-app-pub-1/2"],
    ...over,
  });
  return { handler, granted };
};

Deno.test("derToRaw: strips DER framing and leading zeros", () => {
  const raw = Uint8Array.from({ length: 64 }, (_, i) => (i === 0 ? 0xff : i));
  assertEquals(derToRaw(rawToDer(raw)), raw);
  const short = Uint8Array.from({ length: 64 }, (_, i) => (i === 0 || i === 32 ? 0 : i)); // r and s with leading zero bytes
  assertEquals(derToRaw(rawToDer(short)), short);
});

Deno.test("a genuine callback grants an hour for the signed user", async () => {
  const { handler, granted } = make();
  const res = await handler(new Request(await signedUrl(BASE)));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).granted, true);
  assertEquals(granted, [[USER, "tx-1", "5450213213286189855", "4"]]);
});

Deno.test("a tampered query is rejected and grants nothing", async () => {
  const { handler, granted } = make();
  const res = await handler(new Request(await signedUrl(BASE, KEY.keyId, true)));
  assertEquals(res.status, 400);
  assertEquals(granted.length, 0);
});

Deno.test("a forged signature (made with another key) is rejected", async () => {
  const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const data = new URLSearchParams(BASE).toString();
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, other.privateKey, new TextEncoder().encode(data)));
  const { handler, granted } = make();
  const res = await handler(new Request(`https://f.example/x?${data}&signature=${toB64Url(rawToDer(sig))}&key_id=${KEY.keyId}`));
  assertEquals(res.status, 400);
  assertEquals(granted.length, 0);
});

Deno.test("missing or malformed signature parts are rejected", async () => {
  const { handler } = make();
  for (const url of [`https://f.example/x?${new URLSearchParams(BASE)}`, `https://f.example/x?${new URLSearchParams(BASE)}&signature=abc`, `https://f.example/x?${new URLSearchParams(BASE)}&signature=%%%&key_id=1`]) {
    assertEquals((await handler(new Request(url))).status, 400, url.slice(-30));
  }
});

Deno.test("unknown key id triggers exactly one key refresh (rotation), then verifies", async () => {
  const calls: boolean[] = [];
  const { handler, granted } = make({ fetchKeys: (force) => { calls.push(force); return Promise.resolve(force ? [KEY] : []); } });
  const res = await handler(new Request(await signedUrl(BASE)));
  assertEquals(res.status, 200);
  assertEquals(calls, [false, true]);
  assertEquals(granted.length, 1);
});

Deno.test("still-unknown key after refresh → rejected", async () => {
  const { handler } = make({ fetchKeys: () => Promise.resolve([]) });
  assertEquals((await handler(new Request(await signedUrl(BASE)))).status, 400);
});

Deno.test("ad units are allow-listed (dev override available)", async () => {
  const { handler, granted } = make({ allowedUnits: ["ca-app-pub-1/9"] });
  assertEquals((await handler(new Request(await signedUrl(BASE)))).status, 400);
  assertEquals(granted.length, 0);
  const dev = make({ allowedUnits: [], allowAnyUnit: true });
  assertEquals((await dev.handler(new Request(await signedUrl(BASE)))).status, 200);
});

Deno.test("user id must be a uuid; transaction id required", async () => {
  const { handler, granted } = make();
  assertEquals((await handler(new Request(await signedUrl({ ...BASE, user_id: "not-a-uuid" })))).status, 400);
  assertEquals((await handler(new Request(await signedUrl({ ...BASE, transaction_id: "" })))).status, 400);
  assertEquals(granted.length, 0);
});

Deno.test("capped or duplicate callbacks still answer 200 so Google does not retry", async () => {
  const { handler } = make({ grant: () => Promise.resolve(null) });
  const res = await handler(new Request(await signedUrl(BASE)));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).granted, false);
});

Deno.test("only GET", async () => {
  const { handler } = make();
  assertEquals((await handler(new Request("https://f.example/x", { method: "POST" }))).status, 405);
});

Deno.test("verifySsv reports whether the key was known", async () => {
  const url = new URL(await signedUrl(BASE, 999));
  assertEquals(await verifySsv(url.search.slice(1), [KEY]), { ok: false, keyKnown: false });
});
