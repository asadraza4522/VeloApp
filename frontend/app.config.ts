import type { ExpoConfig } from "expo/config";

// Velo ships as two variants from one codebase (docs/VELO_TECHNICAL_PLAN.md §7.5):
//   full — all popular platforms, alternative stores / direct link (default)
//   lite — Google Play version: no third-party-platform downloaders
// Set EXPO_PUBLIC_DISTRIBUTION=lite|full at build time (see eas.json profiles).
const lite = process.env.EXPO_PUBLIC_DISTRIBUTION === "lite";

const config: ExpoConfig = {
  name: lite ? "Velo" : "Velo Full",
  slug: "velo",
  scheme: "velo",
  version: "0.1.0",
  orientation: "portrait",
  platforms: ["android", "ios"],
  userInterfaceStyle: "automatic",
  icon: "./assets/images/icon.png",
  experiments: { typedRoutes: true, reactCompiler: true },
  ios: {
    bundleIdentifier: "com.velo.app",
    supportsTablet: false,
  },
  android: {
    package: lite ? "com.velo.app" : "com.velo.app.full",
    adaptiveIcon: {
      foregroundImage: "./assets/images/adaptive-icon.png",
      backgroundColor: "#081A3D",
    },
  },
  plugins: [
    "expo-router",
    "expo-font",
    "expo-image",
    "expo-secure-store",
    "expo-video",
    ["expo-audio", { microphonePermission: false, enableBackgroundPlayback: true }],
    "expo-dev-client",
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-image.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#0A1020",
      },
    ],
    // Plain-HTTP is only enabled when a dev LAN worker is configured (never in release builds).
    ["expo-build-properties", { android: { minSdkVersion: 29, usesCleartextTraffic: Boolean(process.env.EXPO_PUBLIC_DEV_WORKER_URL) } }],
    // AdMob app id: Google's sample id unless EXPO_PUBLIC_ADMOB_ANDROID_APP_ID is set (required for a real release build).
    ["react-native-google-mobile-ads", { androidAppId: process.env.EXPO_PUBLIC_ADMOB_ANDROID_APP_ID ?? "ca-app-pub-3940256099942544~3347511713", iosAppId: "ca-app-pub-3940256099942544~1458002511" }],
    [
      "expo-share-intent",
      {
        iosActivationRules: {
          NSExtensionActivationSupportsWebURLWithMaxCount: 1,
          NSExtensionActivationSupportsWebPageWithMaxCount: 1,
          NSExtensionActivationSupportsText: true,
        },
        androidIntentFilters: ["text/*"],
      },
    ],
  ],
  extra: { distribution: lite ? "lite" : "full" },
};

export default config;
