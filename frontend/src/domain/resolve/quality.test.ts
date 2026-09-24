import { buildOptions, pickPreset, previousHint } from "@/domain/resolve/quality";
import type { MediaVariant } from "@/domain/resolve/schema";

const v = (o: Partial<MediaVariant>): MediaVariant => ({ id: "x", type: "video", label: "l", container: "mp4", url: "https://c/x", headers: {}, protocol: "https", has_video: true, has_audio: true, ...o });

const VARIANTS = [
  v({ id: "22", height: 720, filesize: 50_000_000 }),
  v({ id: "18", height: 360, filesize: 20_000_000 }),
  v({ id: "137", height: 1080, has_audio: false, video_codec: "avc1", filesize: 90_000_000 }),
  v({ id: "299", height: 1080, has_audio: false, video_codec: "avc1", filesize: 70_000_000, fps: 60, bitrate: 3_000_000 }),
  v({ id: "313", height: 2160, has_audio: false, container: "webm", video_codec: "vp9", filesize: 400_000_000 }),
  v({ id: "hls", height: 480, protocol: "hls" }),
  v({ id: "140", type: "audio", container: "m4a", has_video: false, audio_codec: "mp4a.40.2", bitrate: 129_000, filesize: 5_000_000 }),
  v({ id: "251", type: "audio", container: "webm", has_video: false, audio_codec: "opus", bitrate: 160_000 }),
];

describe("buildOptions", () => {
  const o = buildOptions(VARIANTS);

  it("one row per height, best first", () => expect(o.video.map((x) => x.label)).toEqual(["2160p", "1080p", "720p", "480p", "360p"]));

  it("progressive files are used as-is, video-only gets audio added automatically", () => {
    const by = Object.fromEntries(o.video.map((x) => [x.label, x]));
    expect(by["720p"].selection?.mode).toBe("single");
    expect(by["720p"].detail).toContain("includes audio");
    expect(by["1080p"].selection?.mode).toBe("mux");
    expect(by["1080p"].detail).toContain("audio added automatically");
    expect(by["1080p"].tag).toBe("Full HD");
    expect(by["1080p"].sizeBytes).toBe(70_000_000 + 5_000_000); // the higher-bitrate avc stream (299) + AAC
  });

  it("marks streaming (HLS/DASH) formats as blocked — no FFmpeg for that yet", () => {
    const by = Object.fromEntries(o.video.map((x) => [x.label, x]));
    expect(by["480p"].blocked).toMatch(/Streaming/);
  });

  // 2026-09-23, Instagram Reels: a platform can label a container "mp4" while the video track
  // inside is actually VP9 — MediaMuxer's fast on-device MP4 path only accepts H.264/AAC, so this
  // must NOT be offered as a plain "mux" (it would silently fail at mux time on-device). It's
  // still downloadable, just via the FFmpeg fallback (Matroska output, stream-copy, no re-encode).
  it("VP9/AV1 video (even mislabeled with an mp4 container) downloads via the FFmpeg/MKV fallback, not the fast MP4 path", () => {
    const by = Object.fromEntries(o.video.map((x) => [x.label, x]));
    expect(by["2160p"].selection?.mode).toBe("mux"); // job.ts decides mux vs mux-ffmpeg from the actual codec at build time
    expect(by["2160p"].detail).toMatch(/MKV/);
    expect(by["2160p"].detail).toMatch(/FFmpeg/);
    expect(by["2160p"].tag).toBe("4K");

    const withMislabeledVp9 = [
      v({ id: "1", height: 1080, has_audio: false, container: "mp4", video_codec: "vp09.00.40.08", filesize: 9_000_000 }),
      v({ id: "2", type: "audio", container: "m4a", has_video: false, audio_codec: "mp4a.40.5", bitrate: 62_000, filesize: 500_000 }),
    ];
    const opt = buildOptions(withMislabeledVp9).video[0];
    expect(opt.selection?.mode).toBe("mux");
    expect(opt.detail).toMatch(/MKV/);
  });

  it("blocks video-only formats that have no audio track to merge with, at all", () => {
    const noAudio = buildOptions([v({ id: "1", height: 720, has_audio: false, video_codec: "vp9", filesize: 1000 })]);
    expect(noAudio.video[0].selection).toBeNull();
    expect(noAudio.video[0].blocked).toMatch(/audio/);
  });

  it("audio-only offers AAC/M4A only", () => {
    expect(o.audio).toHaveLength(1);
    expect(o.audio[0].label).toBe("M4A · 129 kbps");
  });

  it("falls back to extracting audio from an MP4 when there is no AAC track", () => {
    const only = buildOptions([v({ id: "22", height: 720 })]);
    expect(only.audio[0].selection.mode).toBe("extract-audio");
  });

  it("images/files become plain options", () => {
    const imgs = buildOptions([v({ id: "1", type: "image", container: "png", has_video: false, has_audio: false, label: "Image 1" })]);
    expect(imgs.other).toHaveLength(1);
    expect(imgs.video).toHaveLength(0);
  });
});

describe("presets", () => {
  const { video } = buildOptions(VARIANTS);
  it("best skips blocked rows", () => expect(pickPreset(video, "best")?.label).toBe("2160p")); // now downloadable via the FFmpeg/MKV fallback
  it("balanced is at most 720p", () => expect(pickPreset(video, "balanced")?.label).toBe("720p"));
  it("data saver is the smallest usable, not below 360p", () => expect(pickPreset(video, "dataSaver")?.label).toBe("360p"));
  it("no options → null", () => expect(pickPreset([], "best")).toBeNull());
});

describe("previousHint (PRD §12)", () => {
  const { video } = buildOptions(VARIANTS);
  it("still available", () => expect(previousHint("1080p", video)).toEqual({ status: "available", previous: "1080p" }));
  it("unavailable → suggests the next best", () => {
    const h = previousHint("1440p", video);
    expect(h).toMatchObject({ status: "unavailable", previous: "1440p" });
    expect(h?.status === "unavailable" && h.alternative?.label).toBe("1080p");
  });
  it("no history → no hint", () => {
    expect(previousHint(null, video)).toBeNull();
    expect(previousHint("weird", video)).toBeNull();
  });
});
