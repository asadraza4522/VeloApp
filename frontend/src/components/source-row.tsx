import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { memo } from "react";
import { Pressable, Text, View } from "react-native";

import { StatusChip } from "@/components/status-chip";
import type { Source } from "@/db/queries/sources";
import { fonts, fontSize, makeStyles, radius, spacing, tactileShadow, useTheme } from "@/design/theme";
import { sourceStatusView } from "@/domain/status-view";
import { formatDuration } from "@/utils/format";

export const SourceRow = memo(function SourceRow({ source, onPress }: { source: Source; onPress?: (id: string) => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const meta = [source.creatorName, source.platform, formatDuration(source.durationMs)].filter(Boolean).join(" · ");
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && styles.pressed]} onPress={onPress ? () => onPress(source.id) : undefined} accessibilityRole="button">
      {source.thumbnailUrl ? (
        <Image source={source.thumbnailUrl} style={styles.thumb} contentFit="cover" recyclingKey={source.id} />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]}>
          <MaterialCommunityIcons name={source.mediaType === "audio" ? "music-note" : source.mediaType === "image" ? "image" : "play"} size={20} color={colors.muted} />
        </View>
      )}
      <View style={styles.body}>
        <Text numberOfLines={1} style={styles.title}>{source.title ?? source.originalUrl}</Text>
        <Text numberOfLines={1} style={styles.meta}>{meta}</Text>
        <StatusChip view={sourceStatusView(source.status)} />
      </View>
      {source.favorite && <MaterialCommunityIcons name="star" size={18} color={colors.warning} />}
    </Pressable>
  );
});

const useStyles = makeStyles((c) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: c.surfaceTertiary,
    borderWidth: 1.5,
    borderColor: c.border,
    ...tactileShadow(2, c.border),
  },
  pressed: { transform: [{ translateX: 2 }, { translateY: 2 }], shadowOpacity: 0, elevation: 0 },
  thumb: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: c.surfaceSecondary, borderWidth: 1.5, borderColor: c.border },
  thumbEmpty: { alignItems: "center", justifyContent: "center" },
  body: { flex: 1, gap: spacing.xs, alignItems: "flex-start" },
  title: { fontFamily: fonts.textSemiBold, fontSize: fontSize.bodyLg, color: c.onSurface },
  meta: { fontFamily: fonts.text, fontSize: fontSize.caption, color: c.mutedSecondary },
}));
