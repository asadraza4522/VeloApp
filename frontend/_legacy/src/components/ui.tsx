import { MaterialDesignIcons } from "@react-native-vector-icons/material-design-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { ComponentProps, ReactNode } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  Text,
  View,
  ViewStyle,
} from "react-native";

import { Source, SourceStatus, useAppState } from "@/src/state/app-state";
import { brandGradient, fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export type IconName = ComponentProps<typeof MaterialDesignIcons>["name"];

export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color: string }) {
  return <MaterialDesignIcons name={name} size={size} color={color} />;
}

function haptic(selection = false) {
  if (Platform.OS === "web") return;
  if (selection) Haptics.selectionAsync().catch(() => {});
  else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

const useStyles = makeStyles((c) => ({
  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
    backgroundColor: c.surface,
  },
  logoRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  logoMark: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  logoLetter: { color: c.onBrand, fontSize: 19, fontFamily: fonts.displayBold },
  logoText: { color: c.onSurface, fontSize: 21, fontFamily: fonts.display, letterSpacing: 0.2 },
  tagline: { color: c.muted, fontSize: 8, fontFamily: fonts.textSemiBold, letterSpacing: 1.6, marginTop: 1 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  modePill: {
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: c.surfaceTertiary,
    borderWidth: 1,
    borderColor: c.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  modeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.success },
  modeText: { color: c.onSurfaceTertiary, fontSize: 9, fontFamily: fonts.textSemiBold, letterSpacing: 1 },
  gearButton: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: c.surfaceSecondary,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },
  // Typography
  eyebrow: {
    color: c.brandPrimary,
    fontSize: 11,
    fontFamily: fonts.textSemiBold,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  screenTitle: { color: c.onSurface, fontSize: 26, lineHeight: 32, fontFamily: fonts.display, letterSpacing: 0.2, marginTop: spacing.sm },
  body: { color: c.muted, fontSize: 14, lineHeight: 21, fontFamily: fonts.text },
  // Sections
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xl, marginBottom: spacing.md },
  sectionTitle: { color: c.onSurface, fontSize: 17, fontFamily: fonts.display, letterSpacing: 0.1 },
  linkText: { color: c.brandPrimary, fontSize: 12, fontFamily: fonts.textSemiBold },
  // Card
  card: {
    backgroundColor: c.surfaceSecondary,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  // Buttons
  primaryButton: {
    minHeight: 50,
    borderRadius: radius.pill,
    backgroundColor: c.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: { color: c.onBrandPrimary, fontSize: 14, fontFamily: fonts.textSemiBold },
  ghostButton: {
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: c.surfaceTertiary,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  ghostButtonText: { color: c.onSurface, fontSize: 13, fontFamily: fonts.textMedium },
  miniButton: {
    minHeight: 40,
    borderRadius: radius.pill,
    backgroundColor: c.surfaceTertiary,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  miniButtonText: { color: c.onSurface, fontSize: 12, fontFamily: fonts.textMedium },
  // Chips — active = illuminated studio button (brandTertiary + gold text).
  chip: {
    height: 36,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    justifyContent: "center",
    backgroundColor: c.surfaceTertiary,
    borderWidth: 1,
    borderColor: c.border,
    flexShrink: 0,
  },
  chipActive: { backgroundColor: c.brandTertiary, borderColor: c.brandSecondary },
  chipText: { color: c.muted, fontSize: 12, fontFamily: fonts.textMedium },
  chipTextActive: { color: c.onBrandTertiary },
  // Mock tag
  mockRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md },
  mockDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: c.brandSecondary },
  mockLabel: { color: c.brandSecondary, fontSize: 10, fontFamily: fonts.textSemiBold, letterSpacing: 1 },
  // Source card
  sourceRow: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  sourceIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" },
  sourceTitle: { color: c.onSurface, fontSize: 14, fontFamily: fonts.textMedium },
  sourceMeta: { color: c.muted, fontSize: 12, fontFamily: fonts.text, marginTop: 3 },
  // Empty state
  emptyWrap: { alignItems: "center", paddingVertical: spacing.xl },
  emptyIcon: { width: 56, height: 56, borderRadius: radius.lg, backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  emptyTitle: { color: c.onSurface, fontSize: 16, fontFamily: fonts.display },
  // Toast
  toast: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: 110,
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: c.surfaceInverse,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  toastText: { color: c.onSurfaceInverse, fontSize: 13, fontFamily: fonts.textMedium },
}));

export function AppHeader() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { synced } = useAppState();
  return (
    <View style={styles.header} testID="app-header">
      <View style={styles.logoRow}>
        <LinearGradient colors={[...brandGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.logoMark}>
          <Text style={styles.logoLetter}>V</Text>
        </LinearGradient>
        <View>
          <Text style={styles.logoText}>velo</Text>
          <Text style={styles.tagline}>SAVE. CONVERT. ORGANIZE.</Text>
        </View>
      </View>
      <View style={styles.headerRight}>
        <View style={styles.modePill} testID="sync-mode-pill">
          <View style={[styles.modeDot, !synced && { backgroundColor: colors.warning }]} />
          <Text style={styles.modeText}>{synced ? "SYNCED" : "LOCAL"}</Text>
        </View>
        <Pressable
          testID="settings-button"
          accessibilityLabel="Open settings"
          hitSlop={8}
          onPress={() => {
            haptic();
            router.push("/settings");
          }}
          style={({ pressed }) => [styles.gearButton, pressed && { opacity: 0.7 }]}
        >
          <Icon name="cog-outline" size={19} color={colors.onSurfaceSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

export function ScreenHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  const styles = useStyles();
  return (
    <View>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.screenTitle}>{title}</Text>
      {description ? <Text style={[styles.body, { marginTop: spacing.sm }]}>{description}</Text> : null}
    </View>
  );
}

export function SectionHeader({ title, actionLabel, onAction, testID }: { title: string; actionLabel?: string; onAction?: () => void; testID?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {actionLabel ? (
        <Pressable testID={testID} onPress={onAction} hitSlop={8}>
          <Text style={styles.linkText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Card({ children, style, onPress, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; testID?: string }) {
  const styles = useStyles();
  if (onPress) {
    return (
      <Pressable testID={testID} onPress={() => { haptic(); onPress(); }} style={({ pressed }) => [styles.card, style, pressed && { opacity: 0.82 }]}>
        {children}
      </Pressable>
    );
  }
  return (
    <View testID={testID} style={[styles.card, style]}>
      {children}
    </View>
  );
}

export function PrimaryButton({ label, icon, onPress, loading, testID, style }: { label: string; icon?: IconName; onPress: () => void; loading?: boolean; testID?: string; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} onPress={() => { haptic(); onPress(); }} disabled={loading} style={({ pressed }) => [styles.primaryButton, style, pressed && { opacity: 0.82 }]}>
      {loading ? (
        <ActivityIndicator color={colors.onBrandPrimary} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={18} color={colors.onBrandPrimary} /> : null}
          <Text style={styles.primaryButtonText}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function GhostButton({ label, icon, onPress, testID, style, children }: { label?: string; icon?: IconName; onPress?: () => void; testID?: string; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} onPress={onPress ? () => { haptic(); onPress(); } : undefined} style={({ pressed }) => [styles.ghostButton, style, pressed && { opacity: 0.82 }]}>
      {children ?? (
        <>
          {icon ? <Icon name={icon} size={17} color={colors.onSurface} /> : null}
          <Text style={styles.ghostButtonText}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function MiniButton({ label, icon, onPress, testID, style }: { label: string; icon?: IconName; onPress?: () => void; testID?: string; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} onPress={onPress ? () => { haptic(); onPress(); } : undefined} style={({ pressed }) => [styles.miniButton, style, pressed && { opacity: 0.82 }]}>
      {icon ? <Icon name={icon} size={16} color={colors.onSurface} /> : null}
      <Text style={styles.miniButtonText}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, active, onPress, testID }: { label: string; active?: boolean; onPress?: () => void; testID?: string }) {
  const styles = useStyles();
  return (
    <Pressable testID={testID} onPress={onPress ? () => { haptic(true); onPress(); } : undefined} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.lg }}>
      {children}
    </ScrollView>
  );
}

export function MockTag({ label }: { label: string }) {
  const styles = useStyles();
  return (
    <View style={styles.mockRow} testID="mock-tag">
      <View style={styles.mockDot} />
      <Text style={styles.mockLabel}>{label}</Text>
    </View>
  );
}

const statusTone: Record<SourceStatus, "success" | "info" | "warning" | "error"> = {
  Downloaded: "success",
  Saved: "info",
  "File missing": "warning",
  Failed: "error",
};

export function StatusPill({ status }: { status: SourceStatus }) {
  const { colors } = useTheme();
  const tone = colors[statusTone[status]];
  return (
    <View style={{ alignSelf: "flex-start", borderRadius: radius.pill, backgroundColor: tone + "33", paddingHorizontal: 10, paddingVertical: 4, marginTop: spacing.md }}>
      <Text style={{ color: tone, fontSize: 10, fontFamily: fonts.textSemiBold, letterSpacing: 0.8 }}>{status.toUpperCase()}</Text>
    </View>
  );
}

export function SourceCard({ source, compact, testID }: { source: Source; compact?: boolean; testID?: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { openSource } = useAppState();
  return (
    <Card testID={testID ?? `source-${source.id}`} onPress={() => openSource(source)} style={{ marginBottom: spacing.md }}>
      <View style={styles.sourceRow}>
        <View style={styles.sourceIcon}>
          <Icon name={source.type === "AUDIO" ? "music-note-outline" : source.type === "IMAGE" ? "image-outline" : "play-outline"} size={21} color={colors.onBrandTertiary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sourceTitle} numberOfLines={compact ? 1 : 2}>{source.title}</Text>
          <Text style={styles.sourceMeta} numberOfLines={1}>{source.platform} · {source.creator} · {source.duration}</Text>
        </View>
        <Icon name="chevron-right" size={20} color={colors.muted} />
      </View>
      {!compact ? <StatusPill status={source.status} /> : null}
    </Card>
  );
}

export function EmptyState({ icon, title, body, actionLabel, onAction, testID }: { icon: IconName; title: string; body: string; actionLabel?: string; onAction?: () => void; testID?: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Card testID={testID}>
      <View style={styles.emptyWrap}>
        <View style={styles.emptyIcon}>
          <Icon name={icon} size={26} color={colors.onBrandTertiary} />
        </View>
        <Text style={styles.emptyTitle}>{title}</Text>
        <Text style={[styles.body, { textAlign: "center", marginTop: 6 }]}>{body}</Text>
        {actionLabel ? <MiniButton label={actionLabel} icon="arrow-right" onPress={onAction} style={{ marginTop: spacing.lg }} /> : null}
      </View>
    </Card>
  );
}

export function ToastHost() {
  const styles = useStyles();
  const { toast } = useAppState();
  if (!toast) return null;
  return (
    <View style={styles.toast} testID="toast">
      <Text style={styles.toastText}>{toast}</Text>
    </View>
  );
}

export { spacing, radius };
