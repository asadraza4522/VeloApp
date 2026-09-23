// expo-share-intent delivers the shared content through its hook (native/share-intent.tsx); the deep link
// that wakes the app must not be treated as a route, so send it to Home.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  return path.includes("dataUrl=") || path.includes("expo-sharing") ? "/" : path;
}
