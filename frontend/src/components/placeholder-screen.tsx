import { Text, View } from "react-native";

import { fonts, fontSize, makeStyles, spacing } from "@/design/theme";

export function PlaceholderScreen({ title, note }: { title: string; note: string }) {
  const styles = useStyles();
  return (
    <View style={styles.root}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.note}>{note}</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, backgroundColor: c.surface },
  title: { fontFamily: fonts.displayBold, fontSize: fontSize.xxl, color: c.onSurface },
  note: { marginTop: spacing.sm, fontFamily: fonts.text, fontSize: fontSize.base, color: c.muted, textAlign: "center" },
}));
