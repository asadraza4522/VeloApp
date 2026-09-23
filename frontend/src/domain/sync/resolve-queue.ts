// Links saved while offline are stored as "pending"; once online they are resolved in the background (PRD §9).
import { and, asc, eq, isNull } from "drizzle-orm";

import { applyResolved, recordFailure } from "@/db/queries/sources";
import { mediaSources } from "@/db/schema";
import type { Db } from "@/db/types";
import type { ResolveOutcome } from "@/domain/resolve/client";
import { toSourceMetadata } from "@/domain/resolve/mapping";

export async function processPendingResolves(
  db: Db,
  resolve: (url: string) => Promise<ResolveOutcome>,
  limit = 5,
): Promise<{ resolved: number; failed: number; offline: boolean }> {
  const pending = db.select().from(mediaSources)
    .where(and(eq(mediaSources.resolveState, "pending"), isNull(mediaSources.deletedAt))).orderBy(asc(mediaSources.createdAt)).limit(limit).all();
  let resolved = 0;
  let failed = 0;
  for (const s of pending) {
    const out = await resolve(s.originalUrl);
    if (out.ok) { applyResolved(db, s.id, toSourceMetadata(out.result)); resolved++; continue; }
    if (out.code === "NETWORK_ERROR" || out.code === "RATE_LIMITED") return { resolved, failed, offline: true }; // try again later
    recordFailure(db, s.id, out.code);
    failed++;
  }
  return { resolved, failed, offline: false };
}
