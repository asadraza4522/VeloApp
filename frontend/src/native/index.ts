// Single access point to the Kotlin modules. Loaded lazily so Jest/Node (no native runtime) can import
// everything else; domain code depends on the `Engine`/`MediaStoreApi` shapes, never on this file.
import type { DownloadEngineApi, MediaStoreApi, MediaToolsApi } from "@/native/types";

export function getEngine(): DownloadEngineApi {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@velo/native").DownloadEngine;
}

export function getMediaStore(): MediaStoreApi {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@velo/native").MediaStore;
}

export function getTools(): MediaToolsApi {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@velo/native").MediaTools;
}
