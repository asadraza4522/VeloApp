import { Text, View } from "react-native";

import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { fonts, fontSize, makeStyles, spacing } from "@/design/theme";
import { getMediaStore } from "@/native";
import { formatBytes } from "@/utils/format";

export function ToolResult({ uri, mime, title, lines, size }: { uri: string; mime: string; title: string; lines?: string[]; size: number }) {
  const styles = useStyles();
  const media = getMediaStore();
  return (
    <Card style={styles.success}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.meta}>{[formatBytes(size), ...(lines ?? [])].join(" · ")}</Text>
      <Text style={styles.meta}>Saved in your Velo folder (Files app → Velo → Tools).</Text>
      <View style={styles.row}>
        <Button label="Open" variant="secondary" grow onPress={() => void media.openInFiles(uri, mime).catch(() => {})} />
        <Button label="Share" variant="secondary" grow onPress={() => void media.shareFile(uri, mime).catch(() => {})} />
      </View>
    </Card>
  );
}

export function ProgressLine({ busy, progress, onCancel }: { busy: boolean; progress: number | null; onCancel: () => void }) {
  const styles = useStyles();
  if (!busy) return null;
  return (
    <Card>
      <Text style={styles.meta}>{progress != null ? `Working… ${Math.round(progress * 100)}%` : "Working…"}</Text>
      <Button label="Cancel" variant="ghost" onPress={onCancel} />
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  success: { borderColor: c.success },
  title: { fontFamily: fonts.textSemiBold, fontSize: fontSize.bodyLg, color: c.onSurface },
  meta: { fontFamily: fonts.text, fontSize: fontSize.caption, color: c.mutedSecondary },
  row: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm },
}));
