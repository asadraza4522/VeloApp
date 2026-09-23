import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { Button } from "@/components/button";
import { InvalidUrlError } from "@/db/queries/sources";
import { fonts, fontSize, makeStyles, radius, spacing } from "@/design/theme";
import { previewUrl, saveWithOutcome } from "@/domain/sources/analyze";
import { canonicalize } from "@/domain/sources/url";
import { formatDuration } from "@/utils/format";

// Share → Velo (PRD §9): shows what the link is, then "Download" or "Save Link". Nothing is saved until you choose.
export function ShareIntakeScreen() {
  const styles = useStyles();
  const router = useRouter();
  const { url = "" } = useLocalSearchParams<{ url?: string }>();
  const canon = canonicalize(url);
  const [message, setMessage] = useState("");
  const preview = useQuery({ queryKey: ["preview", url], queryFn: () => previewUrl(url), enabled: !!canon, staleTime: 5 * 60_000, retry: 0 });
  const outcome = preview.data;
  const meta = outcome?.ok ? outcome.result.metadata : null;
  const hasFormats = outcome?.ok && outcome.result.variants.length > 0;

  const commit = () => {
    try {
      return saveWithOutcome(url, outcome);
    } catch (e) {
      setMessage(e instanceof InvalidUrlError ? "That isn't a valid link." : "Couldn't save the link.");
      return null;
    }
  };
  const download = () => {
    const r = commit();
    if (r) router.replace({ pathname: "/sheets/format-picker", params: { sourceId: r.source.id } });
  };
  const save = () => {
    const r = commit();
    if (!r) return;
    setMessage(r.created ? "Saved to your Library" : "Already in your Library");
    setTimeout(() => router.back(), 900);
  };

  return (
    <View style={styles.root}>
      <Text style={styles.platform}>{meta?.platform ?? canon?.platform ?? "Unknown source"}</Text>

      {preview.isLoading && <View style={styles.loading}><ActivityIndicator /><Text style={styles.meta}>Getting details…</Text></View>}

      {meta?.thumbnail_url && <Image source={meta.thumbnail_url} style={styles.thumb} contentFit="cover" />}
      {meta ? (
        <>
          <Text style={styles.title} numberOfLines={2}>{meta.title ?? "Untitled"}</Text>
          <Text style={styles.meta}>{[meta.creator, meta.platform, formatDuration(meta.duration != null ? meta.duration * 1000 : null)].filter(Boolean).join(" · ")}</Text>
        </>
      ) : (
        !preview.isLoading && <Text style={styles.url} numberOfLines={3}>{url}</Text>
      )}
      {outcome && !outcome.ok && <Text style={styles.note}>{outcome.code === "NETWORK_ERROR" ? "No connection. You can still save the link for later." : "Couldn't read details for this link. You can still save it."}</Text>}
      {outcome?.ok && !hasFormats && <Text style={styles.note}>Nothing downloadable was found right now. You can save the link.</Text>}
      {message !== "" && <Text style={styles.message}>{message}</Text>}

      <View style={styles.actions}>
        <Button label="Download" onPress={download} disabled={!canon || preview.isLoading || !hasFormats} grow />
        <Button label="Save Link" variant="secondary" onPress={save} disabled={!canon} grow />
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, padding: spacing.xl, gap: spacing.md, backgroundColor: c.surface },
  platform: { fontFamily: fonts.overline, fontSize: fontSize.overline, color: c.mutedAmber, textTransform: "uppercase", letterSpacing: 0.5 },
  loading: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  thumb: { width: "100%", aspectRatio: 16 / 9, borderRadius: radius.sm, backgroundColor: c.surfaceSecondary, borderWidth: 1.5, borderColor: c.border },
  title: { fontFamily: fonts.display, fontSize: fontSize.h1, color: c.onSurface },
  meta: { fontFamily: fonts.text, fontSize: fontSize.caption, color: c.mutedSecondary },
  url: { fontFamily: fonts.mono, fontSize: fontSize.body, color: c.mutedSecondary },
  note: { fontFamily: fonts.text, fontSize: fontSize.body, color: c.onSurfaceSecondary },
  message: { fontFamily: fonts.textMedium, fontSize: fontSize.body, color: c.success },
  actions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md },
}));
