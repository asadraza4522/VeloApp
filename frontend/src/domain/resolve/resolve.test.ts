import { resolveUrl, type Invoke } from "@/domain/resolve/client";
import { groupVariants, toSourceMetadata } from "@/domain/resolve/mapping";
import { mediaResultSchema } from "@/domain/resolve/schema";

const variant = (o: object) => ({ id: "x", type: "video", label: "l", container: "mp4", url: "https://cdn/x", has_video: true, has_audio: true, ...o });
const result = {
  resolver_id: "ytdlp", resolved_at: 1, degraded: false,
  metadata: { source_url: "https://youtu.be/a", title: "T", creator: "C", platform: "YouTube", duration: 65.4, published_at: "2026-09-10T00:00:00+00:00", media_type: "video", platform_media_id: "a" },
  variants: [
    variant({ id: "18", height: 360 }),
    variant({ id: "137", height: 1080, has_audio: false, bitrate: 4_000_000 }),
    variant({ id: "22", height: 720 }),
    variant({ id: "140", type: "audio", has_video: false, container: "m4a", bitrate: 129_000 }),
    { id: "img", type: "image", label: "i", container: "png", url: "https://cdn/i.png", has_video: false, has_audio: false },
  ],
};

const invoke = (status: number, body: unknown): Invoke => async () => ({ status, body });

describe("resolveUrl", () => {
  it("parses a successful worker result", async () => {
    const r = await resolveUrl("https://youtu.be/a", invoke(200, { ok: true, result }));
    expect(r.ok && r.result.variants).toHaveLength(5);
  });

  it("passes through classified failures", async () => {
    expect(await resolveUrl("u", invoke(200, { ok: false, error: { code: "AUTH_REQUIRED", message: "login" } }))).toEqual({ ok: false, code: "AUTH_REQUIRED", message: "login" });
    expect(await resolveUrl("u", invoke(429, { ok: false, error: { code: "RATE_LIMITED", message: "cap" } }))).toMatchObject({ code: "RATE_LIMITED" });
  });

  it("unknown failure codes become UNKNOWN", async () => {
    expect(await resolveUrl("u", invoke(200, { ok: false, error: { code: "NEW_THING" } }))).toMatchObject({ code: "UNKNOWN" });
  });

  it("malformed / drifted responses fail safely", async () => {
    expect(await resolveUrl("u", invoke(200, { ok: true, result: { nope: 1 } }))).toMatchObject({ ok: false });
    expect(await resolveUrl("u", invoke(502, null))).toMatchObject({ ok: false, code: "SERVER_ERROR" });
    expect(await resolveUrl("u", invoke(429, "<html>"))).toMatchObject({ ok: false, code: "RATE_LIMITED" });
  });

  it("transport errors are NETWORK_ERROR", async () => {
    const boom: Invoke = async () => { throw new Error("Network request failed"); };
    expect(await resolveUrl("u", boom)).toMatchObject({ ok: false, code: "NETWORK_ERROR" });
  });

  it("rejects a variant without a valid URL", () => {
    expect(mediaResultSchema.safeParse({ ...result, variants: [variant({ url: "not a url" })] }).success).toBe(false);
  });
});

describe("mapping", () => {
  const parsed = mediaResultSchema.parse(result);

  it("maps worker metadata to a source patch", () => {
    expect(toSourceMetadata(parsed)).toMatchObject({ title: "T", creatorName: "C", durationMs: 65_400, mediaType: "video", platformMediaId: "a", publishedAt: Date.parse("2026-09-10T00:00:00+00:00") });
  });

  it("groups variants for the picker, best first", () => {
    const g = groupVariants(parsed.variants);
    expect(g.complete.map((v) => v.id)).toEqual(["22", "18", "img"]);
    expect(g.complete.filter((v) => v.type === "video").map((v) => v.id)).toEqual(["22", "18"]);
    expect(g.videoOnly.map((v) => v.id)).toEqual(["137"]);
    expect(g.audioOnly.map((v) => v.id)).toEqual(["140"]);
  });
});
