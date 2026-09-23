// Local download notifications: live progress with Pause/Cancel actions,
// completion and failure alerts. Local only (no push server) — progress updates
// while the app is running; fully reliable on native builds.
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { controlDownload, deleteDownload, DownloadJob } from "@/src/api";

const CHANNEL_ID = "downloads";
const ACTIVE_CATEGORY = "download-active";
const PAUSED_CATEGORY = "download-paused";

let setupDone = false;
let permission: "granted" | "denied" | "blocked" | "unknown" = "unknown";
const lastPct = new Map<string, number>();
const terminalNotified = new Set<string>();

const supported = Platform.OS !== "web";

export async function setupNotifications(): Promise<void> {
  if (setupDone || !supported) return;
  setupDone = true;
  try {
    await Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: "Downloads",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    await Notifications.setNotificationCategoryAsync(ACTIVE_CATEGORY, [
      { identifier: "pause", buttonTitle: "Pause", options: { opensAppToForeground: false } },
      { identifier: "cancel", buttonTitle: "Cancel", options: { isDestructive: true, opensAppToForeground: false } },
    ]);
    await Notifications.setNotificationCategoryAsync(PAUSED_CATEGORY, [
      { identifier: "resume", buttonTitle: "Resume", options: { opensAppToForeground: false } },
      { identifier: "cancel", buttonTitle: "Cancel", options: { isDestructive: true, opensAppToForeground: false } },
    ]);
    Notifications.addNotificationResponseReceivedListener((response) => {
      const jobId = response.notification.request.content.data?.jobId as string | undefined;
      if (!jobId) return;
      if (response.actionIdentifier === "pause") controlDownload(jobId, "pause").catch(() => {});
      else if (response.actionIdentifier === "resume") controlDownload(jobId, "resume").catch(() => {});
      else if (response.actionIdentifier === "cancel") deleteDownload(jobId).catch(() => {});
    });
  } catch {
    // notification setup unavailable (e.g. Expo Go limits) — stay silent
  }
}

export async function getNotificationStatus(): Promise<typeof permission> {
  if (!supported) return "blocked";
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return "granted";
    return current.canAskAgain ? "denied" : "blocked";
  } catch {
    return "blocked";
  }
}

// Called contextually (a download is running), never at app start.
export async function requestNotificationPermission(): Promise<typeof permission> {
  if (!supported) return "blocked";
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) {
      permission = "granted";
      return permission;
    }
    if (!current.canAskAgain) {
      permission = "blocked";
      return permission;
    }
    const next = await Notifications.requestPermissionsAsync();
    permission = next.granted ? "granted" : "denied";
    return permission;
  } catch {
    permission = "blocked";
    return permission;
  }
}

async function post(identifier: string, content: Notifications.NotificationContentInput): Promise<void> {
  if (permission !== "granted" || !supported) return;
  try {
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: { ...content, ...(Platform.OS === "android" ? { channelId: CHANNEL_ID } : {}) },
      trigger: null,
    });
  } catch {
    // ignore notification failures
  }
}

export async function clearJobNotification(jobId: string): Promise<void> {
  if (!supported) return;
  lastPct.delete(jobId);
  terminalNotified.delete(jobId);
  try {
    await Notifications.dismissNotificationAsync(`dl-${jobId}`);
  } catch {
    // nothing posted
  }
}

// Drives progress/completion notifications from the global job poller.
export async function trackJobNotifications(jobs: DownloadJob[]): Promise<void> {
  if (!supported) return;
  const seen = new Set<string>();
  for (const job of jobs) {
    seen.add(job.id);
    const pct = Math.round(job.progress * 100);

    if (job.status === "downloading" || job.status === "processing" || job.status === "queued") {
      terminalNotified.delete(job.id);
      if (permission === "unknown") await requestNotificationPermission();
      if (lastPct.get(job.id) === pct) continue;
      lastPct.set(job.id, pct);
      await post(`dl-${job.id}`, {
        title: job.title,
        body: job.status === "processing" ? "Converting…" : job.status === "queued" ? "Queued…" : `Downloading · ${pct}%`,
        data: { jobId: job.id },
        categoryIdentifier: ACTIVE_CATEGORY,
        sticky: true,
        autoDismiss: false,
      });
    } else if (job.status === "paused") {
      terminalNotified.delete(job.id);
      if (lastPct.get(job.id) !== -1) {
        lastPct.set(job.id, -1);
        await post(`dl-${job.id}`, {
          title: job.title,
          body: `Paused at ${pct}%`,
          data: { jobId: job.id },
          categoryIdentifier: PAUSED_CATEGORY,
          sticky: true,
          autoDismiss: false,
        });
      }
    } else if (job.status === "ready" || job.status === "failed") {
      if (terminalNotified.has(job.id)) continue;
      terminalNotified.add(job.id);
      lastPct.delete(job.id);
      await clearJobNotification(job.id);
      terminalNotified.add(job.id);
      await post(`dl-done-${job.id}`, {
        title: job.status === "ready" ? "Download complete" : "Download failed",
        body: job.status === "ready" ? `${job.title} is ready to save.` : job.title,
        data: { jobId: job.id },
      });
    }
  }
  // Dismiss notifications for jobs that disappeared (cancelled/deleted).
  for (const jobId of [...lastPct.keys()]) {
    if (!seen.has(jobId)) await clearJobNotification(jobId);
  }
}
