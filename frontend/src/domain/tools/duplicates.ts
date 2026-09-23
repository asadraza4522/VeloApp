// Duplicate finder (PRD §39): same size first (cheap), then a content hash only for those candidates.

export type FileRef = { id: string; uri: string; size: number; createdAt: number };
export type DupGroup = { hash: string; size: number; keep: FileRef; extras: FileRef[] };

export async function findDuplicates(
  files: FileRef[],
  hash: (f: FileRef) => Promise<string>,
  onProgress?: (done: number, total: number) => void,
): Promise<DupGroup[]> {
  const bySize = new Map<number, FileRef[]>();
  for (const f of files) if (f.size > 0) bySize.set(f.size, [...(bySize.get(f.size) ?? []), f]);
  const candidates = [...bySize.values()].filter((g) => g.length > 1);
  const total = candidates.reduce((n, g) => n + g.length, 0);

  const groups: DupGroup[] = [];
  let done = 0;
  for (const same of candidates) {
    const byHash = new Map<string, FileRef[]>();
    for (const f of same) {
      const h = await hash(f);
      byHash.set(h, [...(byHash.get(h) ?? []), f]);
      onProgress?.(++done, total);
    }
    for (const [h, g] of byHash) {
      if (g.length < 2) continue;
      const sorted = [...g].sort((a, b) => a.createdAt - b.createdAt); // keep the oldest copy
      groups.push({ hash: h, size: sorted[0].size, keep: sorted[0], extras: sorted.slice(1) });
    }
  }
  return groups.sort((a, b) => b.size * b.extras.length - a.size * a.extras.length);
}

/** How much space deleting every extra would free. */
export const reclaimable = (groups: DupGroup[]) => groups.reduce((n, g) => n + g.size * g.extras.length, 0);
