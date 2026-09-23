import { MaterialCommunityIcons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { fonts, fontSize, radius, tactileShadow, useTheme } from "@/design/theme";

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: "index", title: "Home", icon: "home-variant" },
  { name: "library", title: "Library", icon: "folder-multiple" },
  { name: "downloads", title: "Downloads", icon: "download" },
  { name: "tools", title: "Tools", icon: "swap-horizontal-bold" },
  { name: "settings", title: "Settings", icon: "cog" },
];

// Nivora Daylight tab bar: translucent blur chrome (the one place this theme allows blur — see
// design_guidelines.json elevation.chrome_exception), active tab gets a filled brandPrimary pill.
export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.onBrandTertiary,
        tabBarInactiveTintColor: colors.mutedSecondary,
        tabBarStyle: { position: "absolute", borderTopWidth: 0, elevation: 0, backgroundColor: "transparent" },
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
            tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name={icon} size={size} color={color} />,
            tabBarButton: ({ onPress, onLongPress, accessibilityState, accessibilityLabel, testID, children }) => {
              const focused = accessibilityState?.selected ?? false;
              return (
                <Pressable
                  onPress={onPress}
                  onLongPress={onLongPress}
                  accessibilityState={accessibilityState}
                  accessibilityRole="button"
                  accessibilityLabel={accessibilityLabel}
                  testID={testID}
                  style={[styles.button, focused && { backgroundColor: colors.brandPrimary, borderColor: colors.border, ...tactileShadow(1.5, colors.border) }]}
                >
                  {children}
                </Pressable>
              );
            },
            tabBarLabel: ({ color, focused }) => (
              <Text style={[styles.label, { color }, focused && styles.labelActive]}>{title}</Text>
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  button: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2, marginHorizontal: 4, marginVertical: 6, borderRadius: radius.pill, borderWidth: 1.5, borderColor: "transparent" },
  buttonActive: {},
  label: { fontFamily: fonts.textMedium, fontSize: fontSize.overline, marginTop: 2 },
  labelActive: { fontFamily: fonts.textSemiBold },
});
