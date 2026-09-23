// Dev-only bulk data for perf checks (Settings → Developer). Skips the outbox on purpose (dirty = false).
import { downloads, mediaSources, sourceUrls, type DownloadStatus, type MediaType } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidv7 } from "@/utils/uuid";

const PLATFORMS = ["YouTube", "Instagram", "TikTok", "Facebook", "X", "Reddit", "Vimeo", "SoundCloud"];
const TYPES: MediaType[] = ["video", "video", "video", "audio", "image"];
const WORDS = ["Sunset", "Guide", "Beats", "Tutorial", "Highlights", "Mix", "Review", "Studio", "Road", "Trip", "Deep", "Focus", "Live", "Session", "Cinema"];
const STATUSES: DownloadStatus[] = ["COMPLETED", "COMPLETED", "COMPLETED", "DOWNLOADING", "QUEUED", "PAUSED", "FAILED"];
const CHUNK = 100; // SQLite variable limit: rows × columns must stay under 32766

export function seedSources(db: Db, count: number, now = Date.now()) {
  db.transaction((tx) => {
    for (let start = 0; start < count; start += CHUNK) {
      const n = Math.min(CHUNK, count - start);
      const src: (typeof mediaSources.$inferInsert)[] = [];
      const urls: (typeof sourceUrls.$inferInsert)[] = [];
      const dls: (typeof downloads.$inferInsert)[] = [];
      for (let i = 0; i < n; i++) {
        const k = start + i;
        const t = now - k * 60_000;
        const id = uuidv7(t);
        const platform = PLATFORMS[k % PLATFORMS.length];
        const url = `https://example.com/${platform.toLowerCase()}/${k}`;
        src.push({
          id, originalUrl: url, canonicalUrl: url, platform,
          title: `${WORDS[k % WORDS.length]} ${WORDS[(k * 7) % WORDS.length]} #${k}`,
          creatorName: `Creator ${k % 97}`,
          mediaType: TYPES[k % TYPES.length], durationMs: 60_000 + (k % 600) * 1000,
          status: "resolved", resolveState: "done", firstSeenAt: t, createdAt: t, updatedAt: t, dirty: false,
        });
        urls.push({ id: uuidv7(t), sourceId: id, url, kind: "original", seenAt: t, createdAt: t, updatedAt: t, dirty: false });
        if (k % 5 !== 0) {
          const status = STATUSES[k % STATUSES.length];
          dls.push({
            id: uuidv7(t), sourceId: id, status, resolution: "1080p", container: "mp4",
            totalBytes: 50_000_000, progressBytes: status === "COMPLETED" ? 50_000_000 : (k % 10) * 5_000_000,
            createdAt: t, updatedAt: t, dirty: false,
          });
        }
      }
      tx.insert(mediaSources).values(src).run();
      tx.insert(sourceUrls).values(urls).run();
      if (dls.length) tx.insert(downloads).values(dls).run();
    }
  });
}
