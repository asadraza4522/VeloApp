// Test double for the server: in-memory tables with the same last-write-wins rule and (updated_at, id) cursor as the real database.
import { RemoteError, type Cursor, type Remote, type Row } from "@/domain/sync/remote";

export class FakeRemote implements Remote {
  tables: Record<string, Map<string, Row>> = {};
  settingsRow: Row | null = null;
  flagRows: { key: string; value: unknown }[] = [{ key: "rewarded_hours_per_day", value: 4 }];
  entitlementRows: Row[] = [];
  clock = Date.parse("2026-09-21T00:00:00Z");
  offline = false;
  authFails = false;
  rejectIds = new Set<string>();
  upsertOrder: string[] = [];

  private iso() { return new Date(++this.clock).toISOString(); }
  private t(name: string) { return (this.tables[name] ??= new Map()); }

  async userId() {
    if (this.offline) throw new RemoteError("network", "offline");
    if (this.authFails) throw new RemoteError("auth", "no session");
    return "user-1";
  }

  async upsert(table: string, rows: Row[], onConflict: string) {
    if (this.offline) throw new RemoteError("network", "offline");
    this.upsertOrder.push(table);
    if (rows.some((r) => this.rejectIds.has(r.id as string))) throw new RemoteError("row", "violates row-level security", "42501");
    if (table === "settings") {
      const cur = this.settingsRow;
      if (cur && Date.parse(rows[0].client_updated_at as string) < Date.parse(cur.client_updated_at as string)) return;
      this.settingsRow = { ...rows[0], updated_at: this.iso() };
      return;
    }
    const key = onConflict === "user_id" ? "user_id" : "id";
    for (const r of rows) {
      // foreign keys, as in the real schema: a child cannot exist before its parent
      const parent = { source_urls: ["media_sources", "source_id"], downloads: ["media_sources", "source_id"], download_attempts: ["downloads", "download_id"] }[table];
      if (parent && !this.t(parent[0]).has(r[parent[1]] as string)) throw new RemoteError("row", "violates foreign key constraint", "23503");
      if (table === "media_sources" && !r.deleted_at) {
        // unique (user_id, canonical_url) where deleted_at is null
        const clash = [...this.t(table).values()].find((x) => x.canonical_url === r.canonical_url && !x.deleted_at && x.id !== r.id);
        if (clash) throw new RemoteError("row", "duplicate key value violates unique constraint", "23505");
      }
      const cur = this.t(table).get(r[key] as string);
      // the database's zz_lww_guard trigger: a stale write is ignored entirely (no updated_at bump)
      if (cur && r.client_updated_at && Date.parse(r.client_updated_at as string) < Date.parse(cur.client_updated_at as string)) continue;
      this.t(table).set(r[key] as string, { ...cur, ...r, updated_at: this.iso() });
    }
  }

  async pull(table: string, cursor: Cursor, limit: number) {
    if (this.offline) throw new RemoteError("network", "offline");
    return [...this.t(table).values()]
      .filter((r) => (r.updated_at as string) > cursor.at || ((r.updated_at as string) === cursor.at && (r.id as string) > cursor.id))
      .sort((a, b) => (a.updated_at as string).localeCompare(b.updated_at as string) || (a.id as string).localeCompare(b.id as string))
      .slice(0, limit);
  }

  async pullSettings(since: string) {
    if (this.offline) throw new RemoteError("network", "offline");
    return this.settingsRow && (this.settingsRow.updated_at as string) > since ? this.settingsRow : null;
  }

  async flags() {
    if (this.offline) throw new RemoteError("network", "offline");
    return this.flagRows;
  }

  usage: { rewarded_seconds: number } | null = null;
  async usageToday() {
    if (this.offline) throw new RemoteError("network", "offline");
    return this.usage;
  }

  async entitlements() {
    if (this.offline) throw new RemoteError("network", "offline");
    return this.entitlementRows;
  }
}
