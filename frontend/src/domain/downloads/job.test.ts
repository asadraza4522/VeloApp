import { buildJob, pickAudioFor, reselect, selectionFor, UnsupportedSelectionError } from "@/domain/downloads/job";
import type { MediaVariant } from "@/domain/resolve/schema";

const v = (o: Partial<MediaVariant>): MediaVariant => ({
  id: "x", type: "video", label: "l", container: "mp4", url: "https://c/x", headers: {}, protocol: "https", has_video: true, has_audio: true, ...o,
});

describe("buildJob", () => {
  it("audio extraction becomes an m4a job", () => {
    const j = buildJob({ taskId: "t", title: "Song", platform: "YouTube", selection: { mode: "extract-audio", variant: v({ id: "22" }) } });
    expect(j).toMatchObject({ kind: "audio", postProcess: "extract-audio", filename: "Song.m4a", mime: "audio/mp4", relativePath: "YouTube/Audio" });
  });
  it("audio-only variants download as-is", () => {
    const a = v({ id: "140", type: "audio", container: "m4a", has_video: false });
    expect(buildJob({ taskId: "t", title: "x", platform: "P", selection: { mode: "single", variant: a } })).toMatchObject({ kind: "audio", postProcess: "none", filename: "x.m4a" });
  });
  it("images", () => {
    const i = v({ type: "image", container: "png", has_video: false, has_audio: false });
    expect(buildJob({ taskId: "t", title: null, platform: "Other", selection: { mode: "single", variant: i } })).toMatchObject({ kind: "image", filename: "download.png", relativePath: "Other/Images" });
  });
  it("refuses video-only as a single file, and streaming protocols", () => {
    expect(() => buildJob({ taskId: "t", title: "x", platform: "P", selection: { mode: "single", variant: v({ has_audio: false }) } })).toThrow(UnsupportedSelectionError);
    expect(() => buildJob({ taskId: "t", title: "x", platform: "P", selection: { mode: "single", variant: v({ protocol: "dash" }) } })).toThrow(UnsupportedSelectionError);
  });

  it("H.264/AAC mux uses the fast on-device path (MP4, no re-encode)", () => {
    const j = buildJob({ taskId: "t", title: "x", platform: "P", selection: { mode: "mux", video: v({ has_audio: false, video_codec: "avc1" }), audio: v({ type: "audio", container: "m4a", audio_codec: "mp4a.40.2" }) } });
    expect(j).toMatchObject({ postProcess: "mux", filename: "x.mp4", mime: "video/mp4" });
  });

  // 2026-09-23, Instagram Reels: VP9 video-only (even labeled with an mp4 container, or any other
  // codec combo) is still downloadable — just via the FFmpeg fallback (Matroska, stream-copy, no
  // re-encode), not the fast MediaMuxer path which only accepts H.264/AAC.
  it("non-H.264 mux (e.g. VP9) falls back to FFmpeg (MKV, still no re-encode)", () => {
    const j = buildJob({ taskId: "t", title: "x", platform: "P", selection: { mode: "mux", video: v({ container: "webm", has_audio: false, video_codec: "vp9" }), audio: v({ type: "audio", container: "m4a" }) } });
    expect(j).toMatchObject({ postProcess: "mux-ffmpeg", filename: "x.mkv", mime: "video/x-matroska" });
  });
});

describe("naming templates", () => {
  const sel = { mode: "single" as const, variant: v({ id: "22", height: 1080 }) };
  it("applies folder + filename templates", () => {
    const j = buildJob({ taskId: "t", title: "My Clip", platform: "YouTube", creator: "Chan", selection: sel, now: new Date(2026, 8, 5), naming: { pathTemplate: "{platform}/{creator}/{year}", filenameTemplate: "{date} - {title} [{resolution}]" } });
    expect(j.relativePath).toBe("YouTube/Chan/2026");
    expect(j.filename).toBe("2026-09-05 - My Clip [1080p].mp4");
  });
  it("hostile titles/creators stay inside the Velo folder", () => {
    const j = buildJob({ taskId: "t", title: "../../etc/passwd", platform: "../x", creator: "..\\evil", selection: sel, naming: { pathTemplate: "{platform}/{creator}", filenameTemplate: "{title}" } });
    expect(j.relativePath.split("/").every((s) => s !== ".." && s !== "")).toBe(true);
    expect(j.filename).not.toMatch(/[\\/]/);
  });
});

describe("pickAudioFor / reselect", () => {
  const video = v({ id: "137", has_audio: false });
  const aac = v({ id: "140", type: "audio", container: "m4a", has_video: false, bitrate: 128_000 });
  const aacHigh = v({ id: "141", type: "audio", container: "m4a", has_video: false, bitrate: 256_000 });
  const opus = v({ id: "251", type: "audio", container: "webm", has_video: false, audio_codec: "opus", bitrate: 300_000 });

  it("prefers AAC over higher-bitrate Opus, then bitrate", () => {
    expect(pickAudioFor(video, [aac, aacHigh, opus])?.id).toBe("141");
    expect(pickAudioFor(v({ has_audio: true }), [aac])).toBeNull();
  });
  it("selectionFor pairs video-only, keeps progressive single", () => {
    expect(selectionFor(video, [video, aac]).mode).toBe("mux");
    expect(selectionFor(v({ id: "22" }), [aac]).mode).toBe("single");
  });
  it("reselect rebuilds the same choice from fresh variants, or null", () => {
    const sel = reselect({ mode: "mux", videoId: "137", audioId: "140" }, [video, aac]);
    expect(sel?.mode).toBe("mux");
    expect(reselect({ mode: "mux", videoId: "137", audioId: "gone" }, [video, aac])).toBeNull();
    expect(reselect({ mode: "single", variantId: "22" }, [])).toBeNull();
  });
});
