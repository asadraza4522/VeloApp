import { Stack } from "expo-router";
import type { ReactNode } from "react";
import { ScrollView, Text } from "react-native";

import { fonts, fontSize, makeStyles, spacing, useTheme } from "@/design/theme";

export function ToolScreen({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ headerShown: true, title, headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.onSurface, headerTitleStyle: { fontFamily: fonts.textSemiBold } }} />
      {intro ? <Text style={styles.intro}>{intro}</Text> : null}
      {children}
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  body: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxxl },
  intro: { fontFamily: fonts.text, fontSize: fontSize.body, color: c.mutedSecondary },
}));
