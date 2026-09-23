import { ActivityIndicator, Pressable, Text } from "react-native";

import { fonts, fontSize, makeStyles, radius, tactileShadow, useTheme } from "@/design/theme";

type Props = { label: string; onPress: () => void; variant?: "primary" | "secondary" | "ghost" | "destructive"; disabled?: boolean; loading?: boolean; grow?: boolean };

// Press feedback (design_guidelines.json motion.principles): translate by the resting shadow's
// offset and drop the shadow to none — the theme's one universal tactile interaction.
export function Button({ label, onPress, variant = "primary", disabled, loading, grow }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const shadowed = variant === "primary" || variant === "secondary";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        grow && styles.grow,
        (disabled || loading) && styles.disabled,
        shadowed && (pressed ? styles.pressed : styles.resting),
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? colors.onBrandPrimary : colors.onSurface} />
      ) : (
        <Text style={[styles.text, styles[`${variant}Text`]]}>{label}</Text>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  base: { minHeight: 44, paddingHorizontal: 20, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, borderWidth: 1.5, borderColor: c.border },
  grow: { flex: 1 },
  disabled: { opacity: 0.5 },
  resting: tactileShadow(2, c.border),
  pressed: { transform: [{ translateX: 2 }, { translateY: 2 }] },
  primary: { backgroundColor: c.brandPrimary },
  secondary: { backgroundColor: c.surfaceInset },
  ghost: { backgroundColor: "transparent", borderWidth: 0 },
  destructive: { backgroundColor: c.errorSurface, borderColor: c.errorBorder },
  text: { fontFamily: fonts.textSemiBold, fontSize: fontSize.body },
  primaryText: { color: c.onBrandPrimary },
  secondaryText: { color: c.onSurface },
  ghostText: { color: c.onSurface },
  destructiveText: { color: c.onErrorSurface },
}));
