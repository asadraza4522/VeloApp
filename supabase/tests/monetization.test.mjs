import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { as, createDb, newUser } from "./harness.mjs";

let db;
before(async () => { db = await createDb(); });

const apply = (u, enabled, expires, ms) =>
  as(db, "service_role", null, (d) => d.query("select apply_subscription($1, $2, $3, $4) as ok", [u, enabled, expires, ms])).then((r) => r.rows[0].ok);
const ent = async (u) => (await db.query("select enabled, expires_at, source_event_ms from entitlements where user_id = $1 and source = 'subscription'", [u])).rows[0];

describe("apply_subscription (RevenueCat webhook)", () => {
  it("is not callable by clients", async () => {
    const u = await newUser(db);
    for (const role of ["authenticated", "anon"]) {
      await assert.rejects(as(db, role, u, (d) => d.query("select apply_subscription($1, true, now(), 1)", [u])), /permission denied/i);
    }
  });

  it("grants, renews, and expires", async () => {
    const u = await newUser(db);
    assert.equal(await apply(u, true, "2026-10-01T00:00:00Z", 100), true);
    assert.equal((await ent(u)).enabled, true);
    assert.equal(await apply(u, true, "2026-11-01T00:00:00Z", 200), true);
    assert.equal((await ent(u)).expires_at.toISOString(), "2026-11-01T00:00:00.000Z");
    assert.equal(await apply(u, false, "2026-11-01T00:00:00Z", 300), true);
    assert.equal((await ent(u)).enabled, false);
  });

  it("ignores events that arrive out of order", async () => {
    const u = await newUser(db);
    await apply(u, true, "2026-11-01T00:00:00Z", 500);
    assert.equal(await apply(u, false, "2026-10-01T00:00:00Z", 400), false);
    const e = await ent(u);
    assert.equal(e.enabled, true);
    assert.equal(String(e.source_event_ms), "500");
    assert.equal(await apply(u, true, "2026-11-01T00:00:00Z", 500), true);
  });

  it("does not disturb the rewarded-ad entitlement", async () => {
    const u = await newUser(db);
    await as(db, "service_role", null, (d) => d.query("select grant_rewarded_hour($1, 'tx-1', 'admob', 4)", [u]));
    await apply(u, true, "2026-11-01T00:00:00Z", 1);
    const rows = (await db.query("select source from entitlements where user_id = $1 order by source", [u])).rows.map((r) => r.source);
    assert.deepEqual(rows, ["rewarded_ad", "subscription"]);
  });

  it("clients still cannot write entitlements directly", async () => {
    const u = await newUser(db);
    await assert.rejects(as(db, "authenticated", u, (d) => d.query("insert into entitlements (user_id, feature, source) values ($1, 'premium', 'admin')", [u])), /permission denied/i);
  });
});
