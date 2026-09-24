import { useSafeAreaInsets } from "react-native-safe-area-context";

// Must match the height given to `tabBarStyle` in `(tabs)/_layout.tsx`. The tab bar floats over
// content (translucent chrome, design_guidelines.json elevation.chrome_exception) so every tab
// screen needs to pad its scrollable content by this much, or the last row/card ends up hidden
// behind the floating bar.
export const TAB_BAR_CONTENT_HEIGHT = 64;

export function useTabBarHeight(): number {
  const insets = useSafeAreaInsets();
  return TAB_BAR_CONTENT_HEIGHT + insets.bottom;
}
