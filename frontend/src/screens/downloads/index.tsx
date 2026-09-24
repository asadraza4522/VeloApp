import { FlashList } from "@shopify/flash-list";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DownloadRow } from "@/components/download-row";
import { useQueue } from "@/db/hooks";
import { QUEUE_GROUPS, type QueueRow } from "@/db/queries/downloads";
import { fonts, fontSize, makeStyles, spacing } from "@/design/theme";
import { useTabBarHeight } from "@/hooks/use-tab-bar-height";

const LIMIT = 100;
type Item = { kind: "header"; id: string; label: string } | { kind: "row"; id: string; row: QueueRow };

function SectionHeader({ label }: { label: string }) {
  const styles = useStyles();
  return <Text style={styles.section}>{label}</Text>;
}

const renderItem = ({ item }: { item: Item }) => (item.kind === "header" ? <SectionHeader label={item.label} /> : <DownloadRow row={item.row} />);
const getItemType = (item: Item) => item.kind;
const keyExtractor = (item: Item) => item.id;

export function DownloadsScreen() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useTabBarHeight();
  const active = useQueue(QUEUE_GROUPS.active, LIMIT);
  const waiting = useQueue(QUEUE_GROUPS.waiting, LIMIT);
  const failed = useQueue(QUEUE_GROUPS.failed, LIMIT);
  const completed = useQueue(QUEUE_GROUPS.completed, LIMIT);

  const data = useMemo(() => {
    const out: Item[] = [];
    for (const [label, rows] of [["Active", active], ["Waiting", waiting], ["Failed", failed], ["Completed", completed]] as const) {
      if (!rows.length) continue;
      out.push({ kind: "header", id: `h-${label}`, label });
      for (const row of rows) out.push({ kind: "row", id: row.id, row });
    }
    return out;
  }, [active, waiting, failed, completed]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Text style={styles.title}>Downloads</Text>
      {data.length ? (
        <FlashList data={data} renderItem={renderItem} getItemType={getItemType} keyExtractor={keyExtractor} contentContainerStyle={{ paddingBottom: tabBarHeight }} />
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Queue is silent.</Text>
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  title: { padding: spacing.lg, fontFamily: fonts.display, fontSize: fontSize.h1, color: c.onSurface, borderBottomWidth: 1.5, borderBottomColor: c.border },
  section: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm, fontFamily: fonts.overline, fontSize: fontSize.overline, color: c.mutedSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { fontFamily: fonts.text, fontSize: fontSize.bodyLg, color: c.mutedSecondary },
}));
