// Native: pull a finished server-side file into on-device storage with progress.
import * as FileSystem from "expo-file-system/legacy";

export async function saveFileToDevice(
  url: string,
  filename: string,
  onProgress: (pct: number) => void,
): Promise<string> {
  const dir = `${FileSystem.documentDirectory ?? ""}velo/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const task = FileSystem.createDownloadResumable(url, dir + filename, {}, (progress) => {
    const total = progress.totalBytesExpectedToWrite || 0;
    onProgress(total ? progress.totalBytesWritten / total : 0);
  });
  const result = await task.downloadAsync();
  if (!result) throw new Error("Download failed");
  return result.uri;
}
