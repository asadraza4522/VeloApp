import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { Button } from "@/components/button";
import { db } from "@/db/client";
import { listDownloadsForSource } from "@/db/queries/downloads";
import { getSource } from "@/db/queries/sources";
import { fonts, fontSize, makeStyles, radius, spacing, tactileShadow } from "@/design/theme";
import { startDownload } from "@/domain/downloads/controller";
import { UnsupportedSelectionError, type Selection } from "@/domain/downloads/job";
import { buildOptions, pickPreset, previousHint, type Preset } from "@/domain/resolve/quality";
import { ensureResolved } from "@/domain/sources/analyze";
import { ensureNotificationPermission } from "@/native/permissions";
import { getDeps } from "@/native/runtime";

type Choice = { key: string; label: string; selection: Selection };
const PRESETS: { id: Preset; label: string }[] = [
  { id: "best", label: "Best" },
  { id: "balanced", label: "Balanced" },
  { id: "dataSaver", label: "Data saver" },
];

function Row({ title, tag, detail, selected, blocked, onPress }: { title: string; tag?: string; detail: string; selected: boolean; blocked?: boolean; onPress: () => void }) {
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} disabled={blocked} style={[styles.row, selected && styles.rowSelected, blocked && styles.rowBlocked]} accessibilityRole="radio" accessibilityState={{ selected, disabled: blocked }}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}{tag ? `  ${tag}` : ""}</Text>
        <Text style={styles.rowDetail}>{detail}</Text>
      </View>
      <View style={[styles.radio, selected && styles.radioOn]}>{selected && <View style={styles.radioDot} />}</View>
    </Pressable>
  );
}

export function FormatPickerScreen() {
  const styles = useStyles();
  const router = useRouter();
  const { sourceId } = useLocalSearchParams<{ sourceId: string }>();
  const source = getSource(db, sourceId);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const resolved = useQuery({ queryKey: ["resolve", sourceId], queryFn: () => ensureResolved(source!), enabled: !!source, staleTime: 5 * 60_000 });
  const options = useMemo(() => (resolved.data?.ok ? buildOptions(resolved.data.result.variants) : null), [resolved.data]);
  const previous = useMemo(() => {
    if (!options || !source) return null;
    const last = listDownloadsForSource(db, source.id).find((d) => d.status === "COMPLETED" && d.resolution);
    return previousHint(last?.resolution, options.video);
  }, [options, source]);

  const applyPreset = (p: Preset) => {
    const o = options && pickPreset(options.video, p);
    if (o?.selection) setChoice({ key: o.key, label: `${o.label}`, selection: o.selection });
  };

  const start = async () => {
    if (!choice || !source) return;
    setBusy(true);
    setError("");
    try {
      await ensureNotificationPermission();
      await startDownload(getDeps(), source, choice.selection);
      router.back();
      router.navigate("/downloads");
    } catch (e) {
      setError(e instanceof UnsupportedSelectionError ? e.message : "Couldn't start the download. Try again.");
      setBusy(false);
    }
  };

  if (!source) return <View style={styles.center}><Text style={styles.detail}>Source not found.</Text></View>;
  if (resolved.isLoading) return <View style={styles.center}><ActivityIndicator /><Text style={styles.detail}>Checking available formats…</Text></View>;
  if (!resolved.data?.ok || !options) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Couldn&apos;t load formats</Text>
        <Text style={styles.detail}>{resolved.data && !resolved.data.ok ? `${resolved.data.code}: ${resolved.data.message}` : "Check your connection and try again."}</Text>
        <Button label="Try again" variant="secondary" onPress={() => void resolved.refetch()} />
      </View>
    );
  }

  const nothing = !options.video.length && !options.audio.length && !options.other.length;
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title} numberOfLines={2}>{source.title ?? source.originalUrl}</Text>

        {options.video.length > 0 && (
          <View style={styles.presets}>
            {PRESETS.map((p) => <Pressable key={p.id} style={styles.preset} onPress={() => applyPreset(p.id)}><Text style={styles.presetText}>{p.label}</Text></Pressable>)}
          </View>
        )}

        {previous && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              {previous.status === "available"
                ? `Previously ${previous.previous} · still available`
                : `Previously ${previous.previous} · unavailable${previous.alternative ? `, ${previous.alternative.label} available` : ""}`}
            </Text>
          </View>
        )}

        {options.video.length > 0 && <Text style={styles.section}>Video</Text>}
        {options.video.map((o) => (
          <Row key={o.key} title={o.label} tag={o.tag} detail={o.detail} blocked={!o.selection} selected={choice?.key === o.key}
            onPress={() => o.selection && setChoice({ key: o.key, label: o.label, selection: o.selection })} />
        ))}

        {options.audio.length > 0 && <Text style={styles.section}>Audio only</Text>}
        {options.audio.map((o) => (
          <Row key={o.key} title={o.label} detail={o.detail || "Saved as .m4a"} selected={choice?.key === o.key} onPress={() => setChoice({ key: o.key, label: o.label, selection: o.selection })} />
        ))}

        {options.other.length > 0 && <Text style={styles.section}>Files</Text>}
        {options.other.map((o) => (
          <Row key={o.key} title={o.label} detail={o.detail} selected={choice?.key === o.key} onPress={() => setChoice({ key: o.key, label: o.label, selection: o.selection })} />
        ))}

        {nothing && <Text style={styles.detail}>Nothing downloadable was found for this link.</Text>}
        {error !== "" && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
      <View style={styles.footer}>
        <Button label={choice ? `Download ${choice.label}` : "Choose a format"} onPress={() => void start()} disabled={!choice} loading={busy} grow />
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl, backgroundColor: c.surface },
  scroll: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl },
  title: { fontFamily: fonts.display, fontSize: fontSize.h1, color: c.onSurface },
  detail: { fontFamily: fonts.text, fontSize: fontSize.body, color: c.mutedSecondary, textAlign: "center" },
  error: { fontFamily: fonts.textMedium, fontSize: fontSize.body, color: c.error },
  section: { marginTop: spacing.md, fontFamily: fonts.overline, fontSize: fontSize.overline, color: c.mutedSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  presets: { flexDirection: "row", gap: spacing.sm, marginVertical: spacing.sm },
  preset: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.sm, backgroundColor: c.surfaceInset, borderWidth: 1.5, borderColor: c.border, ...tactileShadow(1.5, c.border) },
  presetText: { fontFamily: fonts.textMedium, fontSize: fontSize.caption, color: c.onSurface },
  banner: { padding: spacing.md, borderRadius: radius.sm, backgroundColor: c.infoSurface, borderWidth: 1.5, borderColor: c.border, ...tactileShadow(2, c.border) },
  bannerText: { fontFamily: fonts.textMedium, fontSize: fontSize.caption, color: c.info },
  row: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderRadius: radius.sm, backgroundColor: c.surfaceTertiary, borderWidth: 1.5, borderColor: c.border, ...tactileShadow(2, c.border) },
  rowSelected: { backgroundColor: c.brandTertiary, borderWidth: 2 },
  rowBlocked: { opacity: 0.5 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: fonts.textSemiBold, fontSize: fontSize.bodyLg, color: c.onSurface },
  rowDetail: { fontFamily: fonts.mono, fontSize: fontSize.caption, color: c.mutedSecondary },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: c.border, alignItems: "center", justifyContent: "center" },
  radioOn: { backgroundColor: c.brandPrimary },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.border },
  footer: { flexDirection: "row", padding: spacing.lg, borderTopWidth: 1.5, borderTopColor: c.border, backgroundColor: c.surface },
}));
