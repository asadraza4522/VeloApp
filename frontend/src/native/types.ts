import type { EngineEvents, MediaEntry, MediaProbe, MediaStoreEvents, MediaToolsEvents, NativeDownloadJob, NativePart, NativeTaskStatus, ToolResult } from "@velo/native";

type Subscription = { remove(): void };

// PRD §59 (+ listAll/ack/setConstraints), as consumed by the app. The native module satisfies this structurally.
export interface DownloadEngineApi {
  enqueue(job: NativeDownloadJob): Promise<string>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  retry(id: string, parts: NativePart[] | null): Promise<void>;
  ack(id: string): Promise<void>;
  getStatus(id: string): Promise<NativeTaskStatus | null>;
  listAll(): Promise<NativeTaskStatus[]>;
  setConstraints(c: { wifiOnly: boolean; maxConcurrent: number }): Promise<void>;
  addListener<K extends keyof EngineEvents>(event: K, listener: EngineEvents[K]): Subscription;
}

export interface MediaStoreApi {
  existsMany(uris: string[]): Promise<boolean[]>;
  delete(uri: string): Promise<boolean>;
  openInFiles(uri: string, mime: string): Promise<void>;
  shareFile(uri: string, mime: string): Promise<void>;
  addListener<K extends keyof MediaStoreEvents>(event: K, listener: MediaStoreEvents[K]): Subscription;
}

export interface MediaToolsApi {
  probe(uri: string): Promise<MediaProbe>;
  extractAudio(uri: string, filename: string, relPath: string, opId: string): Promise<ToolResult>;
  trim(uri: string, startMs: number, endMs: number, filename: string, relPath: string, opId: string): Promise<ToolResult & { startMs: number; kind: "video" | "audio" }>;
  frame(uri: string, atMs: number, format: "jpg" | "png", filename: string, relPath: string): Promise<ToolResult>;
  imageProcess(uri: string, format: "jpg" | "png" | "webp", quality: number, maxDimension: number, filename: string, relPath: string): Promise<ToolResult & { width: number; height: number }>;
  sha256(uri: string, opId: string): Promise<string>;
  cancel(opId: string): Promise<void>;
  describe(uri: string): Promise<MediaEntry | null>;
  describeMany(uris: string[]): Promise<(MediaEntry | null)[]>;
  move(uri: string, relPath: string, name: string, kind: string): Promise<boolean>;
  addListener<K extends keyof MediaToolsEvents>(event: K, listener: MediaToolsEvents[K]): Subscription;
}

export type { NativeDownloadJob, NativePart, NativeTaskStatus };
