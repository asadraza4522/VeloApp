import { buildFilename, defaultRelativePath, mimeFor, sanitizeSegment } from "@/domain/organize/filename";

describe("sanitizeSegment", () => {
  it("removes path separators and reserved characters", () => {
    expect(sanitizeSegment("../../etc/passwd")).toBe("etc passwd");
    expect(sanitizeSegment('a<b>c:d"e|f?g*h')).toBe("a b c d e f g h");
    expect(sanitizeSegment("C:\\Users\\x")).toBe("C Users x");
  });
  it("drops leading dots and trailing dots/spaces (Android/Windows)", () => {
    expect(sanitizeSegment("...hidden")).toBe("hidden");
    expect(sanitizeSegment("name. . ")).toBe("name");
  });
  it("never returns empty and bounds the length", () => {
    expect(sanitizeSegment("   ")).toBe("file");
    expect(sanitizeSegment("///", "Other")).toBe("Other");
    expect(sanitizeSegment("x".repeat(500)).length).toBeLessThanOrEqual(120);
  });
  it("keeps unicode", () => {
    expect(sanitizeSegment("कैसे बनाएं 🎬")).toBe("कैसे बनाएं 🎬");
  });
});

describe("buildFilename / paths / mime", () => {
  it("builds title.ext", () => {
    expect(buildFilename("How to: Build a React App?", ".MP4")).toBe("How to Build a React App.mp4");
    expect(buildFilename(null, "m4a")).toBe("download.m4a");
    expect(buildFilename("x", "$$")).toBe("x.bin");
  });
  it("default folder layout", () => {
    expect(defaultRelativePath("YouTube", "video")).toBe("YouTube/Videos");
    expect(defaultRelativePath("a/b", "audio")).toBe("a b/Audio");
  });
  it("mime types", () => {
    expect(mimeFor("m4a", "audio")).toBe("audio/mp4");
    expect(mimeFor("xyz", "file")).toBe("application/octet-stream");
  });
});
