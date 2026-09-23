import { create } from "zustand";

// Live per-download progress from the native engine (≤ 4 Hz). Kept out of SQLite and out of list state
// so only the progress bar re-renders; the DB gets a snapshot on state change / every few seconds.
export type Progress = { bytes: number; total: number | null; bytesPerSec?: number };

type ProgressStore = {
  byId: Record<string, Progress>;
  set: (id: string, p: Progress) => void;
  clear: (id: string) => void;
};

export const useProgressStore = create<ProgressStore>((set) => ({
  byId: {},
  set: (id, p) => set((s) => ({ byId: { ...s.byId, [id]: p } })),
  clear: (id) =>
    set((s) => {
      const { [id]: _drop, ...rest } = s.byId;
      return { byId: rest };
    }),
}));

export const useProgress = (id: string) => useProgressStore((s) => s.byId[id]);
