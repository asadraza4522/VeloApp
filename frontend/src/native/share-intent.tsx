import { ShareIntentProvider, useShareIntent } from "expo-share-intent";
import { useRouter } from "expo-router";
import { useEffect, type ReactNode } from "react";

// A link shared into Velo (Android ACTION_SEND) opens the Download / Save Link sheet (PRD §9).
function ShareIntentWatcher() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  const router = useRouter();

  useEffect(() => {
    if (!hasShareIntent) return;
    const url = /https?:\/\/[^\s]+/i.exec(String(shareIntent?.webUrl || shareIntent?.text || ""))?.[0];
    if (url) router.push({ pathname: "/sheets/share-intake", params: { url } });
    resetShareIntent();
  }, [hasShareIntent, shareIntent, resetShareIntent, router]);

  return null;
}

export function ShareIntake({ children }: { children: ReactNode }) {
  return (
    <ShareIntentProvider>
      <ShareIntentWatcher />
      {children}
    </ShareIntentProvider>
  );
}
