import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";

import { Button } from "@/components/button";
import { ToolScreen } from "@/components/tool-screen";
import { fonts, fontSize, makeStyles, radius, spacing, tactileShadow, useTheme } from "@/design/theme";
import { largest, olderThan, totalBytes, usageByPlatform, type StoredFile } from "@/domain/tools/storage";
import { deleteFile, loadLiveFiles } from "@/screens/tools/library-helpers";
import { formatBytes } from "@/utils/format";

export function StorageScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const [files, setFiles] = useState<(StoredFile & { downloadId: string })[] | null>(null);
  const [message, setMessage] = useState("");

  const load = async () => {
    const live = await loadLiveFiles();
    setFiles(live.map((f) => ({ id: f.downloadId, downloadId: f.downloadId, uri: f.uri, platform: f.platform, kind: f.mediaType, size: f.realSize, createdAt: f.createdAt, title: f.title ?? f.name })));
  };
  // async loader: setState happens after the awaits, not synchronously in the effect body
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load().catch(() => setFiles([])); }, []);

  const usage = useMemo(() => (files ? usageByPlatform(files) : []), [files]);

  const confirmDelete = (label: string, list: (StoredFile & { downloadId: string })[]) => {
    if (!list.length) return;
    Alert.alert(`Delete ${label}?`, `${list.length} files · frees ${formatBytes(totalBytes(list))}. The sources stay in your Library and can be downloaded again.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        let n = 0;
        for (const f of list) if (await deleteFile(f)) n++;
        setMessage(`Deleted ${n} files.`);
        await load();
      } },
    ]);
  };

  return (
    <ToolScreen title="Storage" intro="See how much space your downloads use and free it without losing your sources.">
      {files === null ? <Text style={styles.meta}>Checking your files…</Text> : (
        <>
          <Text style={styles.total}>{formatBytes(totalBytes(files))}</Text>
          <Text style={styles.meta}>{files.length} downloaded files on this device</Text>
          <Button label="Delete files older than 30 days" icon="trash-can-outline" variant="destructive" onPress={() => confirmDelete("files older than 30 days", olderThan(files, 30))} disabled={!olderThan(files, 30).length} />

          <Text style={styles.section}>By platform</Text>
          {usage.map((u) => (
            <View key={u.platform} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{u.platform}</Text>
                <Text style={styles.meta}>{u.count} files · {formatBytes(u.bytes)}</Text>
              </View>
              <Pressable style={styles.small} onPress={() => confirmDelete(`all ${u.platform} files`, files.filter((f) => f.platform === u.platform))}>
                <MaterialCommunityIcons name="trash-can-outline" size={14} color={colors.onErrorSurface} />
                <Text style={styles.smallText}>Delete</Text>
              </Pressable>
            </View>
          ))}

          <Text style={styles.section}>Largest files</Text>
          {largest(files, 10).map((f) => (
            <View key={f.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1}>{f.title}</Text>
                <Text style={styles.meta}>{f.platform} · {formatBytes(f.size)}</Text>
              </View>
              <Pressable style={styles.small} onPress={() => confirmDelete(`“${f.title}”`, [f])}>
                <MaterialCommunityIcons name="trash-can-outline" size={14} color={colors.onErrorSurface} />
                <Text style={styles.smallText}>Delete</Text>
              </Pressable>
            </View>
          ))}
        </>
      )}
      {message !== "" && <Text style={styles.ok}>{message}</Text>}
    </ToolScreen>
  );
}

const useStyles = makeStyles((c) => ({
  total: { fontFamily: fonts.display, fontSize: fontSize.display, color: c.onSurface },
  meta: { fontFamily: fonts.text, fontSize: fontSize.caption, color: c.mutedSecondary },
  ok: { fontFamily: fonts.textMedium, fontSize: fontSize.body, color: c.success },
  section: { marginTop: spacing.md, fontFamily: fonts.overline, fontSize: fontSize.overline, color: c.mutedSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.sm, backgroundColor: c.surfaceTertiary, borderWidth: 1.5, borderColor: c.border, ...tactileShadow(2, c.border) },
  title: { fontFamily: fonts.textSemiBold, fontSize: fontSize.body, color: c.onSurface },
  small: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: c.errorSurface, borderWidth: 1.5, borderColor: c.errorBorder },
  smallText: { fontFamily: fonts.textMedium, fontSize: fontSize.caption, color: c.onErrorSurface },
}));
