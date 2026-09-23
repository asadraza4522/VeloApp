import { formatBytes, formatDuration, timeAgo } from "@/utils/format";

it("formatBytes", () => {
  expect(formatBytes(0)).toBe("0 B");
  expect(formatBytes(1536)).toBe("1.5 KB");
  expect(formatBytes(620 * 1024 * 1024)).toBe("620 MB");
  expect(formatBytes(null)).toBe("—");
});

it("formatDuration", () => {
  expect(formatDuration(65_000)).toBe("1:05");
  expect(formatDuration(3_725_000)).toBe("1:02:05");
  expect(formatDuration(undefined)).toBe("");
});

it("timeAgo", () => {
  expect(timeAgo(1000, 4000)).toBe("just now");
  expect(timeAgo(0, 45_000)).toBe("45s ago");
  expect(timeAgo(0, 5 * 60_000)).toBe("5 min ago");
  expect(timeAgo(0, 3 * 3_600_000)).toBe("3 h ago");
  expect(timeAgo(0, 2 * 86_400_000)).toBe("2 d ago");
  expect(timeAgo(5000, 1000)).toBe("just now"); // clock skew never goes negative
});
