// URL validation, platform detection and canonicalization (PRD §19). Hand-parsed on purpose:
// React Native's URL/URLSearchParams are incomplete, and this must behave identically in tests.

export type ParsedUrl = { scheme: "http" | "https"; host: string; path: string; query: [string, string][] };

const TRACKING = /^(utm_.*|fbclid|gclid|igsh|igshid|si|feature|ref|ref_src|ref_url|s|t|pp|context|mc_.*)$/i;

export function parseUrl(raw: string): ParsedUrl | null {
  const m = /^(https?):\/\/([^/?#\s]+)([^?#\s]*)(?:\?([^#\s]*))?(?:#\S*)?$/i.exec(raw.trim());
  if (!m) return null;
  const host = m[2].toLowerCase().replace(/:\d+$/, "").replace(/^(www|m|mobile)\./, "");
  const query = (m[4] ?? "")
    .split("&")
    .filter(Boolean)
    .map((p): [string, string] => {
      const i = p.indexOf("=");
      return i < 0 ? [p, ""] : [p.slice(0, i), p.slice(i + 1)];
    });
  return { scheme: m[1].toLowerCase() as "http" | "https", host, path: m[3] || "/", query };
}

const PLATFORMS: [RegExp, string][] = [
  [/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/, "YouTube"],
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)(facebook\.com|fb\.watch)$/, "Facebook"],
  [/(^|\.)(twitter\.com|x\.com)$/, "X"],
  [/(^|\.)reddit\.com$/, "Reddit"],
  [/(^|\.)pinterest\.[a-z.]+$/, "Pinterest"],
  [/(^|\.)vimeo\.com$/, "Vimeo"],
  [/(^|\.)soundcloud\.com$/, "SoundCloud"],
  [/(^|\.)dailymotion\.com$/, "Dailymotion"],
  [/(^|\.)twitch\.tv$/, "Twitch"],
  [/(^|\.)archive\.org$/, "Internet Archive"],
];

export function detectPlatform(host: string): string {
  return PLATFORMS.find(([re]) => re.test(host))?.[1] ?? "Other";
}

export type CanonicalSource = { canonicalUrl: string; platform: string; platformMediaId: string | null };

export function canonicalize(raw: string): CanonicalSource | null {
  const u = parseUrl(raw);
  if (!u) return null;
  const platform = detectPlatform(u.host);
  const q = (k: string) => u.query.find(([key]) => key === k)?.[1];

  if (platform === "YouTube") {
    const id =
      u.host === "youtu.be" ? u.path.split("/")[1]
      : q("v") ?? /^\/(?:shorts|embed|live|v)\/([\w-]{6,})/.exec(u.path)?.[1];
    if (id) return { canonicalUrl: `https://youtube.com/watch?v=${id}`, platform, platformMediaId: id };
  }
  if (platform === "Instagram") {
    const m = /^\/(?:[\w.]+\/)?(p|reel|reels|tv)\/([\w-]+)/.exec(u.path);
    if (m) return { canonicalUrl: `https://instagram.com/${m[1] === "reels" ? "reel" : m[1]}/${m[2]}/`, platform, platformMediaId: m[2] };
  }
  if (platform === "TikTok") {
    const m = /^\/@([\w.]+)\/video\/(\d+)/.exec(u.path);
    if (m) return { canonicalUrl: `https://tiktok.com/@${m[1]}/video/${m[2]}`, platform, platformMediaId: m[2] };
  }
  if (platform === "X") {
    const m = /^\/(\w+)\/status\/(\d+)/.exec(u.path);
    if (m) return { canonicalUrl: `https://x.com/${m[1]}/status/${m[2]}`, platform, platformMediaId: m[2] };
  }

  const kept = u.query.filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => (a < b ? -1 : 1));
  const qs = kept.length ? `?${kept.map(([k, v]) => (v ? `${k}=${v}` : k)).join("&")}` : "";
  const path = u.path.length > 1 ? u.path.replace(/\/+$/, "") : "";
  return { canonicalUrl: `https://${u.host}${path}${qs}`, platform, platformMediaId: null };
}
