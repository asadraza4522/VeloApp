// Turns a chosen variant (or pair) into the job the native engine runs. Pure.
import type { NativeDownloadJob, NativePart } from "@velo/native";

import type { MediaVariant } from "@/domain/resolve/schema";
import { mimeFor } from "@/domain/organize/filename";
import { DEFAULT_NAMING, renderFilename, renderPath, type Naming } from "@/domain/organize/template";

export type Selection =
  | { mode: "single"; variant: MediaVariant }
  | { mode: "mux"; video: MediaVariant; audio: MediaVariant }
  | { mode: "extract-audio"; variant: MediaVariant };

/** Persisted in downloads.variant_json: ids only (URLs are short-lived), enough to re-resolve the same choice. */
export type SelectionMeta = { mode: Selection["mode"]; variantId?: string; videoId?: string; audioId?: string; reResolved?: boolean };

export class UnsupportedSelectionError extends Error {}

const toPart = (v: MediaVariant, role: NativePart["role"]): NativePart => ({ url: v.url, headers: v.headers, expectedSize: v.filesize ?? null, role });

const isMp4Video = (v: MediaVariant) => v.container === "mp4" || v.container === "m4v";
const isAac = (v: MediaVariant) => v.container === "m4a" || v.container === "mp4" || (v.audio_codec ?? "").startsWith("mp4a");
// The container label alone doesn't mean MediaMuxer can mux it (a platform can label a container
// "mp4" while the video track is actually VP9/AV1 — seen on Instagram Reels); the fast on-device
// MediaMuxer path only accepts H.264/AAC. Everything else falls back to "mux-ffmpeg" (see
// FfmpegRunner.kt), which stream-copies any codec combination into Matroska — that path doesn't
// care about codec at all, so it needs no matching isMuxableVideo-style gate.
const isAvcVideo = (v: MediaVariant) => (v.video_codec ?? "").startsWith("avc");

function assertDownloadable(...vs: MediaVariant[]) {
  for (const v of vs) {
    if (v.protocol !== "https") throw new UnsupportedSelectionError("Streaming (HLS/DASH) formats need the FFmpeg module");
  }
}

export function metaOf(sel: Selection): SelectionMeta {
  return sel.mode === "mux"
    ? { mode: "mux", videoId: sel.video.id, audioId: sel.audio.id }
    : { mode: sel.mode, variantId: sel.variant.id };
}

export function partsFor(sel: Selection): NativePart[] {
  return sel.mode === "mux" ? [toPart(sel.video, "video"), toPart(sel.audio, "audio")] : [toPart(sel.variant, "main")];
}

type JobInput = {
  taskId: string;
  title: string | null | undefined;
  platform: string;
  creator?: string | null;
  selection: Selection;
  naming?: Naming;
  now?: Date;
};

export function buildJob(input: JobInput): NativeDownloadJob {
  const { taskId, title, platform, selection: sel } = input;
  const naming = input.naming ?? DEFAULT_NAMING;
  const now = input.now ?? new Date();
  const finish = (kind: NativeDownloadJob["kind"], ext: string, resolution: string | null, postProcess: NativeDownloadJob["postProcess"]): NativeDownloadJob => {
    const ctx = { platform, kind, creator: input.creator, title, resolution, ext, date: now };
    const filename = renderFilename(naming.filenameTemplate, ctx);
    return { taskId, title: title ?? filename, parts: partsFor(sel), kind, relativePath: renderPath(naming.pathTemplate, ctx), filename, mime: mimeFor(ext, kind), postProcess };
  };

  if (sel.mode === "mux") {
    assertDownloadable(sel.video, sel.audio);
    const resolution = sel.video.height ? `${sel.video.height}p` : null;
    // Fast path: no re-encode, MediaMuxer straight to MP4 (H.264/AAC only).
    if (isMp4Video(sel.video) && isAvcVideo(sel.video) && isAac(sel.audio)) return finish("video", "mp4", resolution, "mux");
    // Fallback: any other codec combination (VP9/AV1 video, non-AAC audio) — FFmpeg stream-copies
    // into Matroska, still no re-encode, just a container that doesn't care what's inside it.
    return finish("video", "mkv", resolution, "mux-ffmpeg");
  }

  const v = sel.variant;
  assertDownloadable(v);
  if (sel.mode === "extract-audio") {
    if (!v.has_audio) throw new UnsupportedSelectionError("This format has no audio");
    return finish("audio", "m4a", null, "extract-audio");
  }
  if (v.type === "video" && !v.has_audio) throw new UnsupportedSelectionError("Video-only format: pick an audio track to merge with it");
  return finish(v.type, v.container, v.height ? `${v.height}p` : null, "none");
}

/** Best audio partner for a video-only variant: MP4/AAC first (muxable), then highest bitrate. */
export function pickAudioFor(video: MediaVariant, all: MediaVariant[]): MediaVariant | null {
  if (video.has_audio) return null;
  const audios = all.filter((v) => v.type === "audio" && v.protocol === "https");
  const aac = audios.filter(isAac);
  return [...(aac.length ? aac : audios)].sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0] ?? null;
}

/** The selection for "download this variant": progressive as-is, video-only + best AAC track otherwise. */
export function selectionFor(variant: MediaVariant, all: MediaVariant[]): Selection {
  if (variant.type === "video" && !variant.has_audio) {
    const audio = pickAudioFor(variant, all);
    if (!audio) throw new UnsupportedSelectionError("No compatible audio track was found for this video");
    return { mode: "mux", video: variant, audio };
  }
  return { mode: "single", variant };
}

/** Rebuild the same selection from a fresh resolve (after URL expiry). Null if the formats are gone. */
export function reselect(meta: SelectionMeta, all: MediaVariant[]): Selection | null {
  const by = (id?: string) => all.find((v) => v.id === id);
  if (meta.mode === "mux") {
    const video = by(meta.videoId);
    const audio = by(meta.audioId);
    return video && audio ? { mode: "mux", video, audio } : null;
  }
  const variant = by(meta.variantId);
  return variant ? { mode: meta.mode, variant } as Selection : null;
}
