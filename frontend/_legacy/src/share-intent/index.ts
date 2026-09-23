// Native share intent (iOS share extension / Android ACTION_SEND).
// Metro picks index.web.ts on web, where the native module does not exist.
export { ShareIntentProvider, useShareIntent } from "expo-share-intent";
