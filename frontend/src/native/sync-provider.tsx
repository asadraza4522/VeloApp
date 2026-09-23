import { useEffect } from "react";

import { startSync } from "@/native/sync-runtime";

// Mount once after the DB is ready.
export function SyncRuntime() {
  useEffect(() => {
    try {
      return startSync();
    } catch (e) {
      console.warn("Sync unavailable:", e instanceof Error ? e.message : e);
    }
  }, []);
  return null;
}
