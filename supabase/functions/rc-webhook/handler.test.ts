import { assertEquals } from "jsr:@std/assert@1";

import { createHandler, safeEqual, type Deps } from "./handler.ts";

const USER = "0192f3a4-7b1c-7000-8000-00000000abcd";
const SECRET = "whsec-test";

const make = (over: Partial<Deps> = {}) => {
  const applied: unknown[][] = [];
  const handler = createHandler({ secret: SECRET, apply: (...a) => { applied.push(a); return Promise.resolve(true); }, ...over });
  return { handler, applied };
};

const post = (event: unknown, auth: string | null = `Bearer ${SECRET}`) =>
  new Request("https://f/rc", { method: "POST", body: JSON.stringify({ event }), headers: auth === null ? {} : { Authorization: auth } });

const EXP = Date.parse("2026-11-01T00:00:00Z");

Deno.test("rejects missing or wrong authorization", async () => {
  const { handler, applied } = make();
  for (const auth of [null, "", "nope", `Bearer ${SECRET}x`, "Bearer "]) {
    assertEquals((await handler(post({ type: "RENEWAL", app_user_id: USER, expiration_at_ms: EXP }, auth))).status, 401, String(auth));
  }
  assertEquals(applied.length, 0);
});

Deno.test("fails closed when no secret is configured", async () => {
  const { handler } = make({ secret: "" });
  assertEquals((await handler(post({ type: "RENEWAL", app_user_id: USER, expiration_at_ms: EXP }, ""))).status, 401);
});

Deno.test("accepts the bare secret or 'Bearer <secret>'", async () => {
  const { handler } = make();
  assertEquals((await handler(post({ type: "RENEWAL", app_user_id: USER, expiration_at_ms: EXP, event_timestamp_ms: 1 }, SECRET))).status, 200);
  assertEquals((await handler(post({ type: "RENEWAL", app_user_id: USER, expiration_at_ms: EXP, event_timestamp_ms: 2 }))).status, 200);
});

Deno.test("purchase / renewal / cancellation keep premium until the expiry date", async () => {
  for (const type of ["INITIAL_PURCHASE", "RENEWAL", "CANCELLATION", "BILLING_ISSUE", "PRODUCT_CHANGE", "UNCANCELLATION"]) {
    const { handler, applied } = make();
    assertEquals((await handler(post({ type, app_user_id: USER, expiration_at_ms: EXP, event_timestamp_ms: 7 }))).status, 200);
    assertEquals(applied, [[USER, true, "2026-11-01T00:00:00.000Z", 7]], type);
  }
});

Deno.test("EXPIRATION disables premium", async () => {
  const { handler, applied } = make();
  await handler(post({ type: "EXPIRATION", app_user_id: USER, expiration_at_ms: EXP, event_timestamp_ms: 9 }));
  assertEquals(applied, [[USER, false, "2026-11-01T00:00:00.000Z", 9]]);
});

Deno.test("anonymous RevenueCat ids and unrelated event types are ignored with 200", async () => {
  const { handler, applied } = make();
  for (const ev of [{ type: "RENEWAL", app_user_id: "$RCAnonymousID:abc", expiration_at_ms: EXP }, { type: "TRANSFER", app_user_id: USER }, { type: "TEST", app_user_id: USER }]) {
    const res = await handler(post(ev));
    assertEquals(res.status, 200);
    assertEquals((await res.json()).ignored, true);
  }
  assertEquals(applied.length, 0);
});

Deno.test("an active event without an expiry never grants forever", async () => {
  const { handler, applied } = make();
  await handler(post({ type: "RENEWAL", app_user_id: USER, expiration_at_ms: null, event_timestamp_ms: 1 }));
  assertEquals(applied.length, 0);
});

Deno.test("reports when an out-of-order event was ignored", async () => {
  const { handler } = make({ apply: () => Promise.resolve(false) });
  const res = await handler(post({ type: "RENEWAL", app_user_id: USER, expiration_at_ms: EXP, event_timestamp_ms: 1 }));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).applied, false);
});

Deno.test("bad bodies and methods", async () => {
  const { handler } = make();
  assertEquals((await handler(new Request("https://f/rc", { method: "POST", body: "not json", headers: { Authorization: SECRET } }))).status, 400);
  assertEquals((await handler(new Request("https://f/rc", { method: "GET" }))).status, 405);
});

Deno.test("safeEqual", () => {
  assertEquals(safeEqual("abc", "abc"), true);
  assertEquals(safeEqual("abc", "abd"), false);
  assertEquals(safeEqual("abc", "abcd"), false);
  assertEquals(safeEqual("", ""), true);
});
