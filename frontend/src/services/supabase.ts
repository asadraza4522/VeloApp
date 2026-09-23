import "react-native-url-polyfill/auto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { AppState } from "react-native";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY; // publishable key only — never a service-role key

// SecureStore values are limited to ~2 KB and a session JWT is larger, so values are stored in chunks.
const CHUNK = 1800;
const secureStorage = {
  async getItem(k: string) {
    const n = Number(await SecureStore.getItemAsync(`${k}.n`));
    if (!n) return null;
    const parts = await Promise.all(Array.from({ length: n }, (_, i) => SecureStore.getItemAsync(`${k}.${i}`)));
    return parts.some((p) => p == null) ? null : parts.join("");
  },
  async setItem(k: string, value: string) {
    const parts = value.match(new RegExp(`.{1,${CHUNK}}`, "gs")) ?? [""];
    await Promise.all(parts.map((p, i) => SecureStore.setItemAsync(`${k}.${i}`, p)));
    await SecureStore.setItemAsync(`${k}.n`, String(parts.length));
  },
  async removeItem(k: string) {
    const n = Number(await SecureStore.getItemAsync(`${k}.n`)) || 0;
    await Promise.all([SecureStore.deleteItemAsync(`${k}.n`), ...Array.from({ length: n }, (_, i) => SecureStore.deleteItemAsync(`${k}.${i}`))]);
  },
};

export class BackendNotConfiguredError extends Error {
  constructor() {
    super("Backend is not configured (EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_KEY)");
  }
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!url || !key) throw new BackendNotConfiguredError();
  if (!client) {
    client = createClient(url, key, {
      auth: { storage: secureStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
    });
    // Token refresh only while the app is foregrounded (Supabase RN guidance).
    AppState.addEventListener("change", (s) => (s === "active" ? client?.auth.startAutoRefresh() : client?.auth.stopAutoRefresh()));
    client.auth.startAutoRefresh();
  }
  return client;
}
