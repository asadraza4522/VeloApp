// mm:ss(.s) helpers for the trim / frame tools.

/** "83", "1:23", "1:23.5", "01:02:03" → milliseconds; null when it is not a time. */
export function parseTime(input: string): number | null {
  const s = input.trim();
  if (!/^\d+(:\d{1,2}){0,2}(\.\d{1,3})?$/.test(s)) return null;
  const [main, frac = ""] = s.split(".");
  const parts = main.split(":").map(Number);
  if (parts.length > 1 && parts.slice(1).some((p) => p >= 60)) return null; // 1:75 is not a time
  const seconds = parts.reduce((acc, p) => acc * 60 + p, 0);
  return seconds * 1000 + Number((frac + "00").slice(0, 3));
}

export function formatTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  const tenth = Math.floor((t % 1000) / 100);
  const body = h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  return tenth ? `${body}.${tenth}` : body;
}

export const MIN_CLIP_MS = 500;

export type Range = { ok: true; startMs: number; endMs: number } | { ok: false; error: string };

/** Validate a start/end pair against the media length. */
export function clampRange(startMs: number | null, endMs: number | null, durationMs: number): Range {
  if (startMs == null || endMs == null) return { ok: false, error: "Enter times like 1:23 or 83.5" };
  if (startMs < 0 || endMs > durationMs + 50) return { ok: false, error: `Times must be within 0:00 and ${formatTime(durationMs)}` };
  if (endMs - startMs < MIN_CLIP_MS) return { ok: false, error: "The end must be after the start" };
  return { ok: true, startMs, endMs: Math.min(endMs, durationMs) };
}
