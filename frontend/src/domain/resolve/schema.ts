// Mirrors worker/app/models.py. Parsed at the trust boundary: never use worker/Edge output unvalidated.
import { z } from "zod";

import { FAILURE_CODES } from "@/db/schema";

export const variantSchema = z.object({
  id: z.string(),
  type: z.enum(["video", "audio", "image", "file"]),
  label: z.string(),
  container: z.string(),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).default({}),
  protocol: z.enum(["https", "hls", "dash"]).default("https"),
  has_video: z.boolean(),
  has_audio: z.boolean(),
  video_codec: z.string().nullish(),
  audio_codec: z.string().nullish(),
  width: z.number().nullish(),
  height: z.number().nullish(),
  fps: z.number().nullish(),
  bitrate: z.number().nullish(),
  filesize: z.number().nullish(),
  ip_bound: z.boolean().nullish(),
});

export const metadataSchema = z.object({
  source_url: z.string(),
  title: z.string().nullish(),
  description: z.string().nullish(),
  creator: z.string().nullish(),
  creator_id: z.string().nullish(),
  platform: z.string(),
  platform_media_id: z.string().nullish(),
  thumbnail_url: z.string().nullish(),
  published_at: z.string().nullish(),
  duration: z.number().nullish(),
  media_type: z.enum(["video", "audio", "image", "file", "unknown"]).default("unknown"),
});

export const mediaResultSchema = z.object({
  resolver_id: z.string(),
  metadata: metadataSchema,
  variants: z.array(variantSchema),
  resolved_at: z.number(),
  expires_at: z.number().nullish(),
  degraded: z.boolean().default(false),
});

export const responseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), result: mediaResultSchema }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string().default("") }) }),
]);

export type MediaVariant = z.infer<typeof variantSchema>;
export type MediaResult = z.infer<typeof mediaResultSchema>;
export type FailureCodeName = (typeof FAILURE_CODES)[number];
