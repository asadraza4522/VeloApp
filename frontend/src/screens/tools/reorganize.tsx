import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/button";
import { ToolScreen } from "@/components/tool-screen";
import { db } from "@/db/client";
import { setFilename } from "@/db/queries/downloads";
import { getNaming } from "@/db/queries/settings";
import { fonts, fontSize, makeStyles, radius, spacing } from "@/design/theme";
import { planReorganize, type Move } from "@/domain/tools/reorganize";
import { getTools } from "@/native";
import { kindOf, loadLiveFiles } from "@/screens/tools/library-helpers";

export function ReorganizeScreen() {
  const styles = useStyles();
  const [moves, setMoves] = useState<Move[] | null>(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const scan = async () => {
    const files = await loadLiveFiles();
    setTotal(files.length);
    setMoves(planReorganize(files.map((f) => ({
      downloadId: f.downloadId, uri: f.uri, kind: kindOf(f.mediaType), platform: f.platform, creator: f.creator, title: f.title, resolution: f.resolution,
      ext: (f.name.split(".").pop() ?? "bin"), createdAt: f.createdAt, currentPath: f.path, currentName: f.name,
    })), getNaming(db)));
  };
  // async loader: setState happens after the awaits, not synchronously in the effect body
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void scan().catch(() => setMoves([])); }, []);

  const apply = async () => {
    if (!moves?.length) return;
    setBusy(true);
    let ok = 0;
    for (const m of moves) {
      if (await getTools().move(m.uri, m.toPath, m.toName, m.kind)) { setFilename(db, m.downloadId, m.toName); ok++; }
    }
    setMessage(`${ok} of ${moves.length} files moved${ok < moves.length ? ". Some couldn't be moved (Android only lets an app change files it created)." : "."}`);
    setBusy(false);
    await scan();
  };

  return (
    <ToolScreen title="Re-organize library" intro="Apply your folder and file-name templates (Settings → Organization) to files you already downloaded. Only files inside Velo's own folder are touched.">
      {moves === null ? <Text style={styles.meta}>Checking your files…</Text> : (
        <>
          <Text style={styles.meta}>{moves.length === 0 ? `All ${total} files already match your templates.` : `${moves.length} of ${total} files would change.`}</Text>
          {moves.slice(0, 30).map((m) => (
            <View key={m.downloadId} style={styles.row}>
              <Text style={styles.from} numberOfLines={1}>{m.fromPath}/{m.fromName}</Text>
              <Text style={styles.to} numberOfLines={1}>→ {m.toPath ? `${m.toPath}/` : ""}{m.toName}</Text>
            </View>
          ))}
          {moves.length > 30 && <Text style={styles.meta}>…and {moves.length - 30} more</Text>}
          {moves.length > 0 && <Button label={`Move ${moves.length} files`} onPress={() => void apply()} loading={busy} />}
        </>
      )}
      {message !== "" && <Text style={styles.ok}>{message}</Text>}
    </ToolScreen>
  );
}

const useStyles = makeStyles((c) => ({
  meta: { fontFamily: fonts.textMedium, fontSize: fontSize.body, color: c.onSurfaceSecondary },
  ok: { fontFamily: fonts.textMedium, fontSize: fontSize.body, color: c.success },
  row: { gap: 2, padding: spacing.md, borderRadius: radius.sm, backgroundColor: c.surfaceTertiary, borderWidth: 1.5, borderColor: c.border },
  from: { fontFamily: fonts.mono, fontSize: fontSize.caption, color: c.mutedSecondary },
  to: { fontFamily: fonts.mono, fontSize: fontSize.caption, color: c.onSurface },
}));
