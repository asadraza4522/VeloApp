import { create } from "zustand";

import type { MediaType } from "@/db/schema";

type UiStore = {
  librarySegment: "media" | "sources";
  libraryView: "grid" | "list";
  librarySearch: string;
  libraryType: MediaType | null;
  setLibrarySegment: (v: UiStore["librarySegment"]) => void;
  setLibraryView: (v: UiStore["libraryView"]) => void;
  setLibrarySearch: (v: string) => void;
  setLibraryType: (v: MediaType | null) => void;
};

export const useUiStore = create<UiStore>((set) => ({
  librarySegment: "sources",
  libraryView: "list",
  librarySearch: "",
  libraryType: null,
  setLibrarySegment: (librarySegment) => set({ librarySegment }),
  setLibraryView: (libraryView) => set({ libraryView }),
  setLibrarySearch: (librarySearch) => set({ librarySearch }),
  setLibraryType: (libraryType) => set({ libraryType }),
}));
