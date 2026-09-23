import { useRouter } from "expo-router";
import { memo } from "react";
import { Pressable, Text, View } from "react-native";

import { ProgressBar } from "@/components/progress-bar";
import { StatusChip } from "@/components/status-chip";
import type { QueueRow } from "@/db/queries/downloads";
import { fonts, fontSize, makeStyles, radius, spacing, tactileShadow } from "@/design/theme";
import { cancelDownload, pauseDownload, resumeDownload, retryDownload } from "@/domain/downloads/controller";
import { downloadStatusView, type StatusView } from "@/domain/status-view";
import { getDeps } from "@/native/runtime";
import { useProgress } from "@/stores/progress-store";
import { formatBytes } from "@/utils/format";

type Action = { label: string; run: (id: string) => Promise<void> };

const pause: Action = { label: "Pause", run: (id) => pauseDownload(getDeps(), id) };
const resume: Action = { label: "Resume", run: (id) => resumeDownload(getDeps(), id) };
const cancel: Action = { label: "Cancel", run: (id) => cancelDownload(getDeps(), id) };
const retry: Action = { label: "Retry", run: (id) => retryDownload(getDeps(), id) };

function actionsFor(status: QueueRow["status"]): Action[] {
  switch (status) {
    case "DOWNLOADING": return [pause, cancel];
    case "QUEUED": case "RETRYING": return [pause, cancel];
    case "PAUSED": return [resume, cancel];
    case "FAILED": case "CANCELED": case "AUTH_REQUIRED": case "SOURCE_UNAVAILABLE": return [retry];
    default: return [];
  }
}

const FAILED_STATUSES = new Set<QueueRow["status"]>(["FAILED", "AUTH_REQUIRED", "SOURCE_UNAVAILABLE"]);

// Same live source as the progress bar, so the numbers and the bar always agree (the DB snapshot lags by up to 5 s).
function SizeText({ id, bytes, total, inFlight }: { id: string; bytes: number; total: number | null; inFlight: boolean }) {
  const styles = useStyles();
  const live = useProgress(id);
  const b = live?.bytes ?? bytes;
  const t = live?.total ?? total;
  return <Text style={styles.size}>{inFlight ? `${formatBytes(b)} / ${formatBytes(t)}` : formatBytes(t)}</Text>;
}

const MISSING: StatusView = { label: "File missing", tone: "warning", icon: "file-alert-outline" };

export const DownloadRow = memo(function DownloadRow({ row }: { row: QueueRow }) {
  const styles = useStyles();
  const router = useRouter();
  const inFlight = row.status === "DOWNLOADING" || row.status === "PROCESSING" || row.status === "PAUSED";
  const processing = row.status === "PROCESSING" || row.status === "ORGANIZING";
  const failed = FAILED_STATUSES.has(row.status);
  const meta = [row.platform, row.resolution, row.container?.toUpperCase()].filter(Boolean).join(" · ");
  const view = row.status === "COMPLETED" && row.fileDeletedAt ? MISSING : downloadStatusView(row.status);
  const actions = actionsFor(row.status);
  return (
    <Pressable
      style={({ pressed }) => [styles.card, failed && styles.cardFailed, pressed && styles.pressed]}
      onPress={() => router.push({ pathname: "/source/[id]", params: { id: row.sourceId } })}
      accessibilityRole="button"
    >
      <Text numberOfLines={1} style={styles.title}>{row.title ?? "Untitled"}</Text>
      <Text numberOfLines={1} style={styles.meta}>{meta}</Text>
      {inFlight && <ProgressBar id={row.id} bytes={row.progressBytes} total={row.totalBytes} processing={processing} />}
      <View style={styles.footer}>
        <StatusChip view={view} />
        <SizeText id={row.id} bytes={row.progressBytes} total={row.totalBytes} inFlight={inFlight} />
      </View>
      {actions.length > 0 && (
        <View style={styles.actions}>
          {actions.map((a) => (
            <Pressable
              key={a.label}
              onPress={() => void a.run(row.id).catch(() => {})}
              style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
            >
              <Text style={styles.actionText}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </Pressable>
  );
});

const useStyles = makeStyles((c) => ({
  card: { gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.md, padding: spacing.md, borderRadius: radius.sm, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.surfaceTertiary, ...tactileShadow(2, c.border) },
  cardFailed: { backgroundColor: `${c.errorSurface}66` },
  pressed: { transform: [{ translateX: 2 }, { translateY: 2 }], shadowOpacity: 0, elevation: 0 },
  title: { fontFamily: fonts.textSemiBold, fontSize: fontSize.bodyLg, color: c.onSurface },
  meta: { fontFamily: fonts.text, fontSize: fontSize.caption, color: c.mutedSecondary },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  size: { fontFamily: fonts.mono, fontSize: fontSize.caption, color: c.onSurfaceSecondary, fontVariant: ["tabular-nums"] },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
  action: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: c.surfaceInset, borderWidth: 1.5, borderColor: c.border, ...tactileShadow(1, c.border) },
  actionPressed: { transform: [{ translateX: 1 }, { translateY: 1 }], shadowOpacity: 0, elevation: 0 },
  actionText: { fontFamily: fonts.textMedium, fontSize: fontSize.caption, color: c.onSurface },
}));
