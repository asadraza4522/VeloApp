// Web stub: expo-share-intent has no web implementation. Keeps the root layout
// import platform-safe; the paste + clipboard flows cover web/Expo Go.
import { ReactNode } from "react";

export function ShareIntentProvider({ children }: { children: ReactNode }) {
  return children;
}

export function useShareIntent() {
  return {
    hasShareIntent: false,
    shareIntent: null as { webUrl?: string | null; text?: string | null } | null,
    resetShareIntent: () => {},
    error: null as string | null,
  };
}
