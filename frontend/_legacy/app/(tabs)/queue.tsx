import { Image } from "expo-image";
import { useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DownloadJob, downloadFileUrl } from "@/src/api";
import { AppHeader, Card, EmptyState, Icon, MiniButton, ScreenHeading, SectionHeader } from "@/src/components/ui";
import { useBottomChrome } from "@/src/navigation";
import { saveFileToDevice } from "@/src/save-file";
import { useAppState } from "@/src/state/app-state";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const filters = ["All", "Active", "Completed", "Failed"] as const;
const ACTIVE_STATUSES = ["queued", "downloading", "processing", "paused"];

function fmtSpeed(bps?: number | null): string {
  if (!bps) return "";
  const mb = bps / 1_000_000;
  return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${(bps / 1000).toFixed(0)} KB/s`;
}

function fmtEta(seconds?: number | null): string {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")} left`;
}

function fmtSize(bytes?: number | null): string {
  if (!bytes) return "";
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  return `${(bytes / 1_000_000).toFixed(0)} MB`;
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  statRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.xl },
  stat: { flex: 1, backgroundColor: c.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: c.border },
  statValue: { color: c.brandPrimary, fontSize: 22, fontFamily: fonts.display },
  statLabel: { color: c.muted, fontSize: 9, fontFamily: fonts.textSemiBold, letterSpacing: 1, marginTop: spacing.xs },
  segment: { flexDirection: "row", backgroundColor: c.surfaceTertiary, padding: spacing.xs, borderRadius: radius.pill, marginBottom: spacing.lg },
  segmentButton: { flex: 1, minHeight: 34, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  segmentActive: { backgroundColor: c.brandTertiary, borderWidth: 1, borderColor: c.brandSecondary },
  segmentText: { color: c.muted, fontSize: 11, fontFamily: fonts.textMedium },
  segmentTextActive: { color: c.onBrandTertiary },
  sourceRow: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  thumb: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: c.brandTertiary },
  thumbIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" },
  sourceTitle: { color: c.onSurface, fontSize: 14, fontFamily: fonts.textMedium },
  sourceMeta: { color: c.muted, fontSize: 12, fontFamily: fonts.text, marginTop: 3 },
  statusText: { color: c.brandPrimary, fontSize: 12, fontFamily: fonts.textSemiBold },
  // Thin, elegant gold progress (2.5pt track).
  progressTrack: { height: 3, backgroundColor: c.surfaceTertiary, borderRadius: 2, marginTop: spacing.md, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: c.brandPrimary, borderRadius: 2 },
  queueMeta: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.sm },
  queueMetaText: { color: c.muted, fontSize: 11, fontFamily: fonts.textMedium, letterSpacing: 0.3 },
  actionRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg, justifyContent: "flex-end" },
  noteCard: { flexDirection: "row", gap: spacing.md, alignItems: "center", marginTop: spacing.xs },
  engineRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  engineDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: c.success },
  engineLabel: { color: c.success, fontSize: 10, fontFamily: fonts.textSemiBold, letterSpacing: 1 },
  savingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.lg },
  savingText: { color: c.brandPrimary, fontSize: 12, fontFamily: fonts.textMedium },
}));

export default function QueueScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { jobs, actJob, removeJob, notify, sources, updateSource } = useAppState();
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const [saving, setSaving] = useState<Record<string, number>>({});

  const bottomChrome = useBottomChrome();

  const saveToDevice = async (job: DownloadJob) => {
    setSaving((current) => ({ ...current, [job.id]: 0 }));
    try {
      const fileUrl = downloadFileUrl(job.id);
      const savedUri = await saveFileToDevice(fileUrl, `${job.id}.${job.ext ?? "mp4"}`, (pct) =>
        setSaving((current) => ({ ...current, [job.id]: pct })),
      );
      updateSource(job.url, {
        status: "Downloaded",
        ...(savedUri.startsWith("http") ? { fileUrl: savedUri } : { localUri: savedUri }),
      });
      notify(Platform.OS === "web" ? "Download started in browser" : "Saved to device storage");
    } catch {
      notify("Save to device failed");
    }
    setSaving((current) => {
      const next = { ...current };
      delete next[job.id];
      return next;
    });
  };

  const matches = (job: DownloadJob) =>
    filter === "All"
      ? true
      : filter === "Active"
        ? ACTIVE_STATUSES.includes(job.status)
        : filter === "Completed"
          ? job.status === "ready"
          : job.status === "failed";

  const visible = jobs.filter(matches);
  const activeCount = jobs.filter((job) => ACTIVE_STATUSES.includes(job.status)).length;
  const readyCount = jobs.filter((job) => job.status === "ready").length;

  const renderJob = (job: DownloadJob) => {
    const pct = Math.round(job.progress * 100);
    const isSaving = saving[job.id] !== undefined;
    const statusLine =
      job.status === "downloading"
        ? `${fmtSpeed(job.speed_bps)} ${fmtEta(job.eta_seconds)}`.trim() || "Fetching…"
        : job.status === "processing"
          ? "Converting…"
          : job.status === "paused"
            ? `Paused at ${pct}%`
            : job.status === "ready"
              ? `Ready · ${fmtSize(job.size_bytes) || job.ext?.toUpperCase() || ""}`
              : job.status === "failed"
                ? job.error || "Download failed"
                : "Queued";

    return (
      <Card key={job.id} testID={`job-${job.id}`} style={{ marginBottom: spacing.md, padding: spacing.md }}>
        <View style={styles.sourceRow}>
          {job.thumbnail ? (
            <Image source={{ uri: job.thumbnail }} style={styles.thumb} contentFit="cover" transition={150} />
          ) : (
            <View style={styles.thumbIcon}>
              <Icon
                name={job.kind === "audio" ? "music-note-outline" : job.kind === "image" ? "image-outline" : "download"}
                size={20}
                color={job.status === "failed" ? colors.error : colors.onBrandTertiary}
              />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.sourceTitle} numberOfLines={1}>{job.title}</Text>
            <Text style={styles.sourceMeta} numberOfLines={1}>{job.label} · {job.platform}</Text>
          </View>
          <Text style={[styles.statusText, job.status === "failed" && { color: colors.error }]} testID={`job-status-${job.id}`}>
            {job.status === "downloading" ? `${pct}%` : job.status.toUpperCase()}
          </Text>
        </View>

        {ACTIVE_STATUSES.includes(job.status) ? (
          <View style={styles.progressTrack} testID={`job-progress-${job.id}`}>
            <View style={[styles.progressFill, { width: `${Math.max(pct, 2)}%` }, job.status === "paused" && { backgroundColor: colors.muted }]} />
          </View>
        ) : null}

        <View style={styles.queueMeta}>
          <Text style={styles.queueMetaText} numberOfLines={1}>{statusLine}</Text>
          <Text style={styles.queueMetaText}>{job.kind === "audio" ? "Audio" : job.kind === "image" ? "Image" : "Video"}</Text>
        </View>

        {isSaving ? (
          <View style={styles.savingRow} testID={`job-saving-${job.id}`}>
            <Text style={styles.savingText}>Saving to device · {Math.round(saving[job.id] * 100)}%</Text>
          </View>
        ) : (
          <View style={styles.actionRow}>
            {job.status === "downloading" || job.status === "queued" ? (
              <>
                <MiniButton testID={`job-pause-${job.id}`} label="Pause" icon="pause" onPress={() => actJob(job.id, "pause")} />
                <MiniButton testID={`job-cancel-${job.id}`} label="Cancel" icon="close" onPress={() => removeJob(job.id)} />
              </>
            ) : null}
            {job.status === "processing" ? (
              <MiniButton testID={`job-cancel-${job.id}`} label="Cancel" icon="close" onPress={() => removeJob(job.id)} />
            ) : null}
            {job.status === "paused" ? (
              <>
                <MiniButton testID={`job-resume-${job.id}`} label="Resume" icon="play" onPress={() => actJob(job.id, "resume")} />
                <MiniButton testID={`job-cancel-${job.id}`} label="Cancel" icon="close" onPress={() => removeJob(job.id)} />
              </>
            ) : null}
            {job.status === "ready" ? (
              <>
                <MiniButton testID={`job-save-${job.id}`} label="Save to device" icon="download-outline" onPress={() => saveToDevice(job)} />
                <MiniButton testID={`job-delete-${job.id}`} label="Delete" icon="trash-can-outline" onPress={() => removeJob(job.id)} />
              </>
            ) : null}
            {job.status === "failed" ? (
              <>
                <MiniButton testID={`job-retry-${job.id}`} label="Retry" icon="reload" onPress={() => actJob(job.id, "resume")} />
                <MiniButton testID={`job-delete-${job.id}`} label="Delete" icon="trash-can-outline" onPress={() => removeJob(job.id)} />
              </>
            ) : null}
          </View>
        )}
      </Card>
    );
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <AppHeader />
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomChrome + spacing.lg }]} showsVerticalScrollIndicator={false}>
        <ScreenHeading eyebrow="Download manager" title="Your queue, in motion." description="Real downloads with pause, resume and retry — sources stay safe either way." />

        <View style={styles.statRow}>
          <View style={styles.stat} testID="stat-active">
            <Text style={styles.statValue}>{String(activeCount).padStart(2, "0")}</Text>
            <Text style={styles.statLabel}>ACTIVE NOW</Text>
          </View>
          <View style={styles.stat} testID="stat-ready">
            <Text style={styles.statValue}>{String(readyCount).padStart(2, "0")}</Text>
            <Text style={styles.statLabel}>READY TO SAVE</Text>
          </View>
          <View style={styles.stat} testID="stat-saved">
            <Text style={styles.statValue}>{String(sources.length).padStart(2, "0")}</Text>
            <Text style={styles.statLabel}>SAVED SOURCES</Text>
          </View>
        </View>

        <SectionHeader title="Activity" />
        <View style={[styles.engineRow, { justifyContent: "flex-end", marginTop: -spacing.xl - spacing.md, marginBottom: spacing.sm }]}>
          <View style={styles.engineDot} />
          <Text style={styles.engineLabel} testID="engine-label">LIVE ENGINE · VELO CORE</Text>
        </View>

        <View style={styles.segment} testID="queue-filters">
          {filters.map((item) => (
            <Pressable key={item} testID={`queue-filter-${item.toLowerCase()}`} onPress={() => setFilter(item)} style={[styles.segmentButton, filter === item && styles.segmentActive]}>
              <Text style={[styles.segmentText, filter === item && styles.segmentTextActive]}>{item}</Text>
            </Pressable>
          ))}
        </View>

        {visible.length ? (
          visible.map(renderJob)
        ) : (
          <EmptyState
            testID="queue-empty"
            icon="download-circle-outline"
            title={filter === "All" ? "Queue is silent." : `No ${filter.toLowerCase()} downloads`}
            body="Resolve a link on Home and tap Download to start a real download."
          />
        )}

        <Card style={styles.noteCard}>
          <Icon name="shield-check-outline" size={22} color={colors.brandSecondary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.sourceTitle}>Permission-first downloads</Text>
            <Text style={styles.sourceMeta}>Velo will not bypass DRM or private access controls.</Text>
          </View>
        </Card>
      </ScrollView>
    </View>
  );
}
