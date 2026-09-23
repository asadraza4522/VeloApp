import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fonts, fontSize, makeStyles, radius, spacing, tactileShadow, useTheme } from "@/design/theme";

type Tool = { route: "/tool/extract-audio" | "/tool/trim" | "/tool/image" | "/tool/frame" | "/tool/reorganize" | "/tool/duplicates" | "/tool/storage"; icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"]; title: string; desc: string };

const MEDIA: Tool[] = [
  { route: "/tool/extract-audio", icon: "music-note", title: "Extract audio", desc: "Save the sound of a video as M4A" },
  { route: "/tool/trim", icon: "content-cut", title: "Trim", desc: "Cut a video or audio file, no quality loss" },
  { route: "/tool/image", icon: "image-edit", title: "Image tools", desc: "Convert, resize and compress images" },
  { route: "/tool/frame", icon: "camera-image", title: "Grab a frame", desc: "Save a picture from a video" },
];
const LIBRARY: Tool[] = [
  { route: "/tool/reorganize", icon: "folder-swap", title: "Re-organize library", desc: "Apply your folder and name templates" },
  { route: "/tool/duplicates", icon: "content-duplicate", title: "Duplicate finder", desc: "Find and remove identical files" },
  { route: "/tool/storage", icon: "database", title: "Storage", desc: "See usage and free space" },
];

function Card({ t }: { t: Tool }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && styles.cardPressed]} onPress={() => router.push(t.route)} accessibilityRole="button" accessibilityLabel={`${t.title}. ${t.desc}`}>
      <View style={styles.icon}><MaterialCommunityIcons name={t.icon} size={20} color={colors.onSurface} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{t.title}</Text>
        <Text style={styles.desc}>{t.desc}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={22} color={colors.muted} />
    </Pressable>
  );
}

export function ToolsScreen() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingTop: insets.top, paddingBottom: spacing.xxxl }}>
      <Text style={styles.heading}>Tools</Text>
      <Text style={styles.section}>Media</Text>
      {MEDIA.map((t) => <Card key={t.route} t={t} />)}
      <Text style={styles.section}>Library</Text>
      {LIBRARY.map((t) => <Card key={t.route} t={t} />)}
      <Text style={styles.note}>More conversions (MP3, OPUS, video formats, compression) arrive with the FFmpeg update.</Text>
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  heading: { padding: spacing.lg, fontFamily: fonts.display, fontSize: fontSize.h1, color: c.onSurface, borderBottomWidth: 1.5, borderBottomColor: c.border },
  section: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm, fontFamily: fonts.overline, fontSize: fontSize.overline, color: c.mutedSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginHorizontal: spacing.lg, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.sm, backgroundColor: c.surfaceTertiary, borderWidth: 1.5, borderColor: c.border, ...tactileShadow(2, c.border) },
  cardPressed: { transform: [{ translateX: 2 }, { translateY: 2 }], shadowOpacity: 0, elevation: 0 },
  icon: { width: 40, height: 40, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceInset, borderWidth: 1.5, borderColor: c.border },
  title: { fontFamily: fonts.textSemiBold, fontSize: fontSize.bodyLg, color: c.onSurface },
  desc: { fontFamily: fonts.text, fontSize: fontSize.caption, color: c.mutedSecondary },
  note: { margin: spacing.lg, fontFamily: fonts.text, fontSize: fontSize.caption, color: c.mutedSecondary },
}));
