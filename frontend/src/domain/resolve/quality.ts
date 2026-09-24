// Turns the raw variant list into what the format picker shows (PRD §26-27, §12). Pure.
import { pickAudioFor, type Selection } from "@/domain/downloads/job";
import type { MediaVariant } from "@/domain/resolve/schema";
import { formatBytes } from "@/utils/format";

export type QualityOption = {
  key: string;
  label: string;          // "1080p"
  tag: string;            // "Full HD" | "4K" | ""
  detail: string;         // "MP4 · 620 MB · includes audio"
  height: number;
  sizeBytes: number | null;
  selection: Selection | null; // null = not downloadable yet
  blocked?: string;       // why, when selection is null
};

export type AudioOption = { key: string; label: string; detail: string; selection: Selection };
export type OtherOption = { key: string; label: string; detail: string; selection: Selection };

export type Options = { video: QualityOption[]; audio: AudioOption[]; other: OtherOption[] };

const TAGS: Record<number, string> = { 2160: "4K", 1440: "QHD", 1080: "Full HD", 720: "HD" };
const isMp4 = (v: MediaVariant) => v.container === "mp4" || v.container === "m4v";
const isAac = (v: MediaVariant) => v.container === "m4a" || (v.audio_codec ?? "").startsWith("mp4a");
// A platform can label a container "mp4" while the video track inside is VP9/AV1 (seen on
// Instagram Reels) — the container name alone doesn't mean our native MediaMuxer can mux it: it
// only muxes H.264/AAC into MP4 (no re-encode, no FFmpeg yet). Muxability must check the actual
// video codec, not just the container label, or the app offers a download that silently fails
// (or produces a corrupt file) at mux time on-device.
const isFastMuxVideo = (v: MediaVariant) => isMp4(v) && (v.video_codec ?? "").startsWith("avc");
const rank = (v: MediaVariant) => [isMp4(v) ? 1 : 0, (v.video_codec ?? "").startsWith("avc") ? 1 : 0, v.bitrate ?? 0] as const;
const better = (a: MediaVariant, b: MediaVariant) => {
  const [x, y] = [rank(a), rank(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};
const sum = (...n: (number | null | undefined)[]) => (n.every((x) => x != null) ? n.reduce<number>((a, b) => a + (b as number), 0) : null);

export function buildOptions(variants: MediaVariant[]): Options {
  const all = variants;
  const videos = all.filter((v) => v.type === "video");
  const heights = [...new Set(videos.map((v) => v.height ?? 0))].filter(Boolean).sort((a, b) => b - a);

  const video: QualityOption[] = heights.map((h) => {
    const atH = videos.filter((v) => v.height === h);
    const https = atH.filter((v) => v.protocol === "https");
    const base = { key: `v${h}`, label: `${h}p`, tag: TAGS[h] ?? "", height: h };

    const progressive = https.filter((v) => v.has_audio).sort(better).pop();
    if (progressive) {
      return { ...base, detail: [progressive.container.toUpperCase(), formatBytes(progressive.filesize), "includes audio"].filter((s) => s !== "—").join(" · "), sizeBytes: progressive.filesize ?? null, selection: { mode: "single", variant: progressive } };
    }
    const videoOnly = https.filter((v) => !v.has_audio).sort(better);
    // Fast path first (no re-encode, on-device MediaMuxer, MP4 out): H.264 video + AAC audio.
    const fastVideo = videoOnly.filter(isFastMuxVideo).pop();
    const fastAudio = fastVideo ? pickAudioFor(fastVideo, all) : null;
    if (fastVideo && fastAudio && isAac(fastAudio)) {
      const size = sum(fastVideo.filesize, fastAudio.filesize);
      return { ...base, detail: ["MP4", formatBytes(size), "audio added automatically"].filter((s) => s !== "—").join(" · "), sizeBytes: size, selection: { mode: "mux", video: fastVideo, audio: fastAudio } };
    }
    // Fallback (any other codec — VP9/AV1 video-only, seen on Instagram Reels): FFmpeg stream-copies
    // into Matroska, no re-encode either, just a container that isn't fussy about what's inside it.
    const anyVideo = videoOnly.pop();
    const anyAudio = anyVideo ? pickAudioFor(anyVideo, all) : null;
    if (anyVideo && anyAudio) {
      const size = sum(anyVideo.filesize, anyAudio.filesize);
      return { ...base, detail: ["MKV", formatBytes(size), "merged with FFmpeg"].filter((s) => s !== "—").join(" · "), sizeBytes: size, selection: { mode: "mux", video: anyVideo, audio: anyAudio } };
    }
    const reason = !https.length ? "Streaming format: needs the FFmpeg module" : anyVideo ? "No audio track to merge with" : "No downloadable video track at this resolution";
    return { ...base, detail: reason, sizeBytes: null, selection: null, blocked: reason };
  });

  // Audio only: AAC/M4A (plays everywhere, no re-encode). Fall back to extracting from a progressive file.
  const aacTracks = all.filter((v) => v.type === "audio" && v.protocol === "https" && isAac(v)).sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
  const audio: AudioOption[] = aacTracks.slice(0, 2).map((v) => ({
    key: `a${v.id}`,
    label: v.bitrate ? `M4A · ${Math.round(v.bitrate / 1000)} kbps` : "M4A",
    detail: [formatBytes(v.filesize)].filter((s) => s !== "—").join(""),
    selection: { mode: "single", variant: v },
  }));
  if (!audio.length) {
    const src = all.filter((v) => v.type === "video" && v.has_audio && v.protocol === "https" && isMp4(v)).sort((a, b) => (a.height ?? 0) - (b.height ?? 0))[0];
    if (src) audio.push({ key: `x${src.id}`, label: "M4A (extracted)", detail: "", selection: { mode: "extract-audio", variant: src } });
  }

  const other: OtherOption[] = all
    .filter((v) => (v.type === "image" || v.type === "file") && v.protocol === "https")
    .map((v, i) => ({ key: `o${v.id}`, label: v.label || `File ${i + 1}`, detail: [v.container.toUpperCase(), formatBytes(v.filesize)].filter((s) => s !== "—").join(" · "), selection: { mode: "single", variant: v } }));

  return { video, audio, other };
}

export type Preset = "best" | "balanced" | "dataSaver";

/** PRD §27. Only ever picks options that can be downloaded today. */
export function pickPreset(options: QualityOption[], preset: Preset): QualityOption | null {
  const ok = options.filter((o) => o.selection);
  if (!ok.length) return null;
  if (preset === "best") return ok[0];
  if (preset === "balanced") return ok.find((o) => o.height <= 720) ?? ok[ok.length - 1];
  return [...ok].reverse().find((o) => o.height >= 360) ?? ok[ok.length - 1];
}

export type PreviousHint =
  | { status: "available"; previous: string }
  | { status: "unavailable"; previous: string; alternative: QualityOption | null };

/** PRD §12: "Previous: 1080p — still available" / "unavailable, 720p available". */
export function previousHint(previousResolution: string | null | undefined, options: QualityOption[]): PreviousHint | null {
  const h = previousResolution ? Number(/^(\d+)p/.exec(previousResolution)?.[1]) : NaN;
  if (!h) return null;
  const same = options.find((o) => o.height === h && o.selection);
  if (same) return { status: "available", previous: `${h}p` };
  const alt = options.find((o) => o.selection && o.height < h) ?? options.find((o) => o.selection) ?? null;
  return { status: "unavailable", previous: `${h}p`, alternative: alt };
}
