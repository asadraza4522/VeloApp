// App-level wiring between the native engine and JS state. One instance of everything, created on first use.
import { getEngine, getMediaStore } from "@/native";
import type { Deps } from "@/domain/downloads/controller";
import { db } from "@/db/client";
import { flushProgress } from "@/db/queries/downloads";
import { applyEngineEvent, reconcile } from "@/domain/downloads/controller";
import { scanMissingFiles } from "@/domain/library/missing-files";
import { invokeResolveFunction, resolveUrl } from "@/domain/resolve/client";
import { useProgressStore } from "@/stores/progress-store";

let deps: Deps | null = null;

export const getMedia = getMediaStore;

export function getDeps(): Deps {
  return (deps ??= {
    db,
    engine: getEngine(),
    // After a 403/410 the direct URL is dead: resolve the page again and let the controller re-select the same format.
    reResolve: async (url) => {
      const r = await resolveUrl(url, invokeResolveFunction);
      return r.ok ? r.result.variants : null;
    },
  });
}

const DB_FLUSH_MS = 5000;

/** Subscribes to engine events for the app's lifetime. Returns an unsubscribe function. */
export function startDownloadRuntime(): () => void {
  const d = getDeps();
  const media = getMediaStore();
  const progress = useProgressStore.getState();
  const lastFlush = new Map<string, number>();

  void d.engine.setConstraints({ wifiOnly: true, maxConcurrent: 3 }); // user settings replace these in the Settings phase
  const sync = () => reconcile(d).then(() => scanMissingFiles(d.db, media)).catch(() => {});
  void sync();

  const subs = [
    d.engine.addListener("onProgress", (e) => {
      progress.set(e.taskId, { bytes: e.bytes, total: e.total ?? null, bytesPerSec: e.bytesPerSec });
      const now = Date.now();
      if (now - (lastFlush.get(e.taskId) ?? 0) >= DB_FLUSH_MS) {
        lastFlush.set(e.taskId, now);
        flushProgress(d.db, e.taskId, e.bytes, e.total);
      }
    }),
    d.engine.addListener("onStateChange", (e) => {
      const live = useProgressStore.getState().byId[e.taskId];
      if (live) flushProgress(d.db, e.taskId, live.bytes, live.total); // exact snapshot at every state change
      if (e.state === "COMPLETED" || e.state === "FAILED" || e.state === "CANCELED") {
        progress.clear(e.taskId);
        lastFlush.delete(e.taskId);
      }
      void applyEngineEvent(d, { kind: "state", taskId: e.taskId, state: e.state, errorCode: e.errorCode });
    }),
    d.engine.addListener("onComplete", (e) => {
      progress.clear(e.taskId);
      void applyEngineEvent(d, { kind: "complete", taskId: e.taskId, uri: e.uri, filename: e.filename });
    }),
    media.addListener("onMediaChanged", () => void scanMissingFiles(d.db, media).catch(() => {})),
  ];
  return () => subs.forEach((s) => s.remove());
}

