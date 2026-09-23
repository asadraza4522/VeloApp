import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppHeader, Card, Chip, ChipRow, EmptyState, Icon, ScreenHeading, SectionHeader, SourceCard, StatusPill } from "@/src/components/ui";
import { useBottomChrome } from "@/src/navigation";
import { Source, useAppState } from "@/src/state/app-state";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const filters = ["All", "Videos", "Audio", "Images"] as const;

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  searchWrap: {
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: c.surfaceTertiary,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: c.border,
    marginTop: spacing.xl,
  },
  searchInput: { flex: 1, color: c.onSurface, fontSize: 14, fontFamily: fonts.text, minHeight: 44 },
  chips: { marginTop: spacing.md },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  gridCard: {
    flexBasis: "47%",
    flexGrow: 1,
    height: 190,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: c.surfaceSecondary,
    borderWidth: 1,
    borderColor: c.border,
  },
  gridFallback: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceTertiary },
  gridScrim: { position: "absolute", left: 0, right: 0, bottom: 0, height: "70%" },
  gridCopy: { position: "absolute", left: spacing.md, right: spacing.md, bottom: spacing.md },
  gridTitle: { color: c.surfaceInverse, fontSize: 14, fontFamily: fonts.display, letterSpacing: 0.1 },
  gridMeta: { color: c.surfaceInverse, opacity: 0.72, fontSize: 11, fontFamily: fonts.text, marginTop: 2 },
  durationPill: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: c.surface + "CC",
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  durationText: { color: c.onSurface, fontSize: 10, fontFamily: fonts.textSemiBold },
  playBadge: {
    position: "absolute",
    top: spacing.sm,
    left: spacing.sm,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: c.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  sourceTitle: { color: c.onSurface, fontSize: 13, fontFamily: fonts.textMedium },
  sourceMeta: { color: c.muted, fontSize: 11, fontFamily: fonts.text, marginTop: 3 },
  tipCard: { flexDirection: "row", gap: spacing.md, alignItems: "center", borderColor: c.brandSecondary, marginTop: spacing.xs },
  body: { color: c.muted, fontSize: 13, lineHeight: 19, fontFamily: fonts.text },
}));

export default function LibraryScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { sources, notify, openSource } = useAppState();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const [grid, setGrid] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const bottomChrome = useBottomChrome();

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return sources.filter((source) => {
      const matchesQuery = !query || `${source.title} ${source.creator} ${source.platform}`.toLowerCase().includes(query);
      const matchesFilter =
        filter === "All" ||
        (filter === "Videos" && source.type === "VIDEO") ||
        (filter === "Audio" && source.type === "AUDIO") ||
        (filter === "Images" && source.type === "IMAGE");
      return matchesQuery && matchesFilter;
    });
  }, [sources, search, filter]);

  const refresh = () => {
    setRefreshing(true);
    setTimeout(() => {
      setRefreshing(false);
      notify("Library synced");
    }, 700);
  };

  const isPlayable = (source: Source) => Boolean(source.localUri || source.fileUrl);

  const renderGridCard = (source: Source) => (
    <Pressable
      key={source.id}
      testID={`source-${source.id}`}
      onPress={() => openSource(source)}
      style={({ pressed }) => [styles.gridCard, pressed && { opacity: 0.85 }]}
    >
      {source.thumbnail ? (
        <Image source={{ uri: source.thumbnail }} style={{ flex: 1 }} contentFit="cover" transition={200} />
      ) : (
        <View style={styles.gridFallback}>
          <Icon name={source.type === "AUDIO" ? "music-note-outline" : source.type === "IMAGE" ? "image-outline" : "play-outline"} size={30} color={colors.brandPrimary} />
        </View>
      )}
      {/* Mandatory scrim for overlaid text contrast */}
      <LinearGradient colors={["transparent", colors.surface + "E6"]} style={[styles.gridScrim, { pointerEvents: "none" }]} />
      <View style={styles.durationPill}>
        <Text style={styles.durationText}>{source.duration}</Text>
      </View>
      {isPlayable(source) ? (
        <View style={styles.playBadge} testID={`play-${source.id}`}>
          <Icon name="play" size={15} color={colors.onBrandPrimary} />
        </View>
      ) : null}
      <View style={styles.gridCopy}>
        <Text style={styles.gridTitle} numberOfLines={2}>{source.title}</Text>
        <Text style={styles.gridMeta} numberOfLines={1}>{source.platform} · {source.creator}</Text>
      </View>
    </Pressable>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <AppHeader />
      <KeyboardAwareScrollView
        bottomOffset={spacing.lg}
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomChrome + spacing.lg }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brandPrimary} />}
      >
        <ScreenHeading eyebrow="Your library" title="Everything you saved." description="Sources stay here even when a local file is missing." />

        <View style={styles.searchWrap}>
          <Icon name="magnify" size={19} color={colors.muted} />
          <TextInput
            testID="library-search"
            value={search}
            onChangeText={setSearch}
            placeholder="Search titles, creators, platforms"
            placeholderTextColor={colors.muted}
            style={styles.searchInput}
          />
        </View>

        <View style={styles.chips}>
          <ChipRow>
            {filters.map((item) => (
              <Chip key={item} testID={`library-filter-${item.toLowerCase()}`} label={item} active={filter === item} onPress={() => setFilter(item)} />
            ))}
          </ChipRow>
        </View>

        <SectionHeader title={`${filtered.length} saved sources`} />
        <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: -spacing.xl - spacing.md, marginBottom: spacing.sm }}>
          <Pressable testID="layout-toggle" onPress={() => setGrid(!grid)} hitSlop={8} accessibilityLabel="Toggle grid layout">
            <Icon name={grid ? "view-agenda-outline" : "view-grid-outline"} size={20} color={colors.muted} />
          </Pressable>
        </View>

        {filtered.length ? (
          grid ? (
            <View style={styles.grid}>{filtered.map(renderGridCard)}</View>
          ) : (
            filtered.map((source) => <SourceCard key={source.id} source={source} />)
          )
        ) : (
          <EmptyState
            testID="library-empty"
            icon="magnify-close"
            title="Your vault is empty."
            body="Try another title, creator, or platform."
            actionLabel="Explore Home"
            onAction={() => router.push("/")}
          />
        )}

        <Card style={styles.tipCard}>
          <Icon name="lightbulb-on-outline" size={20} color={colors.brandPrimary} />
          <Text style={[styles.body, { flex: 1 }]}>File missing? The source remains available for a fresh download.</Text>
        </Card>
      </KeyboardAwareScrollView>
    </View>
  );
}
