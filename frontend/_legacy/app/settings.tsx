import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Chip, Icon, MiniButton } from "@/src/components/ui";
import { getNotificationStatus, requestNotificationPermission } from "@/src/notifications";
import { useAppState } from "@/src/state/app-state";
import { fonts, makeStyles, radius, setColorScheme, spacing, useTheme, ColorScheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: c.surfaceSecondary,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { color: c.onSurface, fontSize: 22, fontFamily: fonts.display, letterSpacing: 0.2 },
  label: { color: c.muted, fontSize: 10, fontFamily: fonts.textSemiBold, letterSpacing: 1.6, marginTop: spacing.xl, marginBottom: spacing.sm },
  group: { backgroundColor: c.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, overflow: "hidden" },
  row: { minHeight: 60, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md },
  rowIcon: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" },
  rowCopy: { flex: 1 },
  rowTitle: { color: c.onSurface, fontSize: 14, fontFamily: fonts.textMedium },
  rowSub: { color: c.muted, fontSize: 11, fontFamily: fonts.text, marginTop: 2 },
  divider: { height: 1, backgroundColor: c.divider, marginLeft: spacing.lg + 34 + spacing.md },
  footer: { color: c.muted, fontSize: 11, fontFamily: fonts.text, textAlign: "center", marginTop: spacing.xl },
  chipRow: { flexDirection: "row", gap: spacing.sm },
  linkText: { color: c.brandPrimary, fontSize: 12, fontFamily: fonts.textSemiBold },
}));

export default function SettingsScreen() {
  const styles = useStyles();
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signedIn, authEmail, openAuth, signOut, wifiOnly, setWifiOnly, notify } = useAppState();
  const [notifStatus, setNotifStatus] = useState<"granted" | "denied" | "blocked" | "unknown">("unknown");

  useEffect(() => {
    getNotificationStatus().then(setNotifStatus);
  }, []);

  const enableNotifications = async () => {
    const status = await requestNotificationPermission();
    setNotifStatus(status);
    if (status === "granted") notify("Download alerts enabled");
    else if (status === "blocked") {
      if (Platform.OS === "web") notify("Notifications aren't available in the web preview");
      else Linking.openSettings().catch(() => notify("Could not open system settings"));
    }
    else notify("Notifications off — progress shows in the Queue tab");
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={[styles.header, { paddingHorizontal: spacing.lg }]}>
        <Pressable testID="settings-back-button" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} hitSlop={8} style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.7 }]} accessibilityLabel="Go back">
          <Icon name="chevron-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]} showsVerticalScrollIndicator={false}>
        <View style={styles.group} testID="settings-account">
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Icon name={signedIn ? "account-check-outline" : "account-outline"} size={19} color={colors.onBrandTertiary} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle} numberOfLines={1}>{signedIn ? authEmail : "Guest workspace"}</Text>
              <Text style={styles.rowSub}>{signedIn ? "MOCKED AUTH · local session" : "Your sources are stored on this device"}</Text>
            </View>
            {signedIn ? (
              <Pressable testID="sign-out-button" onPress={signOut} hitSlop={8}>
                <Text style={styles.linkText}>Sign out</Text>
              </Pressable>
            ) : (
              <Pressable testID="sign-in-button" onPress={openAuth} hitSlop={8}>
                <Text style={styles.linkText}>Sign in</Text>
              </Pressable>
            )}
          </View>
        </View>

        <Text style={styles.label}>APPEARANCE</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Icon name="theme-light-dark" size={19} color={colors.onBrandTertiary} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>Theme</Text>
              <Text style={styles.rowSub}>{scheme === "dark" ? "Smoked espresso · dark and cinematic" : "Porcelain · bright and airy"}</Text>
            </View>
            <View style={styles.chipRow}>
              {(["dark", "light"] as ColorScheme[]).map((value) => (
                <Chip key={value} testID={`theme-${value}`} label={value === "dark" ? "Dark" : "Light"} active={scheme === value} onPress={() => setColorScheme(value)} />
              ))}
            </View>
          </View>
        </View>

        <Text style={styles.label}>DOWNLOADS</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Icon name="wifi" size={19} color={colors.onBrandTertiary} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>Wi-Fi only</Text>
              <Text style={styles.rowSub}>Protect your mobile data while downloading</Text>
            </View>
            <Switch
              testID="wifi-only-switch"
              value={wifiOnly}
              onValueChange={setWifiOnly}
              trackColor={{ false: colors.surfaceTertiary, true: colors.brandSecondary }}
              thumbColor={colors.onSurface}
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.row} testID="notifications-row">
            <View style={styles.rowIcon}>
              <Icon name="bell-outline" size={19} color={colors.onBrandTertiary} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>Download alerts</Text>
              <Text style={styles.rowSub}>
                {notifStatus === "granted" ? "Progress + completion alerts on" : notifStatus === "blocked" ? "Blocked — enable in system settings" : "Progress and completion alerts"}
              </Text>
            </View>
            {notifStatus === "granted" ? (
              <Icon name="check-circle" size={18} color={colors.success} />
            ) : (
              <MiniButton testID="enable-notifications" label={notifStatus === "blocked" ? "Open Settings" : "Enable"} icon="bell-ring-outline" onPress={enableNotifications} />
            )}
          </View>
          <View style={styles.divider} />
          <Pressable testID="organization-row" onPress={() => notify("Folder rules arrive with smart organization")} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
            <View style={styles.rowIcon}>
              <Icon name="folder-outline" size={19} color={colors.onBrandTertiary} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>Organization</Text>
              <Text style={styles.rowSub}>Platform / media type folders</Text>
            </View>
            <Icon name="chevron-right" size={20} color={colors.muted} />
          </Pressable>
        </View>

        <Text style={styles.label}>SERVICES</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Icon name="engine-outline" size={19} color={colors.onBrandTertiary} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>Velo Core engine</Text>
              <Text style={styles.rowSub}>Own resolver + downloader · no third-party providers</Text>
            </View>
            <Icon name="check-decagram" size={17} color={colors.success} />
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Icon name="gift-outline" size={19} color={colors.onBrandTertiary} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>Premium time</Text>
              <Text style={styles.rowSub}>Rewarded ads are MOCKED in this preview</Text>
            </View>
            <Text style={styles.linkText}>0 min</Text>
          </View>
        </View>

        <Text style={styles.footer}>Velo 1.0.0 · Preview build · Own-engine mode</Text>
      </ScrollView>
    </View>
  );
}
