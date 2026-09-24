export type TaskState = 'QUEUED' | 'DOWNLOADING' | 'PROCESSING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELED';

/** PRD §16 failure codes plus engine-specific ones (URL_EXPIRED: re-resolve once; STORAGE_FULL). */
export type EngineErrorCode =
  | 'URL_EXPIRED' | 'NETWORK_ERROR' | 'AUTH_REQUIRED' | 'MEDIA_NOT_FOUND' | 'RATE_LIMITED'
  | 'SERVER_ERROR' | 'FORMAT_UNAVAILABLE' | 'STORAGE_FULL' | 'UNKNOWN';

export type NativePart = {
  url: string;
  headers: Record<string, string>;
  expectedSize?: number | null;
  role: 'main' | 'video' | 'audio';
};

export type NativeDownloadJob = {
  taskId: string;
  parts: NativePart[];
  kind: 'video' | 'audio' | 'image' | 'file';
  relativePath: string;
  filename: string;
  mime: string;
  postProcess: 'none' | 'mux' | 'mux-ffmpeg' | 'extract-audio';
  title: string;
};

export type NativeTaskStatus = {
  taskId: string;
  state: TaskState;
  bytes: number;
  total: number | null;
  errorCode: EngineErrorCode | null;
  errorMessage: string | null;
  uri: string | null;
  filename: string;
  kind: string;
  updatedAt: number;
};

export type EngineEvents = {
  onProgress: (e: { taskId: string; bytes: number; total?: number; bytesPerSec: number }) => void;
  onStateChange: (e: { taskId: string; state: TaskState; errorCode?: EngineErrorCode; errorMessage?: string }) => void;
  onComplete: (e: { taskId: string; uri: string; filename: string; size: number }) => void;
};

export type MediaStoreEvents = { onMediaChanged: () => void };

export type MediaProbe = {
  durationMs: number; hasVideo: boolean; hasAudio: boolean; width: number; height: number; audioIsAac: boolean; mimes: string[];
};
export type ToolResult = { uri: string; size: number };
export type MediaEntry = { name: string; relativePath: string; size: number; mime: string };
export type MediaToolsEvents = { onToolProgress: (e: { opId: string; progress: number }) => void };
