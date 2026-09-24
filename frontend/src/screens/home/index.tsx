import { useFocusEffect, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { AdBanner } from "@/components/ad-banner";
import { Card } from "@/components/card";
import { SourceRow } from "@/components/source-row";
import { useTabBarHeight } from "@/hooks/use-tab-bar-height";
import { useSources } from "@/db/hooks";
import { usePremium } from "@/db/use-premium";
import { formatRemaining } from "@/domain/monetization/premium";
import { InvalidUrlError } from "@/db/queries/sources";
import type { FailureCode } from "@/db/schema";
import { fonts, fontSize, makeStyles, radius, spacing, tactileShadow, useTheme } from "@/design/theme";
import { actionsFor } from "@/domain/downloads/failure";
import { analyzeUrl, saveLink } from "@/domain/sources/analyze";
import { canonicalize } from "@/domain/sources/url";

const MESSAGES: Partial<Record<FailureCode, string>> = {
  NETWORK_ERROR: "No connection. The link is saved and can be analyzed later.",
  AUTH_REQUIRED: "This source needs you to sign in on the original site.",
  PRIVATE: "This content is private.",
  DRM_PROTECTED: "Protected media can't be downloaded.",
  MEDIA_NOT_FOUND: "This media is no longer available.",
  RATE_LIMITED: "Too many requests. Try again later.",
  UNSUPPORTED: "This link isn't supported.",
};

// A link on the clipboard is offered once (PRD: clipboard detection). Reading only happens while Home is focused.
function useClipboardLink() {
  const [link, setLink] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      let live = true;
      Clipboard.getStringAsync()
        .then((t) => live && setLink(canonicalize(t.trim()) ? t.trim() : null))
        .catch(() => {});
      return () => { live = false; };
    }, []),
  );
  return { link: link && link !== dismissed ? link : null, dismiss: () => setDismissed(link) };
}

export function HomeScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useTabBarHeight();
  const [url, setUrl] = useState("");
  const [notice, setNotice] = useState("");
  const clip = useClipboardLink();
  const premium = usePremium();
  const recent = useSources({}, 5);
  const run = useMutation({ mutationFn: analyzeUrl });

  const trimmed = url.trim();
  const openPicker = (sourceId: string) => router.push({ pathname: "/sheets/format-picker", params: { sourceId } });
  const openSource = useCallback((id: string) => router.push({ pathname: "/source/[id]", params: { id } }), [router]);

  const analyze = () => {
    setNotice("");
    if (trimmed) run.mutate(trimmed);
  };
  const save = () => {
    try {
      const r = saveLink(trimmed);
      setNotice(r.created ? "Saved to your Library" : "Already in your Library");
    } catch (e) {
      setNotice(e instanceof InvalidUrlError ? "That doesn't look like a valid http(s) link." : "Couldn't save the link.");
    }
  };

  const data = run.data;
  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: tabBarHeight + spacing.xxxl }} keyboardShouldPersistTaps="handled">
      <View style={[styles.hero, { paddingTop: insets.top + spacing.xl }]}>
        <View style={styles.readyPill}>
          <View style={styles.readyDot} />
          <Text style={styles.readyText}>Ready</Text>
        </View>
        <Text style={styles.title}>Velo</Text>
        <Text style={styles.subtitle}>Save. Convert. Organize.</Text>
        <Pressable style={({ pressed }) => [styles.premiumChip, pressed && styles.chipPressed]} onPress={() => router.push("/sheets/premium")} accessibilityRole="button">
          <Text style={styles.premiumChipText}>{premium.active ? `Premium · ${premium.lifetime ? "lifetime" : formatRemaining(premium.remainingMs)}` : "Get Premium"}</Text>
        </Pressable>
      </View>

      <Card style={styles.card} inset>
        <TextInput
          value={url}
          onChangeText={setUrl}
          placeholder="Paste a link..."
          placeholderTextColor={colors.muted}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={analyze}
        />
        {clip.link && !trimmed && (
          <Pressable style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]} onPress={() => { setUrl(clip.link!); clip.dismiss(); }} accessibilityRole="button">
            <Text style={styles.chipText} numberOfLines={1}>Paste copied link · {clip.link}</Text>
          </Pressable>
        )}
        <View style={styles.actions}>
          <Button label="Analyze" icon="magnify" onPress={analyze} loading={run.isPending} disabled={!trimmed} grow />
          <Button label="Save Link" icon="bookmark-outline" variant="secondary" onPress={save} disabled={!trimmed} grow />
        </View>
      </Card>

      {notice !== "" && <Text style={styles.notice}>{notice}</Text>}
      {run.error && <Text style={styles.error}>{run.error instanceof InvalidUrlError ? "That doesn't look like a valid http(s) link." : run.error.message}</Text>}

      {data && !data.ok && (
        <Card style={styles.result}>
          <Text style={styles.resultTitle}>{MESSAGES[data.code] ?? "Couldn't analyze this link."}</Text>
          <Text style={styles.meta}>{data.code} · {actionsFor(data.code).join(", ")}</Text>
          <Button label="Open saved source" icon="open-in-new" variant="secondary" onPress={() => openSource(data.source.id)} />
        </Card>
      )}

      {data?.ok && (
        <Card style={styles.result}>
          {data.result.metadata.thumbnail_url && <Image source={data.result.metadata.thumbnail_url} style={styles.thumb} contentFit="cover" />}
          <Text style={styles.resultTitle}>{data.result.metadata.title ?? "Untitled"}</Text>
          <Text style={styles.meta}>{[data.result.metadata.creator, data.result.metadata.platform].filter(Boolean).join(" · ")}</Text>
          {data.result.variants.length === 0 && <Text style={styles.meta}>Saved. Nothing downloadable was found for this link right now.</Text>}
          <View style={styles.actions}>
            <Button label="Choose quality" icon="tune" onPress={() => openPicker(data.source.id)} disabled={data.result.variants.length === 0} grow />
            <Button label="Details" icon="information-outline" variant="secondary" onPress={() => openSource(data.source.id)} grow />
          </View>
        </Card>
      )}

      <AdBanner />

      {recent.length > 0 && (
        <View style={styles.recent}>
          <Text style={styles.section}>Recent sources</Text>
          {recent.map((s) => <SourceRow key={s.id} source={s} onPress={openSource} />)}
        </View>
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  hero: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.xs },
  readyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: c.surfaceTertiary,
    borderWidth: 1.5,
    borderColor: c.border,
    ...tactileShadow(1.5, c.border),
  },
  readyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.successSurface },
  readyText: { fontFamily: fonts.overline, fontSize: fontSize.overline, color: c.onSurface, textTransform: "uppercase", letterSpacing: 0.5 },
  title: { fontFamily: fonts.display, fontSize: fontSize.display, color: c.onSurface, marginTop: spacing.sm },
  subtitle: { fontFamily: fonts.text, fontSize: fontSize.body, color: c.mutedSecondary },
  premiumChip: {
    alignSelf: "flex-start",
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: c.brandTertiary,
    borderWidth: 1.5,
    borderColor: c.border,
    ...tactileShadow(2, c.border),
  },
  chipPressed: { transform: [{ translateX: 1.5 }, { translateY: 1.5 }], shadowOpacity: 0, elevation: 0 },
  premiumChipText: { fontFamily: fonts.textSemiBold, fontSize: fontSize.caption, color: c.onBrandTertiary },
  card: { marginHorizontal: spacing.lg },
  input: {
    height: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.sm,
    backgroundColor: c.surfaceTertiary,
    borderWidth: 1.5,
    borderColor: c.border,
    color: c.onSurface,
    fontFamily: fonts.textSemiBold,
    fontSize: fontSize.body,
  },
  chip: { alignSelf: "flex-start", maxWidth: "100%", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: c.brandTertiary, borderWidth: 1.5, borderColor: c.border, ...tactileShadow(1.5, c.border) },
  chipText: { fontFamily: fonts.textMedium, fontSize: fontSize.caption, color: c.onBrandTertiary },
  actions: { flexDirection: "row", gap: spacing.md },
  notice: { margin: spacing.lg, fontFamily: fonts.textMedium, fontSize: fontSize.body, color: c.success },
  error: { margin: spacing.lg, fontFamily: fonts.text, fontSize: fontSize.body, color: c.error },
  result: { marginHorizontal: spacing.lg, marginTop: spacing.lg },
  thumb: { width: "100%", aspectRatio: 16 / 9, borderRadius: radius.sm, backgroundColor: c.surfaceSecondary, borderWidth: 1.5, borderColor: c.border },
  resultTitle: { fontFamily: fonts.textSemiBold, fontSize: fontSize.bodyLg, color: c.onSurface },
  meta: { fontFamily: fonts.text, fontSize: fontSize.caption, color: c.mutedSecondary },
  recent: { marginTop: spacing.xl },
  section: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, fontFamily: fonts.overline, fontSize: fontSize.overline, color: c.mutedSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
}));
