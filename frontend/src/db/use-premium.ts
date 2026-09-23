import { eq } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { useEffect, useState } from "react";

import { db } from "@/db/client";
import { kvCache } from "@/db/schema";

/** Premium from the cached server snapshot (works offline). Re-evaluates every second so the countdown ticks and access ends on time. */
export function usePremium() {
  const row = useLiveQuery(db.select().from(kvCache).where(eq(kvCache.key, "entitlements")), []).data[0];
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  let until: number | null = null;
  try {
    const ents = (row ? JSON.parse(row.value) : []) as { feature: string; enabled: boolean; expires_at: string | null }[];
    const ends = ents.filter((e) => e.feature === "premium" && e.enabled).map((e) => (e.expires_at ? Date.parse(e.expires_at) : Infinity)).filter((t) => t > now);
    until = ends.length ? Math.max(...ends) : null;
  } catch { /* corrupt cache → free */ }
  return { active: until != null, until, remainingMs: until != null ? until - now : 0, lifetime: until === Infinity };
}
