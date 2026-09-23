import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";

import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { FilePicker } from "@/components/file-picker";
import { ToolScreen } from "@/components/tool-screen";
import { ProgressLine, ToolResult } from "@/components/tool-result";
import { fonts, fontSize, makeStyles, radius, spacing, useTheme } from "@/design/theme";
import { useProbe } from "@/hooks/use-probe";
import { useToolRun } from "@/hooks/use-tool-run";
import { trimName, TOOLS_FOLDER } from "@/domain/tools/naming";
import { clampRange, formatTime, parseTime } from "@/domain/tools/time";
import { getTools } from "@/native";
import { useToolStore } from "@/stores/tool-store";

export function TrimScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const picked = useToolStore((s) => s.picked);
  const setPicked = useToolStore((s) => s.setPicked);
  const probe = useProbe(picked?.uri ?? null);
  // edits are keyed by file so picking another file starts from its own defaults
  const [edit, setEdit] = useState<{ uri: string; start?: string; end?: string } | null>(null);
  const mine = edit && edit.uri === picked?.uri ? edit : null;
  const start = mine?.start ?? "0:00";
  const end = mine?.end ?? (probe ? formatTime(probe.durationMs) : "");
  const setStart = (v: string) => picked && setEdit({ ...mine, uri: picked.uri, start: v });
  const setEnd = (v: string) => picked && setEdit({ ...mine, uri: picked.uri, end: v });
  const run = useToolRun<{ uri: string; size: number; name: string; startMs: number; kind: "video" | "audio" }>();

  useEffect(() => { setPicked(null); }, [setPicked]);
  const range = probe ? clampRange(parseTime(start), parseTime(end), probe.durationMs) : null;

  const result = picked ? run.resultFor(picked.uri) : null;
  const trim = () => picked && range?.ok && run.run(async (opId) => {
    const ext = probe?.hasVideo ? "mp4" : "m4a";
    const name = trimName(picked.name, range.startMs, range.endMs, ext);
    const r = await getTools().trim(picked.uri, range.startMs, range.endMs, name, TOOLS_FOLDER, opId);
    return { ...r, name };
  }, picked.uri);

  return (
    <ToolScreen title="Trim" intro="Cut a part of a video or audio file without losing quality. Without re-encoding, a cut can only start on a keyframe, so the start may move slightly earlier.">
      <FilePicker kinds={["video", "audio"]} />
      {probe && (
        <Card>
          <Text style={styles.meta}>Length {formatTime(probe.durationMs)}</Text>
          <View style={styles.row}>
            <View style={styles.field}><Text style={styles.label}>Start</Text><TextInput value={start} onChangeText={setStart} style={styles.input} placeholder="0:00" placeholderTextColor={colors.muted} keyboardType="numbers-and-punctuation" /></View>
            <View style={styles.field}><Text style={styles.label}>End</Text><TextInput value={end} onChangeText={setEnd} style={styles.input} placeholder="1:30" placeholderTextColor={colors.muted} keyboardType="numbers-and-punctuation" /></View>
          </View>
          {range && !range.ok && <Text style={styles.warn}>{range.error}</Text>}
        </Card>
      )}
      <Button label="Trim" onPress={() => void trim()} disabled={!range?.ok || run.busy} loading={run.busy} />
      <ProgressLine busy={run.busy} progress={run.progress} onCancel={run.cancel} />
      {run.error !== "" && <Text style={styles.warn}>{run.error}</Text>}
      {result && (
        <ToolResult title={result.name} uri={result.uri} size={result.size} mime={result.kind === "video" ? "video/mp4" : "audio/mp4"}
          lines={[`starts at ${formatTime(result.startMs)} (nearest keyframe)`]} />
      )}
    </ToolScreen>
  );
}

const useStyles = makeStyles((c) => ({
  row: { flexDirection: "row", gap: spacing.md },
  field: { flex: 1, gap: spacing.xs },
  label: { fontFamily: fonts.textMedium, fontSize: fontSize.caption, color: c.mutedSecondary },
  input: { height: 48, paddingHorizontal: spacing.lg, borderRadius: radius.sm, backgroundColor: c.surfaceInset, borderWidth: 1.5, borderColor: c.border, color: c.onSurface, fontFamily: fonts.mono, fontSize: fontSize.bodyLg },
  meta: { fontFamily: fonts.text, fontSize: fontSize.caption, color: c.mutedSecondary },
  warn: { fontFamily: fonts.textMedium, fontSize: fontSize.body, color: c.warning },
}));
