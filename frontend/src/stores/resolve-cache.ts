import { create } from "zustand";

import type { MediaResult } from "@/domain/resolve/schema";

// Resolved variants hold short-lived direct URLs, so they live in memory only (never SQLite) and expire.
const TTL_MS = 20 * 60 * 1000;

type Entry = { result: MediaResult; at: number };
type ResolveCache = { entries: Record<string, Entry>; put: (sourceId: string, result: MediaResult) => void };

export const useResolveCache = create<ResolveCache>((set) => ({
  entries: {},
  put: (sourceId, result) => set((s) => ({ entries: { ...s.entries, [sourceId]: { result, at: Date.now() } } })),
}));

export function cachedResult(sourceId: string, now = Date.now()): MediaResult | null {
  const e = useResolveCache.getState().entries[sourceId];
  if (!e) return null;
  const expires = e.result.expires_at ? e.result.expires_at * 1000 - 60_000 : e.at + TTL_MS;
  return now < Math.min(expires, e.at + TTL_MS) ? e.result : null;
}
