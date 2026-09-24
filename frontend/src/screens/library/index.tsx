import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AdBanner } from "@/components/ad-banner";
import { DownloadRow } from "@/components/download-row";
import { SourceRow } from "@/components/source-row";
import { useQueue, useSources } from "@/db/hooks";
import type { QueueRow } from "@/db/queries/downloads";
import type { Source } from "@/db/queries/sources";
import { fonts, fontSize, makeStyles, radius, spacing, tactileShadow, useTheme } from "@/design/theme";
import { useTabBarHeight } from "@/hooks/use-tab-bar-height";
import { useUiStore } from "@/stores/ui-store";

const PAGE = 100;

const renderMedia = ({ item }: { item: QueueRow }) => <DownloadRow row={item} />;
const COMPLETED = ["COMPLETED"] as const;

function Segment({ value, current, onPress }: { value: "media" | "sources"; current: string; onPress: (v: "media" | "sources") => void }) {
  const styles = useStyles();
  const active = value === current;
  return (
    <Pressable onPress={() => onPress(value)} style={[styles.segment, active && styles.segmentActive]}>
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{value === "media" ? "Media" : "Sources"}</Text>
    </Pressable>
  );
}

function SourcesList({ search }: { search: string }) {
  const router = useRouter();
  const open = useCallback((id: string) => router.push({ pathname: "/source/[id]", params: { id } }), [router]);
  const renderSource = useCallback(({ item }: { item: Source }) => <SourceRow source={item} onPress={open} />, [open]);
  const [limit, setLimit] = useState(PAGE);
  const data = useSources({ search }, limit);
  const more = useCallback(() => data.length >= limit && setLimit((l) => l + PAGE), [data.length, limit]);
  return <FlashList data={data} renderItem={renderSource} keyExtractor={keyId} onEndReached={more} onEndReachedThreshold={1} />;
}

function MediaList() {
  const [limit, setLimit] = useState(PAGE);
  const data = useQueue(COMPLETED, limit);
  const more = useCallback(() => data.length >= limit && setLimit((l) => l + PAGE), [data.length, limit]);
  return <FlashList data={data} renderItem={renderMedia} keyExtractor={keyId} onEndReached={more} onEndReachedThreshold={1} />;
}

const keyId = (item: { id: string }) => item.id;

export function LibraryScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useTabBarHeight();
  const segment = useUiStore((s) => s.librarySegment);
  const setSegment = useUiStore((s) => s.setLibrarySegment);
  const search = useUiStore((s) => s.librarySearch);
  const setSearch = useUiStore((s) => s.setLibrarySearch);

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: tabBarHeight }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Library</Text>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search title, creator, platform, URL"
          placeholderTextColor={colors.muted}
          style={styles.search}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        <View style={styles.segments}>
          <Segment value="media" current={segment} onPress={setSegment} />
          <Segment value="sources" current={segment} onPress={setSegment} />
        </View>
      </View>
      {segment === "sources" ? <SourcesList search={search} /> : <MediaList />}
      <AdBanner />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { padding: spacing.lg, gap: spacing.md, borderBottomWidth: 1.5, borderBottomColor: c.border },
  title: { fontFamily: fonts.display, fontSize: fontSize.h1, color: c.onSurface },
  search: { height: 44, paddingHorizontal: spacing.lg, borderRadius: radius.sm, backgroundColor: c.surfaceInset, borderWidth: 1.5, borderColor: c.border, color: c.onSurface, fontFamily: fonts.text, fontSize: fontSize.body, ...tactileShadow(1.5, c.border) },
  segments: { flexDirection: "row", padding: 3, borderRadius: radius.sm, backgroundColor: c.surfaceInset, borderWidth: 1.5, borderColor: c.border },
  segment: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.sm },
  segmentActive: { backgroundColor: c.brandPrimary },
  segmentText: { fontFamily: fonts.textMedium, fontSize: fontSize.body, color: c.mutedSecondary },
  segmentTextActive: { fontFamily: fonts.textSemiBold, color: c.onBrandPrimary },
}));
