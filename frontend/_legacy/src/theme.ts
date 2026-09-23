// Design tokens for Velo. The brand is dark-first, with a light alternative for
// users who prefer it. Components should read colors through useTheme/makeStyles.
//
// The keys match the "color" block of /app/design_guidelines.json. Fill the
// values from that file (or from the user's brand colors). Keep every key; do
// not add a second theme or colors file; do not write color literals in
// components.

import { useEffect, useMemo, useState } from "react";
import { Appearance, StyleSheet } from "react-native";

import { storage } from "@/src/utils/storage";

export type ColorScheme = "light" | "dark";

const light = {
  // ---------------------------------------------------------------------------
  // Surfaces: backgrounds, from the screen down to small fills.
  // Each `on` key is the text and icon color for that background.
  // ---------------------------------------------------------------------------
  surface: "#FAF6F0",
  onSurface: "#201C18",
  surfaceSecondary: "#FFFFFF",
  onSurfaceSecondary: "#3A342E",
  surfaceTertiary: "#F0EAE0",
  onSurfaceTertiary: "#6B5B3E",
  surfaceInverse: "#131110",
  onSurfaceInverse: "#F2EFEA",
  muted: "#8A8177",

  // ---------------------------------------------------------------------------
  // Brand: the identity color and the fills built from it.
  // ---------------------------------------------------------------------------
  brand: "#A87C42",
  onBrand: "#FFFFFF",
  brandPrimary: "#A87C42",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#967A4F",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#E9DDC4",
  onBrandTertiary: "#6B4F1F",

  // ---------------------------------------------------------------------------
  // Status: semantic only, never decorative.
  // ---------------------------------------------------------------------------
  success: "#4E7457",
  onSuccess: "#FFFFFF",
  warning: "#A87C42",
  onWarning: "#FFFFFF",
  error: "#964843",
  onError: "#FFFFFF",
  info: "#60747E",
  onInfo: "#FFFFFF",

  // ---------------------------------------------------------------------------
  // Lines
  // ---------------------------------------------------------------------------
  border: "#E5DED2",
  borderStrong: "#C9B99B",
  divider: "#ECE6DA",
};

export type ThemeColors = typeof light;

const dark: ThemeColors = {
  surface: "#131110",
  onSurface: "#F2EFEA",
  surfaceSecondary: "#1B1917",
  onSurfaceSecondary: "#E1DCD3",
  surfaceTertiary: "#262321",
  onSurfaceTertiary: "#D0C8BD",
  surfaceInverse: "#F2EFEA",
  onSurfaceInverse: "#131110",
  muted: "#827C76",
  brand: "#CFA360",
  onBrand: "#131110",
  brandPrimary: "#CFA360",
  onBrandPrimary: "#131110",
  brandSecondary: "#967A4F",
  onBrandSecondary: "#F2EFEA",
  brandTertiary: "#3D3120",
  onBrandTertiary: "#CFA360",
  success: "#4E7457",
  onSuccess: "#E0EFEB",
  warning: "#A87C42",
  onWarning: "#F9EEDB",
  error: "#964843",
  onError: "#F2DFDF",
  info: "#60747E",
  onInfo: "#E5F0F5",
  border: "#2D2925",
  borderStrong: "#453F3A",
  divider: "#24211E",
};

export const defaultScheme = "dark" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light, dark };

// ---------------------------------------------------------------------------
// Typography (loaded in app/_layout.tsx via expo-font), spacing and radius
// tokens — values mirror design_guidelines.json.
// ---------------------------------------------------------------------------
export const fonts = {
  display: "Fraunces-SemiBold",
  displayBold: "Fraunces-Bold",
  text: "Satoshi-Regular",
  textMedium: "Satoshi-Medium",
  textSemiBold: "Satoshi-Bold",
  textBold: "Satoshi-Black",
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { sm: 6, md: 12, lg: 20, pill: 999 } as const;

// Velo brand gradient — antique gold, identical in light and dark (brand asset).
export const brandGradient = ["#E8C884", "#CFA360", "#9A7440"] as const;

const SCHEME_KEY = "@velo_color_scheme";

let activeScheme: ColorScheme = defaultScheme;
const themeListeners = new Set<() => void>();

// In-app theme toggle. Call setColorScheme("dark"), setColorScheme("light"), or
// setColorScheme(null) to follow the device. Every useTheme() consumer re-renders.
export function setColorScheme(scheme: ColorScheme | null, persist = true) {
  // RN 0.86 re-reads the device scheme only for the literal "unspecified";
  // null would pin useColorScheme() to null and the app to light.
  activeScheme = scheme ?? defaultScheme;
  Appearance.setColorScheme?.(activeScheme);
  if (persist) storage.setItem(SCHEME_KEY, activeScheme);
  themeListeners.forEach((listener) => listener());
}

// Keep native surfaces (alerts, pickers, navigation chrome) on the schemes this
// app ships: light only forces light; once `dark` exists the device decides.
// Optional call because react-native-web does not implement it.
setColorScheme?.(themes.dark ? "dark" : defaultScheme, false);

// Re-apply the user's stored choice on launch (bootstrap above forces dark).
storage.getItem(SCHEME_KEY, defaultScheme).then((stored) => {
  if (stored !== activeScheme) setColorScheme(stored, false);
});

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const [, refresh] = useState(0);
  useEffect(() => {
    const listener = () => refresh((value) => value + 1);
    themeListeners.add(listener);
    return () => {
      themeListeners.delete(listener);
    };
  }, []);
  return { scheme: activeScheme, colors: themes[activeScheme] ?? themes.light };
}

// Themed StyleSheet: returns a hook that builds the sheet from the active
// scheme's colors and memoizes it until the scheme changes.
export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}
