// Shared by the library tools: read the on-device state of every downloaded file once.
import { db } from "@/db/client";
import { listLibraryFiles, markFileMissing, type LibraryFile } from "@/db/queries/downloads";
import { getMediaStore, getTools } from "@/native";

export type LiveFile = LibraryFile & { uri: string; realSize: number; path: string; name: string };

/** Library files that still exist, with real size/folder/name from MediaStore (files that vanished are flagged missing). */
export async function loadLiveFiles(): Promise<LiveFile[]> {
  const rows = listLibraryFiles(db).filter((r): r is LibraryFile & { uri: string } => !!r.uri);
  const info = await getTools().describeMany(rows.map((r) => r.uri));
  const out: LiveFile[] = [];
  rows.forEach((r, i) => {
    const d = info[i];
    if (!d) { markFileMissing(db, r.downloadId); return; } // deleted outside Velo (PRD §14)
    out.push({ ...r, realSize: d.size, path: d.relativePath, name: d.name });
  });
  return out;
}

/** Delete the file (never the source) and flag the download so the UI offers Redownload. */
export async function deleteFile(f: { uri: string; downloadId: string }): Promise<boolean> {
  const ok = await getMediaStore().delete(f.uri);
  if (ok) markFileMissing(db, f.downloadId);
  return ok;
}

export const kindOf = (mediaType: string): "video" | "audio" | "image" | "file" =>
  mediaType === "audio" ? "audio" : mediaType === "image" ? "image" : mediaType === "file" ? "file" : "video";
