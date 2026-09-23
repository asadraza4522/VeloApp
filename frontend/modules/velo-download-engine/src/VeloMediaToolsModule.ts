import { NativeModule, requireNativeModule } from 'expo';

import type { MediaEntry, MediaProbe, MediaToolsEvents, ToolResult } from './VeloDownloadEngine.types';

declare class VeloMediaToolsModule extends NativeModule<MediaToolsEvents> {
  probe(uri: string): Promise<MediaProbe>;
  extractAudio(uri: string, filename: string, relPath: string, opId: string): Promise<ToolResult>;
  trim(uri: string, startMs: number, endMs: number, filename: string, relPath: string, opId: string): Promise<ToolResult & { startMs: number; kind: 'video' | 'audio' }>;
  frame(uri: string, atMs: number, format: 'jpg' | 'png', filename: string, relPath: string): Promise<ToolResult>;
  imageProcess(uri: string, format: 'jpg' | 'png' | 'webp', quality: number, maxDimension: number, filename: string, relPath: string): Promise<ToolResult & { width: number; height: number }>;
  sha256(uri: string, opId: string): Promise<string>;
  cancel(opId: string): Promise<void>;
  describe(uri: string): Promise<MediaEntry | null>;
  describeMany(uris: string[]): Promise<(MediaEntry | null)[]>;
  move(uri: string, relPath: string, name: string, kind: string): Promise<boolean>;
}

export default requireNativeModule<VeloMediaToolsModule>('VeloMediaTools');
