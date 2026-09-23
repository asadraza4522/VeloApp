// Folder + filename templates (PRD §33-34). Variables are substituted, every segment is sanitized,
// and the result is always a safe path under Movies|Music|Pictures|Download/Velo.
import { sanitizeSegment } from "@/domain/organize/filename";

export type MediaKind = "video" | "audio" | "image" | "file";

export type TemplateCtx = {
  platform: string;
  kind: MediaKind;
  creator?: string | null;
  title?: string | null;
  resolution?: string | null;
  ext: string;
  date: Date;
};

const KIND_FOLDER: Record<MediaKind, string> = { video: "Videos", audio: "Audio", image: "Images", file: "Files" };
const MAX_DEPTH = 4;
const pad = (n: number) => String(n).padStart(2, "0");

function vars(c: TemplateCtx): Record<string, string> {
  return {
    platform: c.platform || "Other",
    media_type: KIND_FOLDER[c.kind],
    creator: c.creator || "Unknown creator",
    title: c.title || "download",
    resolution: c.resolution || "",
    extension: c.ext,
    year: String(c.date.getFullYear()),
    month: pad(c.date.getMonth() + 1),
    day: pad(c.date.getDate()),
    date: `${c.date.getFullYear()}-${pad(c.date.getMonth() + 1)}-${pad(c.date.getDate())}`,
  };
}

const fill = (tpl: string, v: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (_m, k: string) => v[k] ?? "");

/** "{platform}/{media_type}" → "YouTube/Videos". Empty segments are dropped, depth is capped. */
export function renderPath(template: string, ctx: TemplateCtx): string {
  const v = vars(ctx);
  return fill(template, v)
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s && !/^\.+$/.test(s)) // no empty or ./.. segments
    .slice(0, MAX_DEPTH)
    .map((s) => sanitizeSegment(s, "Other"))
    .join("/");
}

/** "{creator} - {title}" → "Chan - My Video.mp4" (extension preserved, name bounded). */
export function renderFilename(template: string, ctx: TemplateCtx): string {
  const name = sanitizeSegment(fill(template, vars(ctx)).replace(/\s+-\s*$/, "").replace(/^\s*-\s+/, ""), "download");
  const ext = ctx.ext.replace(/^\./, "").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  return `${name}.${ext}`;
}

export type Naming = { pathTemplate: string; filenameTemplate: string };
export const DEFAULT_NAMING: Naming = { pathTemplate: "{platform}/{media_type}", filenameTemplate: "{title}" };

export const PATH_PRESETS: { label: string; template: string }[] = [
  { label: "Platform / Type", template: "{platform}/{media_type}" },
  { label: "Platform / Creator", template: "{platform}/{creator}" },
  { label: "Platform / Year / Month", template: "{platform}/{year}/{month}" },
  { label: "Type only", template: "{media_type}" },
  { label: "No subfolders", template: "" },
];

export const NAME_PRESETS: { label: string; template: string }[] = [
  { label: "Title", template: "{title}" },
  { label: "Creator - Title", template: "{creator} - {title}" },
  { label: "Date - Title", template: "{date} - {title}" },
];
