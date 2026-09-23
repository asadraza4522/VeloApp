import { useEffect } from "react";
import { Text } from "react-native";

import { Button } from "@/components/button";
import { FilePicker } from "@/components/file-picker";
import { ToolScreen } from "@/components/tool-screen";
import { ProgressLine, ToolResult } from "@/components/tool-result";
import { fonts, fontSize, makeStyles } from "@/design/theme";
import { useProbe } from "@/hooks/use-probe";
import { useToolRun } from "@/hooks/use-tool-run";
import { audioName, TOOLS_FOLDER } from "@/domain/tools/naming";
import { formatTime } from "@/domain/tools/time";
import { getTools } from "@/native";
import { useToolStore } from "@/stores/tool-store";

export function ExtractAudioScreen() {
  const styles = useStyles();
  const picked = useToolStore((s) => s.picked);
  const setPicked = useToolStore((s) => s.setPicked);
  const probe = useProbe(picked?.uri ?? null);
  const run = useToolRun<{ uri: string; size: number; name: string }>();

  useEffect(() => { setPicked(null); }, [setPicked]);
  const result = picked ? run.resultFor(picked.uri) : null;

  const extract = () => picked && run.run(async (opId) => {
    const name = audioName(picked.name);
    const r = await getTools().extractAudio(picked.uri, name, TOOLS_FOLDER, opId);
    return { ...r, name };
  }, picked.uri);

  return (
    <ToolScreen title="Extract audio" intro="Save the sound of a video as an .m4a file. Fast and lossless: nothing is re-encoded.">
      <FilePicker kinds={["video", "audio"]} />
      {probe && (
        <Text style={styles.meta}>
          {formatTime(probe.durationMs)} · {probe.hasAudio ? (probe.audioIsAac ? "AAC audio" : "audio is not AAC") : "no audio track"}
        </Text>
      )}
      {probe && probe.hasAudio && !probe.audioIsAac && <Text style={styles.warn}>This audio isn&apos;t AAC, so it can&apos;t be extracted without re-encoding. MP3/OPUS support comes with the FFmpeg module.</Text>}
      <Button label="Extract audio" onPress={() => void extract()} disabled={!picked || !probe?.hasAudio || run.busy} loading={run.busy} />
      <ProgressLine busy={run.busy} progress={run.progress} onCancel={run.cancel} />
      {run.error !== "" && <Text style={styles.warn}>{run.error}</Text>}
      {result && <ToolResult title={result.name} uri={result.uri} size={result.size} mime="audio/mp4" />}
    </ToolScreen>
  );
}

const useStyles = makeStyles((c) => ({
  meta: { fontFamily: fonts.text, fontSize: fontSize.caption, color: c.mutedSecondary },
  warn: { fontFamily: fonts.textMedium, fontSize: fontSize.body, color: c.warning },
}));
