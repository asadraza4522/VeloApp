// Thin API client for the Velo backend. Base URL comes from the public env var
// (never hardcode hosts); all backend routes live under /api.

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

export type ResolvedQuality = {
  id: string;
  label: string;
  ext: string;
  size: string;
};

export type ResolvedMedia = {
  url: string;
  title: string;
  creator: string;
  platform: string;
  type: "VIDEO" | "AUDIO" | "IMAGE";
  duration: string;
  thumbnail: string | null;
  provider: "yt-dlp" | "oembed" | "direct";
  degraded: boolean;
  qualities: ResolvedQuality[];
  cached?: boolean;
};

export type DownloadStatus =
  | "queued"
  | "downloading"
  | "processing"
  | "paused"
  | "ready"
  | "failed"
  | "cancelled";

export type DownloadJob = {
  id: string;
  url: string;
  kind: "video" | "audio" | "image";
  quality: string;
  format: string;
  label: string;
  workspace: string;
  title: string;
  creator: string;
  platform: string;
  duration: string;
  thumbnail: string | null;
  status: DownloadStatus;
  progress: number;
  speed_bps: number | null;
  eta_seconds: number | null;
  size_bytes: number | null;
  ext: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
};

export type DownloadRequest = {
  url: string;
  kind: "video" | "audio" | "image";
  quality?: string;
  format?: string;
  label?: string;
  workspace: string;
  title?: string;
  creator?: string;
  platform?: string;
  duration?: string;
  thumbnail?: string | null;
};

export type SyncState = {
  workspace: string;
  sources: unknown[];
  settings: Record<string, unknown>;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    let detail = response.status === 502
      ? "All resolver services failed for this link. Retry, or try a different link."
      : `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      // non-JSON error body (proxy error page) — keep the friendly message
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

export function resolveMedia(url: string): Promise<ResolvedMedia> {
  return request<ResolvedMedia>("/resolve", { method: "POST", body: JSON.stringify({ url }) });
}

export function createDownload(payload: DownloadRequest): Promise<DownloadJob> {
  return request<DownloadJob>("/downloads", { method: "POST", body: JSON.stringify(payload) });
}

export function listDownloads(workspace: string): Promise<DownloadJob[]> {
  return request<DownloadJob[]>(`/downloads?workspace=${encodeURIComponent(workspace)}`);
}

export function controlDownload(id: string, action: "pause" | "resume"): Promise<DownloadJob> {
  return request<DownloadJob>(`/downloads/${id}/${action}`, { method: "POST" });
}

export async function deleteDownload(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/downloads/${id}`, { method: "DELETE" });
}

export function downloadFileUrl(id: string): string {
  return `${BASE_URL}/api/downloads/${id}/file`;
}

export function getSyncState(workspace: string): Promise<SyncState> {
  return request<SyncState>(`/sync/state?workspace=${encodeURIComponent(workspace)}`);
}

export function putSyncState(workspace: string, sources: unknown, settings: Record<string, unknown>): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/sync/state", {
    method: "PUT",
    body: JSON.stringify({ workspace, sources, settings }),
  });
}
