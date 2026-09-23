// Server data that must keep working offline: feature flags and the entitlement snapshot (plan §5, §9).
// The cache is refreshed at most hourly while online and read locally everywhere else.
import { eq } from "drizzle-orm";

import { kvCache } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Remote } from "@/domain/sync/remote";

export const CACHE_TTL_MS = 60 * 60 * 1000;
const put = (db: Db, key: string, value: unknown, now: number) =>
  db.insert(kvCache).values({ key, value: JSON.stringify(value), fetchedAt: now })
    .onConflictDoUpdate({ target: kvCache.key, set: { value: JSON.stringify(value), fetchedAt: now } }).run();

function read<T>(db: Db, key: string): { value: T; fetchedAt: number } | null {
  const r = db.select().from(kvCache).where(eq(kvCache.key, key)).get();
  if (!r) return null;
  try {
    return { value: JSON.parse(r.value) as T, fetchedAt: r.fetchedAt };
  } catch {
    return null;
  }
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export async function refreshServerCaches(db: Db, remote: Remote, now = Date.now(), force = false) {
  const stamp = read(db, "flags")?.fetchedAt;
  if (!force && stamp != null && now - stamp < CACHE_TTL_MS) return false;
  const [flags, ents, usage] = await Promise.all([remote.flags(), remote.entitlements(), remote.usageToday()]);
  put(db, "flags", Object.fromEntries(flags.map((f) => [f.key, f.value])), now);
  put(db, "entitlements", ents, now);
  put(db, "usage", { day: utcDay(now), rewarded_seconds: usage?.rewarded_seconds ?? 0 }, now);
  return true;
}

export function getFlag<T>(db: Db, key: string, fallback: T): T {
  const flags = read<Record<string, T>>(db, "flags")?.value;
  return flags && key in flags ? flags[key] : fallback;
}

type Ent = { feature: string; enabled: boolean; expires_at: string | null };

/** Offline-safe: reads the last server snapshot; an expired grant stops counting the moment its time passes. */
export function hasEntitlement(db: Db, feature: string, now = Date.now()): boolean {
  const ents = read<Ent[]>(db, "entitlements")?.value ?? [];
  return ents.some((e) => e.feature === feature && e.enabled && (!e.expires_at || Date.parse(e.expires_at) > now));
}

/** When the cached premium ends (for the countdown), or null. */
export function premiumUntil(db: Db, now = Date.now()): number | null {
  const ends = (read<Ent[]>(db, "entitlements")?.value ?? [])
    .filter((e) => e.feature === "premium" && e.enabled)
    .map((e) => (e.expires_at ? Date.parse(e.expires_at) : Number.POSITIVE_INFINITY))
    .filter((t) => t > now);
  return ends.length ? Math.max(...ends) : null;
}

/** Seconds of rewarded premium earned today (UTC day, like the server's usage_daily); 0 when the snapshot is from another day. */
export function rewardedSecondsToday(db: Db, now = Date.now()): number {
  const u = read<{ day: string; rewarded_seconds: number }>(db, "usage")?.value;
  return u && u.day === utcDay(now) ? u.rewarded_seconds : 0;
}
