import { applyResolved, createSource, InvalidUrlError, recordFailure, type Source } from "@/db/queries/sources";
import type { Db } from "@/db/types";
import type { ResolveOutcome } from "@/domain/resolve/client";
import { toSourceMetadata } from "@/domain/resolve/mapping";
import { canonicalize } from "@/domain/sources/url";

/** Throws InvalidUrlError before any network or DB work. */
export function assertValidUrl(url: string) {
  if (!canonicalize(url.trim())) throw new InvalidUrlError(url);
}

/**
 * Persist a link, optionally with what a preview/resolve found. Offline (NETWORK_ERROR) keeps the source
 * "pending" so it resolves later; any other failure is remembered on the source (PRD §15).
 */
export function commitLink(db: Db, url: string, outcome?: ResolveOutcome): { source: Source; created: boolean } {
  const { source, created } = createSource(db, { url });
  if (!outcome) return { source, created };
  if (outcome.ok) return { source: applyResolved(db, source.id, toSourceMetadata(outcome.result)) ?? source, created };
  if (outcome.code !== "NETWORK_ERROR") return { source: recordFailure(db, source.id, outcome.code) ?? source, created };
  return { source, created };
}
