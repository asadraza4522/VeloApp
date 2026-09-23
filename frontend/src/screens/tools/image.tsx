import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Button } from "@/components/button";
import { FilePicker } from "@/components/file-picker";
import { ToolScreen } from "@/components/tool-screen";
import { ProgressLine, ToolResult } from "@/components/tool-result";
import { fonts, fontSize, makeStyles, radius, spacing, tactileShadow } from "@/design/theme";
import { useToolRun } from "@/hooks/use-tool-run";
import { IMAGE_FORMATS, IMAGE_QUALITY, IMAGE_SIZES, imageName, savings, TOOLS_FOLDER } from "@/domain/tools/naming";
import { getTools } from "@/native";
import { useToolStore } from "@/stores/tool-store";
import { formatBytes } from "@/utils/format";

function Chips<T extends string | number>({ label, options, value, onChange }: { label: string; options: readonly { id?: T; label: string; value?: T }[]; value: T; onChange: (v: T) => void }) {
  const styles = useStyles();
  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chips}>
        {options.map((o) => {
          const v = (o.id ?? o.value) as T;
          return (
            <Pressable key={String(v)} onPress={() => onChange(v)} style={[styles.chip, v === value && styles.chipOn]} accessibilityRole="radio" accessibilityState={{ selected: v === value }}>
              <Text style={[styles.chipText, v === value && styles.chipTextOn]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function ImageToolScreen() {
  const styles = useStyles();
  const picked = useToolStore((s) => s.picked);
  const setPicked = useToolStore((s) => s.setPicked);
  const [format, setFormat] = useState<"jpg" | "png" | "webp">("jpg");
  const [quality, setQuality] = useState<number>(75);
  const [size, setSize] = useState<number>(0);
  const run = useToolRun<{ uri: string; size: number; name: string; width: number; height: number }>();

  useEffect(() => { setPicked(null); }, [setPicked]);

  const result = picked ? run.resultFor(picked.uri) : null;
  const go = () => picked && run.run(async () => {
    const name = imageName(picked.name, format, size);
    const r = await getTools().imageProcess(picked.uri, format, quality, size, name, TOOLS_FOLDER);
    return { ...r, name };
  }, picked.uri);

  return (
    <ToolScreen title="Image tools" intro="Convert between JPG, PNG and WebP, shrink the dimensions, or compress. The original is never changed.">
      <FilePicker kinds={["image"]} />
      <Chips label="Format" options={IMAGE_FORMATS} value={format} onChange={setFormat} />
      <Chips label="Quality (JPG / WebP)" options={IMAGE_QUALITY} value={quality} onChange={setQuality} />
      <Chips label="Longest side" options={IMAGE_SIZES} value={size} onChange={setSize} />
      <Button label="Convert" onPress={() => void go()} disabled={!picked || run.busy} loading={run.busy} />
      <ProgressLine busy={run.busy} progress={run.progress} onCancel={run.cancel} />
      {run.error !== "" && <Text style={styles.warn}>{run.error}</Text>}
      {result && (
        <ToolResult title={result.name} uri={result.uri} size={result.size}
          mime={format === "png" ? "image/png" : format === "webp" ? "image/webp" : "image/jpeg"}
          lines={[`${result.width}×${result.height}`, picked?.size ? (savings(picked.size, result.size) >= 0 ? `${savings(picked.size, result.size)}% smaller than ${formatBytes(picked.size)}` : `${-savings(picked.size, result.size)}% larger than the original`) : ""].filter(Boolean)} />
      )}
    </ToolScreen>
  );
}

const useStyles = makeStyles((c) => ({
  group: { gap: spacing.sm },
  label: { fontFamily: fonts.textMedium, fontSize: fontSize.caption, color: c.mutedSecondary },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.surfaceInset, ...tactileShadow(1.5, c.border) },
  chipOn: { backgroundColor: c.brandTertiary, borderWidth: 2 },
  chipText: { fontFamily: fonts.textMedium, fontSize: fontSize.caption, color: c.onSurfaceSecondary },
  chipTextOn: { color: c.onSurface, fontFamily: fonts.textSemiBold },
  warn: { fontFamily: fonts.textMedium, fontSize: fontSize.body, color: c.warning },
}));
