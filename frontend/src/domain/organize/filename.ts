// Filename + path sanitizing for MediaStore (PRD §34). Everything that reaches the native engine goes through here.

const RESERVED = /[\\/:*?"<>|\u0000-\u001f]/g;
const MAX_NAME = 120;

/** Safe single path segment: no separators/reserved chars/leading dots, bounded length, never empty. */
export function sanitizeSegment(input: string, fallback = "file"): string {
  const cleaned = input
    .normalize("NFC").replace(RESERVED, " ").replace(/\s+/g, " ").trim()
    .split(" ").filter((t) => !/^\.+$/.test(t)).join(" ") // drop ".." / "." path tokens
    .replace(/^\.+/, "").replace(/[. ]+$/, "");
  return (cleaned || fallback).slice(0, MAX_NAME).trim() || fallback;
}

/** "Title" + "mp4" → "Title.mp4" with the extension preserved when truncating. */
export function buildFilename(title: string | null | undefined, ext: string): string {
  const e = ext.replace(/^\./, "").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  return `${sanitizeSegment(title ?? "", "download")}.${e}`;
}

/** Folder under Movies|Music|Pictures|Download/Velo, default layout `{platform}/{Videos|Audio|Images}` (PRD §32). */
export function defaultRelativePath(platform: string, kind: "video" | "audio" | "image" | "file"): string {
  const sub = { video: "Videos", audio: "Audio", image: "Images", file: "Files" }[kind];
  return `${sanitizeSegment(platform, "Other")}/${sub}`;
}

export const MIME: Record<string, string> = {
  mp4: "video/mp4", webm: "video/webm", mkv: "video/x-matroska", mov: "video/quicktime", m4v: "video/mp4", "3gp": "video/3gpp",
  m4a: "audio/mp4", mp3: "audio/mpeg", aac: "audio/aac", opus: "audio/ogg", ogg: "audio/ogg", oga: "audio/ogg", wav: "audio/wav", flac: "audio/flac",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif",
};

export const mimeFor = (ext: string, kind: "video" | "audio" | "image" | "file") =>
  MIME[ext.toLowerCase()] ?? (kind === "file" ? "application/octet-stream" : `${kind}/${ext.toLowerCase()}`);
