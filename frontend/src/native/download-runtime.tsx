import { useEffect } from "react";
import { AppState, Platform } from "react-native";

import { startDownloadRuntime } from "@/native/runtime";

// Mount once after the DB is ready. Android only; a missing native module (e.g. a dev client built
// before Phase 3) degrades to "no downloads" instead of crashing the app.
export function DownloadRuntime() {
  useEffect(() => {
    if (Platform.OS !== "android") return;
    let stop: (() => void) | undefined;
    const boot = () => {
      try {
        stop?.();
        stop = startDownloadRuntime();
      } catch (e) {
        console.warn("Download engine unavailable:", e instanceof Error ? e.message : e);
      }
    };
    boot();
    const sub = AppState.addEventListener("change", (s) => s === "active" && boot()); // reconcile when returning to the app
    return () => {
      sub.remove();
      stop?.();
    };
  }, []);
  return null;
}
