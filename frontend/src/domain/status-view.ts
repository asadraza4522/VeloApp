import type { DownloadStatus, SourceStatus } from "@/db/schema";

// Presentation of statuses: always icon + label + tone (never color alone — design guidelines).
export type Tone = "success" | "warning" | "info" | "error" | "muted";
export type StatusView = { label: string; tone: Tone; icon: string };

export function sourceStatusView(status: SourceStatus): StatusView {
  switch (status) {
    case "resolved": return { label: "Ready", tone: "info", icon: "check-circle-outline" };
    case "failed": return { label: "Retry available", tone: "info", icon: "refresh" };
    case "unavailable": return { label: "Unavailable", tone: "error", icon: "alert-circle-outline" };
    default: return { label: "Saved", tone: "muted", icon: "bookmark-outline" };
  }
}

export function downloadStatusView(status: DownloadStatus): StatusView {
  switch (status) {
    case "COMPLETED": return { label: "Completed", tone: "success", icon: "check-circle" };
    case "DOWNLOADING": return { label: "Downloading", tone: "info", icon: "arrow-down-circle-outline" };
    case "PROCESSING":
    case "ORGANIZING": return { label: "Processing", tone: "info", icon: "cog-sync-outline" };
    case "PAUSED": return { label: "Paused", tone: "muted", icon: "pause-circle-outline" };
    case "QUEUED": return { label: "Queued", tone: "muted", icon: "clock-outline" };
    case "WAITING_FOR_SELECTION": return { label: "Choose format", tone: "warning", icon: "format-list-bulleted" };
    case "FAILED":
    case "RETRYING": return { label: status === "FAILED" ? "Failed" : "Retrying", tone: "info", icon: "refresh" };
    case "AUTH_REQUIRED": return { label: "Sign-in required", tone: "warning", icon: "lock-outline" };
    case "UNSUPPORTED": return { label: "Not supported", tone: "error", icon: "cancel" };
    case "SOURCE_UNAVAILABLE": return { label: "Unavailable", tone: "error", icon: "alert-circle-outline" };
    case "CANCELED": return { label: "Canceled", tone: "muted", icon: "close-circle-outline" };
    default: return { label: "Preparing", tone: "muted", icon: "dots-horizontal-circle-outline" };
  }
}
