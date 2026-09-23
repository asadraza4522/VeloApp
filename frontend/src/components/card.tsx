import type { ReactNode } from "react";
import { View, type ViewStyle } from "react-native";

import { makeStyles, radius, tactileShadow } from "@/design/theme";

// Nivora Daylight tactile card: opaque fill, solid ink border, hard offset shadow. Replaces the
// retired GlassCard (v2). No blur here — blur is chrome-only (Header/TabBar), see
// memory/design_guidelines.json elevation.chrome_exception.
export function Card({ children, style, inset = false }: { children: ReactNode; style?: ViewStyle; inset?: boolean }) {
  const styles = useStyles();
  return <View style={[inset ? styles.cardInset : styles.card, style]}>{children}</View>;
}

const useStyles = makeStyles((c) => ({
  card: { borderRadius: radius.sm, padding: 16, gap: 12, backgroundColor: c.surfaceTertiary, borderWidth: 1.5, borderColor: c.border, ...tactileShadow(2, c.border) },
  cardInset: { borderRadius: radius.sm, padding: 16, gap: 12, backgroundColor: c.surfaceInset, borderWidth: 1.5, borderColor: c.border, ...tactileShadow(2, c.border) },
}));
