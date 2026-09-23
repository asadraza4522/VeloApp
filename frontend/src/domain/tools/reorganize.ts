// Re-apply the naming templates to files that are already downloaded (Tools → Re-organize). Pure planner.
import { renderFilename, renderPath, type MediaKind, type Naming } from "@/domain/organize/template";

export type LibraryItem = {
  downloadId: string;
  uri: string;
  kind: MediaKind;
  platform: string;
  creator: string | null;
  title: string | null;
  resolution: string | null;
  ext: string;
  createdAt: number;
  currentPath: string;   // "Movies/Velo/YouTube/Videos/" as reported by MediaStore
  currentName: string;
};

export type Move = { downloadId: string; uri: string; kind: MediaKind; toPath: string; toName: string; fromPath: string; fromName: string };

const ROOTS = ["Movies", "Music", "Pictures", "Download"];

/** "Movies/Velo/YouTube/Videos/" → "YouTube/Videos"; null when the file is not under our Velo folder (never touch those). */
export function pathUnderVelo(rel: string): string | null {
  const parts = rel.split("/").filter(Boolean);
  if (parts.length < 2 || !ROOTS.includes(parts[0]) || parts[1] !== "Velo") return null;
  return parts.slice(2).join("/");
}

export function planReorganize(items: LibraryItem[], naming: Naming): Move[] {
  const moves: Move[] = [];
  const taken = new Map<string, number>(); // final "path/name" → uses, to keep targets unique inside this plan
  for (const it of [...items].sort((a, b) => a.createdAt - b.createdAt)) {
    const current = pathUnderVelo(it.currentPath);
    if (current === null) continue;

    const ctx = { platform: it.platform, kind: it.kind, creator: it.creator, title: it.title, resolution: it.resolution, ext: it.ext, date: new Date(it.createdAt) };
    const toPath = renderPath(naming.pathTemplate, ctx);
    let toName = renderFilename(naming.filenameTemplate, ctx);

    const key = `${it.kind}|${toPath}|${toName}`.toLowerCase();
    const n = (taken.get(key) ?? 0) + 1;
    taken.set(key, n);
    if (n > 1) toName = toName.replace(/(\.[^.]+)?$/, ` (${n})$1`); // two files, same target name

    if (toPath === current && toName === it.currentName) continue; // already where it should be
    moves.push({ downloadId: it.downloadId, uri: it.uri, kind: it.kind, toPath, toName, fromPath: current, fromName: it.currentName });
  }
  return moves;
}
