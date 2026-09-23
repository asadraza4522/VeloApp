import { MaterialCommunityIcons } from "@expo/vector-icons";
import { memo } from "react";
import { Text, View } from "react-native";

import { fonts, fontSize, makeStyles, radius, spacing, useTheme, type ThemeColors } from "@/design/theme";
import type { StatusView, Tone } from "@/domain/status-view";

// Nivora status chip: plain ink border + a semantic *Surface fill (never a raw opacity tint) —
// design_guidelines.json components.StatusChip. Nivora has no blue "info" hue, so `info` tone maps
// to the amber brand family (closest to the mockups' "active/in-progress" chips).
function toneFill(c: ThemeColors, tone: Tone): { bg: string; fg: string } {
  switch (tone) {
    case "success": return { bg: c.successSurfaceLight, fg: c.success };
    case "warning": return { bg: c.warningSurface, fg: c.onWarningSurface };
    case "error": return { bg: c.errorSurface, fg: c.onErrorSurface };
    case "info": return { bg: c.brandTertiary, fg: c.mutedAmber };
    default: return { bg: c.surfaceSecondary, fg: c.mutedSecondary };
  }
}

export const StatusChip = memo(function StatusChip({ view }: { view: StatusView }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { bg, fg } = toneFill(colors, view.tone);
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <MaterialCommunityIcons name={view.icon as never} size={12} color={fg} />
      <Text style={[styles.label, { color: fg }]}>{view.label}</Text>
    </View>
  );
});

const useStyles = makeStyles((c) => ({
  chip: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border },
  label: { fontFamily: fonts.textMedium, fontSize: fontSize.overline, textTransform: "uppercase" },
}));
