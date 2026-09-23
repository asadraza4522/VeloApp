# Velo — project context for Claude

Velo = **Media Source Manager + Downloader + Converter + Organizer**. Tagline: *Save. Convert. Organize.*
Core idea: **the file can disappear, the source doesn't.** Every URL becomes a persistent `media_source`; downloads are child records; redownload/retry/open/share always work.
Android MVP first, iOS later.

## Read these first (source of truth)

| File | What |
|---|---|
| `memory/Velo PRD v1.1.md` | Product requirements. Wins on *what* to build. |
| `docs/VELO_TECHNICAL_PLAN.md` | Architecture, data model, sync, native, roadmap. Wins on *how*. |
| `memory/design_guidelines.json` | Design tokens/rules (v3, "Nivora Daylight" — light-only ink/amber neo-brutalist). v1 espresso/gold and v2 navy/glassmorphism are retired. Screens not yet reskinned to v3 — see the file's `instructions_to_main_agent`. |
| `memory/assets/` | Logos, icons, Android adaptive XML, brand spec. |

If PRD and plan disagree, the plan's "Decisions at a glance" documents deliberate deviations. Otherwise ask before diverging from the PRD.

## Stack

- **App:** Expo SDK 57, React Native 0.86 (New Architecture, Hermes), React 19, TypeScript strict, **Expo Router** (typed routes), React Compiler on. Prebuild/CNG + dev client — **not Expo Go**.
- **State/data:** local **SQLite (expo-sqlite + Drizzle)** is the source of truth; **Zustand** for UI/session; **TanStack Query** only for server calls; **FlashList**; **expo-image**.
- **Native (Kotlin, Expo Modules API, `frontend/modules/velo-download-engine`, minSdk 29):** WorkManager (expedited + `dataSync` foreground service) + OkHttp resumable downloader + own SQLite task table (`TaskStore`, authoritative for byte state) + `MediaProcessor` (MediaMuxer remux/mux, no FFmpeg) + `MediaStoreWriter` (scoped storage, no storage permission). Two Expo modules live in it: `VeloDownloadEngine`, `VeloMediaStore`. JS imports them only via `@velo/native` and the `DownloadEngineApi` interface (`src/native/types.ts`) so Jest can fake them. MP3/OPUS and re-encoding arrive with the later `velo-ffmpeg` module behind the same processing seam. Swift equivalents later behind the same TS interface.
- **Backend:** **Supabase** (Auth incl. anonymous, Postgres+RLS, Realtime, Edge Functions, pgmq, flags) + **Python FastAPI worker** on Fly.io (`worker/`: yt-dlp, gallery-dl, Resolver Manager). The worker only **resolves** page URLs to direct media URLs + headers; **it never downloads or stores media** — the phone downloads.
- **Ids:** Velo Lite (Play) `com.velo.app`, Velo Full `com.velo.app.full`, scheme `velo`. **Sign-in:** anonymous → link Google. **Analytics:** PostHog + Sentry (no URLs/titles in events).
- **Monetization:** AdMob rewarded ads with **server-side verification** → `entitlements`; RevenueCat for subscriptions.

## Layout

```
frontend/  src/app (routes ONLY) · screens · components · design · db · domain · native · services · stores
           modules/ (local Expo modules) · assets/ · app.config.ts
supabase/  migrations · functions · tests (pgTAP) · seed.sql
worker/    FastAPI resolver worker (resolves URLs → direct media URLs; never downloads)
docs/  memory/
```

> **Status: Phases 0–7 done (code; perf pass + Sentry/PostHog still open).** Phase 0 = foundations (structure, `app.config.ts`, EAS profiles, brand theme/fonts/icons, CI, Supabase init). Phase 1 = data core: Drizzle schema + migrations (`src/db/`), FTS5 search, keyset pagination, outbox-on-every-write, pure download state machine (`src/domain/downloads/`), URL canonicalization, Zustand stores, Library/Downloads screens on live queries, dev seeder (Settings → Developer). Phase 2 = backend: Supabase migration (`supabase/migrations/…_init_core.sql`: tables, RLS, server-only functions `consume_resolve` / `grant_rewarded_hour`), RLS tests in embedded Postgres (`supabase/tests`), `resolve` Edge Function (`supabase/functions/resolve`), resolver worker (`worker/`: direct / yt-dlp / gallery-dl / oEmbed, failure classification, SSRF guard, Lite policy, health), app client (`src/services`, `src/domain/resolve`) and a working Home screen (paste → Analyze → variants). Phase 3 = native engine: `frontend/modules/velo-download-engine` (Kotlin; two Expo modules `VeloDownloadEngine` + `VeloMediaStore`), JS controller `src/domain/downloads/controller.ts` (state machine ⇄ engine events ⇄ SQLite, URL-expiry re-resolve, auto-retry, reconcile), `src/native/` (typed API, runtime wiring), Downloads screen controls, Home “Download / M4A” buttons, missing-file scan. Phase 4 = core UX: format picker sheet (`screens/format-picker`, options/presets/previous-choice in `domain/resolve/quality.ts`), Source Details (`screens/source`: history, Open/Copy/Share source, Redownload, Retry, delete), share-intake sheet (`native/share-intent.tsx`), Save Link + clipboard chip + recents on Home, folder/filename templates (`domain/organize/template.ts` + Settings → Organization). The resolve result lives in memory only (`stores/resolve-cache.ts`); URLs are never persisted. "Glass" is tint-only for now (`components/glass-card.tsx`); real blur needs expo-blur `BlurTargetView` wiring (Phase 7). Phase 5 = offline sync (`src/domain/sync/`): outbox push (parents first, coalesced per row, parked after 8 rejects), keyset pull with per-table cursors, LWW by client edit time (server trigger `zz_lww_guard` + local check), tombstones + 30-day compaction, duplicate-link merge across devices (smaller UUIDv7 wins, children re-parented), per-device downloads (other device's finished history shows "File missing → Redownload"), `SyncManager` (debounce, single-flight, exponential backoff), offline resolve queue, cached flags/entitlements (`hasEntitlement()` reads the cache), Settings → Sync status, Realtime as a pull hint. The server is behind the `Remote` interface (`services/supabase-remote.ts`; tests use `fake-remote.ts`, which mirrors the DB's LWW guard, unique canonical URL and FKs). Second migration `…_sync_lww_realtime.sql` must be pushed. Phase 6 = monetization: migration 3 (`apply_subscription`, out-of-order safe), Edge Functions `ad-ssv` (verifies Google's ECDSA/DER signature, key rotation, ad-unit allow-list, idempotent + capped via `grant_rewarded_hour`) and `rc-webhook` (RevenueCat, secret header, ignores anonymous ids), app side `domain/monetization/premium.ts` (countdown format, allowance, `waitForPremiumChange` polling), `services/ads.ts` (UMP consent → SDK → rewarded, SSV user id), `services/purchases.ts` (Play/Lite only), `usePremium()` (cache-driven, ticks, offline-safe), Premium sheet (`sheets/premium`), `AdBanner` on Home/Library only (never Downloads, hidden for Premium). Premium is only ever granted by the server; the client just waits for the snapshot to change. Phase 7 = Tools + player: Kotlin `MediaTools` / `VeloMediaToolsModule` (probe, lossless AAC audio extraction, lossless trim to the previous keyframe, frame grab, image convert/resize/compress with EXIF, SHA-256, describe/move in MediaStore; results always land in `Velo/Tools`, inputs never overwritten; non-AAC / re-encode cases fail with FORMAT_UNAVAILABLE until FFmpeg), pure logic in `domain/tools/` (time, naming, reorganize planner that only touches `<Root>/Velo/**`, duplicates by size→hash, storage), screens under `screens/tools` + routes `app/tool/*`, library-file picker + device picker (`expo-document-picker`), in-app player `screens/player` (expo-video; expo-audio with background + lock-screen controls). Not done yet: Sentry/PostHog, a measured perf pass on device, batch tools (Premium later), FFmpeg tools (Phase 9). Phase 9 also carries a candidate perf item: parallel segmented downloads in `Downloader.kt` (see plan §Risks R10) — N concurrent Range connections per file instead of today's sequential bounded chunks, found while researching two OSS downloaders; not urgent, pick up alongside FFmpeg or a real perf pass. Next: Phase 8 (Full release build + updater) — or first a device test round.
>
> DB code takes a `Db` parameter (never imports `client.ts`) so it runs in Jest against in-memory better-sqlite3 (`src/db/test-db.ts`) with the exact shipped migrations. Change the schema → edit `schema.ts`, run `npx drizzle-kit generate --name <x>` (custom SQL: `--custom`), commit `src/db/migrations/`. `frontend/_legacy/` and root `_legacy/backend/` = the old demo app/backend (routes, components, state, scripts, fonts) kept for reference; it is excluded from tsc/eslint/jest/Metro — port ideas from it, don't import it.
>
> The old demo code (server-side downloads, giant context with seeded data) lives only in the `_legacy/` folders for reference. Do not import from or extend it.

## Commands

```bash
# app (from frontend/)
npx expo install <pkg>          # always use this, never raw npm i / yarn add
npx expo prebuild --clean       # regenerate android/ (never hand-edit android/ — use config plugins / modules)
npx expo run:android            # dev client build + run (native changes need a rebuild)
(cd android && ./gradlew :velo-download-engine:testDebugUnitTest -PreactNativeArchitectures=arm64-v8a)   # Kotlin unit tests
npm run typecheck && npm run lint && npm test

# supabase (from repo root). No Docker needed for the tests below:
(cd supabase/tests && npm test)                      # RLS + function tests on embedded Postgres (PGlite)
(cd supabase/functions/resolve && deno test handler.test.ts && deno check handler.ts index.ts)
supabase start | supabase db reset                   # full local stack (needs Docker)
supabase migration new <name>   # then edit; never invent filenames
supabase db advisors            # must be clean before committing a migration

# worker (from worker/)
python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"
pytest -m "not network"        # unit;  pytest -m network = live canaries
WORKER_SHARED_SECRET=dev uvicorn app.main:app --port 8080
```

Package manager is **npm** (`.npmrc`: `save-exact`, `legacy-peer-deps`); commit `package-lock.json`; pin versions. Not yarn (the old yarn.lock was dropped).

## Non-negotiable rules

**Product / legal**
- **Two variants, one codebase: Velo Full and Velo Lite** (`EXPO_PUBLIC_DISTRIBUTION=full|lite`, read in `app.config.ts` and `src/distribution.ts` (`isLite`); set per EAS profile; Android `buildConfigField` for Kotlin modules comes with Phase 3). **Full** = popular third-party platforms (YouTube, Instagram, TikTok, Facebook, X, Reddit, Pinterest, Vimeo, SoundCloud, Dailymotion, Twitch clips) + self-updater; ships first via alternative stores / direct link (interim: GitHub Releases). **Lite** = Play version, submitted later: no third-party-platform resolvers, downloads only from direct file URLs + allow-listed hosts (Internet Archive, CC/public-domain), no updater. Lite-restricted code is **excluded at build time**; **never enable it in Lite through a remote flag** (post-review behavior change → account termination risk). Flags may only *narrow* Lite. Worker enforces the same via `x-velo-dist` (+ Play Integrity for Lite).
- Never add server-side downloading. Resolve on the worker, download on the phone; treat 403/410 as `URL_EXPIRED` → re-resolve once (some platform URLs are IP-bound).
- Never bypass DRM, auth, private-content or access controls. `DRM_PROTECTED`, `AUTH_REQUIRED`, `PRIVATE`, `CAPTCHA_REQUIRED` → stop and show actions (Open Source / Copy URL). UI copy says "supported media you have permission to save", never "download anything".
- Deleting a local file **never** deletes the source (mark `file_deleted_at`, offer Redownload).
- Failed downloads keep their source; failure code (PRD §16) decides available actions via one `actionsFor(code)` map.

**Architecture**
- **Offline-first:** UI reads SQLite, never awaits network to render or record intent. Every syncable mutation writes the row **and** an `outbox` row in one transaction. Applying pulled server data never writes the outbox (no echo). Settings sync is whole-blob LWW: safe while only the `organization` key is synced (`SYNCED_SETTING_KEYS`); add a server-side jsonb merge before syncing more keys.
- Media files and `local_uri` are **never** uploaded or synced. Server never proxies large media.
- Native engine owns byte-level download state (`TaskStore`); JS mirrors it and `reconcile()`s from `listAll()` on start/foreground. Terminal native tasks stay until JS `ack`s them.
- Client is **never trusted to grant Premium**; entitlement/reward writes happen only in Edge Functions (service role). `hasEntitlement()` reads the cached server snapshot.

**Security**
- RLS on every table; `TO authenticated` **plus** `(select auth.uid()) = user_id`; UPDATE policies need `USING` and `WITH CHECK`; never use `user_metadata` in authorization; views `security_invoker`; no `SECURITY DEFINER` in exposed schemas.
- Only the publishable key ships in the app. Service-role/secret keys live in Edge Function secrets / worker (Fly) secrets only. Never commit `.env*` (ship `.env.example`). Current `frontend/.env` / `backend/.env` are test-only demo values and are deleted with the legacy backend.
- Worker: SSRF guard on every URL (http/https only, block private/loopback/link-local, resolve-then-connect), timeouts, size caps.

**Performance (from `vercel-react-native-skills`)**
- Lists: FlashList, `getItemType`, memoized items, stable callbacks, **no inline style/object props**.
- Live download progress goes to a small dedicated store / shared values (≤ 4 Hz from native); only the progress bar subscribes. Write SQLite on state change or ≥ 5 s, not per tick.
- Zustand **selectors**, never subscribe to whole stores. No new big React Contexts.
- Animate only `transform`/`opacity` on the UI thread (Reanimated). Blur only where design allows; use the low-end fallback.
- All images via `expo-image` (recyclingKey, disk cache, blurhash). Pagination is keyset, never `OFFSET`.
- Nothing heavy at module scope; lazy-load Player/Tools/premium/ads.

**Design**
- All colors/spacing/type/radius come from `frontend/src/design/theme.ts` via `useTheme` (keys mirror `memory/design_guidelines.json`). **No color literals in components.**
- Plus Jakarta Sans (all type) + JetBrains Mono (hashes/paths/live metrics) per v3. Status = icon + label + color. Every thumbnail gets the scrim before overlaid text. No glass/blur/gradients in v3 — depth is a solid ink border + hard offset shadow only (see `design_guidelines.json` `elevation`).
- Prefer `@expo/ui` for sheets/pickers/sliders/switches/menus before RN built-ins or community libs (exception: it is not a virtualized list).

## Conventions

- Files kebab-case (`media-tile.tsx`); one exported component per file; styles at bottom via `StyleSheet.create`; tests colocated (`*.test.ts`).
- `src/app` contains routes only; screen bodies in `src/screens/<name>/`; route files stay thin.
- Platform variants via `.android.ts` / `.ios.ts` / `.native.ts`; **no web target**.
- Types: `zod` at every trust boundary (worker/Edge responses, share-intent payloads, sync payloads); infer TS types from schemas.
- Download states are exactly PRD §29; transitions go through the single pure reducer in `domain/downloads`.
- Time: store UTC ISO/epoch ms; format at the edge with `date-fns`.
- Filenames/paths: always through `domain/organize` sanitizer; MediaStore roots only (`Movies/Velo`, `Music/Velo`, `Pictures/Velo`), no `MANAGE_EXTERNAL_STORAGE`.
- Prefer stdlib/native/already-installed deps over adding packages; adding a native dependency needs a note in the plan's §15.
- Don't restructure files outside the task; don't edit generated `android/`, `.expo/`, `graft/`.

## Testing expectations

State machine table tests, organize/sanitize tests, sync engine tests (fake Supabase), RLS tests for every table + server-only function (`supabase/tests`, PGlite; add pgTAP only if a real-Supabase run is needed), Deno tests for Edge Functions, pytest for resolvers/failure classification, Kotlin JVM tests for `Downloader` (MockWebServer: resume, Range/If-Range, 416, error codes, truncation, cancel); controller tests with a fake engine, Maestro E2E for the four PRD §74 journeys. Verify with real commands before claiming done.

## Skills & tools to use

- Expo work: `expo:expo-overview` (router) → `expo-router`, `expo-native-ui`, `expo-design-system`, `expo-ui`, `expo-animation`, `expo-module` (Kotlin modules), `expo-data-fetching`, `eas-*` for builds/updates.
- `vercel-react-native-skills` for list/animation/render performance rules.
- `supabase:supabase` + `supabase:supabase-postgres-best-practices` for any schema/RLS/function change; check the Supabase changelog before relying on memory.
- `mobile-app-ui-design`, `sleek-design-mobile-apps` for screen design; `superpowers:*` for planning/TDD/debugging; `ponytail` (lazy, minimal code) and `karpathy-guidelines` (surgical changes).
- **Graft** is wired for this repo (`graft/`, `.mcp.json`): use `graft ask "<task>" --source` / `graft callers <symbol>` before grepping. It is a local cache — rebuild with `graft build`.

## Open decisions (ask before assuming)

**Paid Premium is deferred (decided).** For now Premium = rewarded-ad hours only (server-verified). RevenueCat/Play Billing code exists but is off (`purchasesAvailable` false without a key). Later plan (owner is in Pakistan): sell time-based "Premium passes" (30 d / 1 y one-time payments that add to `expires_at`) through a provider-agnostic hosted checkout + signed webhook → `apply_subscription`; candidates: an international merchant-of-record that pays out to Pakistan (+ Payoneer) and a local gateway for PKR; Play Billing (RevenueCat) only for the Lite/Play build. Do not build billing until the owner picks providers.

Website domain / privacy-policy URL (deferred until the app is complete) · Play policy review of the Lite feature list + host allow-list (before Lite submission) · FFmpeg fork/build choice (at the FFmpeg phase). Everything else is decided in `docs/VELO_TECHNICAL_PLAN.md` §1 and §18.
