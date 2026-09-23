import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { createDownload, DownloadJob, listDownloads } from "@/src/api";
import { AppHeader, Card, Chip, ChipRow, GhostButton, Icon, MockTag, PrimaryButton, ScreenHeading, SectionHeader } from "@/src/components/ui";
import { useBottomChrome } from "@/src/navigation";
import { Source, useAppState } from "@/src/state/app-state";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const formats = ["MP3", "M4A", "OPUS"];

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  heroCard: { marginTop: spacing.xl },
  toolIcon: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  toolTitle: { color: c.onSurface, fontSize: 20, fontFamily: fonts.display, letterSpacing: -0.4 },
  body: { color: c.muted, fontSize: 13, lineHeight: 20, fontFamily: fonts.text, marginTop: 6 },
  label: { color: c.muted, fontSize: 10, fontFamily: fonts.textBold, letterSpacing: 1, marginTop: spacing.lg, marginBottom: spacing.sm },
  selector: { justifyContent: "space-between", width: "100%" },
  selectorInner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 },
  selectorText: { color: c.onSurface, fontSize: 13, fontFamily: fonts.textSemiBold, flex: 1 },
  conversionRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  conversionIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  sourceTitle: { color: c.onSurface, fontSize: 13, fontFamily: fonts.textSemiBold },
  sourceMeta: { color: c.muted, fontSize: 11, fontFamily: fonts.text, marginTop: 2 },
  infoCard: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: c.success },
  liveLabel: { color: c.success, fontSize: 10, fontFamily: fonts.textBold, letterSpacing: 1 },
  // Source picker sheet
  backdrop: { flex: 1, backgroundColor: "rgba(4, 10, 28, 0.72)", justifyContent: "flex-end" },
  sheet: { backgroundColor: c.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, borderTopWidth: 1, borderColor: c.border, maxHeight: "70%" },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: c.muted, marginBottom: spacing.lg },
  sheetTitle: { color: c.onSurface, fontSize: 18, fontFamily: fonts.display, letterSpacing: -0.3, marginBottom: spacing.md },
  pickRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  pickIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  divider: { height: 1, backgroundColor: c.divider },
  emptyText: { color: c.muted, fontSize: 13, fontFamily: fonts.text, textAlign: "center", paddingVertical: spacing.xl },
}));

export default function ToolsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { notify, sources, workspace } = useAppState();
  const [format, setFormat] = useState(formats[0]);
  const [converting, setConverting] = useState(false);
  const [selected, setSelected] = useState<Source | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [recentJobs, setRecentJobs] = useState<DownloadJob[]>([]);

  const bottomChrome = useBottomChrome();
  const videoSources = sources.filter((source) => source.type === "VIDEO");

  const refreshRecent = useCallback(async () => {
    if (!workspace) return;
    try {
      const jobs = await listDownloads(workspace);
      setRecentJobs(jobs.filter((job) => job.kind === "audio").slice(0, 3));
    } catch {
      // backend unreachable — keep last known list
    }
  }, [workspace]);

  useFocusEffect(
    useCallback(() => {
      refreshRecent();
      const interval = setInterval(refreshRecent, 5000);
      return () => clearInterval(interval);
    }, [refreshRecent]),
  );

  const startConversion = async () => {
    if (!selected) {
      notify("Pick a source first");
      setPickerVisible(true);
      return;
    }
    setConverting(true);
    try {
      await createDownload({
        url: selected.url,
        kind: "audio",
        format: format.toLowerCase(),
        label: `${format} audio`,
        workspace,
        title: selected.title,
        creator: selected.creator,
        platform: selected.platform,
        duration: selected.duration,
      });
      notify("Conversion started — track it in Queue");
    } catch {
      notify("Conversion failed to start");
    } finally {
      setConverting(false);
    }
  };

  const jobMeta = (job: DownloadJob) =>
    job.status === "ready"
      ? `${job.label} · ${job.size_bytes ? `${(job.size_bytes / 1_000_000).toFixed(0)} MB` : "done"}`
      : job.status === "failed"
        ? "Failed · retry from Queue"
        : `${job.label} · ${job.status}`;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <AppHeader />
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomChrome + spacing.xl }]} showsVerticalScrollIndicator={false}>
        <ScreenHeading eyebrow="Tools" title="Shape your media." description="Extract real audio from any saved video source." />

        <Card style={styles.heroCard} testID="audio-studio">
          <View style={styles.toolIcon}>
            <Icon name="waveform" size={24} color={colors.brandSecondary} />
          </View>
          <Text style={styles.toolTitle}>Audio Studio</Text>
          <Text style={styles.body}>Turn a saved video into a clean audio file with a format that fits your library.</Text>
          <View style={styles.liveRow} testID="converter-live-label">
            <View style={styles.liveDot} />
            <Text style={styles.liveLabel}>LIVE CONVERTER · FFMPEG PIPELINE</Text>
          </View>

          <Text style={styles.label}>SOURCE</Text>
          <GhostButton testID="tool-source-selector" style={styles.selector} onPress={() => setPickerVisible(true)}>
            <View style={styles.selectorInner}>
              <Icon name="video-outline" size={17} color={colors.onSurface} />
              <Text style={styles.selectorText} numberOfLines={1}>{selected ? selected.title : "Choose a saved video…"}</Text>
            </View>
            <Icon name="chevron-down" size={18} color={colors.muted} />
          </GhostButton>

          <Text style={styles.label}>OUTPUT FORMAT</Text>
          <ChipRow>
            {formats.map((item) => (
              <Chip key={item} testID={`format-${item.toLowerCase()}`} label={item} active={format === item} onPress={() => setFormat(item)} />
            ))}
          </ChipRow>

          <Text style={styles.label}>QUALITY</Text>
          <GhostButton testID="tool-quality-selector" style={styles.selector} onPress={() => notify(`Quality locked to High · ${format === "MP3" ? "320" : "256"} kbps in this build`)}>
            <View style={styles.selectorInner}>
              <Icon name="music-note-outline" size={17} color={colors.brandSecondary} />
              <Text style={styles.selectorText}>High · {format === "MP3" ? "320" : "256"} kbps</Text>
            </View>
            <Icon name="lock-outline" size={16} color={colors.muted} />
          </GhostButton>

          <PrimaryButton testID="extract-audio-button" label={`Extract ${format} audio`} icon="auto-fix" loading={converting} onPress={startConversion} style={{ marginTop: spacing.xl }} />
        </Card>

        <SectionHeader title="Recent conversions" />
        <Card testID="recent-conversions">
          {recentJobs.length ? (
            recentJobs.map((job, index) => (
              <View key={job.id} testID={`conversion-${job.id}`}>
                <View style={styles.conversionRow}>
                  <View style={styles.conversionIcon}>
                    <Icon name="file-music-outline" size={19} color={colors.brandTertiary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sourceTitle} numberOfLines={1}>{job.title}</Text>
                    <Text style={styles.sourceMeta}>{jobMeta(job)}</Text>
                  </View>
                  <Icon
                    name={job.status === "ready" ? "check-circle-outline" : job.status === "failed" ? "alert-circle-outline" : "progress-clock"}
                    size={18}
                    color={job.status === "ready" ? colors.success : job.status === "failed" ? colors.error : colors.muted}
                  />
                </View>
                {index < recentJobs.length - 1 ? <View style={styles.divider} /> : null}
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No conversions yet — pick a source and extract your first audio file.</Text>
          )}
        </Card>

        <Card style={styles.infoCard}>
          <Icon name="information-outline" size={19} color={colors.info} />
          <Text style={[styles.body, { flex: 1, marginTop: 0 }]}>
            Protected or private media cannot be processed. Use Velo only for media you have permission to save.
          </Text>
        </Card>
      </ScrollView>

      <Modal visible={pickerVisible} transparent animationType="slide" onRequestClose={() => setPickerVisible(false)}>
        <View style={styles.backdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setPickerVisible(false)} accessibilityLabel="Close source picker" />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]} testID="source-picker">
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Choose a source</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {videoSources.length ? (
                videoSources.map((source, index) => (
                  <View key={source.id}>
                    <Pressable
                      testID={`pick-${source.id}`}
                      onPress={() => {
                        setSelected(source);
                        setPickerVisible(false);
                      }}
                      style={({ pressed }) => [styles.pickRow, pressed && { opacity: 0.7 }]}
                    >
                      <View style={styles.pickIcon}>
                        <Icon name="play-outline" size={19} color={colors.brandSecondary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.sourceTitle} numberOfLines={1}>{source.title}</Text>
                        <Text style={styles.sourceMeta}>{source.platform} · {source.duration}</Text>
                      </View>
                      {selected?.id === source.id ? <Icon name="check-circle" size={18} color={colors.success} /> : null}
                    </Pressable>
                    {index < videoSources.length - 1 ? <View style={styles.divider} /> : null}
                  </View>
                ))
              ) : (
                <Text style={styles.emptyText} testID="picker-empty">No video sources yet — resolve and save a link on Home first.</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
