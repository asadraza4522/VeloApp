import { useMigrations } from "drizzle-orm/expo-sqlite/migrator";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { db } from "@/db/client";
import migrations from "@/db/migrations/migrations";

// Blocks rendering until the DB is opened and migrated. Returns `ready` so the root layout can keep
// the splash screen up meanwhile.
export function useDbReady() {
  return useMigrations(db, migrations);
}

export function DbError({ error }: { error: Error }): ReactNode {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Text selectable>Database migration failed: {error.message}</Text>
    </View>
  );
}
