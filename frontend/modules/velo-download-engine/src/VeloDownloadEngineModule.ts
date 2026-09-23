import { NativeModule, requireNativeModule } from 'expo';

import type { EngineEvents, NativeDownloadJob, NativePart, NativeTaskStatus } from './VeloDownloadEngine.types';

declare class VeloDownloadEngineModule extends NativeModule<EngineEvents> {
  enqueue(job: NativeDownloadJob): Promise<string>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  retry(id: string, parts: NativePart[] | null): Promise<void>;
  ack(id: string): Promise<void>;
  getStatus(id: string): Promise<NativeTaskStatus | null>;
  listAll(): Promise<NativeTaskStatus[]>;
  setConstraints(c: { wifiOnly: boolean; maxConcurrent: number }): Promise<void>;
}

export default requireNativeModule<VeloDownloadEngineModule>('VeloDownloadEngine');
