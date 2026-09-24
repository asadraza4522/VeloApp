import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, type StyleProp, type ViewStyle } from "react-native";

import { makeStyles, radius, tactileShadow, useTheme } from "@/design/theme";

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

// Design rule (design_guidelines.json components.IconButton): ANY icon control placed over a
// thumbnail, hero image, video frame, or other unpredictable content MUST use this — never a bare
// tinted icon straight on top of the content. A tinted icon's contrast depends on what's under it
// (a dark photo region, a bright sky, etc.) and WILL be invisible sometimes; an opaque tactile
// circle guarantees contrast regardless of what image is behind it. This is what fixed the
// Source Details back button disappearing over a dark hero photo, and is now the only approved
// pattern for that situation (see the Player screen's Close/side/play controls, which already did
// this before the rule was written down).
export function IconButton({ icon, onPress, label, size = 44, iconSize = 22, style }: { icon: IconName; onPress: () => void; label: string; size?: number; iconSize?: number; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.base, { width: size, height: size, borderRadius: size / 2 }, pressed ? styles.pressed : styles.resting, style]}
    >
      <MaterialCommunityIcons name={icon} size={iconSize} color={colors.onSurface} />
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  base: { alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceTertiary, borderWidth: 1.5, borderColor: c.border, borderRadius: radius.pill },
  resting: tactileShadow(2, c.border),
  pressed: { transform: [{ translateX: 2 }, { translateY: 2 }] },
}));
