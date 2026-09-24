import { useRouter } from "expo-router";
import { Alert, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { db } from "@/db/client";
import { useOutboxCounts, useSettingValue, useSyncStatus } from "@/db/hooks";
import { usePremium } from "@/db/use-premium";
import { formatRemaining } from "@/domain/monetization/premium";
import { NAMING_KEY, setNaming } from "@/db/queries/settings";
import { seedSources } from "@/db/seed";
import { downloads, mediaSources, outbox, sourceUrls } from "@/db/schema";
import { fonts, fontSize, makeStyles, radius, spacing, tactileShadow } from "@/design/theme";
import { Card } from "@/components/card";
import { useTabBarHeight } from "@/hooks/use-tab-bar-height";
import { getSyncManager, isBackendConfigured } from "@/native/sync-runtime";
import { timeAgo } from "@/utils/format";
import { useState } from "react";
import { DEFAULT_NAMING, NAME_PRESETS, PATH_PRESETS, renderFilename, renderPath, type Naming } from "@/domain/organize/template";

function DevButton({ label, onPress }: { label: string; onPress: () => void }) {
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

// Perf fixtures for Phase 1 exit check (5k rows @ 60 fps). Dev builds only.
function DeveloperSection() {
  const styles = useStyles();
  const seed = () => {
    const t0 = Date.now();
    seedSources(db, 5000);
    Alert.alert("Seeded 5,000 sources", `${Date.now() - t0} ms`);
  };
  const clear = () => {
    db.transaction((tx) => {
      tx.delete(downloads).run();
      tx.delete(sourceUrls).run();
      tx.delete(mediaSources).run();
      tx.delete(outbox).run();
    });
  };
  return (
    <Card style={styles.section}>
      <Text style={styles.sectionTitle}>Developer</Text>
      <DevButton label="Seed 5,000 sources" onPress={seed} />
      <DevButton label="Clear all local data" onPress={clear} />
    </Card>
  );
}


// Sync status (plan §5): what is waiting to go out, when it last worked, and why not.
function SyncSection() {
  const styles = useStyles();
  const status = useSyncStatus();
  const { pending, parked } = useOutboxCounts();
  const [busy, setBusy] = useState(false);
  const configured = isBackendConfigured();

  const line = !configured ? "Not connected to a backend. Everything works offline."
    : !status ? "Waiting for the first sync…"
    : status.ok ? `Synced ${timeAgo(status.at)}`
    : status.error === "network" ? `Offline. Will retry automatically (last try ${timeAgo(status.at)}).`
    : status.error === "auth" ? "Signing in failed. Will retry."
    : `Sync problem: ${status.message ?? status.error}`;

  const syncNow = async () => {
    setBusy(true);
    try { await getSyncManager()?.syncNow(); } finally { setBusy(false); }
  };

  return (
    <Card style={styles.section}>
      <Text style={styles.sectionTitle}>Sync</Text>
      <Text style={styles.label}>{line}</Text>
      <Text style={styles.preview}>{pending} waiting to upload{parked > 0 ? ` · ${parked} could not be uploaded` : ""}</Text>
      {configured && <DevButton label={busy ? "Syncing…" : "Sync now"} onPress={() => void syncNow()} />}
    </Card>
  );
}

function PremiumSection() {
  const styles = useStyles();
  const router = useRouter();
  const premium = usePremium();
  return (
    <Card style={styles.section}>
      <Text style={styles.sectionTitle}>Premium</Text>
      <Text style={styles.label}>{premium.active ? `Active · ${premium.lifetime ? "lifetime" : `${formatRemaining(premium.remainingMs)} remaining`}` : "Free plan"}</Text>
      <DevButton label={premium.active ? "Manage Premium" : "Get Premium or watch an ad"} onPress={() => router.push("/sheets/premium")} />
    </Card>
  );
}

function Choice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} style={[styles.choice, active && styles.choiceActive]} accessibilityRole="radio" accessibilityState={{ selected: active }}>
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text>
    </Pressable>
  );
}

// PRD §32-34: where files go and what they are called, with a live preview.
function OrganizationSection() {
  const styles = useStyles();
  const saved = useSettingValue<Partial<Naming>>(NAMING_KEY, {});
  const naming: Naming = { ...DEFAULT_NAMING, ...saved };
  const sample = { platform: "YouTube", kind: "video" as const, creator: "Tech Example", title: "How to Build a React App", resolution: "1080p", ext: "mp4", date: new Date() };
  const folder = renderPath(naming.pathTemplate, sample);
  return (
    <Card style={styles.section}>
      <Text style={styles.sectionTitle}>Organization</Text>
      <Text style={styles.label}>Folders</Text>
      <View style={styles.choices}>
        {PATH_PRESETS.map((p) => <Choice key={p.label} label={p.label} active={naming.pathTemplate === p.template} onPress={() => setNaming(db, { ...naming, pathTemplate: p.template })} />)}
      </View>
      <Text style={styles.label}>File names</Text>
      <View style={styles.choices}>
        {NAME_PRESETS.map((p) => <Choice key={p.label} label={p.label} active={naming.filenameTemplate === p.template} onPress={() => setNaming(db, { ...naming, filenameTemplate: p.template })} />)}
      </View>
      <Text style={styles.preview} selectable>Movies/Velo/{folder ? `${folder}/` : ""}{renderFilename(naming.filenameTemplate, sample)}</Text>
    </Card>
  );
}

// GPL §6 requires offering the source for any GPL component we ship, not just crediting it — a
// permanent obligation, not decorative. FFmpeg here is the Termux build bundled by
// io.github.junkfood02.youtubedl-android:ffmpeg (2026-09-23, added to unblock VP9-only platforms
// like Instagram Reels — MediaMuxer alone can't mux those). It runs as a genuinely separate
// subprocess (FfmpegRunner.kt), never linked into our own binary.
function AboutSection() {
  const styles = useStyles();
  return (
    <Card style={styles.section}>
      <Text style={styles.sectionTitle}>About</Text>
      <Text style={styles.label}>Open-source components</Text>
      <DevButton label="FFmpeg (GPLv3) — source code" onPress={() => void Linking.openURL("https://github.com/yausername/youtubedl-android/blob/master/BUILD_FFMPEG.md")} />
    </Card>
  );
}

export function SettingsScreen() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useTabBarHeight();
  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingTop: insets.top, paddingBottom: tabBarHeight + spacing.xxxl }}>
      <Text style={styles.title}>Settings</Text>
      <PremiumSection />
      <OrganizationSection />
      <SyncSection />
      <AboutSection />
      {__DEV__ && <DeveloperSection />}
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  title: { padding: spacing.lg, fontFamily: fonts.display, fontSize: fontSize.h1, color: c.onSurface, borderBottomWidth: 1.5, borderBottomColor: c.border },
  section: { marginHorizontal: spacing.lg, marginTop: spacing.lg, gap: spacing.md },
  sectionTitle: { fontFamily: fonts.overline, fontSize: fontSize.overline, color: c.mutedSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  label: { fontFamily: fonts.textMedium, fontSize: fontSize.body, color: c.onSurfaceSecondary },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  choice: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.surfaceInset, ...tactileShadow(1.5, c.border) },
  choiceActive: { backgroundColor: c.brandTertiary, borderWidth: 2 },
  choiceText: { fontFamily: fonts.textMedium, fontSize: fontSize.caption, color: c.onSurfaceSecondary },
  choiceTextActive: { color: c.onSurface, fontFamily: fonts.textSemiBold },
  preview: { fontFamily: fonts.mono, fontSize: fontSize.caption, color: c.mutedSecondary },
  button: { padding: spacing.md, borderRadius: radius.sm, backgroundColor: c.surfaceInset, borderWidth: 1.5, borderColor: c.border, ...tactileShadow(1.5, c.border) },
  buttonPressed: { transform: [{ translateX: 1.5 }, { translateY: 1.5 }], shadowOpacity: 0, elevation: 0 },
  buttonText: { fontFamily: fonts.textMedium, fontSize: fontSize.body, color: c.onSurface },
}));
