#!/usr/bin/env bash
# Runs the resolver worker on this machine for testing (no Fly.io).
#   scripts/dev-worker.sh          → worker + free Cloudflare tunnel (for the Supabase `resolve` function)
#   scripts/dev-worker.sh --ngrok  → worker + ngrok tunnel (use this if api.trycloudflare.com is blocked
#                                    on your network — needs `ngrok config add-authtoken <token>` once first)
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

cleanup() { kill "${UV_PID:-}" "${CF_PID:-}" "${NG_PID:-}" 2>/dev/null || true; }
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

URL=""
if [ "$MODE" = "--ngrok" ]; then
  # ngrok as a fallback when api.trycloudflare.com is blocked on this network (seen on some
  # ISPs/corporate networks — DNS resolves fine but the quick-tunnel API call itself times out).
  ngrok http "$PORT" --log=stdout > /tmp/velo-ngrok.log 2>&1 &
  NG_PID=$!
  for _ in $(seq 1 25); do
    URL="$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null | python3 -c 'import sys,json
try:
  for t in json.load(sys.stdin)["tunnels"]:
    if t["proto"] == "https": print(t["public_url"]); break
except Exception: pass' 2>/dev/null || true)"
    [ -n "$URL" ] && break
    kill -0 "$NG_PID" 2>/dev/null || break
    sleep 1
  done
  [ -n "$URL" ] || { echo; echo "ngrok did not start. Check /tmp/velo-ngrok.log — likely needs: ngrok config add-authtoken <token>"; exit 1; }
else
  # The quick-tunnel API can be slow; retry a few times before giving up.
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
  [ -n "$URL" ] || { echo; echo "Tunnel did not start after 5 tries. Try:  scripts/dev-worker.sh --ngrok  (or --lan)"; exit 1; }
fi

cat <<MSG

Worker is live: $URL
Run this in another terminal (the URL changes on every restart):

  supabase secrets set WORKER_URL=$URL WORKER_SHARED_SECRET=$SECRET --project-ref ibuxemwmpkqkkokcqcdg

Keep this window open while testing. Ctrl+C to stop.
MSG
wait
