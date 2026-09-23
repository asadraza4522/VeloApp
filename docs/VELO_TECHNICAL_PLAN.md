# Velo — Technical Plan (TSD-lite v0.1)

Derived from `memory/Velo PRD v1.1.md`, `memory/design_guidelines.json`, the brand kit in `memory/assets/`, and an audit of the existing `frontend/` + `backend/` demo code.
Scope: Android MVP first, iOS second (same JS, Swift native module later).

---

## 1. Decisions at a glance

| # | Question | Decision | Why |
|---|----------|----------|-----|
| D1 | Expo vs bare React Native | **Stay on Expo (SDK 57, Expo Router) with prebuild / CNG + custom dev client.** No Expo Go. No bare-RN migration. | Every native need in the PRD (Kotlin download service, MediaStore, share intent, ads) is covered by Expo Modules API + config plugins. Bare RN gives nothing extra and loses EAS Build/Update, autolinking and upgrade tooling. |
| D2 | Navigation | **Expo Router** (it is React Navigation underneath, so PRD §57 is satisfied). | File-based, typed routes, deep links + share-intent handled centrally. |
| D3 | Backend | **Supabase = control plane** (Auth, Postgres+RLS, Realtime, Edge Functions, pgmq, Storage-for-thumbs-only, flags). **Python FastAPI worker** = data plane (yt-dlp, gallery-dl, FFmpeg). | Matches PRD §60–61. Alternatives (Firebase, custom Node+PG) cost more ops for no gain here. |
| D4 | Where files download | **On device** via a Kotlin native engine. Server never proxies large media. | PRD §62. Cheapest, private, scales with users not with server bandwidth. |
| D5 | Source of truth for the app | **Local SQLite (expo-sqlite + Drizzle)**. Supabase is a sync target, not the read path. | Offline-first: library, sources, queue, settings all work with no network. |
| D6 | State | **Zustand** (UI/session state, selectors) + **Drizzle live queries** (data) + **TanStack Query** (server calls only: resolve, entitlements, flags). | Replaces the current single giant React Context that re-renders everything. |
| D7 | Lists | **FlashList v2** everywhere; `expo-image` for all images. | Library and queue are the hot screens. |
| D8 | Auth | **Supabase anonymous sign-in on first launch**, upgrade to email / Google later (link identity). | Zero-friction start, entitlements + sync bound to a real `user_id` from day one. |
| D9 | Ads / premium | `react-native-google-mobile-ads` with **server-side verification (SSV)** → Edge Function → `entitlements`. Paid tier via **RevenueCat** webhook → same table. | PRD §52–56: client must never grant itself Premium. |
| D10 | Design system | Rewrite tokens to the **brand kit** (navy / blue / purple / teal, Poppins). Espresso-gold palette retired. | Brand kit is the newer, real asset set. See §12. |
| D11 | Web target | **Drop web** (Android MVP, iOS later). Remove `react-native-web`, `.web.ts` shims. | Less surface, smaller bundle, no dual-platform tax. |
| D12 | Audio conversion | **MVP: on-device M4A only** (`MediaCodec` AAC / remux, zero deps). **Later: FFmpeg** (LGPL-only audio build, maintained fork of the retired ffmpeg-kit, decided at that time) for MP3/OPUS/video conversion and HLS merging. All conversion sits behind one `AudioConverter` interface so the engine can be swapped without touching JS. | Ships fast now; FFmpeg is the right long-term tool but is a native-dependency + size decision we defer until the core downloader works. Server-side conversion stays a disabled fallback. See §7.4. |
| D13 | Distribution | **Two variants from one codebase: Velo Full and Velo Lite.** **Full** (all popular platforms) ships first via alternative stores / direct APK links. **Lite** (no third-party-platform downloaders) is the Play Store version, submitted after the privacy/policy review. Lite's restricted features are **excluded at build time, never switched on later by a flag.** | Fast launch of the real product now, low-risk Play listing later. Turning banned behavior on after Play review can get the developer account terminated. See §7.5 and R1. |
| D14 | Download location | **Never on the server.** Worker only *resolves* a page URL into a direct media URL + headers; the phone downloads it. | PRD §62; zero bandwidth cost. Legacy server download code is deleted. |
| D15 | Ids & ops | **Lite (Play): `com.velo.app`. Full: `com.velo.app.full`.** Worker on **Fly.io**. Sign-in: **anonymous + Google** (email OTP later). Analytics: **PostHog + Sentry**. Reward cap **4 h/day** (flag). | Package id confirmed by owner. Details in §18. |

---

## 2. System architecture

```
┌────────────────────────── Android app (Expo / React Native) ───────────────────────────┐
│  UI (Expo Router screens)                                                              │
│    │  Zustand (ui/session)   Drizzle live queries   TanStack Query (server calls)      │
│    ▼                                                                                   │
│  Domain layer (pure TS): sources · downloads · library · resolve · sync · entitlements │
│    │                                   │                                               │
│    ▼                                   ▼                                               │
│  SQLite (expo-sqlite)             Native modules (Kotlin, Expo Modules API)            │
│  + outbox table                    ├─ velo-download-engine  (WorkManager + OkHttp)     │
│                                    └─ velo-media-store      (MediaStore, observers)    │
└───────┬───────────────────────────────────────────────┬────────────────────────────────┘
        │ HTTPS (supabase-js, RLS)                       │ direct media URL (resolved)
        ▼                                                ▼
┌──────────── Supabase (control plane) ───────────┐   CDN of the source platform
│ Auth · Postgres+RLS · Realtime · pgmq · Flags   │
│ Edge Functions: resolve · ad-ssv · rc-webhook   │
│                 sync-push · flags               │
└───────┬─────────────────────────────────────────┘
        │ authenticated HTTP + pgmq (conversion / long jobs)
        ▼
┌──────────── Python worker (Docker: Fly.io / Cloud Run) ─────┐
│ FastAPI · Resolver Manager · yt-dlp · gallery-dl (resolve only)│
└─────────────────────────────────────────────────────────────┘
```

**Resolve flow (latency-sensitive, so not queue-first):**
app → Edge Function `resolve` (JWT, rate-limit, entitlement check) → worker `/resolve` (sync, ≤20 s) → normalized `MediaResult` → app. On worker timeout the Edge Function enqueues a `resolve_jobs` pgmq message and the client waits on Realtime. *(Deviation from PRD §61's queue-only wording; queue stays for conversion and slow resolves.)*

**Download flow:** app picks a `MediaVariant` → native engine downloads the direct URL → (mux / extract) → MediaStore → JS mirrors state into SQLite → outbox syncs metadata (never the file) to Supabase.

---

## 3. Repository layout (target)

```
VeloApp/
├── CLAUDE.md
├── docs/                         # this plan, ADRs
├── memory/                       # PRD, design guidelines, brand assets (read-only references)
├── frontend/                     # Expo app
│   ├── src/
│   │   ├── app/                  # Expo Router: routes ONLY
│   │   │   ├── _layout.tsx       #   providers, fonts, DB gate, splash
│   │   │   ├── (tabs)/           #   home · library · downloads · tools · settings
│   │   │   ├── source/[id].tsx   #   Source Details (PRD §45)
│   │   │   ├── player/[id].tsx
│   │   │   ├── sheets/           #   formModal routes: format-picker, premium, share-intake
│   │   │   ├── onboarding.tsx
│   │   │   └── +native-intent.ts #   share-intent → route
│   │   ├── screens/              # screen bodies (+ private components per screen)
│   │   ├── components/           # shared UI: glass-card, media-tile, progress-bar, status-chip…
│   │   ├── design/               # tokens (theme.ts), useTheme, typography, glass helpers
│   │   ├── db/                   # schema.ts (Drizzle), migrations/, client.ts, queries/
│   │   ├── domain/
│   │   │   ├── sources/          # create/save/dedupe/canonicalize, source actions
│   │   │   ├── downloads/        # state machine, controller, native-engine bridge
│   │   │   ├── library/          # missing-file scan, filters, search (FTS5)
│   │   │   ├── resolve/          # resolve client, MediaResult types (zod), variant picker
│   │   │   ├── organize/         # template engine ({platform}/{creator}…), filename sanitizer
│   │   │   ├── sync/             # outbox, push, pull, realtime hint, conflict rules
│   │   │   ├── entitlements/     # hasEntitlement(), rewarded-ad flow, RevenueCat
│   │   │   └── settings/
│   │   ├── native/               # TS wrappers over modules (typed, mockable)
│   │   ├── services/             # supabase client, analytics, sentry, ads
│   │   ├── stores/               # zustand slices (ui, session, queue-progress)
│   │   ├── hooks/  utils/  constants.ts
│   ├── modules/                  # LOCAL Expo modules (Kotlin now, Swift later)
│   │   ├── velo-download-engine/
│   │   └── velo-media-store/
│   ├── assets/ (fonts, brand icons, splash)   ├── app.config.ts   ├── eas.json
├── supabase/
│   ├── config.toml
│   ├── migrations/               # imperative migrations (supabase migration new …)
│   ├── functions/                # resolve, ad-ssv, rc-webhook, sync-push, flags
│   ├── tests/                    # pgTAP RLS tests
│   └── seed.sql
└── worker/                       # was backend/ — FastAPI resolver worker
    ├── app/ (api/, resolvers/, manager.py, failures.py, models.py, queue.py)
    ├── tests/   ├── Dockerfile   └── pyproject.toml
```

Notes:
- Existing app uses root `app/` + `src/`; we move routes into `src/app` (project is a demo rebuild, so cost is low). Alias `@/*` → `./src/*` already set.
- `backend/` is renamed `worker/`; nothing in it is a user-facing API anymore.

---

## 4. Data model

### 4.1 Local SQLite (device) — authoritative for the UI

Every syncable table carries: `id` (client-generated UUIDv7), `created_at`, `updated_at`, `deleted_at` (soft delete), `dirty` (0/1), `server_rev`.

| Table | Key columns |
|---|---|
| `media_sources` | id, original_url, canonical_url, platform, platform_media_id, creator_id, creator_name, title, description, thumbnail_url, media_type, duration_ms, published_at, first_seen_at, last_checked_at, status (`saved\|resolved\|unavailable\|failed`), failure_code, favorite, resolve_state (`idle\|pending\|done`) |
| `source_urls` | id, source_id, url, kind (`original\|canonical\|redirect`), seen_at |
| `downloads` | id, source_id, variant_json, container, resolution, filename, **local_uri (device-only, never synced)**, filesize, status (PRD §29 states), failure_code, progress_bytes, total_bytes, created_at, completed_at, file_deleted_at, resolver_id |
| `download_attempts` | id, download_id, resolver_id, started_at, ended_at, failure_code, detail |
| `organization_rules` | id, template, filename_template, scope |
| `settings` | key, value (JSON) — theme, glass_intensity, wifi_only, default_quality, template… |
| `outbox` | seq, table, row_id, op (`upsert\|delete`), payload, created_at, attempts |
| `sync_state` | table, cursor_updated_at, cursor_id |
| `kv_cache` | entitlements snapshot, feature flags, resolver health (with `fetched_at`) |
| `sources_fts` (FTS5) | title, creator, platform, url, filename → PRD §37 search |

Indexes: `(status, updated_at)`, `(platform, media_type)`, `(source_id)`, `canonical_url` UNIQUE-ish (dedupe), `platform_media_id`.

### 4.2 Supabase Postgres (cloud) — MVP subset of PRD §63

All tables: RLS **on**, policies `TO authenticated` with `(select auth.uid()) = user_id`; `UPDATE` policies carry both `USING` and `WITH CHECK`; no `user_metadata` in any policy; views `security_invoker`; no `SECURITY DEFINER` outside a private schema.

```sql
-- user data (synced)
profiles(id uuid pk = auth.users.id, display_name, created_at)
devices(id, user_id, platform, push_token, last_seen_at)
media_sources(id uuid pk, user_id, original_url, canonical_url, platform, platform_media_id,
              creator_id, creator_name, title, description, thumbnail_url, media_type,
              duration_ms, published_at, first_seen_at, last_checked_at, status, failure_code,
              favorite bool, updated_at timestamptz default now(), deleted_at,
              unique(user_id, canonical_url))
source_urls(id, source_id, user_id, url, kind, seen_at)
downloads(id, source_id, user_id, device_id, variant jsonb, container, resolution, filename,
          filesize, status, failure_code, created_at, completed_at, file_deleted_at,
          updated_at, deleted_at)            -- no local_uri
download_attempts(id, download_id, user_id, resolver_id, started_at, ended_at, failure_code, detail)
organization_rules(id, user_id, template, filename_template, updated_at, deleted_at)
settings(user_id pk, data jsonb, updated_at)

-- platform data (read-only to clients)
resolvers(id, name, priority, enabled)
resolver_capabilities(resolver_id, platform, media_type)
resolver_health(resolver_id, platform, success_rate, checked_at)     -- written by worker only
feature_flags(key pk, value jsonb, rollout int, updated_at)

-- monetization (client read-only; writes only via Edge Functions with service role)
entitlements(id, user_id, feature, enabled, source enum('subscription','rewarded_ad','promotion','admin'),
             expires_at, created_at)
ad_rewards(id, user_id, ad_network, transaction_id unique, granted_seconds, verified_at)  -- idempotency key
usage_daily(user_id, day, rewarded_hours int, resolves int, primary key(user_id, day))

-- ops
conversion_jobs(id, user_id, source_id, spec jsonb, status, result_url, created_at)  -- + pgmq queue "conversion_jobs"
```

Key functions (SQL, `SECURITY INVOKER` unless noted):
- `grant_rewarded_hour(user_id, txn_id)` — runs from the `ad-ssv` Edge Function under the service role. Idempotent on `ad_rewards.transaction_id`; enforces daily cap from `feature_flags`; **stacks** by `premium_until = greatest(now(), premium_until) + 1h` (PRD §52).
- `sync_pull(table, since_updated_at, since_id, limit)` — keyset pagination.
- `touch_updated_at()` trigger — server clock owns `updated_at`.

Indexes: every RLS column (`user_id`), `(user_id, updated_at, id)` on synced tables, `(user_id, platform)`, GIN/trgm on `title` only if server-side search is ever needed (it is not for MVP — search is local).

Run `supabase db advisors` after every migration; commit only clean.

---

## 5. Offline-first design

**Rule: the UI never awaits the network to render or to record intent.**

| Capability | Offline behavior |
|---|---|
| Browse library / sources / queue / settings | Fully local (SQLite). |
| Play downloaded media | Fully local. |
| Save Link | Creates `media_sources` row with `resolve_state=pending`, `status=saved`. Metadata filled when online (background resolve, PRD §9). |
| Start a download | Needs a resolved variant. If none cached, source stays `pending`, user sees "Waiting for network", auto-resolves on reconnect, then prompts/auto-starts per settings. |
| Resume/pause/cancel in-flight downloads | Native engine is authoritative; survives app kill and reboot. |
| Redownload | Reuses stored variant if URL still valid; else re-resolve (online) and diff formats (PRD §11–12). |
| Favorites, rename, organization rules, deleting records | Local write + outbox. |
| Premium | Cached `entitlements` snapshot with `expires_at`; countdown is computed locally from server-issued absolute time (immune to clock rewind only up to the last online check — on reconnect the snapshot refreshes). |
| Feature flags, resolver health | Last-known cached copy, TTL 1 h online. |

### Sync engine (`domain/sync`)
- **Outbox pattern:** every local mutation writes the row **and** an `outbox` row in one SQLite transaction.
- **Push:** worker loop (on app foreground, connectivity change, and after writes, debounced) sends batches through Edge Function `sync-push` (validates payload with zod, upserts under the user's JWT so RLS applies). Retries with exponential backoff + jitter; poison ops are parked after N attempts and surfaced in Settings → Sync.
- **Pull:** per table keyset cursor `(updated_at, id)`; Realtime channel `user:{id}` is only a *hint* to pull now (no reliance on delivery).
- **Conflicts:** single-user, multi-device → **last-write-wins at row level using server `updated_at`**; deletes are tombstones (`deleted_at`); tombstones compacted after 30 days. `favorite` and `settings` merge per key.
- **Not synced:** media files, `local_uri`, thumbnails cache. `downloads.file_deleted_at` is per-device (`device_id`) so another device's missing file never marks yours missing.
- **Idempotency:** client UUIDs; `unique(user_id, canonical_url)` de-dupes sources created on two devices.
- **Migrations:** Drizzle migrations run before first render (DB gate in root `_layout.tsx`, splash held). Never destructive without a backup copy of the DB file.

### Connectivity
`expo-network` (state stream) → single `useOnline()` store. WorkManager network constraints in the native engine enforce Wi-Fi-only (setting) independently of JS.

---

## 6. Resolver system (worker)

```
POST /v1/resolve {url, hints?}          (worker is private; only Edge Functions call it, with a shared secret + JWT passthrough)
  → Resolver Manager
      1. normalize + canonicalize URL, detect platform
      2. candidates = resolvers supporting (platform, media_type)  sorted by priority × confidence × health
      3. try best; on failure classify (PRD §16) → fallback only if the failure type allows it
      4. return MediaResult { source: MediaMetadata, variants: MediaVariant[], resolver_id, expires_at, headers? }
```

- Resolver interface (Python `Protocol`): `id`, `supports(url) -> Score`, `resolve(url) -> MediaResult`, `health()`.
- MVP resolvers: `direct`, `ytdlp`, `gallerydl`, `oembed` (metadata fallback; from existing `resolver.py`), custom-resolver skeleton (Instagram/TikTok later).
- **Failure classification** → enum from PRD §16 (`AUTH_REQUIRED, PRIVATE, RATE_LIMITED, MEDIA_NOT_FOUND, PROVIDER_CHANGED, FORMAT_UNAVAILABLE, NETWORK_ERROR, UNSUPPORTED, CAPTCHA_REQUIRED, SERVER_ERROR, DRM_PROTECTED, UNKNOWN`). Fallback table: `PROVIDER_CHANGED → next resolver`, `FORMAT_UNAVAILABLE → same resolver other formats`, `RATE_LIMITED → backoff`, **`DRM_PROTECTED / AUTH_REQUIRED / PRIVATE / CAPTCHA_REQUIRED → stop, never bypass`** (PRD §17, §68).
- **Health:** worker records every attempt in `resolver_health`; unhealthy resolvers are demoted automatically.
- **yt-dlp freshness:** platforms break weekly. CI rebuilds the worker image nightly with the latest `yt-dlp`; canary URLs per platform run in CI and page on failure.
- **SSRF hardening:** reject non-http(s), private/loopback/link-local ranges, resolve-then-connect check, response size caps, per-request timeout, no cookies/credentials from users.
- **Rate limits:** per-user (Edge Function, backed by `usage_daily`) and global concurrency cap on the worker.
- **Direct URL expiry:** `MediaResult.expires_at`; the native engine reports HTTP 403/410 as `URL_EXPIRED` → JS re-resolves once transparently.
- **The worker never downloads or stores user media.** It returns `MediaResult` (metadata + direct URLs + required headers + `expires_at`); the phone fetches the bytes. Any `yt-dlp` call uses `--simulate`/`-J`-style extraction only.
- **IP-bound URLs (R7):** some platforms sign direct URLs to the requester's IP, so a URL resolved on the server can 403 on the phone. The Resolver Manager marks each variant `ip_bound: true|false|unknown`; the client treats a first-request 403 as `URL_EXPIRED → re-resolve`, and if that repeats, falls back to the Full-build device-side resolver (§7.5/R7). Measure real hit rate in the Phase 2 canaries before building the fallback.
- **Conversion jobs** are **off by default** (D12). The pgmq `conversion_jobs` queue and worker consumer stay in the schema as a flagged fallback (e.g. for devices below API 29 that need OPUS); temp storage TTL 1 h, file deleted after fetch.

Hosting: **Fly.io** (shared-cpu-1x, 512 MB–1 GB, 1 always-on machine ≈ a few USD/month, no cold start, Docker deploy). Cloud Run is the alternative if traffic spikes; the worker is stateless so switching is cheap.

---

## 7. Native layer

### 7.1 Why local Expo modules
`modules/velo-download-engine` and `modules/velo-media-store` use the **Expo Modules API** (Kotlin), autolinked, with typed TS (`Function`/`AsyncFunction`, `Events`). Config plugins add permissions/services to the manifest. Use `expo-module` skill when implementing.

### 7.2 `velo-download-engine` (Kotlin)

> **As built in Phase 3 (deviations from the text below):** minSdk raised to **29** (MediaStore `RELATIVE_PATH`, no storage permission); scheduler is **WorkManager expedited work + a `dataSync` foreground service** (user-initiated data-transfer jobs are a follow-up once verified on real Android 14/15 devices); the engine's task table is a plain **`SQLiteOpenHelper`** (no Room/annotation processing for one table); `velo-download-engine` hosts **both** Expo modules (`VeloDownloadEngine`, `VeloMediaStore`); audio extraction is **AAC remux only** (non-AAC re-encoding waits for the FFmpeg module); the concurrency cap is read once per process.


TS contract (extends PRD §59):

```ts
interface NativeDownloadEngine {
  enqueue(job: NativeDownloadJob): Promise<string>;          // returns taskId
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  retry(id: string): Promise<void>;
  getStatus(id: string): Promise<DownloadStatus>;
  listActive(): Promise<DownloadStatus[]>;                   // reconcile on app start / foreground
  setConstraints(c: { wifiOnly: boolean; requireCharging?: boolean; maxConcurrent: number }): Promise<void>;
  addListener('onProgress' | 'onStateChange' | 'onComplete' | 'onError', cb): Subscription;
}
type NativeDownloadJob = {
  taskId: string; url: string; headers?: Record<string,string>;
  streams?: { video?: string; audio?: string };              // DASH-style separate streams → mux
  target: { kind: 'video'|'audio'|'image'; relativePath: string; filename: string; mime: string };
  postProcess?: 'none' | 'mux' | 'extract-audio-m4a';
  resumeFrom?: number; expectedSize?: number; etag?: string;
};
```

Implementation choices (Android):
- **Scheduler:** `WorkManager` with **user-initiated data transfer jobs on API 34+** (foreground-service `dataSync` alone is capped to ~6 h/24 h on Android 15 and can be killed); classic foreground service + persistent notification fallback below API 34. Notification channels: `downloads-active` (ongoing, low importance), `downloads-done`, `downloads-failed`.
- **Network:** OkHttp, HTTP `Range` resume with `If-Range`/ETag, atomic `*.part` → rename, retry with backoff on `IOException`, 403/410 → `URL_EXPIRED`, cancellation-safe. Single connection per task in MVP (segmented parallel download = later optimization).
- **State persistence:** engine owns a small **Room** DB (`task_id, state, bytes, url, target, etag…`) → survives process death/reboot; JS SQLite is the mirror. On every app start JS calls `listActive()` and reconciles.
- **Progress throttle:** native emits ≤ 4 Hz per task, coalesced.
- **Post-process (no FFmpeg on device):** `ffmpeg-kit` is retired upstream, so we avoid FFmpeg entirely. Video+audio streams remux with **`MediaMuxer`** (no re-encode, H.264/AAC/MP4). Audio conversion is native — see §7.4.
- **HLS/DASH manifests:** MVP prefers progressive HTTPS and separate DASH streams; HLS-only sources use Media3's downloader in a later phase (risk R3).
- **Save:** write into MediaStore (scoped storage: `Movies/Velo/…`, `Music/Velo/…`, `Pictures/Velo/…`); `organize` templates map to `RELATIVE_PATH` under those roots. No `MANAGE_EXTERNAL_STORAGE`.
- **Battery/Doze:** WorkManager constraints (`NETWORK_UNMETERED` for Wi-Fi-only, optional charging); no wake locks beyond the transfer job.

### 7.3 `velo-media-store` (Kotlin)
`insert(entry) → uri`, `exists(uri)`, `existsMany(uris)` (batch, used by missing-file scan), `delete(uri)`, `registerObserver()` (ContentObserver → `onMediaChanged` event → library re-checks flagged rows), `openInFiles(uri)`, `shareFile(uri)`.
Missing-file rule (PRD §14): on Library open + observer event, check `downloads.local_uri`; set `file_deleted_at` and show "File missing" — **never** delete the source.

### 7.4 Audio conversion (decided, D12)

All conversion lives in `velo-download-engine` behind one interface, invoked as `postProcess: 'extract-audio'` with `format` + `bitrate`, on a background thread in the same WorkManager job (progress events reused):

```ts
interface AudioConverter {
  supports(format: 'm4a' | 'mp3' | 'opus'): boolean;
  convert(input: Uri, output: Target, opts: { format; bitrate; tags?: Metadata }, onProgress): Promise<void>;
}
```

| Phase | Implementation | Formats |
|---|---|---|
| **MVP** | `MediaCodecConverter`: `MediaExtractor` + `MediaMuxer` **remux** when the source is already AAC (instant, lossless); otherwise decode → `MediaCodec` AAC-LC → `MediaMuxer` MP4. No third-party native code. | **M4A** (default). Tools screen shows MP3/OPUS as "coming soon". |
| **Later** | `FfmpegConverter` as its own Expo module (`velo-ffmpeg`): a **maintained fork of the retired ffmpeg-kit** (or a self-built minimal FFmpeg `.so`), **LGPL-only audio-focused build** (libmp3lame, libopus, native AAC; no GPL libs like x264/x265), arm64-v8a + armeabi-v7a only. Registered in the same `AudioConverter` slot. | **MP3, OPUS**, plus ID3/cover tags (PRD §41), video→audio/video→video conversion, HLS/DASH merging (closes R3). |

Decision gate before adding FFmpeg: pick the fork/build (check maintenance status, license, Android 15 16-KB page-size support), measure APK growth (expect ~8–15 MB for a trimmed audio build), and keep LGPL attribution + relink/source offer in the licenses screen. If the size is a problem for Lite, ship FFmpeg only in Full.

Rejected: server-side transcoding (bandwidth + latency + cost; kept only as a disabled `conversion_jobs` fallback), LAME/Opus hand-rolled JNI (more native maintenance than adopting FFmpeg once we need it anyway).

### 7.5 Distribution variants — Velo Full and Velo Lite (decided, D13)

**How other YouTube downloaders work (why this matters):** they don't use an official API. They reverse-engineer YouTube's internal player endpoints, run its signature/`n`-parameter JavaScript to unlock the direct `googlevideo.com` stream URLs, then download those URLs — either on the phone (NewPipe-style / yt-dlp-based apps) or on a server (web "downloader" sites). That is exactly what our Resolver Manager + yt-dlp does. Such apps live on F-Droid, GitHub, alternative stores and their own websites; on Google Play they are either rejected or removed, and the ones that survive for a while usually did so by hiding the feature. Google's policy also treats behavior changed after review as deceptive. So we don't gamble the developer account: **Full launches first outside Play; Lite goes to Play later.**

```
                         one codebase
                              │
          ┌───────────────────┴───────────────────┐
   Velo Full (ship first)                  Velo Lite (Play, later)
   EXPO_PUBLIC_DISTRIBUTION=full           EXPO_PUBLIC_DISTRIBUTION=lite
   APK · id com.velo.app.full              AAB · id com.velo.app
   alt stores + direct link                Play App Signing key
```

`EXPO_PUBLIC_DISTRIBUTION` (`full` default, `lite`) is read in `app.config.ts` (name, Android package) and in `src/distribution.ts` (`isLite`); Metro inlines it at build time, so Lite-restricted code must sit behind `if (isLite)`/guarded `require` to be excluded. An Android `buildConfigField` for the Kotlin modules is added in Phase 3. EAS profiles: `production-full`, `production-lite`; separate EAS Update channels.

| Capability | Lite (Play) | Full |
|---|---|---|
| Save Link, Source Details, Library, Organizer, search, favorites, sync, settings | ✅ | ✅ |
| Download **direct file URLs** (`.mp4/.mp3/.jpg…`), Internet Archive, Creative-Commons / public-domain hosts | ✅ (allow-list below) | ✅ |
| Local conversion of files already on the device (Tools) | ✅ | ✅ |
| Resolver Manager for **popular third-party platforms** | ❌ excluded at build + refused server-side | ✅ |
| Self-updater (own `latest.json`, signature-checked, never silent) | ❌ (Play forbids) | ✅ |
| Ads + rewarded Premium | ✅ | ✅ |

**Full launch platforms (most popular):** YouTube, Instagram, TikTok, Facebook, X (Twitter), Reddit, Pinterest, Vimeo, SoundCloud, Dailymotion, Twitch clips — via yt-dlp / gallery-dl. Login-gated or private content stays out of scope (`AUTH_REQUIRED` / `PRIVATE`); DRM is never bypassed. Per-platform support is best-effort and tracked by resolver health + nightly canaries (R2). Legal/ToS exposure of these platforms remains the owner's decision; mitigations: in-app + landing-page notice "only save content you have permission to save", terms of use, and a takedown/contact address.

**Lite (Play) allow-list of hosts (initial):** direct file URLs (a URL that is itself a media file), Internet Archive (`archive.org`), and Creative-Commons / public-domain hosts (e.g. Wikimedia Commons, Pixabay/Pexels-style free-license sites, Free Music Archive). Stored as a versioned JSON in the app and enforced again by the worker; can be expanded per release. To be reviewed against Play policy before submission.

Rules that keep this safe:
1. **No remote flag ever turns on a Lite-restricted capability.** Flags may only *narrow* Lite.
2. Worker enforces the same split: requests carry `x-velo-dist` (+ Play Integrity token for Lite); Lite requests for non-allow-listed hosts return `UNSUPPORTED`.
3. Play listing, screenshots, description and Data Safety form describe exactly the Lite feature set.
4. Full and Lite have different ids and signing keys, so they install side by side.
5. Full's in-app updater must verify the APK signature and version code and prompt the user; Lite contains no updater code.

**Launch order (revised):**
1. **Now → MVP complete:** build Full first (it is the full product; Lite is the same app minus flagged modules).
2. **Full release:** signed APK on alternative stores and direct link. **No domain yet**, so interim hosting = GitHub Releases (APK + `latest.json`) and/or alternative-store listings; move to the website when a domain exists.
3. **Later, after privacy/policy review + domain (privacy-policy URL):** ship Lite to Play (internal → closed → production).

Optional for Full only (spike after MVP): **device-side resolving** with `youtubedl-android` (bundled yt-dlp) to defeat IP-bound URLs and remove resolve-worker cost. Trade-off: +~30 MB, self-updating yt-dlp.

### 7.6 Other native integrations (no custom code)
- **Share intake:** `expo-share-intent` (already installed) → `+native-intent.ts` → `sheets/share-intake` (Download / Save Link, PRD §9).
- **Clipboard:** `expo-clipboard`; check only when app foregrounds (Android 10+ blocks background reads); show a non-modal "Paste detected link?" chip.
- **Notifications:** progress/complete via the native engine; `expo-notifications` only for remote push + permission UX.
- **Playback:** `expo-video` (video) + `expo-audio` (audio, background playback + lock-screen controls).
- **iOS (later):** Swift module with the *same* TS interface (`URLSession` background sessions, Share Extension via config plugin). Nothing above the `native/` wrapper changes.

---

## 8. Download state machine (`domain/downloads`)

States (PRD §29): `CREATED → VALIDATING → DETECTING_PLATFORM → RESOLVING → RESOLVED → WAITING_FOR_SELECTION → QUEUED → DOWNLOADING → PROCESSING → ORGANIZING → COMPLETED`, plus `PAUSED, CANCELED, RETRYING, FAILED, AUTH_REQUIRED, UNSUPPORTED, SOURCE_UNAVAILABLE`.

- One pure reducer `transition(state, event) → state` (unit-tested table: every legal edge, every illegal edge rejected).
- JS owns pre-download states (`CREATED…WAITING_FOR_SELECTION`); the native engine owns `QUEUED…PROCESSING`; JS owns `ORGANIZING/COMPLETED` (after MediaStore insert).
- Failure code decides available actions (PRD §17) via a single `actionsFor(failureCode)` map used by both Downloads and Source Details.
- Retry policy: automatic for `NETWORK_ERROR` (3× backoff), one automatic re-resolve for `URL_EXPIRED`; everything else user-driven.

---

## 9. Monetization & entitlements

- `hasEntitlement('premium')` reads the **cached server snapshot** (offline-safe); never derives from client-only state.
- **Rewarded flow:** app requests ad with `serverSideVerificationOptions.userId = supabase user id` and `customData = nonce` → user watches → Google calls Edge Function `ad-ssv` → verify ECDSA signature against Google's key set, check nonce, `grant_rewarded_hour()` (idempotent on `transaction_id`, cap from flag) → Realtime/pull updates the client → UI shows `1h 47m remaining` (PRD §52 stacking).
- **Subscriptions:** RevenueCat SDK → webhook Edge Function → `entitlements(source='subscription')`.
- **Ads policy in UI:** banner/native only on Home/Library; **no ads during downloads**, no interstitials (PRD §51). Premium users: no ad SDK init.
- Feature flags (`feature_flags`) control: reward cap/day, ad placements, resolver enable/disable, max concurrent downloads.

---

## 10. Performance plan

**Budgets (mid-tier Android, release build, Hermes):** cold start → interactive ≤ 2.0 s; tab switch ≤ 100 ms; library scroll 60 fps with 5k items; queue with 10 active tasks ≤ 5 % JS-thread frame drops; idle memory ≤ 250 MB; APK/AAB size tracked per release.

Practices (from the `vercel-react-native-skills` rules, applied):
1. **Lists:** FlashList v2, `getItemType` for tile/row/header, memoized items, stable callbacks, no inline style/object props, thumbnails pre-sized via `expo-image` (`recyclingKey`, `cachePolicy="disk"`, blurhash placeholder).
2. **Progress without re-render storms:** native emits ≤ 4 Hz; progress lives in a tiny `progressStore` (per-task Reanimated shared values / Zustand slice keyed by id). Only the progress bar subscribes. SQLite is written on **state change or ≥ 5 s**, not per tick.
3. **State:** Zustand selectors, no big Context; **React Compiler** enabled (`experiments.reactCompiler`) — destructure hook results as the skill recommends.
4. **Animation:** Reanimated worklets on UI thread, animate only `transform`/`opacity`; press feedback via Gesture Handler where it matters; haptics per design table.
5. **Glass cost:** blur only on tab bar, sticky header, Home hero card, player controls (design rule). `expo-blur` on Android is expensive → `low_end_android_fallback` = solid `surfaceSecondary`, chosen from a device-class check (RAM/API level) + user "Glass intensity" setting.
6. **Startup:** splash held only for fonts + DB migrations; everything else lazy (`Player`, Tools, premium sheet, ads SDK init deferred after first interactive); Hermes bytecode; inline requires; no work in module scope.
7. **DB:** WAL mode, prepared statements, batch inserts in one transaction, FTS5 for search, keyset pagination (never `OFFSET`), `existsMany` batch for missing-file scan.
8. **Bundle:** remove `react-native-web`, `dayjs` (keep `date-fns`), `async-storage` (use `expo-sqlite/kv-store`), `react-native-dotenv`, `react-native-webview` (until browser feature), `@react-native-community/slider` (→ `@expo/ui`). Audit with Expo Atlas before each release.
9. **Measure:** `EAS Observe` (launch/TTI), Sentry performance, Android Studio profiler + Perfetto for release checks, Baseline Profile for startup.

---

## 11. Security & privacy

- Supabase: RLS on all tables (§4.2), publishable key only in the app (`EXPO_PUBLIC_*`); service-role/secret keys **only** in Edge Function secrets and the worker env; never committed. The current `.env` files hold **test-only values** (Mongo URL, Expo tunnel host, demo backend URL) and are dropped along with the legacy backend; new envs use `.env.example` + gitignored `.env.local`, and real keys go only to EAS secrets / Supabase secrets / Fly secrets.
- JWT verified at every Edge Function; worker only reachable from Edge Functions (shared secret + network allowlist).
- Reward and entitlement writes impossible from the client (no INSERT/UPDATE policy on `entitlements`, `ad_rewards`).
- Local: `expo-secure-store` for the session refresh token; SQLite unencrypted (media metadata only) — revisit SQLCipher if requirements change.
- Privacy: analytics = event counts only (platform, media type, resolver result, feature usage); no URLs or titles in analytics; no media retained server-side beyond conversion TTL.
- Compliance boundaries (PRD §68): no DRM/auth/private-content bypass; copy in UI says "supported media you have permission to save".

---

## 12. Design system (updated)

Source of truth: `memory/design_guidelines.json` (rewritten to the brand kit; original kept as `memory/design_guidelines.v1-espresso-gold.json`).

- **Direction:** brand kit navy → cyan/blue/purple gradient mark + teal download accent; iOS-inspired glass over a deep-navy base; Poppins (headings) + Inter (body) — Inter is already bundled, **Poppins must be added**.
- **Tokens:** single `frontend/src/design/theme.ts` (light + dark, same keys as the guideline JSON). No color literals in components (already the repo's rule).
- **Glass rules kept** (blur over ≥ 75 % tint; never on list rows, inputs, dense queue cards).
- **Component inventory:** GlassCard, UrlInputBar, MediaTile (scrim), SourceRow, DownloadRow (thin 2–3 pt progress), StatusChip (🟢🟡🔵🔴 per PRD §36), FormatRow, QualityPresetControl (Best/Balanced/Data Saver/Custom), EmptyState, Toast, PremiumTimer.
- **Sheets/pickers/toggles:** prefer `@expo/ui` (native Compose) over `@gorhom/bottom-sheet` (Expo skill guidance); keep gorhom only if a required sheet behavior is missing.
- **Navigation:** 5 tabs per PRD §43 (Home, Library, Downloads, Tools, Settings). Custom JS tab bar with glass on Android MVP; switch to Expo Router `NativeTabs` when iOS ships. Source Details is a stack screen; Format Picker/Premium are form-sheet routes.
- **Assets:** copy from `memory/assets/`: `velo-app-icon.svg` / PNG exports → `icon.png`; Android adaptive XMLs → config plugin or `android/` via prebuild; splash from `Velo_Brand_Kit_Sheet` splash spec (navy bg + logomark). Application id changes from `com.emergent.*` to `com.velo.app` (Lite/Play) / `com.velo.app.full` (Full); iOS bundle id `com.velo.app` (§18).

---

## 13. Screen & route map (PRD → routes)

| Screen | Route | Notes |
|---|---|---|
| Home | `(tabs)/index` | URL input, Analyze, clipboard chip, Active, Recent, Quick actions |
| Library | `(tabs)/library` | Segmented **[Media] [Sources]**, search, filters, grid/list, favorites, missing-file badges |
| Downloads | `(tabs)/downloads` | Queue, per-task controls, failure actions |
| Tools | `(tabs)/tools` | Audio extraction (M4A at MVP; MP3/OPUS with FFmpeg later) |
| Settings | `(tabs)/settings` | Theme, glass, Wi-Fi-only, organization templates, premium, sync, about |
| Source Details | `source/[id]` | Thumb, metadata, Download/Open/Copy/Share, history, Redownload |
| Share intake | `sheets/share-intake` | Download vs Save Link |
| Format picker | `sheets/format-picker` | Variants + smart quality + previous-selection hint (PRD §12) |
| Premium | `sheets/premium` | Timer, Watch Ad +1 h, upgrade |
| Player | `player/[id]` | Full-bleed art, glass controls, expo-video / expo-audio |
| Onboarding | `onboarding` | Permissions (notifications), storage explainer, anonymous sign-in |

---

## 14. Disposition of existing code

| Existing | Action |
|---|---|
| `backend/resolver.py` (yt-dlp/oembed/image logic) | **Port** into `worker/app/resolvers/*` behind the Resolver interface; keep URL validation, formats compaction; add failure classification. |
| `backend/downloads.py` (server-side downloads) | **Delete** (contradicts PRD §62). Keep only as reference for yt-dlp option tuning. |
| `backend/server.py` (status checks, workspace sync, Mongo) | **Delete**; replaced by Supabase + worker `/v1/resolve`. |
| `backend/tests/test_resolver.py` | **Keep/port** to `worker/tests`. |
| `backend/.env`, `frontend/.env` | **Test-only values, no rotation needed.** Delete with the legacy backend; add `.env*` to `.gitignore`, ship `.env.example` (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_KEY`, `EXPO_PUBLIC_DISTRIBUTION`, ad unit ids). |
| `frontend/src/theme.ts` | **Rewrite values** to brand palette; keep structure/keys. |
| `frontend/src/components/{ui,sheets,error-boundary}.tsx` | **Split & refactor** into `components/*` (one component per file), re-skin to new tokens. |
| `frontend/src/state/app-state.tsx` (280-line context with seeds) | **Replace** with Zustand slices + Drizzle; remove `seedSources`. |
| `frontend/src/api.ts` | **Replace** with `domain/resolve` + supabase client. |
| `frontend/app/*.tsx` screens | **Rebuild** as `screens/*` bodies rendered by thin routes; reuse layout ideas. |
| `frontend/scripts/cmd-guard*`, `install-guard.sh`, `sync-shims.sh`, `.web` shims | **Remove** (platform-specific sandbox tooling). |
| `app.json` | **Convert to `app.config.ts`**; new name/slug/scheme/package, adaptive icon, permissions, plugins. |

---

## 15. Dependencies

**Phase 0 result:** package manager is npm (not yarn 1); web deps removed; fonts come from `@expo-google-fonts/poppins` + `/inter` (no bundled TTFs); added `expo-dev-client`, `expo-build-properties` (minSdk 26), `jest-expo` + `@react-native/jest-preset` (pinned to the RN version). Everything else below is added in its phase.

Add (`npx expo install …`): `expo-sqlite`, `drizzle-orm` (+ `drizzle-kit` dev), `zustand`, `@shopify/flash-list`, `@supabase/supabase-js`, `expo-audio`, `expo-network`, `expo-build-properties`, `expo-dev-client`, `@expo/ui`, `react-native-google-mobile-ads`, `react-native-purchases`, `zod`, `@sentry/react-native`, `uuid` (v7) or `expo-crypto`.
Remove: `react-native-web`, `react-dom`, `@expo/metro-runtime` (if unused), `@react-native-async-storage/async-storage`, `dayjs`, `react-native-dotenv`, `react-native-webview`, `@react-native-community/slider`, `expo-symbols`, `@react-native-vector-icons/material-design-icons` (use `@expo/vector-icons` MCI).
Pin versions + commit lockfile (Supabase supply-chain checklist).

---

## 16. Testing & CI/CD

| Layer | Tool |
|---|---|
| TS unit | Jest + RNTL (state machine, organize templates, filename sanitizer, sync engine with fake Supabase, URL canonicalization) |
| DB/RLS | Embedded Postgres (PGlite) tests in `supabase/tests` (no Docker; runs in CI): every table, user A cannot read/write user B, clients cannot write `entitlements`, server-only functions not callable by clients. Add pgTAP against a real local stack later if wanted. |
| Edge Functions | Deno tests (SSV signature verify with fixtures, idempotency, cap) |
| Worker | pytest (resolver fixtures, failure classification, SSRF guard) + nightly canary URLs |
| Native | Kotlin JUnit (Room state, range-resume with MockWebServer) + instrumented test on emulator |
| E2E | Maestro flows: paste→resolve→download→library; kill app mid-download→resume; airplane-mode save link; file deleted→redownload |
| CI/CD | EAS Workflows: lint + typecheck + tests on PR; `development` / `preview` / `production` build profiles; EAS Update for JS-only fixes (runtime version policy `fingerprint`); worker image built + deployed by GitHub Actions; `supabase db push` gated on advisors clean |

---

## 17. Roadmap (each phase ends with a demo-able exit criterion)

| Phase | Deliverable | Exit criterion |
|---|---|---|
| **0 Foundations** ✅ done (debug APK builds; on-device boot check pending) | Repo restructure (§3), `app.config.ts`, dev client, tokens + fonts + brand assets, lint/type/test CI, `.env` hygiene, Supabase project + local stack | App boots in dev client with new theme; CI green |
| **1 Data core** ✅ code done (device check pending: FTS5 in expo-sqlite, 5k-row scroll) | Drizzle schema + migrations, DB gate, sources/downloads repos, FTS search, Zustand slices, state-machine reducer + tests | Library/queue render from SQLite with 5k seeded rows at 60 fps |
| **2 Backend** ✅ code done (needs deploy + on-device check: `supabase db push`, deploy `resolve`, `fly deploy`, set env) | Supabase migrations + RLS + pgTAP, anonymous auth, Edge `resolve`, worker `/v1/resolve` with direct/yt-dlp/oembed + failure classification, health table | Paste real URL on device → variants list; RLS suite green |
| **3 Native engine** ✅ code done (Kotlin compiles + unit tests pass; on-device run pending: kill/reboot/network-flip test) | `velo-download-engine` (WorkManager/UIDT, resume, notifications, Room), `velo-media-store`, mux + M4A converter behind `AudioConverter` (§7.4) | 1 GB download survives app kill + reboot + network flip; file appears in gallery; missing-file detection works |
| **4 Core UX** ✅ code done (needs on-device pass) | Home, format picker, Downloads, Library (Media/Sources), Source Details, share intake, Save Link, redownload/retry/open/copy/share, organization templates | Full PRD §74 journeys pass on device (normal, deleted file, failed, save-for-later) |
| **5 Sync + offline hardening** ✅ code done (needs `supabase db push` of migration 2 + a two-device run) | Outbox/push/pull, Realtime hint, tombstones, offline resolve queue, cached flags | Airplane-mode session then reconnect converges on 2 devices |
| **6 Monetization** ✅ code done (needs AdMob/RevenueCat accounts + on-device run) | AdMob SSV → entitlements, timer UI, daily cap flag, RevenueCat | Watch 3 ads → stacked `2h59m`; forged SSV rejected |
| **7 Tools + polish** ✅ tools + player done; perf/a11y measurement + Sentry/PostHog still open | M4A conversion (§7.4), Full/Lite build profiles + allow-list (§7.5), player, glass fallback, perf pass vs budgets, a11y, Sentry/Observe | Budgets in §10 met on a mid-tier test device |
| **8 Release — Full** (1 wk) | Signed Full APK, alternative-store listings + GitHub Releases link, in-app updater, terms/notice | Full APK installable and self-updating |
| **9 FFmpeg conversion** (1–2 wk) | `velo-ffmpeg` module behind `AudioConverter`, MP3/OPUS, video→audio, HLS merge; **candidate:** parallel segmented downloads in `Downloader.kt` (N concurrent `Range` connections per file instead of today's sequential bounded chunks, each writing its own byte offset via the existing `RandomAccessFile`, no merge step, see R10) | MP3/OPUS convert on device; size measured; if parallel downloads land, throughput on a fast unthrottled host measurably beats sequential chunking |
| **10 Release — Lite (Play)** (after domain + policy review) | Lite build (`VELO_DISTRIBUTION=lite`) with host allow-list, Play listing matching Lite features only, Data Safety form, privacy-policy URL | Closed test → production |

---

## 18. Risks & open decisions

**Risks**
- **R1 — Store policy (mitigated by D13).** Play prohibits facilitating unauthorized downloads (notably YouTube). Full launches first on alternative stores/direct links; Lite (no third-party-platform downloaders, host allow-list) goes to Play after policy + privacy review. Never enable Lite-restricted features later via flag (account-termination risk). To do before Lite: read current Play policies (Deceptive Behavior, Intellectual Property, Device & Network Abuse, self-update) against the final Lite feature list; get legal review of terms/notice; privacy-policy URL requires the domain.
- **R2 — Resolver rot.** yt-dlp/gallery-dl break often → nightly image rebuild + canaries + health-based fallback (§6).
- **R3 — HLS-only sources.** Not covered by the MVP progressive+mux path; scheduled after Phase 4 based on real failure data.
- **R4 — Android background limits** (Doze, OEM killers, Android 15 FGS timeouts) → UIDT jobs + reconcile-on-start + in-app "battery optimization" help sheet.
- **R5 — Worker cost/abuse.** Per-user rate limits, entitlement gates for heavy jobs, global concurrency cap, budget alerts.
- **R6 — `@expo/ui` maturity / SDK 57 changes.** Check versioned docs before use; fallback to RN primitives per component.
- **R7 — IP-bound direct URLs (confirmed in Phase 2).** Real YouTube resolves return URLs with `ip=` (flagged `ip_bound: true`); a server-resolved URL may 403 on the phone. Measure in Phase 2 canaries; mitigations: prefer clients/formats that are not IP-bound, transparent re-resolve, and (Full build only) device-side resolving with `youtubedl-android`.
- **R8 — FFmpeg adoption (later).** ffmpeg-kit is retired: pick a maintained fork or self-build; check LGPL-only config, Android 15 16-KB page-size support and APK growth before committing (§7.4). Until then only M4A is offered.
- **R9 — Alternative-store review/trust.** Sideloaded APKs trigger Play Protect warnings; some alt stores ban downloader apps. Sign consistently, publish checksums, document install steps, review each store's policy.
- **R10 — Parallel segmented downloads (candidate, Phase 9).** `Downloader.kt` today fetches bounded `Range` chunks (8 MiB, PRD/Phase-3 fix for YouTube throttling) sequentially — one HTTP connection at a time. Researching two OSS downloaders (ghost-downloader-3, which wraps aria2; omniget) confirmed the common pattern for a second, independent speed gain: N concurrent `Range` connections per file, each writing its own byte offset via `RandomAccessFile` (already used), no separate merge step. This is additive to the existing throttling fix, not a replacement — helps on any fast unthrottled host, not just throttled ones like YouTube. Needs: a concurrency cap per download (distinct from the existing per-app download concurrency cap), a check that the host actually supports `Range` + returns a stable `Content-Length`/`ETag` before splitting (else fall back to today's single-stream path), and a MockWebServer test for interleaved concurrent chunk writes + cancellation. Not urgent; pick up alongside Phase 9 (FFmpeg) or whenever a perf pass on real hosts justifies it. Also noted from the same research: yt-dlp URL-expiry is better handled proactively (re-resolve on resume after a long pause) rather than only reactively (today: re-resolve once on 403/410) — small follow-up to `domain/downloads/controller.ts`, not scoped yet.

**Decisions made (previously open)**
- **O1 — Audio conversion:** M4A on-device at MVP; FFmpeg later for MP3/OPUS/video (behind `AudioConverter`).
- **O2 — Worker host:** **Fly.io** (always-on small machine, no cold start, Docker); Cloud Run if load demands.
- **O3 — Ids:** **confirmed by owner.** Lite/Play `com.velo.app`; Full `com.velo.app.full` (different signing key, side-by-side installable); iOS bundle id `com.velo.app`; scheme `velo`. Permanent once published.
- **O4 — Sign-in:** anonymous on first launch, then link **Google** (primary) — email OTP added later.
- **O5 — Analytics:** **PostHog** (events without URLs/titles) + **Sentry** (crashes/perf).
- **O6 — Reward cap:** **4 rewarded hours/day**, backend flag `rewarded_hours_per_day`.

**Still open (deferred by owner)**
- Website domain + privacy-policy URL — after the app is complete (needed only for Lite/Play and the website download page).
- Play policy review of the Lite feature list and allow-list — before Phase 10.
- FFmpeg fork/build choice — at Phase 9.
