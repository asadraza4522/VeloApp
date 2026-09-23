import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { LogBox } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { AuthSheet, SourceSheet } from "@/src/components/sheets";
import { ToastHost } from "@/src/components/ui";
import { ErrorBoundary } from "@/src/components/error-boundary";
import { setupNotifications } from "@/src/notifications";
import { queryClient } from "@/src/query-client";
import { AppStateProvider } from "@/src/state/app-state";
import { ShareIntentProvider, useShareIntent } from "@/src/share-intent";
import { useTheme } from "@/src/theme";

// Disable logbox errors etc so that users can see the app
// and agent works as expected.
LogBox.ignoreAllLogs(true)

SplashScreen.preventAutoHideAsync();

function ThemedStatusBar() {
  const { scheme } = useTheme();
  return <StatusBar style={scheme === "dark" ? "light" : "dark"} />;
}

// Picks up links shared into Velo via the native share sheet (dev/production
// builds only) and hands them to Home's resolver as a `sharedUrl` param.
function ShareIntentWatcher() {
  const { shareIntent, resetShareIntent } = useShareIntent();
  const router = useRouter();

  useEffect(() => {
    const raw = shareIntent?.webUrl || shareIntent?.text;
    if (!raw) return;
    const match = String(raw).match(/https?:\/\/[^\s]+/i);
    if (match) {
      router.push({ pathname: "/", params: { sharedUrl: match[0] } });
    }
    resetShareIntent();
  }, [shareIntent, resetShareIntent, router]);

  return null;
}

export default function RootLayout() {
  const { colors } = useTheme();
  const [fontsLoaded, fontError] = useFonts({
    "Fraunces-SemiBold": require("@/assets/fonts/Fraunces-SemiBold.ttf"),
    "Fraunces-Bold": require("@/assets/fonts/Fraunces-Bold.ttf"),
    "Satoshi-Regular": require("@/assets/fonts/Satoshi-Regular.ttf"),
    "Satoshi-Medium": require("@/assets/fonts/Satoshi-Medium.ttf"),
    "Satoshi-Bold": require("@/assets/fonts/Satoshi-Bold.ttf"),
    "Satoshi-Black": require("@/assets/fonts/Satoshi-Black.ttf"),
    MaterialDesignIcons: require("@/assets/fonts/MaterialDesignIcons.ttf"),
  });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    setupNotifications();
  }, []);

  if (!fontsLoaded && !fontError) return null;

  // One app level ErrorBoundary; a render crash shows a reload screen
  // instead of a blank app.
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <KeyboardProvider>
          <ShareIntentProvider>
            <AppStateProvider>
              <ThemedStatusBar />
              <ShareIntentWatcher />
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.surface },
                }}
              >
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="settings" />
                <Stack.Screen name="player" />
              </Stack>
              <SourceSheet />
              <AuthSheet />
              <ToastHost />
            </AppStateProvider>
          </ShareIntentProvider>
        </KeyboardProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
