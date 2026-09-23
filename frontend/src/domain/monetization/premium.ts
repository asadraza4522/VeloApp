// Premium / rewarded-ad rules the UI needs (PRD §52-56). Pure; the server decides, this only displays and waits.

/** "1h 47m" (PRD §52 example), "47m", "2d 3h", "<1m". */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return "";
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "<1m";
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const min = m % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${min}m`;
  return `${min}m`;
}

/** Each verified rewarded ad = 1 hour; the cap (feature flag, default 4/day) is enforced by the server, mirrored here for the UI. */
export function rewardAllowance(capHours: number, rewardedSecondsToday: number) {
  const used = Math.floor(rewardedSecondsToday / 3600);
  const left = Math.max(0, capHours - used);
  return { used, left, canWatch: left > 0 };
}

export type WaitResult = "confirmed" | "timeout";

/**
 * After an ad (or purchase) the server grants premium asynchronously (SSV callback / webhook). Poll the server
 * snapshot until the premium end moves later than it was, or give up. The client never grants anything itself.
 */
export async function waitForPremiumChange(opts: {
  before: number | null;
  refresh: () => Promise<void>;
  readUntil: () => number | null;
  sleep: (ms: number) => Promise<void>;
  intervalMs?: number;
  attempts?: number;
}): Promise<WaitResult> {
  const { before, refresh, readUntil, sleep } = opts;
  for (let i = 0; i < (opts.attempts ?? 15); i++) {
    await sleep(opts.intervalMs ?? 2000);
    await refresh().catch(() => {}); // offline for a moment: keep trying until the attempts run out
    const now = readUntil();
    if (now != null && (before == null || now > before)) return "confirmed";
  }
  return "timeout";
}
