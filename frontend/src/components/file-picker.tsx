import * as DocumentPicker from "expo-document-picker";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";

import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { fonts, fontSize, makeStyles, spacing } from "@/design/theme";
import { kindOfMime, useToolStore, type PickedFile } from "@/stores/tool-store";
import { formatBytes } from "@/utils/format";

type Kind = PickedFile["kind"];

/** Choose the input for a tool: a file Velo downloaded, or any file on the device (system picker). */
export function FilePicker({ kinds }: { kinds: Kind[] }) {
  const styles = useStyles();
  const router = useRouter();
  const picked = useToolStore((s) => s.picked);
  const setPicked = useToolStore((s) => s.setPicked);
  const mimes = kinds.map((k) => `${k}/*`);

  const fromDevice = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: mimes, copyToCacheDirectory: false });
    const a = r.assets?.[0];
    if (!r.canceled && a) setPicked({ uri: a.uri, name: a.name, kind: kindOfMime(a.mimeType), size: a.size ?? null, origin: "device" });
  };

  return (
    <Card>
      <Text style={styles.label}>{picked ? picked.name : "No file selected"}</Text>
      {picked && <Text style={styles.meta}>{[picked.kind, picked.size ? formatBytes(picked.size) : null, picked.origin === "library" ? "from your library" : "from this device"].filter(Boolean).join(" · ")}</Text>}
      <View style={styles.row}>
        <Button label="My library" variant="secondary" grow onPress={() => router.push({ pathname: "/tool/pick-library", params: { kinds: kinds.join(",") } })} />
        <Button label="This device" variant="secondary" grow onPress={() => void fromDevice()} />
      </View>
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  label: { fontFamily: fonts.textSemiBold, fontSize: fontSize.bodyLg, color: c.onSurface },
  meta: { fontFamily: fonts.text, fontSize: fontSize.caption, color: c.mutedSecondary },
  row: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm },
}));
