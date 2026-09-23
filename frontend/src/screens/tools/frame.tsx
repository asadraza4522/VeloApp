import { Image } from "expo-image";
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
import { frameName, TOOLS_FOLDER } from "@/domain/tools/naming";
import { formatTime, parseTime } from "@/domain/tools/time";
import { getTools } from "@/native";
import { useToolStore } from "@/stores/tool-store";

export function FrameScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const picked = useToolStore((s) => s.picked);
  const setPicked = useToolStore((s) => s.setPicked);
  const probe = useProbe(picked?.uri ?? null);
  const [edit, setEdit] = useState<{ uri: string; at: string } | null>(null);
  const at = edit && edit.uri === picked?.uri ? edit.at : probe ? formatTime(probe.durationMs / 2) : "0:00";
  const setAt = (v: string) => picked && setEdit({ uri: picked.uri, at: v });
  const [format, setFormat] = useState<"jpg" | "png">("jpg");
  const run = useToolRun<{ uri: string; size: number; name: string }>();

  useEffect(() => { setPicked(null); }, [setPicked]);
  const ms = parseTime(at);
  const valid = probe != null && ms != null && ms <= probe.durationMs;

  const result = picked ? run.resultFor(picked.uri) : null;
  const grab = () => picked && ms != null && run.run(async () => {
    const name = frameName(picked.name, ms, format);
    const r = await getTools().frame(picked.uri, ms, format, name, TOOLS_FOLDER);
    return { ...r, name };
  }, picked.uri);

  return (
    <ToolScreen title="Grab a frame" intro="Save one picture from a video at the time you choose.">
      <FilePicker kinds={["video"]} />
      {probe && (
        <Card>
          <Text style={styles.meta}>Video length {formatTime(probe.durationMs)}</Text>
          <TextInput value={at} onChangeText={setAt} style={styles.input} placeholder="1:23" placeholderTextColor={colors.muted} keyboardType="numbers-and-punctuation" />
          <View style={styles.row}>
            <Button label="JPG" variant={format === "jpg" ? "primary" : "ghost"} grow onPress={() => setFormat("jpg")} />
            <Button label="PNG" variant={format === "png" ? "primary" : "ghost"} grow onPress={() => setFormat("png")} />
          </View>
          {!valid && <Text style={styles.warn}>Enter a time inside the video, like 1:23.</Text>}
        </Card>
      )}
      <Button label="Save frame" onPress={() => void grab()} disabled={!valid || run.busy} loading={run.busy} />
      <ProgressLine busy={run.busy} progress={run.progress} onCancel={run.cancel} />
      {run.error !== "" && <Text style={styles.warn}>{run.error}</Text>}
      {result && (
        <>
          <Image source={result.uri} style={styles.preview} contentFit="contain" />
          <ToolResult title={result.name} uri={result.uri} size={result.size} mime={format === "png" ? "image/png" : "image/jpeg"} />
        </>
      )}
    </ToolScreen>
  );
}

const useStyles = makeStyles((c) => ({
  row: { flexDirection: "row", gap: spacing.md },
  input: { height: 48, paddingHorizontal: spacing.lg, borderRadius: radius.sm, backgroundColor: c.surfaceInset, borderWidth: 1.5, borderColor: c.border, color: c.onSurface, fontFamily: fonts.mono, fontSize: fontSize.bodyLg },
  meta: { fontFamily: fonts.text, fontSize: fontSize.caption, color: c.mutedSecondary },
  warn: { fontFamily: fonts.textMedium, fontSize: fontSize.body, color: c.warning },
  preview: { width: "100%", aspectRatio: 16 / 9, borderRadius: radius.sm, backgroundColor: c.surfaceSecondary, borderWidth: 1.5, borderColor: c.border },
}));
