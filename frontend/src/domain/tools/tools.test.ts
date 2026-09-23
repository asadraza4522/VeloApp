import { findDuplicates, reclaimable, type FileRef } from "@/domain/tools/duplicates";
import { audioName, frameName, imageName, savings, trimName } from "@/domain/tools/naming";
import { pathUnderVelo, planReorganize, type LibraryItem } from "@/domain/tools/reorganize";
import { largest, olderThan, totalBytes, usageByPlatform, type StoredFile } from "@/domain/tools/storage";
import { clampRange, formatTime, parseTime } from "@/domain/tools/time";

describe("time", () => {
  it("parses common inputs", () => {
    expect(parseTime("83")).toBe(83_000);
    expect(parseTime("1:23")).toBe(83_000);
    expect(parseTime("1:23.5")).toBe(83_500);
    expect(parseTime("01:02:03")).toBe(3_723_000);
    expect(parseTime("0.25")).toBe(250);
  });
  it("rejects nonsense", () => {
    for (const bad of ["", "abc", "1:75", "1:2:3:4", "-5", "1,5", "1:", ".5"]) expect(parseTime(bad)).toBeNull();
  });
  it("formats", () => {
    expect(formatTime(83_500)).toBe("1:23.5");
    expect(formatTime(3_723_000)).toBe("1:02:03");
    expect(formatTime(-1)).toBe("0:00");
    expect(parseTime(formatTime(754_300))).toBe(754_300);
  });
  it("validates trim ranges", () => {
    expect(clampRange(1000, 5000, 60_000)).toEqual({ ok: true, startMs: 1000, endMs: 5000 });
    expect(clampRange(null, 5000, 60_000)).toMatchObject({ ok: false });
    expect(clampRange(5000, 5100, 60_000)).toMatchObject({ ok: false }); // shorter than 0.5 s
    expect(clampRange(0, 90_000, 60_000)).toMatchObject({ ok: false });
    expect(clampRange(-1, 5000, 60_000)).toMatchObject({ ok: false });
    expect(clampRange(0, 60_030, 60_000)).toEqual({ ok: true, startMs: 0, endMs: 60_000 }); // metadata rounding tolerated
  });
});

describe("output names", () => {
  it("are safe and descriptive", () => {
    expect(audioName("My: Video?.mp4")).toBe("My Video.m4a");
    expect(trimName("clip.mp4", 10_000, 40_500, "mp4")).toBe("clip (0-10 to 0-40-5).mp4");
    expect(frameName("clip.mp4", 83_500, "jpg")).toBe("clip (frame 1-23-5).jpg");
    expect(imageName("../photo.PNG", "webp", 1080)).toBe("photo (1080px).webp");
    expect(imageName("photo.png", "jpg", 0)).toBe("photo (converted).jpg");
  });
  it("savings", () => {
    expect(savings(1000, 400)).toBe(60);
    expect(savings(1000, 1200)).toBe(-20);
    expect(savings(0, 5)).toBe(0);
  });
});

const item = (o: Partial<LibraryItem>): LibraryItem => ({
  downloadId: "d1", uri: "content://1", kind: "video", platform: "YouTube", creator: "Chan", title: "Clip", resolution: "1080p", ext: "mp4",
  createdAt: 1_700_000_000_000, currentPath: "Movies/Velo/YouTube/Videos/", currentName: "Clip.mp4", ...o,
});
const NAMING = { pathTemplate: "{platform}/{media_type}", filenameTemplate: "{title}" };

describe("planReorganize", () => {
  it("does nothing when everything already matches", () => expect(planReorganize([item({})], NAMING)).toEqual([]));

  it("moves and renames to the new templates", () => {
    const moves = planReorganize([item({})], { pathTemplate: "{platform}/{creator}", filenameTemplate: "{creator} - {title}" });
    expect(moves).toEqual([{ downloadId: "d1", uri: "content://1", kind: "video", toPath: "YouTube/Chan", toName: "Chan - Clip.mp4", fromPath: "YouTube/Videos", fromName: "Clip.mp4" }]);
  });

  it("never touches files outside Movies|Music|Pictures|Download/Velo", () => {
    expect(planReorganize([item({ currentPath: "DCIM/Camera/" }), item({ currentPath: "Movies/Other/x/" })], { pathTemplate: "x", filenameTemplate: "{title}" })).toEqual([]);
    expect(pathUnderVelo("Music/Velo/")).toBe("");
    expect(pathUnderVelo("Movies/Velo/A/B/")).toBe("A/B");
    expect(pathUnderVelo("Movies/")).toBeNull();
  });

  it("keeps targets unique within one plan (same title twice)", () => {
    const moves = planReorganize([item({ downloadId: "a", currentName: "a.mp4", createdAt: 1 }), item({ downloadId: "b", currentName: "b.mp4", createdAt: 2 })], NAMING);
    expect(moves.map((m) => m.toName)).toEqual(["Clip.mp4", "Clip (2).mp4"]);
  });

  it("hostile metadata cannot escape", () => {
    const moves = planReorganize([item({ creator: "../../x", title: "a/b\\c", currentName: "old.mp4" })], { pathTemplate: "{creator}", filenameTemplate: "{title}" });
    expect(moves[0].toPath.split("/")).not.toContain("..");
    expect(moves[0].toName).not.toMatch(/[\\/]/);
  });
});

describe("findDuplicates", () => {
  const f = (id: string, size: number, createdAt: number): FileRef => ({ id, uri: `content://${id}`, size, createdAt });

  it("hashes only same-size files and groups identical content, keeping the oldest", async () => {
    const hashes: Record<string, string> = { a: "H1", b: "H1", c: "H2", d: "H2", e: "H9" };
    const calls: string[] = [];
    const groups = await findDuplicates([f("a", 100, 5), f("b", 100, 1), f("c", 100, 2), f("d", 100, 3), f("e", 100, 4), f("solo", 7, 1), f("zero", 0, 1), f("z2", 0, 2)], async (x) => { calls.push(x.id); return hashes[x.id]; });
    expect(calls.sort()).toEqual(["a", "b", "c", "d", "e"]); // unique sizes and empty files never hashed
    expect(groups).toHaveLength(2);
    const g1 = groups.find((g) => g.hash === "H1")!;
    expect(g1.keep.id).toBe("b");
    expect(g1.extras.map((x) => x.id)).toEqual(["a"]);
    expect(reclaimable(groups)).toBe(200);
  });

  it("same size but different content is not a duplicate", async () => {
    expect(await findDuplicates([f("a", 10, 1), f("b", 10, 2)], async (x) => x.id)).toEqual([]);
  });

  it("reports progress", async () => {
    const seen: string[] = [];
    await findDuplicates([f("a", 10, 1), f("b", 10, 2), f("c", 10, 3)], async () => "h", (d, t) => seen.push(`${d}/${t}`));
    expect(seen).toEqual(["1/3", "2/3", "3/3"]);
  });
});

describe("storage", () => {
  const s = (id: string, platform: string, size: number, age: number): StoredFile => ({ id, uri: id, platform, kind: "video", size, createdAt: 1_000_000_000_000 - age * 86_400_000, title: id });
  const files = [s("a", "YouTube", 500, 100), s("b", "YouTube", 300, 10), s("c", "TikTok", 900, 40), s("d", "Other", 1, 1)];

  it("aggregates by platform, biggest first", () => {
    expect(usageByPlatform(files)).toEqual([{ platform: "TikTok", bytes: 900, count: 1 }, { platform: "YouTube", bytes: 800, count: 2 }, { platform: "Other", bytes: 1, count: 1 }]);
    expect(totalBytes(files)).toBe(1701);
  });
  it("selects by age and by size", () => {
    expect(olderThan(files, 30, 1_000_000_000_000).map((x) => x.id)).toEqual(["a", "c"]);
    expect(largest(files, 2).map((x) => x.id)).toEqual(["c", "a"]);
  });
});
