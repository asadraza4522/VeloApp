import { useState } from "react";
import { Alert, Text } from "react-native";

import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { ToolScreen } from "@/components/tool-screen";
import { fonts, fontSize, makeStyles } from "@/design/theme";
import { findDuplicates, reclaimable, type DupGroup } from "@/domain/tools/duplicates";
import { getTools } from "@/native";
import { deleteFile, loadLiveFiles } from "@/screens/tools/library-helpers";
import { formatBytes } from "@/utils/format";

export function DuplicatesScreen() {
  const styles = useStyles();
  const [groups, setGroups] = useState<DupGroup[] | null>(null);
  const [byId, setById] = useState<Record<string, { title: string | null; downloadId: string }>>({});
  const [progress, setProgress] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const scan = async () => {
    setBusy(true); setMessage(""); setGroups(null);
    try {
      const files = await loadLiveFiles();
      setById(Object.fromEntries(files.map((f) => [f.downloadId, { title: f.title ?? f.name, downloadId: f.downloadId }])));
      const found = await findDuplicates(
        files.map((f) => ({ id: f.downloadId, uri: f.uri, size: f.realSize, createdAt: f.createdAt })),
        (f) => getTools().sha256(f.uri, `dup-${f.id}`),
        (d, t) => setProgress(`Comparing files… ${d}/${t}`),
      );
      setGroups(found);
    } catch {
      setMessage("Couldn't read some files. Try again.");
    } finally {
      setBusy(false); setProgress("");
    }
  };

  const removeExtras = () => {
    if (!groups) return;
    const n = groups.reduce((s, g) => s + g.extras.length, 0);
    Alert.alert(`Delete ${n} extra ${n === 1 ? "copy" : "copies"}?`, `Frees ${formatBytes(reclaimable(groups))}. One copy of each file is kept, and every source stays in your Library.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        setBusy(true);
        let removed = 0;
        for (const g of groups) for (const e of g.extras) if (await deleteFile({ uri: e.uri, downloadId: e.id })) removed++;
        setMessage(`Deleted ${removed} files.`);
        setGroups([]);
        setBusy(false);
      } },
    ]);
  };

  return (
    <ToolScreen title="Duplicate finder" intro="Finds downloaded files with identical content. Files are compared by size first, then by a checksum, so only real duplicates are listed.">
      <Button label={groups ? "Scan again" : "Scan my downloads"} onPress={() => void scan()} loading={busy} />
      {progress !== "" && <Text style={styles.meta}>{progress}</Text>}
      {groups && groups.length === 0 && <Text style={styles.meta}>No duplicates found.</Text>}
      {groups && groups.length > 0 && (
        <>
          <Text style={styles.meta}>{groups.length} sets of duplicates · {formatBytes(reclaimable(groups))} can be freed</Text>
          {groups.map((g) => (
            <Card key={g.hash}>
              <Text style={styles.title} numberOfLines={1}>{byId[g.keep.id]?.title}</Text>
              <Text style={styles.meta}>{formatBytes(g.size)} · keeping the oldest, {g.extras.length} extra {g.extras.length === 1 ? "copy" : "copies"}</Text>
            </Card>
          ))}
          <Button label="Delete extra copies" variant="secondary" onPress={removeExtras} loading={busy} />
        </>
      )}
      {message !== "" && <Text style={styles.ok}>{message}</Text>}
    </ToolScreen>
  );
}

const useStyles = makeStyles((c) => ({
  meta: { fontFamily: fonts.text, fontSize: fontSize.caption, color: c.mutedSecondary },
  ok: { fontFamily: fonts.textMedium, fontSize: fontSize.body, color: c.success },
  title: { fontFamily: fonts.textSemiBold, fontSize: fontSize.body, color: c.onSurface },
}));
