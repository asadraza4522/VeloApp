import { sanitizeSegment } from "@/domain/organize/filename";
import { formatTime } from "@/domain/tools/time";

export const TOOLS_FOLDER = "Tools"; // Movies|Music|Pictures / Velo / Tools

const base = (name: string) => sanitizeSegment(name.replace(/\.[^.]+$/, ""), "file");
const ext = (e: string) => e.replace(/^\./, "").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";

export const audioName = (source: string) => `${base(source)}.m4a`;
export const trimName = (source: string, startMs: number, endMs: number, e: string) =>
  `${base(source)} (${formatTime(startMs).replace(/[:.]/g, "-")} to ${formatTime(endMs).replace(/[:.]/g, "-")}).${ext(e)}`;
export const frameName = (source: string, atMs: number, e: string) => `${base(source)} (frame ${formatTime(atMs).replace(/[:.]/g, "-")}).${ext(e)}`;
export const imageName = (source: string, e: string, maxDimension: number) => `${base(source)}${maxDimension ? ` (${maxDimension}px)` : " (converted)"}.${ext(e)}`;

export const IMAGE_FORMATS = [{ id: "jpg", label: "JPG" }, { id: "png", label: "PNG" }, { id: "webp", label: "WebP" }] as const;
export const IMAGE_QUALITY = [{ label: "High", value: 90 }, { label: "Balanced", value: 75 }, { label: "Small", value: 50 }] as const;
export const IMAGE_SIZES = [{ label: "Original", value: 0 }, { label: "2048 px", value: 2048 }, { label: "1080 px", value: 1080 }, { label: "720 px", value: 720 }] as const;

/** "Saved 62% (4.2 MB → 1.6 MB)" text pieces. Negative = the result got bigger (e.g. JPG → PNG). */
export function savings(before: number, after: number): number {
  return before > 0 ? Math.round((1 - after / before) * 100) : 0;
}
