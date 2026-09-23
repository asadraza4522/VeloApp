import { FlashList } from "@shopify/flash-list";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";

import { db } from "@/db/client";
import { listLibraryFiles, type LibraryFile } from "@/db/queries/downloads";
import { fonts, fontSize, makeStyles, spacing, useTheme } from "@/design/theme";
import { useToolStore, type PickedFile } from "@/stores/tool-store";
import { formatBytes } from "@/utils/format";

export function PickLibraryScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const setPicked = useToolStore((s) => s.setPicked);
  const { kinds = "video,audio,image" } = useLocalSearchParams<{ kinds?: string }>();
  const wanted = kinds.split(",");
  const files = useMemo(() => listLibraryFiles(db).filter((f) => wanted.includes(f.mediaType === "unknown" ? "video" : f.mediaType)), [kinds]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (f: LibraryFile) => {
    const kind: PickedFile["kind"] = f.mediaType === "audio" ? "audio" : f.mediaType === "image" ? "image" : "video";
    setPicked({ uri: f.uri!, name: f.filename ?? f.title ?? "file", kind, size: f.size, origin: "library" });
    router.back();
  };

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: true, title: "Choose from library", headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.onSurface }} />
      {files.length === 0 ? (
        <Text style={styles.empty}>No downloaded files of this type yet.</Text>
      ) : (
        <FlashList
          data={files}
          keyExtractor={(f) => f.downloadId}
          renderItem={({ item }) => (
            <Pressable onPress={() => choose(item)} style={styles.row}>
              <Text style={styles.title} numberOfLines={1}>{item.title ?? item.filename}</Text>
              <Text style={styles.meta}>{[item.platform, item.resolution, formatBytes(item.size)].filter(Boolean).join(" · ")}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  empty: { padding: spacing.xl, textAlign: "center", fontFamily: fonts.text, fontSize: fontSize.body, color: c.mutedSecondary },
  row: { gap: 2, padding: spacing.lg, borderBottomWidth: 1.5, borderBottomColor: c.border },
  title: { fontFamily: fonts.textSemiBold, fontSize: fontSize.bodyLg, color: c.onSurface },
  meta: { fontFamily: fonts.text, fontSize: fontSize.caption, color: c.mutedSecondary },
}));
