import { JetBrainsMono_500Medium, JetBrainsMono_600SemiBold } from "@expo-google-fonts/jetbrains-mono";
import {
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/plus-jakarta-sans";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";

import { DbError, useDbReady } from "@/db/provider";
import { useTheme } from "@/design/theme";
import { DownloadRuntime } from "@/native/download-runtime";
import { ShareIntake } from "@/native/share-intent";
import { SyncRuntime } from "@/native/sync-provider";
import { ensureSession } from "@/services/auth";
import { queryClient } from "@/services/query-client";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { scheme, colors } = useTheme();
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    JetBrainsMono_500Medium,
    JetBrainsMono_600SemiBold,
  });

  const { success: dbReady, error: dbError } = useDbReady();
  const ready = (fontsLoaded || fontError) && (dbReady || dbError);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  // Anonymous sign-in in the background; the app works offline and without a configured backend.
  useEffect(() => {
    ensureSession().catch(() => {});
  }, []);

  if (!ready) return null;
  if (dbError) return <DbError error={dbError} />;

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <DownloadRuntime />
      <SyncRuntime />
      <ShareIntake>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }}>
          <Stack.Screen name="source/[id]" options={{ headerShown: true, title: "", headerTransparent: true }} />
          <Stack.Screen name="player/[id]" options={{ presentation: "fullScreenModal", animation: "fade" }} />
          <Stack.Screen name="sheets/format-picker" options={{ presentation: "formSheet", sheetGrabberVisible: true, sheetAllowedDetents: [0.75, 1] }} />
          <Stack.Screen name="sheets/premium" options={{ presentation: "formSheet", sheetGrabberVisible: true, sheetAllowedDetents: [0.8, 1] }} />
          <Stack.Screen name="sheets/share-intake" options={{ presentation: "formSheet", sheetGrabberVisible: true, sheetAllowedDetents: [0.65, 1] }} />
        </Stack>
      </ShareIntake>
    </QueryClientProvider>
  );
}
