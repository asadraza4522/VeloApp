// Storage cleaner: what Velo's downloads use, by platform, and which files to remove. The sources are never touched.

export type StoredFile = { id: string; uri: string; platform: string; kind: string; size: number; createdAt: number; title: string | null };
export type PlatformUsage = { platform: string; bytes: number; count: number };

export function usageByPlatform(files: StoredFile[]): PlatformUsage[] {
  const m = new Map<string, PlatformUsage>();
  for (const f of files) {
    const u = m.get(f.platform) ?? { platform: f.platform, bytes: 0, count: 0 };
    u.bytes += f.size;
    u.count++;
    m.set(f.platform, u);
  }
  return [...m.values()].sort((a, b) => b.bytes - a.bytes);
}

export const totalBytes = (files: StoredFile[]) => files.reduce((n, f) => n + f.size, 0);

export const olderThan = <T extends StoredFile>(files: T[], days: number, now = Date.now()) =>
  files.filter((f) => f.createdAt < now - days * 86_400_000);

export const largest = <T extends StoredFile>(files: T[], n = 20) => [...files].sort((a, b) => b.size - a.size).slice(0, n);
