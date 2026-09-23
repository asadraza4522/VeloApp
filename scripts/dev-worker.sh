#!/usr/bin/env bash
# Runs the resolver worker on this machine for testing (no Fly.io).
#   scripts/dev-worker.sh          → worker + free Cloudflare tunnel (for the Supabase `resolve` function)
#   scripts/dev-worker.sh --lan    → worker on your Wi-Fi network only, no tunnel; the phone calls it directly
#                                    (dev builds only; see docs/DEPLOYMENT.md "LAN mode")
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/worker"
MODE="${1:-tunnel}"

[ -d .venv ] || { python3 -m venv .venv && . .venv/bin/activate && pip install -q -e ".[dev]"; }
. .venv/bin/activate

# Stable secret across restarts (gitignored).
[ -f .dev-secret ] || openssl rand -hex 32 > .dev-secret
SECRET="$(cat .dev-secret)"
PORT="${PORT:-8080}"

cleanup() { kill "${UV_PID:-}" "${CF_PID:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

if [ "$MODE" = "--lan" ]; then
  IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  [ -n "$IP" ] || { echo "Could not find your Wi-Fi IP (are you connected?)"; exit 1; }
  cat <<MSG

LAN mode. Put these two lines in frontend/.env.local, then REBUILD the dev app once (npx expo run:android):

  EXPO_PUBLIC_DEV_WORKER_URL=http://$IP:8080
  EXPO_PUBLIC_DEV_WORKER_SECRET=$SECRET

The phone must be on the same Wi-Fi as this Mac. Allow incoming connections if macOS asks. Ctrl+C to stop.

MSG
  WORKER_SHARED_SECRET="$SECRET" exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT" --log-level info
fi

WORKER_SHARED_SECRET="$SECRET" uvicorn app.main:app --port "$PORT" --log-level warning &
UV_PID=$!

# The quick-tunnel API can be slow; retry a few times before giving up.
URL=""
for attempt in 1 2 3 4 5; do
  LOG="$(mktemp -t velo-tunnel)"
  cloudflared tunnel --no-autoupdate --protocol http2 --url "http://localhost:$PORT" >"$LOG" 2>&1 &
  CF_PID=$!
  for _ in $(seq 1 25); do
    URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | grep -v '^https://api\.' | head -1 || true)"
    [ -n "$URL" ] && break
    kill -0 "$CF_PID" 2>/dev/null || break   # cloudflared exited (request failed) → retry
    sleep 1
  done
  [ -n "$URL" ] && break
  echo "Tunnel attempt $attempt failed ($(tail -1 "$LOG" | cut -c1-120)); retrying…"
  kill "$CF_PID" 2>/dev/null || true
  sleep 2
done
[ -n "$URL" ] || { echo; echo "Tunnel did not start after 5 tries. Use LAN mode instead:  scripts/dev-worker.sh --lan"; exit 1; }

cat <<MSG

Worker is live: $URL
Run this in another terminal (the URL changes on every restart):

  supabase secrets set WORKER_URL=$URL WORKER_SHARED_SECRET=$SECRET --project-ref ibuxemwmpkqkkokcqcdg

Keep this window open while testing. Ctrl+C to stop.
MSG
wait
