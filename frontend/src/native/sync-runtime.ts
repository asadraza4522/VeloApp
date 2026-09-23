// Wires the sync engine to the app: when to run (writes, foreground, connectivity, realtime hints) and what runs after it.
import { addNetworkStateListener } from "expo-network";
import { addDatabaseChangeListener } from "expo-sqlite";
import { AppState } from "react-native";

import { db } from "@/db/client";
import { isLite } from "@/distribution";
import { invokeResolveFunction, resolveUrl } from "@/domain/resolve/client";
import { refreshServerCaches } from "@/domain/sync/caches";
import { compactTombstones } from "@/domain/sync/compact";
import { getLocalSetting, setLocalSetting } from "@/domain/sync/device";
import { syncOnce, type SyncOutcome } from "@/domain/sync/engine";
import { SyncManager } from "@/domain/sync/manager";
import { processPendingResolves } from "@/domain/sync/resolve-queue";
import { getSupabase } from "@/services/supabase";
import { createSupabaseRemote } from "@/services/supabase-remote";

const SYNCED_TABLES = ["media_sources", "source_urls", "downloads", "download_attempts", "organization_rules", "settings"];
const DAY = 86_400_000;

let manager: SyncManager | null = null;
export const getSyncManager = () => manager;

export function isBackendConfigured() {
  return Boolean(process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_KEY);
}

async function runOnce(remote: ReturnType<typeof createSupabaseRemote>): Promise<SyncOutcome> {
  const out = await syncOnce({ db, remote, distribution: isLite ? "lite" : "full" });
  if (out.ok) {
    await processPendingResolves(db, (url) => resolveUrl(url, invokeResolveFunction)).catch(() => {}); // links saved offline
    const last = Number(getLocalSetting(db, "last_compaction") ?? 0);
    if (Date.now() - last > DAY) {
      compactTombstones(db);
      setLocalSetting(db, "last_compaction", String(Date.now()));
    }
  }
  return out;
}

/** Returns a stop function. A no-op when the backend is not configured (the app stays fully usable offline-only). */
export function startSync(): () => void {
  if (!isBackendConfigured()) return () => {};
  const remote = createSupabaseRemote();
  const m = new SyncManager(() => runOnce(remote), { debounceMs: 1500 });
  manager = m;

  const subs: (() => void)[] = [];
  // 1) any local write that queued an outbox row
  const dbSub = addDatabaseChangeListener((e) => { if (e.tableName === "outbox") m.request(); });
  subs.push(() => dbSub.remove());
  // 2) coming back to the app, 3) the network returning
  const appSub = AppState.addEventListener("change", (s) => s === "active" && m.request());
  subs.push(() => appSub.remove());
  const netSub = addNetworkStateListener((s) => s.isInternetReachable && m.request());
  subs.push(() => netSub.remove());
  // 4) Realtime is only a hint that something changed elsewhere: pull now. Delivery is never relied on.
  try {
    const channel = getSupabase().channel("velo-sync");
    for (const table of SYNCED_TABLES) channel.on("postgres_changes", { event: "*", schema: "public", table }, () => m.request());
    // a grant (ad reward / purchase) lands on the server first: refresh the cached snapshot right away
    channel.on("postgres_changes", { event: "*", schema: "public", table: "entitlements" }, () => void refreshServerCaches(db, remote, Date.now(), true).catch(() => {}));
    channel.subscribe();
    subs.push(() => void getSupabase().removeChannel(channel));
  } catch { /* realtime unavailable: the other triggers still cover it */ }

  m.request();
  return () => {
    subs.forEach((s) => s());
    m.stop();
    manager = null;
  };
}
