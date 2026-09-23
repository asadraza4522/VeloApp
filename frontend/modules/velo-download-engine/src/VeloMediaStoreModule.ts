import { NativeModule, requireNativeModule } from 'expo';

import type { MediaStoreEvents } from './VeloDownloadEngine.types';

declare class VeloMediaStoreModule extends NativeModule<MediaStoreEvents> {
  exists(uri: string): Promise<boolean>;
  existsMany(uris: string[]): Promise<boolean[]>;
  delete(uri: string): Promise<boolean>;
  openInFiles(uri: string, mime: string): Promise<void>;
  shareFile(uri: string, mime: string): Promise<void>;
}

export default requireNativeModule<VeloMediaStoreModule>('VeloMediaStore');
