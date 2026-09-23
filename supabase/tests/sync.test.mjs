import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { as, createDb, newUser, uuid } from "./harness.mjs";

let db, alice;
before(async () => {
  db = await createDb();
  alice = await newUser(db);
});

const T = (n) => `2026-09-21T10:00:0${n}Z`; // T(1) < T(2) < T(3)
const upsertSource = (d, id, title, clientAt, extra = "") =>
  d.query(
    `insert into media_sources (id, user_id, original_url, canonical_url, title, client_updated_at ${extra ? "," + extra.cols : ""})
     values ($1, $2, $3, $3, $4, $5 ${extra ? "," + extra.vals : ""})
     on conflict (id) do update set title = excluded.title, client_updated_at = excluded.client_updated_at
       ${extra ? "," + extra.set : ""}`,
    [id, alice, `https://example.com/${id}`, title, clientAt],
  );
const row = async (id) => (await db.query("select title, client_updated_at, updated_at, deleted_at from media_sources where id = $1", [id])).rows[0];

describe("last-write-wins by client time", () => {
  it("newer write applies, older write is ignored entirely, in any arrival order", async () => {
    const id = uuid();
    await as(db, "authenticated", alice, (d) => upsertSource(d, id, "v2", T(2)));
    const before = await row(id);

    await as(db, "authenticated", alice, (d) => upsertSource(d, id, "v1-stale", T(1)));
    const afterStale = await row(id);
    assert.equal(afterStale.title, "v2");
    assert.equal(afterStale.updated_at.getTime(), before.updated_at.getTime(), "an ignored write must not bump the server cursor");

    await as(db, "authenticated", alice, (d) => upsertSource(d, id, "v3", T(3)));
    assert.equal((await row(id)).title, "v3");
  });

  it("equal timestamps apply (idempotent retries)", async () => {
    const id = uuid();
    await as(db, "authenticated", alice, (d) => upsertSource(d, id, "a", T(2)));
    await as(db, "authenticated", alice, (d) => upsertSource(d, id, "b", T(2)));
    assert.equal((await row(id)).title, "b");
  });

  it("a stale write cannot resurrect a newer tombstone", async () => {
    const id = uuid();
    await as(db, "authenticated", alice, (d) => upsertSource(d, id, "x", T(1)));
    await as(db, "authenticated", alice, (d) => d.query("update media_sources set deleted_at = now(), client_updated_at = $2 where id = $1", [id, T(3)]));
    await as(db, "authenticated", alice, (d) => d.query("update media_sources set title = 'zombie', client_updated_at = $2 where id = $1", [id, T(2)]));
    const r = await row(id);
    assert.notEqual(r.deleted_at, null);
    assert.equal(r.title, "x");
  });

  it("the guard covers every synced table", async () => {
    const triggers = await db.query("select event_object_table t from information_schema.triggers where trigger_name = 'zz_lww_guard'");
    assert.deepEqual(triggers.rows.map((r) => r.t).sort(), ["download_attempts", "downloads", "media_sources", "organization_rules", "settings", "source_urls"]);
  });
});

describe("pull cursor", () => {
  it("(updated_at, id) keyset pagination sees every row exactly once, even with equal timestamps", async () => {
    const u = await newUser(db);
    await db.exec("begin");
    for (let i = 0; i < 12; i++) {
      // same transaction → identical now() → identical updated_at: the id tiebreak must carry the ordering
      await db.query("insert into media_sources (id, user_id, original_url, canonical_url) values ($1, $2, $3, $3)", [uuid(), u, `https://e.com/${i}`]);
    }
    await db.exec("commit");
    const seen = [];
    let cur = { at: "1970-01-01T00:00:00Z", id: "00000000-0000-0000-0000-000000000000" };
    for (;;) {
      const page = await as(db, "authenticated", u, (d) =>
        d.query(
          `select id, updated_at from media_sources
           where user_id = $3 and (updated_at, id) > ($1::timestamptz, $2::uuid) order by updated_at, id limit 5`,
          [cur.at, cur.id, u],
        ),
      );
      if (!page.rows.length) break;
      seen.push(...page.rows.map((r) => r.id));
      const last = page.rows.at(-1);
      cur = { at: last.updated_at.toISOString(), id: last.id };
    }
    assert.equal(seen.length, 12);
    assert.equal(new Set(seen).size, 12);
  });
});
