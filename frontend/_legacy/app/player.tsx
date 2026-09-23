import Slider from "@react-native-community/slider";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

function fmtTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return "0:00";
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.surface + "B3",
    alignItems: "center",
    justifyContent: "center",
  },
  bottom: { position: "absolute", left: spacing.lg, right: spacing.lg },
  title: { fontSize: 24, fontFamily: fonts.display, letterSpacing: 0.2 },
  creator: { fontSize: 13, fontFamily: fonts.text, marginTop: spacing.xs },
  timeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.xs },
  timeText: { fontSize: 11, fontFamily: fonts.textMedium, letterSpacing: 0.4 },
  controlsPill: {
    marginTop: spacing.md,
    borderRadius: radius.pill,
    overflow: "hidden",
    borderWidth: 1,
  },
  controlsTint: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxl,
    paddingVertical: spacing.md,
  },
  playButton: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: "center",
    justifyContent: "center",
  },
  errorWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  errorTitle: { fontSize: 18, fontFamily: fonts.display },
}));

export default function PlayerScreen() {
  const styles = useStyles();
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ uri?: string; title?: string; creator?: string; kind?: string; art?: string }>();

  const uri = params.uri ?? "";
  const isVideo = params.kind === "VIDEO";
  const isImage = params.kind === "IMAGE";
  const title = params.title || "Untitled media";
  const creator = params.creator || "";

  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);

  const player = useVideoPlayer(uri && !isImage ? uri : null, (instance) => {
    instance.timeUpdateEventInterval = 0.5;
  });

  useEffect(() => {
    if (!player) return;
    const interval = setInterval(() => {
      setPosition(player.currentTime ?? 0);
      setDuration(player.duration && isFinite(player.duration) ? player.duration : 0);
      setPlaying(player.playing);
    }, 400);
    return () => clearInterval(interval);
  }, [player]);

  const toggle = () => {
    if (!player) return;
    if (playing) player.pause();
    else player.play();
  };

  const skip = (delta: number) => {
    if (!player) return;
    player.currentTime = Math.min(Math.max(0, position + delta), duration || Number.MAX_SAFE_INTEGER);
  };

  if (!uri) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={[styles.errorWrap]}>
          <Icon name="alert-circle-outline" size={40} color={colors.error} />
          <Text style={[styles.errorTitle, { color: colors.onSurface }]}>Unable to play media.</Text>
          <Pressable testID="player-back-error" onPress={() => router.back()} hitSlop={8}>
            <Text style={{ color: colors.brandPrimary, fontFamily: fonts.textSemiBold, fontSize: 14 }}>Go back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root} testID="player-screen">
      {/* Backdrop: video canvas, full image viewer, or blurred artwork */}
      {isImage ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" transition={300} testID="player-image" />
      ) : isVideo ? (
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} testID="player-video" />
      ) : (
        <>
          {/* expo-video web attaches the media element only through a mounted
              VideoView — audio needs this hidden view or playback is a no-op. */}
          <VideoView
            player={player}
            style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
            contentFit="cover"
            nativeControls={false}
            testID="player-audio-view"
          />
          {params.art ? (
            <Image source={{ uri: params.art }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={Platform.OS === "web" ? 0 : 60} transition={300} />
          ) : null}
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface + (params.art ? "99" : "FF"), alignItems: "center", justifyContent: "center" }]}>
            {!params.art || Platform.OS === "web" ? (
              params.art ? (
                <Image source={{ uri: params.art }} style={{ width: 220, height: 220, borderRadius: radius.lg }} contentFit="cover" />
              ) : (
                <Icon name="music-note-outline" size={72} color={colors.brandPrimary} />
              )
            ) : null}
          </View>
        </>
      )}

      {/* Heavy scrim for readability */}
      <LinearGradient colors={["transparent", colors.surface + "F2"]} style={[StyleSheet.absoluteFill, { pointerEvents: "none" }]} />

      {/* Close */}
      <View style={{ position: "absolute", top: insets.top + spacing.md, left: spacing.lg }}>
        <Pressable testID="player-close" onPress={() => router.back()} hitSlop={8} style={styles.closeButton} accessibilityLabel="Close player">
          <Icon name="chevron-down" size={22} color={colors.onSurface} />
        </Pressable>
      </View>

      {/* Bottom third: title + seek + glass controls */}
      <View style={[styles.bottom, { bottom: insets.bottom + spacing.xl }]}>
        <Text style={[styles.title, { color: colors.onSurface }]} numberOfLines={2} testID="player-title">{title}</Text>
        {creator ? <Text style={[styles.creator, { color: colors.onSurfaceSecondary }]}>{creator}</Text> : null}

        {isImage ? null : (
          <>
        <Slider
          testID="player-seek"
          style={{ marginTop: spacing.lg, height: 32 }}
          minimumValue={0}
          maximumValue={duration || 1}
          value={Math.min(position, duration || 1)}
          onSlidingComplete={(value) => {
            if (player) player.currentTime = value;
          }}
          minimumTrackTintColor={colors.brandPrimary}
          maximumTrackTintColor={colors.surfaceTertiary}
          thumbTintColor={colors.brandPrimary}
        />
        <View style={styles.timeRow}>
          <Text style={[styles.timeText, { color: colors.onSurfaceSecondary }]} testID="player-position">{fmtTime(position)}</Text>
          <Text style={[styles.timeText, { color: colors.muted }]} testID="player-duration">{fmtTime(duration)}</Text>
        </View>

        <BlurView intensity={45} tint={scheme} style={[styles.controlsPill, { borderColor: colors.borderStrong }]}>
          <View style={[styles.controlsTint, { backgroundColor: colors.surfaceSecondary + "CC" }]}>
            <Pressable testID="player-back15" onPress={() => skip(-15)} hitSlop={8} accessibilityLabel="Back 15 seconds">
              <Icon name="rewind-15" size={26} color={colors.onSurface} />
            </Pressable>
            <Pressable testID="player-toggle" onPress={toggle} style={[styles.playButton, { backgroundColor: colors.brandPrimary }]} accessibilityLabel={playing ? "Pause" : "Play"}>
              <Icon name={playing ? "pause" : "play"} size={30} color={colors.onBrandPrimary} />
            </Pressable>
            <Pressable testID="player-forward15" onPress={() => skip(15)} hitSlop={8} accessibilityLabel="Forward 15 seconds">
              <Icon name="fast-forward-15" size={26} color={colors.onSurface} />
            </Pressable>
          </View>
        </BlurView>
          </>
        )}
      </View>
    </View>
  );
}
