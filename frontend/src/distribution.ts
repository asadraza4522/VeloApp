// Velo Full vs Lite (docs/VELO_TECHNICAL_PLAN.md §7.5). Lite = Play version: no third-party-platform
// downloaders. Metro inlines EXPO_PUBLIC_* at build time; Lite-restricted code must be guarded by
// isLite and never switched on later by a remote flag.
export const isLite = process.env.EXPO_PUBLIC_DISTRIBUTION === "lite";
