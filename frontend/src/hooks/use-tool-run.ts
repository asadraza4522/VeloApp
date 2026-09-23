import { useCallback, useEffect, useRef, useState } from "react";

import { getTools } from "@/native";

const MESSAGES: Record<string, string> = {
  FORMAT_UNAVAILABLE: "This file's format can't be processed without re-encoding yet.",
  MEDIA_NOT_FOUND: "The file could not be read. It may have been moved or deleted.",
  STORAGE_FULL: "Not enough storage to save the result.",
  CANCELLED: "Cancelled.",
};

export function toolErrorMessage(e: unknown): string {
  const err = e as { code?: string; message?: string };
  return (err.code && err.message && err.code === "FORMAT_UNAVAILABLE" ? err.message : err.code && MESSAGES[err.code]) || err.message || "Something went wrong.";
}

/** Runs one native tool call with progress, cancel and a friendly error. One operation at a time. */
export function useToolRun<T>() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [out, setOut] = useState<{ key: string; value: T } | null>(null);
  const op = useRef<string | null>(null);

  useEffect(() => {
    let sub: { remove(): void } | undefined;
    try {
      sub = getTools().addListener("onToolProgress", (e) => e.opId === op.current && setProgress(e.progress));
    } catch { /* native module missing (old dev client): the tool call itself will report it */ }
    return () => sub?.remove();
  }, []);

  const run = useCallback(async (fn: (opId: string) => Promise<T>, key = "") => {
    const id = `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    op.current = id;
    setBusy(true); setError(""); setOut(null); setProgress(null);
    try {
      setOut({ key, value: await fn(id) });
    } catch (e) {
      setError(toolErrorMessage(e));
    } finally {
      setBusy(false); setProgress(null); op.current = null;
    }
  }, []);

  const cancel = useCallback(() => { if (op.current) void getTools().cancel(op.current); }, []);
  /** The result only counts for the input it was made from. */
  const resultFor = (key: string) => (out && out.key === key ? out.value : null);
  return { busy, progress, error, resultFor, run, cancel };
}
