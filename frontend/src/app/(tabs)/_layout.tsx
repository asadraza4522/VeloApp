import { MaterialCommunityIcons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { radius, useTheme } from "@/design/theme";
import { TAB_BAR_CONTENT_HEIGHT } from "@/hooks/use-tab-bar-height";

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: "index", title: "Home", icon: "home-variant" },
  { name: "library", title: "Library", icon: "folder-multiple" },
  { name: "downloads", title: "Downloads", icon: "download" },
  { name: "tools", title: "Tools", icon: "swap-horizontal-bold" },
  { name: "settings", title: "Settings", icon: "cog" },
];

// Nivora Daylight tab bar: translucent blur chrome (the one place this theme allows blur — see
// design_guidelines.json elevation.chrome_exception), active tab gets a gold badge behind its icon.
//
// This is the THIRD approach for the active-tab indicator, kept as one because the first two
// turned out unreliable in this expo-router bottom-tabs fork rather than in our own code:
//   1. A custom tabBarButton reading accessibilityState.selected — never fired (active tab stayed
//      black/unstyled).
//   2. React Navigation's own tabBarActiveBackgroundColor/tabBarItemStyle — the documented,
//      "should just work" option — silently did nothing either (no fill appeared).
// What IS proven reliable: tabBarIcon's own `focused` argument (icon/label tinting via
// tabBarActiveTintColor already renders correctly). So the active indicator is now painted
// entirely inside our own tabBarIcon render — plain React, no library prop-forwarding involved.
//
// The bar floats over content (position: absolute) so it needs an EXPLICIT height — screens pad
// their bottom content by useTabBarHeight() so it never covers the last row/card.
export default function TabsLayout() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const barHeight = TAB_BAR_CONTENT_HEIGHT + insets.bottom;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.onSurface,
        tabBarInactiveTintColor: colors.mutedSecondary,
        tabBarStyle: { position: "absolute", height: barHeight, paddingBottom: insets.bottom, borderTopWidth: 0, elevation: 0, backgroundColor: "transparent" },
        tabBarBackground: () => (
          <>
            <BlurView tint="light" intensity={80} style={StyleSheet.absoluteFill} />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: `${colors.surface}E6` }]} />
          </>
        ),
      }}
    >
      {TABS.map(({ name, title, icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarIcon: ({ color, size, focused }) =>
              focused ? (
                <View style={[styles.badge, { backgroundColor: colors.brandPrimary, borderColor: colors.border }]}>
                  <MaterialCommunityIcons name={icon} size={size - 2} color={color} />
                </View>
              ) : (
                <MaterialCommunityIcons name={icon} size={size} color={color} />
              ),
          }}
        />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  badge: { width: 40, height: 28, borderRadius: radius.pill, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
});
