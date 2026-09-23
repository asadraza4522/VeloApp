import type { SourceMetadata } from "@/db/queries/sources";
import type { MediaResult, MediaVariant } from "@/domain/resolve/schema";

export function toSourceMetadata(r: MediaResult): SourceMetadata {
  const m = r.metadata;
  const published = m.published_at ? Date.parse(m.published_at) : NaN;
  return {
    title: m.title ?? null,
    description: m.description ?? null,
    creatorName: m.creator ?? null,
    creatorId: m.creator_id ?? null,
    thumbnailUrl: m.thumbnail_url ?? null,
    mediaType: m.media_type,
    durationMs: m.duration != null ? Math.round(m.duration * 1000) : null,
    publishedAt: Number.isNaN(published) ? null : published,
    ...(m.platform_media_id ? { platformMediaId: m.platform_media_id } : {}),
  };
}

// What the format picker shows: complete files first (best first), then separate streams the engine must mux.
export function groupVariants(variants: MediaVariant[]) {
  const byQuality = (a: MediaVariant, b: MediaVariant) => (b.height ?? 0) - (a.height ?? 0) || (b.bitrate ?? 0) - (a.bitrate ?? 0);
  return {
    complete: variants.filter((v) => v.type !== "audio" && v.has_video === (v.type === "video") && (v.has_audio || v.type === "image")).sort(byQuality),
    videoOnly: variants.filter((v) => v.type === "video" && !v.has_audio).sort(byQuality),
    audioOnly: variants.filter((v) => v.type === "audio").sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0)),
  };
}
