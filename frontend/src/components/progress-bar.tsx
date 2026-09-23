import { memo } from "react";
import { View } from "react-native";

import { makeStyles } from "@/design/theme";
import { useProgress } from "@/stores/progress-store";

// Nivora tactile progress track: ink-bordered well, rounded-full fill inset within the border
// (design_guidelines.json motion.progress_bar). Live value comes from the progress store; falls
// back to the persisted snapshot.
export const ProgressBar = memo(function ProgressBar({ id, bytes, total, processing = false }: { id: string; bytes: number; total: number | null; processing?: boolean }) {
  const styles = useStyles();
  const live = useProgress(id);
  const b = live?.bytes ?? bytes;
  const t = live?.total ?? total;
  const pct = t ? Math.min(100, Math.max(0, (b / t) * 100)) : 0;
  return (
    <View style={styles.track}>
      <View style={[styles.fill, processing && styles.fillProcessing, { width: `${pct}%` }]} />
    </View>
  );
});

const useStyles = makeStyles((c) => ({
  track: { height: 10, borderRadius: 999, backgroundColor: c.surfaceInset, borderWidth: 1.5, borderColor: c.border, padding: 1.5, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 999, backgroundColor: c.brandPrimary },
  fillProcessing: { backgroundColor: c.successSurface },
}));
