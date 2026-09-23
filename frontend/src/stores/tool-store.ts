import { create } from "zustand";

export type PickedFile = {
  uri: string;
  name: string;
  kind: "video" | "audio" | "image" | "other";
  size: number | null;
  origin: "library" | "device";
};

// The library picker is its own screen; it hands its choice back through this store.
type ToolStore = { picked: PickedFile | null; setPicked: (f: PickedFile | null) => void };
export const useToolStore = create<ToolStore>((set) => ({ picked: null, setPicked: (picked) => set({ picked }) }));

export const kindOfMime = (mime: string | null | undefined): PickedFile["kind"] =>
  mime?.startsWith("video/") ? "video" : mime?.startsWith("audio/") ? "audio" : mime?.startsWith("image/") ? "image" : "other";
