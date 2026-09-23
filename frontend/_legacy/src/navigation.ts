import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// iOS 26+ gets the native Liquid Glass tab bar; older iOS, Android and web use
// the JS Tabs bar. Imported by the tabs layout and every tab screen so bottom
// padding math stays consistent.
export const usesNativeTabs =
  Platform.OS === "ios" && parseInt(String(Platform.Version), 10) >= 26;

// Bottom padding so content clears the tab bar. The JS glass tab bar floats
// (position: absolute), so content must pad by its full height; NativeTabs
// already include the bar in the bottom inset. (BottomTabBarHeightContext is
// unavailable — expo-router SDK 56+ blocks react-navigation imports.)
export function useBottomChrome(): number {
  const insets = useSafeAreaInsets();
  if (usesNativeTabs) return insets.bottom;
  return (Platform.OS === "web" ? 64 : 49 + insets.bottom) + 8;
}
