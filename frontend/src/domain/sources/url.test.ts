import { canonicalize, detectPlatform, parseUrl } from "@/domain/sources/url";

describe("parseUrl", () => {
  it("rejects non-http(s) and garbage", () => {
    expect(parseUrl("ftp://x.com/a")).toBeNull();
    expect(parseUrl("javascript:alert(1)")).toBeNull();
    expect(parseUrl("not a url")).toBeNull();
  });
  it("lowercases host and strips www/m", () => {
    expect(parseUrl("HTTPS://WWW.Example.com:8080/a?b=1#f")).toMatchObject({ host: "example.com", path: "/a", query: [["b", "1"]] });
  });
});

describe("detectPlatform", () => {
  it.each([
    ["youtu.be", "YouTube"], ["music.youtube.com", "YouTube"], ["instagram.com", "Instagram"],
    ["vm.tiktok.com", "TikTok"], ["x.com", "X"], ["archive.org", "Internet Archive"], ["example.org", "Other"],
  ])("%s → %s", (host, want) => expect(detectPlatform(host)).toBe(want));
});

describe("canonicalize", () => {
  it("collapses YouTube variants to one canonical url", () => {
    const want = { canonicalUrl: "https://youtube.com/watch?v=abc123XYZ_-", platform: "YouTube", platformMediaId: "abc123XYZ_-" };
    expect(canonicalize("https://youtu.be/abc123XYZ_-?si=track")).toEqual(want);
    expect(canonicalize("https://m.youtube.com/watch?v=abc123XYZ_-&feature=share&t=10")).toEqual(want);
    expect(canonicalize("https://www.youtube.com/shorts/abc123XYZ_-")).toEqual(want);
  });
  it("normalizes Instagram / TikTok / X ids", () => {
    expect(canonicalize("https://www.instagram.com/reel/Cxyz12/?igsh=abc")?.canonicalUrl).toBe("https://instagram.com/reel/Cxyz12/");
    expect(canonicalize("https://www.tiktok.com/@some.user/video/7123456789?is_from_webapp=1")?.platformMediaId).toBe("7123456789");
    expect(canonicalize("https://twitter.com/jack/status/20?s=20")?.canonicalUrl).toBe("https://x.com/jack/status/20");
  });
  it("generic urls: drop tracking params, sort the rest, trim slash", () => {
    expect(canonicalize("https://www.example.com/a/b/?utm_source=x&z=2&a=1")?.canonicalUrl).toBe("https://example.com/a/b?a=1&z=2");
    expect(canonicalize("https://example.com/")?.canonicalUrl).toBe("https://example.com");
  });
  it("returns null for invalid input", () => {
    expect(canonicalize("hello")).toBeNull();
  });
});
