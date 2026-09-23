import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Alert, Linking, Pressable, ScrollView, Share, Text, View } from "react-native";

import { Button } from "@/components/button";
import { StatusChip } from "@/components/status-chip";
import { db } from "@/db/client";
import { useSource, useSourceDownloads } from "@/db/hooks";
import type { Download } from "@/db/queries/downloads";
import { deleteSource, setFavorite } from "@/db/queries/sources";
import { fonts, fontSize, makeStyles, radius, spacing, tactileShadow, useTheme } from "@/design/theme";
import { cancelDownload, pauseDownload, resumeDownload, retryDownload } from "@/domain/downloads/controller";
import { downloadStatusView, sourceStatusView, type StatusView } from "@/domain/status-view";
import { getDeps, getMedia } from "@/native/runtime";
import { formatBytes, formatDuration } from "@/utils/format";

const MISSING: StatusView = { label: "File missing", tone: "warning", icon: "file-alert-outline" };
const date = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

function HistoryRow({ d, onRedownload }: { d: Download; onRedownload: () => void }) {
  const styles = useStyles();
  const router = useRouter();
  const missing = d.status === "COMPLETED" && d.fileDeletedAt != null;
  const view = missing ? MISSING : downloadStatusView(d.status);
  const label = [d.resolution, d.container?.toUpperCase()].filter(Boolean).join(" ") || "Download";
  const run = (fn: () => Promise<void>) => () => void fn().catch(() => {});

  const actions: { label: string; onPress: () => void }[] = [];
  if (d.status === "COMPLETED" && !missing && d.localUri) {
    const uri = d.localUri;
    const mime = d.filename?.endsWith(".m4a") ? "audio/mp4" : "video/*";
    actions.push(
      { label: "Play", onPress: () => router.push({ pathname: "/player/[id]", params: { id: d.id } }) },
      { label: "Open with…", onPress: run(() => getMedia().openInFiles(uri, mime)) },
      { label: "Share file", onPress: run(() => getMedia().shareFile(uri, mime)) },
    );
  }
  if (missing) actions.push({ label: "Redownload", onPress: onRedownload });
  if (d.status === "DOWNLOADING" || d.status === "QUEUED" || d.status === "RETRYING") actions.push({ label: "Pause", onPress: run(() => pauseDownload(getDeps(), d.id)) }, { label: "Cancel", onPress: run(() => cancelDownload(getDeps(), d.id)) });
  if (d.status === "PAUSED") actions.push({ label: "Resume", onPress: run(() => resumeDownload(getDeps(), d.id)) }, { label: "Cancel", onPress: run(() => cancelDownload(getDeps(), d.id)) });
  if (["FAILED", "CANCELED", "AUTH_REQUIRED", "SOURCE_UNAVAILABLE"].includes(d.status)) actions.push({ label: "Retry", onPress: run(() => retryDownload(getDeps(), d.id)) });

  return (
    <View style={styles.history}>
      <View style={styles.historyTop}>
        <Text style={styles.historyLabel}>{label}</Text>
        <Text style={styles.meta}>{[formatBytes(d.totalBytes), date(d.completedAt ?? d.createdAt)].filter((s) => s && s !== "—").join(" · ")}</Text>
      </View>
      <StatusChip view={view} />
      {actions.length > 0 && (
        <View style={styles.actionsRow}>
          {actions.map((a) => (
            <Pressable key={a.label} onPress={a.onPress} style={({ pressed }) => [styles.smallBtn, pressed && styles.smallBtnPressed]}>
              <Text style={styles.smallBtnText}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

export function SourceDetailsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const source = useSource(id);
  const history = useSourceDownloads(id);

  if (!source) return <View style={styles.center}><Text style={styles.meta}>This source no longer exists.</Text></View>;

  const openPicker = () => router.push({ pathname: "/sheets/format-picker", params: { sourceId: source.id } });
  const meta = [source.creatorName, source.platform, formatDuration(source.durationMs)].filter(Boolean).join(" · ");
  const remove = () =>
    Alert.alert("Delete this source?", "Downloaded files stay on your device. Only the saved source and its history are removed.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => { deleteSource(db, source.id); router.back(); } },
    ]);

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: spacing.xxxl }}>
      <Stack.Screen options={{ title: "", headerTransparent: true, headerTintColor: colors.onSurface }} />
      <View style={styles.hero}>
        {source.thumbnailUrl ? <Image source={source.thumbnailUrl} style={StyleHero.fill} contentFit="cover" /> : null}
        <LinearGradient colors={["transparent", colors.scrim]} style={StyleHero.fill} />
      </View>

      <View style={styles.body}>
        <Text style={styles.title}>{source.title ?? source.originalUrl}</Text>
        <Text style={styles.meta}>{meta}</Text>
        <View style={styles.rowInline}>
          <StatusChip view={sourceStatusView(source.status)} />
          <Text style={styles.meta}>Added {date(source.firstSeenAt)}</Text>
          <Pressable onPress={() => setFavorite(db, source.id, !source.favorite)} accessibilityLabel="Favorite" style={styles.fav}>
            <MaterialCommunityIcons name={source.favorite ? "star" : "star-outline"} size={22} color={source.favorite ? colors.warning : colors.muted} />
          </Pressable>
        </View>

        <View style={styles.actions}>
          <Button label={history.some((d) => d.status === "COMPLETED") ? "Download again" : "Download"} onPress={openPicker} grow />
        </View>
        <View style={styles.actions}>
          <Button label="Open source" variant="ghost" onPress={() => void Linking.openURL(source.originalUrl)} grow />
          <Button label="Copy URL" variant="ghost" onPress={() => void Clipboard.setStringAsync(source.originalUrl)} grow />
          <Button label="Share" variant="ghost" onPress={() => void Share.share({ message: source.originalUrl })} grow />
        </View>

        <Text style={styles.section}>Download history</Text>
        {history.length === 0 && <Text style={styles.meta}>No downloads yet. The source is saved and stays here.</Text>}
        {history.map((d) => <HistoryRow key={d.id} d={d} onRedownload={openPicker} />)}

        <View style={styles.danger}><Button label="Delete source" variant="destructive" onPress={remove} /></View>
      </View>
    </ScrollView>
  );
}

const StyleHero = { fill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } } as const;

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.surface },
  hero: { height: 240, backgroundColor: c.surfaceSecondary, borderBottomWidth: 1.5, borderBottomColor: c.border },
  body: { padding: spacing.lg, gap: spacing.md },
  title: { fontFamily: fonts.display, fontSize: fontSize.h1, color: c.onSurface },
  meta: { fontFamily: fonts.text, fontSize: fontSize.caption, color: c.mutedSecondary },
  rowInline: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  fav: { marginLeft: "auto", padding: spacing.xs },
  actions: { flexDirection: "row", gap: spacing.sm },
  section: { marginTop: spacing.lg, fontFamily: fonts.overline, fontSize: fontSize.overline, color: c.mutedSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  history: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.sm, backgroundColor: c.surfaceTertiary, borderWidth: 1.5, borderColor: c.border, alignItems: "flex-start", ...tactileShadow(2, c.border) },
  historyTop: { flexDirection: "row", justifyContent: "space-between", alignSelf: "stretch" },
  historyLabel: { fontFamily: fonts.textSemiBold, fontSize: fontSize.bodyLg, color: c.onSurface },
  actionsRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  smallBtn: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: c.surfaceInset, borderWidth: 1.5, borderColor: c.border, ...tactileShadow(1, c.border) },
  smallBtnPressed: { transform: [{ translateX: 1 }, { translateY: 1 }], shadowOpacity: 0, elevation: 0 },
  smallBtnText: { fontFamily: fonts.textMedium, fontSize: fontSize.caption, color: c.onSurface },
  danger: { marginTop: spacing.xl, alignItems: "flex-start" },
}));
