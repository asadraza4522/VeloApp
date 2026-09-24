import { MaterialCommunityIcons } from "@expo/vector-icons";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { IconButton } from "@/components/icon-button";
import { db } from "@/db/client";
import { downloads, mediaSources } from "@/db/schema";
import { fonts, fontSize, makeStyles, radius, spacing, tactileShadow, useTheme } from "@/design/theme";
import { formatDuration } from "@/utils/format";
import { eq } from "drizzle-orm";

type Item = { uri: string; title: string; creator: string | null; thumbnail: string | null; sourceId: string; audio: boolean };

function load(downloadId: string): Item | "missing" | null {
  const row = db.select({ uri: downloads.localUri, filename: downloads.filename, gone: downloads.fileDeletedAt, sourceId: downloads.sourceId, title: mediaSources.title, creator: mediaSources.creatorName, thumb: mediaSources.thumbnailUrl, type: mediaSources.mediaType })
    .from(downloads).innerJoin(mediaSources, eq(mediaSources.id, downloads.sourceId)).where(eq(downloads.id, downloadId)).get();
  if (!row) return null;
  if (!row.uri || row.gone) return "missing";
  const audio = row.type === "audio" || /\.(m4a|mp3|aac|opus|ogg|wav|flac)$/i.test(row.filename ?? "");
  return { uri: row.uri, title: row.title ?? row.filename ?? "Untitled", creator: row.creator, thumbnail: row.thumb, sourceId: row.sourceId, audio };
}

// Over video/artwork, same reason as Source Details' back button (design_guidelines.json
// components.IconButton): a bare tinted icon over unpredictable content is invisible some of the
// time. IconButton's opaque circle is the only approved pattern for this.
function Close({ onPress }: { onPress: () => void }) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return <IconButton icon="close" onPress={onPress} label="Close player" size={44} iconSize={22} style={[styles.close, { top: insets.top + spacing.sm }]} />;
}

function VideoScreen({ item, onClose }: { item: Item; onClose: () => void }) {
  const styles = useStyles();
  const player = useVideoPlayer(item.uri, (p) => { p.play(); });
  return (
    <View style={styles.black}>
      <VideoView
        player={player}
        style={styles.fill}
        nativeControls
        contentFit="contain"
        allowsPictureInPicture
        // The app is portrait-locked overall (app.config.ts orientation: "portrait"), but the
        // fullscreen button should rotate to landscape like YouTube/any other player. expo-video's
        // fullscreen mode runs in its own native surface independent of the app's orientation
        // lock, so this alone is enough — no need to touch the app's global orientation.
        fullscreenOptions={{ enable: true, orientation: "landscape", autoExitOnRotate: true }}
      />
      <Close onPress={onClose} />
    </View>
  );
}

const SPEEDS = [1, 1.25, 1.5, 2];

function AudioScreen({ item, onClose }: { item: Item; onClose: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const player = useAudioPlayer(item.uri);
  const status = useAudioPlayerStatus(player);
  const [width, setWidth] = useState(1);

  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: "doNotMix" });
    player.setActiveForLockScreen(true, { title: item.title, artist: item.creator ?? undefined }); // lock-screen controls + sustained background playback
    player.play();
    return () => player.setActiveForLockScreen(false);
  }, [player, item.title, item.creator]);

  const pct = status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;
  const skip = (s: number) => player.seekTo(Math.max(0, Math.min(status.duration || 0, status.currentTime + s)));
  const nextSpeed = () => { player.setPlaybackRate(SPEEDS[(SPEEDS.indexOf(status.playbackRate) + 1) % SPEEDS.length]); };

  return (
    <View style={styles.audio}>
      {item.thumbnail ? <Image source={item.thumbnail} style={styles.fill} contentFit="cover" blurRadius={24} /> : null}
      <LinearGradient colors={["transparent", colors.scrim]} style={styles.fill} />
      <Close onPress={onClose} />
      <View style={[styles.audioBody, { paddingBottom: insets.bottom + spacing.xl }]}>
        {item.thumbnail ? <Image source={item.thumbnail} style={styles.art} contentFit="cover" /> : <View style={[styles.art, styles.artEmpty]}><MaterialCommunityIcons name="music-note" size={72} color={colors.muted} /></View>}
        <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
        {item.creator ? <Text style={styles.creator}>{item.creator}</Text> : null}

        <Pressable style={styles.barHit} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} onPress={(e) => player.seekTo((e.nativeEvent.locationX / width) * status.duration)} accessibilityRole="adjustable" accessibilityLabel="Seek">
          <View style={styles.bar}>
            <View style={[styles.barFill, { width: `${pct * 100}%` }]} />
          </View>
        </Pressable>
        <View style={styles.times}>
          <Text style={styles.time}>{formatDuration(status.currentTime * 1000)}</Text>
          <Text style={styles.time}>{formatDuration(status.duration * 1000)}</Text>
        </View>

        <View style={styles.controls}>
          <Pressable onPress={() => skip(-15)} accessibilityLabel="Back 15 seconds" style={styles.side}><MaterialCommunityIcons name="rewind-15" size={28} color={colors.onSurface} /></Pressable>
          <Pressable onPress={() => (status.playing ? player.pause() : player.play())} accessibilityLabel={status.playing ? "Pause" : "Play"} style={styles.play}>
            <MaterialCommunityIcons name={status.playing ? "pause" : "play"} size={36} color={colors.onBrandPrimary} />
          </Pressable>
          <Pressable onPress={() => skip(15)} accessibilityLabel="Forward 15 seconds" style={styles.side}><MaterialCommunityIcons name="fast-forward-15" size={28} color={colors.onSurface} /></Pressable>
        </View>
        <Pressable onPress={nextSpeed} style={styles.speed} accessibilityLabel="Playback speed"><Text style={styles.speedText}>{status.playbackRate}×</Text></Pressable>
      </View>
    </View>
  );
}

export function PlayerScreen() {
  const styles = useStyles();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = load(id);
  const close = () => router.back();

  if (item === null || item === "missing") {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.creator}>{item === "missing" ? "This file was deleted. You can download it again from its source." : "Nothing to play."}</Text>
        <Button label="Close" variant="secondary" onPress={close} />
      </View>
    );
  }
  return (
    <>
      <Stack.Screen options={{ headerShown: false, presentation: "fullScreenModal", animation: "fade" }} />
      {item.audio ? <AudioScreen item={item} onClose={close} /> : <VideoScreen item={item} onClose={close} />}
    </>
  );
}

// The video surface itself stays black (media, not chrome). Every control is Nivora tactile:
// opaque fill, ink border, hard offset shadow — no glass, no translucent chips (design
// guidelines.json screens.Player: "opaque ink/white bar with tactile shadow, not glass").
const useStyles = makeStyles((c) => ({
  fill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  black: { flex: 1, backgroundColor: "#000" },
  audio: { flex: 1, backgroundColor: c.surfaceInverse },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg, padding: spacing.xl, backgroundColor: c.surface },
  close: { position: "absolute", left: spacing.lg, zIndex: 5 },
  audioBody: { flex: 1, justifyContent: "flex-end", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.xl },
  art: { width: 260, height: 260, borderRadius: radius.sm, backgroundColor: c.surfaceTertiary, marginBottom: spacing.lg, borderWidth: 1.5, borderColor: c.border, ...tactileShadow(3, c.border) },
  artEmpty: { alignItems: "center", justifyContent: "center" },
  title: { fontFamily: fonts.display, fontSize: fontSize.h1, color: c.onSurfaceInverse, textAlign: "center" },
  creator: { fontFamily: fonts.text, fontSize: fontSize.body, color: c.onSurfaceInverse, opacity: 0.7, textAlign: "center" },
  barHit: { alignSelf: "stretch", height: 24, justifyContent: "center", marginTop: spacing.lg },
  bar: { height: 10, borderRadius: 999, backgroundColor: c.surfaceTertiary, borderWidth: 1.5, borderColor: c.border, padding: 1.5, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 999, backgroundColor: c.brandPrimary },
  times: { alignSelf: "stretch", flexDirection: "row", justifyContent: "space-between" },
  time: { fontFamily: fonts.mono, fontSize: fontSize.caption, color: c.onSurfaceInverse, opacity: 0.7, fontVariant: ["tabular-nums"] },
  controls: { flexDirection: "row", alignItems: "center", gap: spacing.xl, marginTop: spacing.md },
  side: { width: 52, height: 52, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceTertiary, borderWidth: 1.5, borderColor: c.border, ...tactileShadow(2, c.border) },
  play: { width: 72, height: 72, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: c.brandPrimary, borderWidth: 1.5, borderColor: c.border, ...tactileShadow(3, c.border) },
  speed: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: c.surfaceTertiary, borderWidth: 1.5, borderColor: c.border, ...tactileShadow(1.5, c.border) },
  speedText: { fontFamily: fonts.textSemiBold, fontSize: fontSize.caption, color: c.onSurface },
}));
