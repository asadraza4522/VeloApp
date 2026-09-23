// Velo design tokens. Mirrors memory/design_guidelines.json (v3.1, "Nivora Daylight" — light-only,
// tactile ink/amber neo-utilitarian, corrected against the real Stitch mockups). Components read
// colors through useTheme()/makeStyles() — never write color literals in components.

import { useMemo } from "react";
import { StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

// Dark mode is explicitly deferred (design_guidelines.json > theme_mode_note): Nivora Daylight is
// a light-only palette. `dark` below is a placeholder that mirrors `light` so useColorScheme()
// never crashes the app on a dark-mode device; it is not a designed dark theme. Settings >
// Appearance should offer only "Light" until a real dark companion palette is designed.
const light = {
  surface: "#FCF9F8",
  onSurface: "#1C1B1B",
  surfaceSecondary: "#F6F3F2",
  onSurfaceSecondary: "#1C1B1B",
  surfaceTertiary: "#FFFFFF",
  onSurfaceTertiary: "#1C1B1B",
  // Inset well (URL input field, waveform canvas) — distinct from surfaceSecondary.
  surfaceInset: "#FAF8F5",
  surfaceContainerHigh: "#EBE7E7",
  surfaceInverse: "#1C1B1B",
  onSurfaceInverse: "#FFFFFF",
  brand: "#FFC800",
  onBrand: "#1C1B1B",
  brandPrimary: "#FFC800",
  onBrandPrimary: "#1C1B1B",
  brandPrimaryHover: "#EBB700",
  brandSecondary: "#1C1B1B",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#FFF7D6",
  onBrandTertiary: "#1C1B1B",
  // Muted amber for small accent-tinted labels/icons only — never a button fill (see design_guidelines.json color.notes).
  mutedAmber: "#755B00",
  accent: "#FFC800",
  onAccent: "#1C1B1B",
  // success/warning follow the mockups' actual chip families (mint = healthy/processing, orange = needs attention),
  // not a generic traffic-light green/amber.
  success: "#006D40",
  onSuccess: "#FFFFFF",
  successSurface: "#66E79F",
  successSurfaceLight: "#E6F8EE",
  successBorder: "#1C1B1B",
  warning: "#AE3200",
  onWarning: "#FFFFFF",
  warningSurface: "#FD5920",
  onWarningSurface: "#521300",
  warningBorder: "#1C1B1B",
  error: "#BA1A1A",
  onError: "#FFFFFF",
  errorSurface: "#FFDAD6",
  onErrorSurface: "#93000A",
  errorBorder: "#1C1B1B",
  info: "#1D4ED8",
  onInfo: "#FFFFFF",
  infoSurface: "#EFF6FF",
  infoBorder: "#1C1B1B",
  neutralChipSurface: "#F1F5F9",
  neutralChipBorder: "#1C1B1B",
  neutralChipText: "#0F172A",
  // Structural ink: every border and offset shadow uses this, distinct from the onSurface text tone above.
  border: "#121212",
  borderStrong: "#121212",
  borderSubtle: "#D2C5AB",
  divider: "#121212",
  muted: "#81765F",
  mutedSecondary: "#4F4632",
  scrim: "rgba(17, 19, 24, 0.35)",
};

export type ThemeColors = typeof light;

const dark: ThemeColors = light;

export const themes = { light, dark } as const;

// Deprecated: Nivora Daylight has no gradients (flat fills only, see design_guidelines.json
// color.gradients.usage). Kept as a same-color triad so screens not yet migrated (e.g. Home's
// hero LinearGradient) still compile; replace with a flat brandPrimary fill when that screen is
// reskinned, then delete this export.
export const gradients = {
  brand: [light.brandPrimary, light.brandPrimary, light.brandPrimary],
  download: [light.success, light.success],
} as const;

// Tactile offset shadows (elevation.note): no blur anywhere except header/tab-bar chrome (see
// elevation.chrome_exception), always paired with a solid ink border. React Native has no
// box-shadow, so each tier is expressed as the shadow*/elevation props a Card spreads. Press state:
// translate the element by the same offset and drop to the "none" tier (or omit shadow props).
export function tactileShadow(offsetPx: 1 | 1.5 | 2 | 2.5 | 3 | 4, color: string = light.border) {
  return {
    shadowColor: color,
    shadowOffset: { width: offsetPx, height: offsetPx },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: Math.ceil(offsetPx), // Android fallback: not identical, close enough at this offset range.
  } as const;
}

// Font family names registered in app/_layout.tsx. Plus Jakarta Sans replaces Poppins+Inter;
// JetBrains Mono replaces SpaceMono. Register via @expo-google-fonts/plus-jakarta-sans and
// @expo-google-fonts/jetbrains-mono (or local .ttf under frontend/assets/fonts).
export const fonts = {
  display: "PlusJakartaSans_800ExtraBold",
  displayBold: "PlusJakartaSans_800ExtraBold",
  headline: "PlusJakartaSans_700Bold",
  text: "PlusJakartaSans_500Medium",
  textSemiBold: "PlusJakartaSans_600SemiBold",
  overline: "PlusJakartaSans_800ExtraBold",
  mono: "JetBrainsMono_500Medium",
  monoSemiBold: "JetBrainsMono_600SemiBold",
  // Deprecated alias, same value as `text` — screens not yet reskinned still import this name.
  // Delete once every `fonts.textMedium` usage is migrated to `fonts.text`.
  textMedium: "PlusJakartaSans_500Medium",
} as const;

export const fontSize = {
  overline: 11,
  caption: 12,
  body: 14,
  bodyLg: 16,
  h3: 16,
  h2: 20,
  h1: 24,
  display: 30,
  // Deprecated aliases (old v2 scale name -> nearest v3 value) so unmigrated screens still
  // compile. Delete each alias once its last caller is moved to the named v3 token above.
  xs: 11,
  sm: 12,
  base: 14,
  lg: 16,
  xl: 24,
  xxl: 24,
  xxxl: 32,
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

// Corrected against the mockups' actual Tailwind config (borderRadius DEFAULT 4, lg 8, xl 12, full 9999).
export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  pill: 999,
  // Deprecated aliases for old names some screens still import.
  lg: 12,
  xl: 12,
} as const;

// Nivora Daylight is light-only for now; the device scheme is read but both branches resolve to
// the same tokens until a dark palette is designed (see the `dark` placeholder above).
export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const scheme: ColorScheme = useColorScheme() === "light" ? "light" : "dark";
  return { scheme, colors: themes[scheme] };
}

// Themed StyleSheet: builds the sheet from the active scheme, memoized until it changes.
export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}
