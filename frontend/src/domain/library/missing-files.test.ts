import { eq } from "drizzle-orm";

import { createDownload, dispatch, setLocalFile } from "@/db/queries/downloads";
import { createSource } from "@/db/queries/sources";
import { downloads, mediaSources } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import { scanMissingFiles } from "@/domain/library/missing-files";

it("flags only downloads whose file is gone and never touches the source", async () => {
  const db = createTestDb();
  const { source } = createSource(db, { url: "https://example.com/a" });
  const make = (uri: string) => {
    const d = createDownload(db, { sourceId: source.id });
    for (const e of [{ type: "START" }, { type: "VALID" }, { type: "DETECTED" }, { type: "RESOLVED" }, { type: "AUTO_SELECT" }, { type: "ENGINE_START" }] as const) dispatch(db, d.id, e);
    dispatch(db, d.id, { type: "DOWNLOAD_DONE", needsProcessing: false });
    dispatch(db, d.id, { type: "ORGANIZED" });
    setLocalFile(db, d.id, uri);
    return d.id;
  };
  const kept = make("content://media/1");
  const gone = make("content://media/2");

  const media = { existsMany: async (uris: string[]) => uris.map((u) => u.endsWith("/1")) };
  expect(await scanMissingFiles(db, media)).toBe(1);
  expect(db.select().from(downloads).where(eq(downloads.id, gone)).get()!.fileDeletedAt).not.toBeNull();
  expect(db.select().from(downloads).where(eq(downloads.id, kept)).get()!.fileDeletedAt).toBeNull();
  expect(db.select().from(mediaSources).where(eq(mediaSources.id, source.id)).get()!.deletedAt).toBeNull();
  expect(await scanMissingFiles(db, media)).toBe(0); // already flagged rows are skipped
});
