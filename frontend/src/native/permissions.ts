import { PermissionsAndroid, Platform } from "react-native";

/** Android 13+ needs the notification permission for progress/complete notifications. Downloads work without it. */
export async function ensureNotificationPermission(): Promise<void> {
  if (Platform.OS !== "android" || Platform.Version < 33) return;
  const p = "android.permission.POST_NOTIFICATIONS" as const;
  if (!(await PermissionsAndroid.check(p))) await PermissionsAndroid.request(p);
}
