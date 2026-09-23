import { assertEquals } from "jsr:@std/assert@1";

import { createHandler, type Deps } from "./handler.ts";

const okWorker = () => Promise.resolve(new Response(JSON.stringify({ ok: true, result: { resolver_id: "ytdlp" } }), { status: 200 }));

const make = (over: Partial<Deps> = {}) => {
  const calls = { worker: 0, consumed: [] as number[] };
  const handler = createHandler({
    authenticate: () => Promise.resolve("user-1"),
    dailyLimit: () => Promise.resolve(3),
    consumeResolve: (_u, limit) => {
      calls.consumed.push(limit);
      return Promise.resolve(calls.consumed.length <= limit ? calls.consumed.length : null);
    },
    worker: () => { calls.worker++; return okWorker(); },
    ...over,
  });
  return { handler, calls };
};

const post = (body: unknown, init: RequestInit = {}) =>
  new Request("https://f/resolve", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), ...init });

Deno.test("happy path passes the worker result through", async () => {
  const { handler, calls } = make();
  const res = await handler(post({ url: "https://youtube.com/watch?v=abc" }));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).result.resolver_id, "ytdlp");
  assertEquals(calls.worker, 1);
});

Deno.test("rejects unauthenticated requests before doing any work", async () => {
  const { handler, calls } = make({ authenticate: () => Promise.resolve(null) });
  const res = await handler(post({ url: "https://youtube.com/watch?v=abc" }));
  assertEquals(res.status, 401);
  assertEquals(calls.worker + calls.consumed.length, 0);
});

Deno.test("only POST is allowed", async () => {
  const { handler } = make();
  assertEquals((await handler(new Request("https://f/resolve"))).status, 405);
});

Deno.test("validates the body", async () => {
  const { handler, calls } = make();
  for (const bad of ["not json", { url: 5 }, { url: "ftp://x.com/a" }, { url: "http://a" }, { url: "https://x.com/" + "a".repeat(3000) }]) {
    assertEquals((await handler(post(bad))).status, 400, JSON.stringify(bad).slice(0, 40));
  }
  assertEquals(calls.worker, 0);
});

Deno.test("daily quota: the call over the limit is 429 and never reaches the worker", async () => {
  const { handler, calls } = make();
  const u = { url: "https://example.com/a.mp4" };
  for (let i = 0; i < 3; i++) assertEquals((await handler(post(u))).status, 200);
  const res = await handler(post(u));
  assertEquals(res.status, 429);
  assertEquals((await res.json()).error.code, "RATE_LIMITED");
  assertEquals(calls.worker, 3);
});

Deno.test("distribution defaults to full and only accepts lite/full", async () => {
  const seen: string[] = [];
  const { handler } = make({ worker: (b) => { seen.push(b.distribution); return okWorker(); } });
  await handler(post({ url: "https://example.com/a.mp4" }));
  await handler(post({ url: "https://example.com/a.mp4", distribution: "lite" }));
  await handler(post({ url: "https://example.com/a.mp4", distribution: "hax" }));
  assertEquals(seen, ["full", "lite", "full"]);
});

Deno.test("worker errors map to 502 without leaking details", async () => {
  const { handler } = make({ worker: () => Promise.reject(new Error("connect ECONNREFUSED 10.0.0.1:8080 secret")) });
  const res = await handler(post({ url: "https://example.com/a.mp4" }));
  assertEquals(res.status, 502);
  assertEquals(JSON.stringify(await res.json()).includes("10.0.0.1"), false);
});

Deno.test("worker non-2xx → 502", async () => {
  const { handler } = make({ worker: () => Promise.resolve(new Response("nope", { status: 401 })) });
  assertEquals((await handler(post({ url: "https://example.com/a.mp4" }))).status, 502);
});

Deno.test("slow worker times out → 504", async () => {
  const { handler } = make({
    timeoutMs: 20,
    worker: (_b, signal) => new Promise((_res, rej) => signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))),
  });
  const res = await handler(post({ url: "https://example.com/a.mp4" }));
  assertEquals(res.status, 504);
  assertEquals((await res.json()).error.code, "NETWORK_ERROR");
});
