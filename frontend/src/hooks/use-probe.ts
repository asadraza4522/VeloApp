import { useEffect, useState } from "react";

import { getTools } from "@/native";
import type { MediaProbe } from "@velo/native";

/** Probe a picked file. Keyed by uri, so switching files never shows the previous file's details. */
export function useProbe(uri: string | null): MediaProbe | null {
  const [state, setState] = useState<{ uri: string; probe: MediaProbe | null } | null>(null);
  useEffect(() => {
    if (!uri) return;
    let live = true;
    getTools().probe(uri).then((probe) => live && setState({ uri, probe })).catch(() => live && setState({ uri, probe: null }));
    return () => { live = false; };
  }, [uri]);
  return state && state.uri === uri ? state.probe : null;
}
