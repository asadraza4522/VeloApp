import { BlurView } from "expo-blur";
import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { createDownload, resolveMedia, ResolvedMedia } from "@/src/api";
import {
  AppHeader,
  Card,
  Chip,
  ChipRow,
  GhostButton,
  Icon,
  MiniButton,
  PrimaryButton,
  ScreenHeading,
  SectionHeader,
  SourceCard,
} from "@/src/components/ui";
import { useBottomChrome } from "@/src/navigation";
import { useAppState } from "@/src/state/app-state";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const HERO_BG =
  "https://images.pexels.com/photos/9665193/pexels-photo-9665193.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  // Clipboard smart-detect pill
  clipPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: c.surfaceTertiary,
    borderWidth: 1,
    borderColor: c.brandSecondary,
    borderRadius: radius.pill,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    minHeight: 44,
    marginTop: spacing.lg,
  },
  clipText: { flex: 1, color: c.onSurfaceSecondary, fontSize: 12, fontFamily: fonts.textMedium },
  clipAction: {
    backgroundColor: c.brandPrimary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  clipActionText: { color: c.onBrandPrimary, fontSize: 12, fontFamily: fonts.textSemiBold },
  clipDismiss: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  // Cinematic hero: texture backdrop + scrim + glass resolver card
  hero: {
    borderRadius: radius.lg,
    marginTop: spacing.xl,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: c.border,
  },
  heroInner: { padding: spacing.lg },
  heroScrim: { ...StyleSheet.absoluteFillObject },
  heroKicker: { fontSize: 10, fontFamily: fonts.textSemiBold, letterSpacing: 2 },
  heroTitle: { fontSize: 24, fontFamily: fonts.display, letterSpacing: 0.2, marginTop: spacing.xs },
  glassCard: {
    marginTop: spacing.lg,
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: 1,
  },
  glassTint: { padding: spacing.md },
  inputRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  input: { flex: 1, fontSize: 14, fontFamily: fonts.text, minHeight: 44 },
  iconButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  heroNote: { fontSize: 10, fontFamily: fonts.textSemiBold, letterSpacing: 1.2, marginTop: spacing.md },
  // States
  analyzingRow: { flexDirection: "row", gap: spacing.md, alignItems: "center", marginTop: spacing.md },
  analyzingText: { fontSize: 13, fontFamily: fonts.textMedium, flex: 1 },
  errorCard: { marginTop: spacing.md, borderColor: c.error },
  errorRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  errorText: { color: c.error, fontSize: 12, fontFamily: fonts.textMedium, flex: 1, lineHeight: 18 },
  // Result
  resolveCard: { marginTop: spacing.md, borderColor: c.brandSecondary },
  thumb: { width: "100%", height: 160, borderRadius: radius.sm, backgroundColor: c.surfaceTertiary, marginBottom: spacing.md },
  resolveHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  resolveTitle: { color: c.onSurface, fontSize: 17, fontFamily: fonts.display, letterSpacing: 0.1, flex: 1 },
  resolveMeta: { color: c.muted, fontSize: 12, fontFamily: fonts.text, marginTop: spacing.xs },
  providerRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md },
  providerDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: c.success },
  providerLabel: { color: c.success, fontSize: 10, fontFamily: fonts.textSemiBold, letterSpacing: 1 },
  degradedNote: { color: c.warning, fontSize: 11, fontFamily: fonts.textMedium, marginTop: spacing.sm },
  chips: { marginTop: spacing.lg },
  actionRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
  flex: { flex: 1 },
}));

function hostOf(url: string): string {
  const match = url.match(/^https?:\/\/([^/\s]+)/i);
  return match ? match[1] : url;
}

export default function HomeScreen() {
  const styles = useStyles();
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ sharedUrl?: string }>();
  const { sources, addSource, notify, workspace } = useAppState();
  const bottomChrome = useBottomChrome();

  const [url, setUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ResolvedMedia | null>(null);
  const [selectedQuality, setSelectedQuality] = useState("");
  const [clipboardLink, setClipboardLink] = useState("");
  const lastSharedHandled = useRef("");

  const analyze = async (raw?: string) => {
    const target = (raw ?? url).trim();
    Keyboard.dismiss();
    setError("");
    setResult(null);
    if (!/^https?:\/\/\S+$/i.test(target)) {
      setError("Paste a valid http(s) media URL to analyze it.");
      return;
    }
    setAnalyzing(true);
    try {
      const data = await resolveMedia(target);
      setResult(data);
      setSelectedQuality(data.qualities[0]?.id ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Resolver failed. Please retry.");
    } finally {
      setAnalyzing(false);
    }
  };

  // Shared-into-Velo links (native share sheet, dev/production builds).
  useEffect(() => {
    if (params.sharedUrl && params.sharedUrl !== lastSharedHandled.current) {
      lastSharedHandled.current = params.sharedUrl;
      setUrl(params.sharedUrl);
      analyze(params.sharedUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.sharedUrl]);

  // Clipboard smart-detect: offer to resolve a copied media link (works in
  // Expo Go and web, where the native share target is unavailable).
  useEffect(() => {
    const checkClipboard = async () => {
      try {
        const value = await Clipboard.getStringAsync();
        const match = value?.match(/https?:\/\/[^\s]+/i);
        if (match) setClipboardLink((current) => current || match[0]);
      } catch {
        // clipboard unavailable (e.g. web permission) — stay silent
      }
    };
    checkClipboard();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") checkClipboard();
    });
    return () => subscription.remove();
  }, []);

  const pasteUrl = async () => {
    const value = await Clipboard.getStringAsync();
    if (value) setUrl(value);
    else notify("Clipboard is empty");
  };

  const saveResolved = async (status: "Saved" | "Downloaded") => {
    if (!result) return;
    const quality = result.qualities.find((item) => item.id === selectedQuality);
    addSource(
      {
        id: `source-${Date.now()}`,
        title: result.title,
        creator: result.creator,
        platform: result.platform,
        type: result.type,
        status: "Saved",
        duration: result.duration,
        url: result.url,
        thumbnail: result.thumbnail,
      },
      "saved",
    );
    if (status === "Saved") return;
    try {
      const isImage = result.type === "IMAGE";
      const isAudio = !isImage && ((quality?.ext ?? "") === "mp3" || result.type === "AUDIO");
      await createDownload({
        url: result.url,
        kind: isImage ? "image" : isAudio ? "audio" : "video",
        quality: isAudio || isImage ? "" : quality?.id ?? "",
        format: isImage ? quality?.ext ?? "jpg" : "mp3",
        label: quality?.label ?? "Best",
        workspace,
        title: result.title,
        creator: result.creator,
        platform: result.platform,
        duration: result.duration,
        thumbnail: result.thumbnail,
      });
      notify(`Download started${quality ? ` · ${quality.label}` : ""} — track it in Queue`);
    } catch {
      notify("Download failed to start — source saved for retry");
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <AppHeader />
      <KeyboardAwareScrollView
        bottomOffset={spacing.lg}
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomChrome + spacing.lg }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenHeading
          eyebrow="Command center"
          title="Save it once. Keep it forever."
          description="Every link becomes a persistent source you can download, convert, or revisit later."
        />

        {clipboardLink ? (
          <View style={styles.clipPill} testID="clipboard-pill">
            <Icon name="link-variant" size={16} color={colors.brandPrimary} />
            <Text style={styles.clipText} numberOfLines={1}>{hostOf(clipboardLink)}</Text>
            <Pressable
              testID="clipboard-resolve"
              style={styles.clipAction}
              onPress={() => {
                const link = clipboardLink;
                setClipboardLink("");
                setUrl(link);
                analyze(link);
              }}
            >
              <Text style={styles.clipActionText}>Resolve</Text>
            </Pressable>
            <Pressable testID="clipboard-dismiss" onPress={() => setClipboardLink("")} hitSlop={8} accessibilityLabel="Dismiss clipboard link" style={styles.clipDismiss}>
              <Icon name="close" size={15} color={colors.muted} />
            </Pressable>
          </View>
        ) : null}

        <View style={styles.hero} testID="resolver-hero">
          <Image source={{ uri: HERO_BG }} style={StyleSheet.absoluteFill} contentFit="cover" transition={300} />
          <View style={[styles.heroScrim, { backgroundColor: colors.surface + (scheme === "dark" ? "D9" : "E6") }]} />
          <View style={styles.heroInner}>
            <Text style={[styles.heroKicker, { color: colors.brandPrimary }]}>NEW MEDIA SOURCE</Text>
            <Text style={[styles.heroTitle, { color: colors.onSurface }]}>Paste a link to start</Text>
            <BlurView intensity={40} tint={scheme} style={[styles.glassCard, { borderColor: colors.borderStrong }]}>
              <View style={[styles.glassTint, { backgroundColor: colors.surfaceSecondary + "CC" }]}>
                <View style={styles.inputRow}>
                  <Icon name="link-variant" size={19} color={colors.brandPrimary} />
                  <TextInput
                    testID="url-input"
                    value={url}
                    onChangeText={setUrl}
                    style={[styles.input, { color: colors.onSurface }]}
                    placeholder="https://..."
                    placeholderTextColor={colors.muted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="go"
                    onSubmitEditing={() => analyze()}
                  />
                  <Pressable testID="paste-button" onPress={pasteUrl} hitSlop={6} style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.6 }]} accessibilityLabel="Paste from clipboard">
                    <Icon name="content-paste" size={19} color={colors.brandPrimary} />
                  </Pressable>
                </View>
                <PrimaryButton
                  testID="analyze-button"
                  label="Analyze source"
                  icon="radar"
                  loading={analyzing}
                  onPress={() => analyze()}
                  style={{ marginTop: spacing.md }}
                />
              </View>
            </BlurView>
            <Text style={[styles.heroNote, { color: colors.onSurfaceSecondary }]}>LIVE RESOLVER · REAL DOWNLOADS</Text>
          </View>
        </View>

        {analyzing ? (
          <Card style={styles.analyzingRow} testID="analyzing-card">
            <ActivityIndicator color={colors.brandPrimary} />
            <Text style={[styles.analyzingText, { color: colors.onSurfaceSecondary }]}>
              Analyzing link structure and fetching formats…
            </Text>
          </Card>
        ) : null}

        {error ? (
          <Card style={styles.errorCard} testID="resolver-error-card">
            <View style={styles.errorRow}>
              <Icon name="alert-circle-outline" size={18} color={colors.error} />
              <Text style={styles.errorText} testID="resolver-error">{error}</Text>
            </View>
            <MiniButton testID="resolver-retry" label="Retry" icon="reload" onPress={() => analyze()} style={{ marginTop: spacing.md, alignSelf: "flex-start" }} />
          </Card>
        ) : null}

        {result ? (
          <Card style={styles.resolveCard} testID="resolver-result">
            {result.thumbnail ? (
              <Image source={{ uri: result.thumbnail }} style={styles.thumb} contentFit="cover" transition={200} testID="resolver-thumbnail" />
            ) : null}
            <View style={styles.resolveHeader}>
              <Text style={styles.resolveTitle} testID="resolver-title">{result.title}</Text>
              <Icon name="check-decagram" size={22} color={colors.success} />
            </View>
            <Text style={styles.resolveMeta}>{result.platform} · {result.creator} · {result.duration}</Text>
            <View style={styles.providerRow} testID="resolver-provider">
              <View style={[styles.providerDot, result.degraded && { backgroundColor: colors.warning }]} />
              <Text style={[styles.providerLabel, result.degraded && { color: colors.warning }]}>
                {result.degraded ? `METADATA ONLY · ${result.provider.toUpperCase()}` : `LIVE · ${result.provider.toUpperCase()}`}
              </Text>
            </View>
            {result.degraded ? (
              <Text style={styles.degradedNote}>Full format list unavailable for this link — showing standard options.</Text>
            ) : null}
            <View style={styles.chips}>
              <ChipRow>
                {result.qualities.map((quality) => (
                  <Chip
                    key={quality.id}
                    testID={`quality-${quality.id}`}
                    label={quality.size ? `${quality.label} · ${quality.size}` : quality.label}
                    active={selectedQuality === quality.id}
                    onPress={() => setSelectedQuality(quality.id)}
                  />
                ))}
              </ChipRow>
            </View>
            <View style={styles.actionRow}>
              <GhostButton testID="save-link-button" label="Save link" icon="bookmark-outline" onPress={() => saveResolved("Saved")} style={styles.flex} />
              <PrimaryButton
                testID="download-button"
                label={`Download${selectedQuality ? ` · ${result.qualities.find((q) => q.id === selectedQuality)?.label ?? ""}` : ""}`}
                icon="download-outline"
                onPress={() => saveResolved("Downloaded")}
                style={styles.flex}
              />
            </View>
          </Card>
        ) : null}

        <SectionHeader title="Recent sources" actionLabel="View library" testID="view-library-link" onAction={() => router.push("/library")} />
        {sources.slice(0, 2).map((source) => (
          <SourceCard key={source.id} source={source} compact />
        ))}
      </KeyboardAwareScrollView>
    </View>
  );
}
