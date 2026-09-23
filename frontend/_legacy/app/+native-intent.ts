// Route incoming share-extension deep links to Home; the shared content itself
// is delivered through the useShareIntent hook, not the URL.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    if (new URL(path).hostname === "expo-sharing") {
      return "/";
    }
    return path;
  } catch {
    return "/";
  }
}
