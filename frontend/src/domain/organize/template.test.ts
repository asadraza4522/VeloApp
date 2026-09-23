import { DEFAULT_NAMING, renderFilename, renderPath, type TemplateCtx } from "@/domain/organize/template";

const ctx: TemplateCtx = { platform: "YouTube", kind: "video", creator: "Tech Example", title: "How to Build: a React App?", resolution: "1080p", ext: "mp4", date: new Date(2026, 8, 5) };

describe("renderPath", () => {
  it("default layout", () => expect(renderPath(DEFAULT_NAMING.pathTemplate, ctx)).toBe("YouTube/Videos"));
  it("creator and date variables", () => {
    expect(renderPath("{platform}/{creator}", ctx)).toBe("YouTube/Tech Example");
    expect(renderPath("{platform}/{year}/{month}", ctx)).toBe("YouTube/2026/09");
  });
  it("drops empty segments, unknown variables and caps the depth", () => {
    expect(renderPath("{platform}//{nope}/{media_type}", ctx)).toBe("YouTube/Videos");
    expect(renderPath("", ctx)).toBe("");
    expect(renderPath("a/b/c/d/e/f", ctx).split("/")).toHaveLength(4);
  });
  it("cannot escape the Velo folder", () => {
    expect(renderPath("../../{platform}", { ...ctx, platform: "../evil" })).toBe("evil");
    expect(renderPath("{creator}", { ...ctx, creator: "a/b\\c" })).toBe("a/b c");
  });
  it("missing creator gets a placeholder", () => expect(renderPath("{creator}", { ...ctx, creator: null })).toBe("Unknown creator"));
});

describe("renderFilename", () => {
  it("title / creator - title / date - title", () => {
    expect(renderFilename("{title}", ctx)).toBe("How to Build a React App.mp4");
    expect(renderFilename("{creator} - {title}", ctx)).toBe("Tech Example - How to Build a React App.mp4");
    expect(renderFilename("{date} - {title}", ctx)).toBe("2026-09-05 - How to Build a React App.mp4");
  });
  it("falls back when everything is empty", () => {
    expect(renderFilename("{nope}", { ...ctx, title: null })).toBe("download.mp4");
    expect(renderFilename("{title}", { ...ctx, title: null, ext: "$$" })).toBe("download.bin");
  });
  it("trims dangling separators when a part is empty", () => {
    expect(renderFilename("{resolution} - {title}", { ...ctx, resolution: null })).toBe("title.mp4".replace("title", "How to Build a React App"));
  });
});
