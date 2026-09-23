# Velo — Deployment guide (backend + first device run)

Project ref: `ibuxemwmpkqkkokcqcdg` · URL: `https://ibuxemwmpkqkkokcqcdg.supabase.co`
Order matters: **1 Supabase → 2 Worker (Fly.io) → 3 Edge Function → 4 Test → 5 Phone**.

You will need: a Supabase login, a Fly.io account (needs a credit card, ~USD 3–5/month), a Mac with Homebrew, an Android phone with USB debugging (or an emulator).

Secrets you will handle (never commit, never paste in chat):
| Name | Where it comes from | Where it goes |
|---|---|---|
| Database password | chosen when the Supabase project was created (reset in Settings → Database) | only typed into `supabase link` |
| `WORKER_SHARED_SECRET` | you generate: `openssl rand -hex 32` | Fly secret **and** Supabase function secret (same value) |
| Secret key `sb_secret_…` | Supabase → Settings → API Keys | Fly secret `SUPABASE_SERVICE_ROLE_KEY` (optional, health reporting) |

The publishable key you already have is public by design and is already in `frontend/.env.local`.

---

## 1. Supabase (database + auth)

```bash
brew upgrade supabase           # CLI here is 2.40.7; current is 2.117+
supabase login                  # opens the browser
cd /Users/qatarnavigatortechnology/Projects/VeloApp
supabase link --project-ref ibuxemwmpkqkkokcqcdg     # asks for the DB password
supabase db push                # applies supabase/migrations/20260920012927_init_core.sql
```

This applies **two** migrations: `…_init_core.sql` and `…_sync_lww_realtime.sql` (adds `client_updated_at`, the last-write-wins guard trigger and Realtime publication for the synced tables). Sync needs both.

Check it worked (Dashboard → Table Editor): tables `media_sources`, `downloads`, `entitlements`, `feature_flags` … exist and every one shows **RLS enabled**. `feature_flags` should contain 4 rows and `resolvers` 4 rows.
Then Dashboard → **Advisors** (Security): expect no "RLS disabled" errors.

**Turn on anonymous sign-ins** (the app signs in anonymously on first launch):
Dashboard → Authentication → Sign In / Providers → **Allow anonymous sign-ins → ON**.
(`config.toml` only affects a local stack, not the hosted project.)
Recommended soon: Authentication → Attack Protection → enable CAPTCHA, because anonymous sign-ins can be abused.

If `db push` fails, paste me the error; the migration was tested on embedded Postgres, not on Supabase itself.

## 2-alt. Worker on your own Mac (no Fly.io, for testing)

Runs the worker locally and exposes it with a free Cloudflare quick tunnel. Works only while this terminal stays open.

```bash
brew install cloudflared            # already done if you used the helper before
scripts/dev-worker.sh               # keep this terminal open
```
It prints a `https://….trycloudflare.com` URL and the exact command to run in **another terminal**:
```bash
supabase secrets set WORKER_URL=https://….trycloudflare.com WORKER_SHARED_SECRET=<printed secret> --project-ref ibuxemwmpkqkkokcqcdg
```
The URL changes every time you restart the script, so re-run that `supabase secrets set` line each time (the secret itself stays the same, stored in `worker/.dev-secret`, gitignored).
Then continue with step 3 (deploy the Edge Function) once; later restarts only need the secrets command.
Bonus: with the phone on the same network as the Mac, YouTube URLs share the same public IP as the resolver, so the IP-bound problem does not appear during testing.

### LAN mode (if the tunnel will not start)
Skips both the tunnel and the Supabase function: the phone calls the worker on your Mac directly (dev builds only).
```bash
scripts/dev-worker.sh --lan       # prints two lines for frontend/.env.local; keep it running
```
Add the two printed lines to `frontend/.env.local`, then rebuild once (`cd frontend && npx expo run:android`): the URL is compiled into the build and cleartext HTTP is enabled only because it is set. Phone and Mac must be on the same Wi-Fi. Remove the two lines before making any release/shared build.

## 2 (later, for real hosting). Worker on Fly.io (the resolver)

```bash
brew install flyctl
fly auth login
cd worker
# app names are global; pick a unique one (e.g. velo-worker-yourname)
fly launch --no-deploy --copy-config --name velo-worker-yourname --region fra
export SECRET=$(openssl rand -hex 32); echo $SECRET     # keep this value, you need it again in step 3
fly secrets set WORKER_SHARED_SECRET=$SECRET RESOLVER_TIMEOUT_SECONDS=25
# optional (resolver health reporting to Supabase):
fly secrets set SUPABASE_URL=https://ibuxemwmpkqkkokcqcdg.supabase.co SUPABASE_SERVICE_ROLE_KEY=<sb_secret_… key>
fly deploy
curl https://velo-worker-yourname.fly.dev/healthz        # → {"ok":true}
```

Notes: `fly.toml` keeps one always-on machine (no cold starts). If `fly launch` rewrites `fly.toml`, keep `internal_port = 8080` and the `/healthz` check. Wikimedia image links need a contact-bearing agent: `fly secrets set RESOLVER_USER_AGENT="VeloResolver/1.0 (you@example.com)"`.

## 3. Edge Function `resolve`

```bash
cd /Users/qatarnavigatortechnology/Projects/VeloApp
supabase secrets set WORKER_URL=https://velo-worker-yourname.fly.dev WORKER_SHARED_SECRET=$SECRET
supabase functions deploy resolve --no-verify-jwt --project-ref ibuxemwmpkqkkokcqcdg
```

`--no-verify-jwt` is intentional: the function checks the user itself and rejects unauthenticated calls before doing any work.

## 4. Test the backend before touching the phone

```bash
URL=https://ibuxemwmpkqkkokcqcdg.supabase.co
KEY=sb_publishable_GhoAvEVdQbMoxLZeai-UjA_iGwnZalK

# 1) anonymous user → access token
TOKEN=$(curl -s "$URL/auth/v1/signup" -H "apikey: $KEY" -H "content-type: application/json" -d '{}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

# 2) resolve a public video
curl -s "$URL/functions/v1/resolve" -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" -d '{"url":"https://archive.org/details/BigBuckBunny_124"}' | head -c 600

# 3) no token must be rejected (401)
curl -s -o /dev/null -w "%{http_code}\n" "$URL/functions/v1/resolve" -H "apikey: $KEY" -H "content-type: application/json" -d '{"url":"https://archive.org/details/BigBuckBunny_124"}'
```

Expected: step 2 returns `{"ok":true,"result":{"resolver_id":"ytdlp",…}}`; step 3 prints `401`.
`token failed`/empty in step 1 → anonymous sign-ins are still off (step 1).
Logs: Dashboard → Edge Functions → resolve → Logs, and `fly logs -a velo-worker-yourname`.

## 5. Run on your phone

```bash
cd frontend
npm install
adb devices                      # phone must show as "device" (enable Developer options → USB debugging)
npx expo run:android             # first build ≈ 10–25 min; installs the dev client
```
Later runs: `npm start`, open the installed "Velo Full" app.
`.env.local` (already created) points the app at your Supabase project. Restart Metro after any env change.

Test checklist:
1. Home → paste `https://archive.org/details/BigBuckBunny_124` → **Analyze** → formats list appears.
2. Tap **Download** on a "Video + audio" row → allow notifications → item appears in **Downloads** with progress.
3. Kill the app mid-download, reopen: it should continue or resume.
4. Turn Wi-Fi off/on: download resumes (Wi-Fi-only is the default; cellular downloads stay queued).
5. Reboot the phone: the task still exists.
6. Delete the finished file in the Files/Gallery app → open the app → row shows **File missing**; the source stays in Library.
7. Try a YouTube link: expect formats; a download may hit "URL expired" once (IP-bound URLs), then re-resolve. Report what happens.


## 6. Monetization setup (Phase 6)

**Server (one time)**
```bash
supabase db push                                             # 3rd migration: apply_subscription + entitlements realtime
supabase functions deploy ad-ssv --no-verify-jwt --project-ref ibuxemwmpkqkkokcqcdg
supabase functions deploy rc-webhook --no-verify-jwt --project-ref ibuxemwmpkqkkokcqcdg
supabase secrets set ADMOB_AD_UNITS=ca-app-pub-XXXX/YYYY RC_WEBHOOK_SECRET=$(openssl rand -hex 24) --project-ref ibuxemwmpkqkkokcqcdg
```
`ADMOB_AD_UNITS` is your **rewarded** ad unit id (comma-separate several). Only callbacks for these units can grant time. Keep the printed `RC_WEBHOOK_SECRET` for RevenueCat.

**AdMob (rewarded hours, works in both builds)**
1. AdMob console → add the Android app → create a **Rewarded** ad unit (reward: amount 1, item "premium").
2. Ad unit → *Server-side verification* → enable, callback URL: `https://ibuxemwmpkqkkokcqcdg.supabase.co/functions/v1/ad-ssv` → use AdMob's "Verify URL" button (must answer 200).
3. In `frontend/.env.local` for a release build set `EXPO_PUBLIC_ADMOB_ANDROID_APP_ID`, `EXPO_PUBLIC_ADMOB_REWARDED_ID`, `EXPO_PUBLIC_ADMOB_BANNER_ID`. Dev builds use Google's **test** ads automatically (no callback is sent for those, so to test the whole flow use your real unit with your phone registered as a test device: `EXPO_PUBLIC_ADMOB_TEST_DEVICE`, id shown in `adb logcat` as "Use RequestConfiguration.Builder().setTestDeviceIds…").
4. Never watch/click your own live ads outside test mode (AdMob policy).

**RevenueCat (paid Premium, Play/Lite build only)**
1. RevenueCat project → Android app (Play package `com.velo.app`) → one subscription product → an offering with it as the first package.
2. Integrations → Webhooks → URL `https://ibuxemwmpkqkkokcqcdg.supabase.co/functions/v1/rc-webhook`, *Authorization header value* = your `RC_WEBHOOK_SECRET`.
3. Lite build env: `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`. The app logs users in to RevenueCat with their Supabase user id, which is how the webhook finds them. Sideloaded (Full) APKs cannot use Play Billing, so Full offers rewarded hours only.

**Check**: Settings → Premium → *Watch ad +1 hour*. After the ad, "Verifying…" then the timer appears (a few seconds). A second ad adds another hour to the remaining time. After 4 (or the flag value) it says "Daily limit reached".

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Home says "Backend is not configured" | `.env.local` missing/edited; restart Metro (`npm start -- --clear`) |
| 401 from the function | anonymous sign-ins off, or app has no session yet (open Home once online) |
| `SERVER_ERROR` / 502 | worker down or `WORKER_URL`/`WORKER_SHARED_SECRET` mismatch (`fly logs`) |
| `RATE_LIMITED` | daily quota (200/day free) — change the `feature_flags` row `resolves_per_day_free` |
| "Database migration failed" screen | `expo-sqlite` build without FTS5 — send me the message shown |
| Download stuck "Queued" | Wi-Fi-only constraint (default) and you are on mobile data |
| No notification | Android 13+ notification permission denied (downloads still work) |
| Build fails: SDK/Java | `ANDROID_HOME` set? JDK 17+ (`java -version`) |

## What is NOT deployed yet
Google sign-in, ads/rewards (`ad-ssv`), RevenueCat webhook, sync push/pull, the Play (Lite) build, the website. Those are later phases.
