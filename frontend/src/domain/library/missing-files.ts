import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { markFileMissing } from "@/db/queries/downloads";
import { downloads } from "@/db/schema";
import type { Db } from "@/db/types";

/** PRD §14: flag downloads whose file was deleted outside Velo. Only ever touches the download row, never the source. */
export async function scanMissingFiles(db: Db, media: { existsMany(uris: string[]): Promise<boolean[]> }): Promise<number> {
  const rows = db.select({ id: downloads.id, uri: downloads.localUri }).from(downloads)
    .where(and(eq(downloads.status, "COMPLETED"), isNotNull(downloads.localUri), isNull(downloads.fileDeletedAt), isNull(downloads.deletedAt))).all();
  if (!rows.length) return 0;

  let flagged = 0;
  for (let i = 0; i < rows.length; i += 200) { // batch the native call
    const chunk = rows.slice(i, i + 200);
    const present = await media.existsMany(chunk.map((r) => r.uri!));
    chunk.forEach((r, j) => {
      if (!present[j]) {
        markFileMissing(db, r.id);
        flagged++;
      }
    });
  }
  return flagged;
}
