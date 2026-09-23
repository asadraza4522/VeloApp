import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { as, createDb, newUser, uuid } from "./harness.mjs";

const DENIED = /permission denied|row-level security|violates row-level/i;
let db, alice, bob;

const insertSource = (d, id, userId, url = `https://example.com/${id}`) =>
  d.query("insert into media_sources (id, user_id, original_url, canonical_url) values ($1, $2, $3, $3)", [id, userId, url]);

before(async () => {
  db = await createDb();
  alice = await newUser(db);
  bob = await newUser(db);
});

describe("auth trigger", () => {
  it("creates a profile for every new user", async () => {
    const r = await db.query("select count(*)::int as n from profiles where id in ($1, $2)", [alice, bob]);
    assert.equal(r.rows[0].n, 2);
  });
});

describe("owner tables (media_sources, source_urls, downloads)", () => {
  const srcA = uuid();
  before(async () => {
    await as(db, "authenticated", alice, (d) => insertSource(d, srcA, alice));
  });

  it("owner can read own rows; others cannot see them", async () => {
    const mine = await as(db, "authenticated", alice, (d) => d.query("select id from media_sources"));
    const theirs = await as(db, "authenticated", bob, (d) => d.query("select id from media_sources"));
    assert.equal(mine.rows.length, 1);
    assert.equal(theirs.rows.length, 0);
  });

  it("cannot insert a row owned by someone else", async () => {
    await assert.rejects(as(db, "authenticated", bob, (d) => insertSource(d, uuid(), alice)), DENIED);
  });

  it("cannot update someone else's row (silently 0 rows)", async () => {
    const r = await as(db, "authenticated", bob, (d) => d.query("update media_sources set title = 'pwned' where id = $1", [srcA]));
    assert.equal(r.affectedRows, 0);
  });

  it("cannot hand a row to another user (WITH CHECK)", async () => {
    await assert.rejects(as(db, "authenticated", alice, (d) => d.query("update media_sources set user_id = $1 where id = $2", [bob, srcA])), DENIED);
  });

  it("has no DELETE for authenticated: sync uses tombstones", async () => {
    await assert.rejects(as(db, "authenticated", alice, (d) => d.query("delete from media_sources where id = $1", [srcA])), DENIED);
    const r = await as(db, "authenticated", alice, (d) => d.query("update media_sources set deleted_at = now() where id = $1", [srcA]));
    assert.equal(r.affectedRows, 1);
  });

  it("cannot attach urls/downloads to another user's source", async () => {
    const srcOwned = uuid();
    await as(db, "authenticated", alice, (d) => insertSource(d, srcOwned, alice));
    await assert.rejects(
      as(db, "authenticated", bob, (d) => d.query("insert into source_urls (id, source_id, user_id, url, kind) values ($1, $2, $3, 'https://x.com', 'original')", [uuid(), srcOwned, bob])),
      DENIED,
    );
    await assert.rejects(
      as(db, "authenticated", bob, (d) => d.query("insert into downloads (id, source_id, user_id) values ($1, $2, $3)", [uuid(), srcOwned, bob])),
      DENIED,
    );
    // ...but the owner can
    await as(db, "authenticated", alice, (d) => d.query("insert into downloads (id, source_id, user_id) values ($1, $2, $3)", [uuid(), srcOwned, alice]));
  });

  it("updated_at belongs to the server clock", async () => {
    const id = uuid();
    await as(db, "authenticated", alice, (d) => insertSource(d, id, alice));
    await as(db, "authenticated", alice, (d) => d.query("update media_sources set updated_at = '2000-01-01', title = 't' where id = $1", [id]));
    const r = await db.query("select updated_at > '2020-01-01' as fresh from media_sources where id = $1", [id]);
    assert.equal(r.rows[0].fresh, true);
  });

  it("canonical url is unique per user among live rows, reusable after a tombstone", async () => {
    const url = "https://example.com/unique";
    const first = uuid();
    await as(db, "authenticated", alice, (d) => insertSource(d, first, alice, url));
    await assert.rejects(as(db, "authenticated", alice, (d) => insertSource(d, uuid(), alice, url)), /duplicate key|unique/i);
    await as(db, "authenticated", bob, (d) => insertSource(d, uuid(), bob, url)); // other user: fine
    await as(db, "authenticated", alice, (d) => d.query("update media_sources set deleted_at = now() where id = $1", [first]));
    await as(db, "authenticated", alice, (d) => insertSource(d, uuid(), alice, url)); // reusable
  });
});

describe("anon role", () => {
  it("has no access to any table", async () => {
    for (const t of ["media_sources", "profiles", "entitlements", "feature_flags", "resolvers"]) {
      await assert.rejects(as(db, "anon", null, (d) => d.query(`select * from ${t}`)), /permission denied/i, t);
    }
  });
});

describe("platform + monetization tables are client read-only", () => {
  it("signed-in users can read flags and resolvers", async () => {
    const flags = await as(db, "authenticated", alice, (d) => d.query("select key from feature_flags"));
    assert.ok(flags.rows.some((r) => r.key === "rewarded_hours_per_day"));
    const res = await as(db, "authenticated", alice, (d) => d.query("select id from resolvers"));
    assert.ok(res.rows.length >= 4);
  });

  it("but cannot write them, or grant themselves premium", async () => {
    const writes = [
      "insert into feature_flags (key, value) values ('x', '1')",
      "update feature_flags set value = '99' where key = 'rewarded_hours_per_day'",
      "insert into resolver_health (resolver_id, platform) values ('ytdlp', 'YouTube')",
      `insert into entitlements (user_id, feature, source) values ('${alice}', 'premium', 'admin')`,
      `insert into ad_rewards (user_id, ad_network, transaction_id, granted_seconds) values ('${alice}', 'admob', 'forged', 3600)`,
      `insert into usage_daily (user_id) values ('${alice}')`,
    ];
    for (const sql of writes) await assert.rejects(as(db, "authenticated", alice, (d) => d.query(sql)), /permission denied/i, sql);
  });

  it("entitlements are visible only to their owner", async () => {
    await db.query("insert into entitlements (user_id, feature, source, expires_at) values ($1, 'premium', 'admin', now() + interval '1 day')", [alice]);
    const a = await as(db, "authenticated", alice, (d) => d.query("select 1 from entitlements"));
    const b = await as(db, "authenticated", bob, (d) => d.query("select 1 from entitlements"));
    assert.equal(a.rows.length, 1);
    assert.equal(b.rows.length, 0);
  });
});

describe("server-only functions", () => {
  it("are not callable by clients", async () => {
    for (const role of ["authenticated", "anon"]) {
      await assert.rejects(as(db, role, alice, (d) => d.query("select consume_resolve($1, 5)", [alice])), /permission denied/i);
      await assert.rejects(as(db, role, alice, (d) => d.query("select grant_rewarded_hour($1, 't', 'admob', 4)", [alice])), /permission denied/i);
    }
  });

  it("consume_resolve enforces the daily limit atomically", async () => {
    const u = await newUser(db);
    const seen = [];
    for (let i = 0; i < 5; i++) seen.push((await as(db, "service_role", null, (d) => d.query("select consume_resolve($1, 3) as n", [u]))).rows[0].n);
    assert.deepEqual(seen, [1, 2, 3, null, null]);
  });

  it("grant_rewarded_hour stacks, is idempotent, and honours the daily cap", async () => {
    const u = await newUser(db);
    const grant = (txn) => as(db, "service_role", null, (d) => d.query("select grant_rewarded_hour($1, $2, 'admob', 4) as until", [u, txn]));

    const t1 = (await grant("t1")).rows[0].until;
    const t2 = (await grant("t2")).rows[0].until;
    const t3 = (await grant("t3")).rows[0].until;
    assert.ok(t1 && t2 && t3);
    const hours = (t3 - t1) / 3_600_000;
    assert.ok(Math.abs(hours - 2) < 0.01, `stacked +2h over first grant, got ${hours}`); // 1h → 2h → 3h remaining

    assert.equal((await grant("t3")).rows[0].until, null, "duplicate transaction id is a no-op");
    assert.ok((await grant("t4")).rows[0].until, "4th hour allowed");
    assert.equal((await grant("t5")).rows[0].until, null, "5th hour exceeds the 4 h/day cap");

    const e = await db.query("select count(*)::int as n from entitlements where user_id = $1 and source = 'rewarded_ad'", [u]);
    assert.equal(e.rows[0].n, 1, "one stacked entitlement row, not one per ad");
    const r = await db.query("select count(*)::int as n from ad_rewards where user_id = $1", [u]);
    assert.equal(r.rows[0].n, 4);
  });
});
