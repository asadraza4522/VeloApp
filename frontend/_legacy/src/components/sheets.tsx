import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Linking, Modal, Platform, Pressable, Share, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GhostButton, Icon, MockTag, PrimaryButton, StatusPill } from "@/src/components/ui";
import { useAppState } from "@/src/state/app-state";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  backdrop: { flex: 1, backgroundColor: "rgba(9, 7, 5, 0.72)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: c.surfaceSecondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderColor: c.border,
  },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: c.muted, marginBottom: spacing.lg },
  art: { width: "100%", height: 150, borderRadius: radius.md, backgroundColor: c.surfaceTertiary, marginBottom: spacing.md },
  title: { color: c.onSurface, fontSize: 20, fontFamily: fonts.display, letterSpacing: 0.2 },
  body: { color: c.muted, fontSize: 13, lineHeight: 20, fontFamily: fonts.text },
  meta: { color: c.muted, fontSize: 12, fontFamily: fonts.text, marginTop: 6 },
  url: { color: c.brandPrimary, fontSize: 12, fontFamily: fonts.textMedium, marginTop: spacing.sm },
  actionRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
  flex: { flex: 1 },
  input: {
    minHeight: 50,
    borderRadius: radius.pill,
    backgroundColor: c.surfaceTertiary,
    borderWidth: 1,
    borderColor: c.border,
    color: c.onSurface,
    fontFamily: fonts.text,
    fontSize: 14,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  closeButton: { position: "absolute", top: spacing.md, right: spacing.md, width: 36, height: 36, borderRadius: 18, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
}));

export function SourceSheet() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeSource, closeSource, addSource, notify } = useAppState();

  const copyUrl = async () => {
    if (!activeSource) return;
    await Clipboard.setStringAsync(activeSource.url);
    notify("Source URL copied");
  };

  const share = async () => {
    if (!activeSource) return;
    await Share.share({ message: activeSource.url });
  };

  const playableUri = activeSource?.localUri || activeSource?.fileUrl || "";

  const play = () => {
    if (!activeSource || !playableUri) return;
    const source = activeSource;
    closeSource();
    router.push({
      pathname: "/player",
      params: {
        uri: playableUri,
        title: source.title,
        creator: source.creator,
        kind: source.type,
        art: source.thumbnail ?? "",
      },
    });
  };

  return (
    <Modal visible={Boolean(activeSource)} transparent animationType="slide" onRequestClose={closeSource}>
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={closeSource} accessibilityLabel="Close source details" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]} testID="source-sheet">
          <View style={styles.handle} />
          <Pressable testID="source-sheet-close" onPress={closeSource} style={styles.closeButton} accessibilityLabel="Close">
            <Icon name="close" size={18} color={colors.muted} />
          </Pressable>
          {activeSource?.thumbnail ? (
            <Image source={{ uri: activeSource.thumbnail }} style={styles.art} contentFit="cover" transition={200} />
          ) : null}
          <Text style={styles.title}>{activeSource?.title}</Text>
          <Text style={styles.meta}>{activeSource?.platform} · {activeSource?.creator} · {activeSource?.duration}</Text>
          {activeSource ? <StatusPill status={activeSource.status} /> : null}
          <MockTag label="PERSISTENT MEDIA SOURCE" />
          <Text style={styles.url} numberOfLines={2}>{activeSource?.url}</Text>

          {playableUri ? (
            <PrimaryButton testID="source-play-button" label={activeSource?.type === "AUDIO" ? "Play audio" : activeSource?.type === "IMAGE" ? "View image" : "Play video"} icon="play" onPress={play} style={{ marginTop: spacing.lg }} />
          ) : null}

          <View style={styles.actionRow}>
            <GhostButton testID="source-copy-button" label="Copy URL" icon="content-copy" onPress={copyUrl} style={styles.flex} />
            <GhostButton testID="source-share-button" label="Share" icon="share-variant-outline" onPress={share} style={styles.flex} />
          </View>
          <GhostButton
            testID="source-open-button"
            label="Open original source"
            icon="open-in-new"
            onPress={() => activeSource && Linking.openURL(activeSource.url)}
            style={{ marginTop: spacing.md }}
          />
          <PrimaryButton
            testID="source-download-button"
            label={activeSource?.status === "File missing" ? "Redownload" : "Download again"}
            icon="download-outline"
            onPress={() => activeSource && addSource({ ...activeSource, status: "Downloaded" }, "downloaded")}
            style={{ marginTop: spacing.md }}
          />
        </View>
      </View>
    </Modal>
  );
}

export function AuthSheet() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { authVisible, closeAuth, signIn } = useAppState();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <Modal visible={authVisible} transparent animationType="slide" onRequestClose={closeAuth}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <Pressable style={{ flex: 1 }} onPress={closeAuth} accessibilityLabel="Close sign in" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]} testID="auth-sheet">
          <View style={styles.handle} />
          <Pressable testID="auth-close-button" onPress={closeAuth} style={styles.closeButton} accessibilityLabel="Close">
            <Icon name="close" size={18} color={colors.muted} />
          </Pressable>
          <Text style={styles.title}>Sign in to Velo</Text>
          <Text style={[styles.body, { marginTop: 6 }]}>Sync is optional. Your current library stays on-device.</Text>
          <MockTag label="MOCKED AUTH · PRODUCTION INTERFACE" />
          <TextInput
            testID="auth-email-input"
            value={email}
            onChangeText={setEmail}
            placeholder="Email address"
            placeholderTextColor={colors.muted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <TextInput
            testID="auth-password-input"
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={colors.muted}
            secureTextEntry
            style={styles.input}
          />
          <PrimaryButton
            testID="auth-email-submit"
            label="Continue with email"
            icon="email-outline"
            onPress={() => signIn(email.trim() || "velo.user@local")}
            style={{ marginTop: spacing.lg }}
          />
          <GhostButton
            testID="auth-google-button"
            label="Continue with Google"
            icon="google"
            onPress={() => signIn("google.user@gmail.com")}
            style={{ marginTop: spacing.md }}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
