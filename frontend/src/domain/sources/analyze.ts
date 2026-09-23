// Save Link / Analyze pipeline shared by Home, the share sheet and the format picker.
import { db } from "@/db/client";
import { applyResolved, type Source } from "@/db/queries/sources";
import { invokeResolveFunction, resolveUrl, type ResolveOutcome } from "@/domain/resolve/client";
import { toSourceMetadata } from "@/domain/resolve/mapping";
import { assertValidUrl, commitLink } from "@/domain/sources/commit";
import { BackendNotConfiguredError } from "@/services/supabase";
import { cachedResult, useResolveCache } from "@/stores/resolve-cache";

export type AnalyzeOutcome = ResolveOutcome & { source: Source; created: boolean };

async function resolveOnly(url: string): Promise<ResolveOutcome> {
  try {
    return await resolveUrl(url, invokeResolveFunction);
  } catch (e) {
    if (!(e instanceof BackendNotConfiguredError)) throw e;
    return { ok: false, code: "SERVER_ERROR", message: e.message };
  }
}

/** Look up a link's details without saving anything (share sheet preview). */
export async function previewUrl(url: string): Promise<ResolveOutcome> {
  assertValidUrl(url);
  return resolveOnly(url.trim());
}

/** Save the link, remembering what the preview found, and keep the variants for the format picker. */
export function saveWithOutcome(url: string, outcome?: ResolveOutcome) {
  assertValidUrl(url);
  const r = commitLink(db, url.trim(), outcome);
  if (outcome?.ok) useResolveCache.getState().put(r.source.id, outcome.result);
  return r;
}

/** Save Link without resolving (works offline). */
export const saveLink = (url: string) => saveWithOutcome(url);

export async function analyzeUrl(url: string): Promise<AnalyzeOutcome> {
  const outcome = await previewUrl(url);
  return { ...outcome, ...saveWithOutcome(url, outcome) };
}

/** Variants for a saved source: the in-memory result if still fresh, otherwise resolve again. */
export async function ensureResolved(source: Source): Promise<ResolveOutcome> {
  const hit = cachedResult(source.id);
  if (hit) return { ok: true, result: hit };
  const outcome = await resolveOnly(source.originalUrl);
  if (outcome.ok) {
    applyResolved(db, source.id, toSourceMetadata(outcome.result));
    useResolveCache.getState().put(source.id, outcome.result);
  }
  return outcome;
}
