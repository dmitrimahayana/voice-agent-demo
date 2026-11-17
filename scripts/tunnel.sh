#!/usr/bin/env bash
# Starts a Cloudflare quick tunnel to `wrangler dev`, then rebuilds the agent configs with the new URL
# (setup-agents.mjs --build-only). To also point the live agents at it: W=$(cat .tunnel-url) node scripts/setup-agents.mjs
#
#   scripts/tunnel.sh                # tunnel + rebuild configs
#   PORT=8788 scripts/tunnel.sh      # different local port
#
# WEBHOOK_SECRET and TRANSFER_NUMBER come from the environment, or else from functions/.dev.vars.
# The URL is saved to .tunnel-url, so other terminals can run:  export W=$(cat .tunnel-url)
# Ctrl+C stops the tunnel.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-8787}"
VARS=functions/.dev.vars
LOG="$(mktemp -t cloudflared)"

getvar() { grep -E "^$1=" "$VARS" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }
export WEBHOOK_SECRET="${WEBHOOK_SECRET:-$(getvar WEBHOOK_SECRET)}"
export TRANSFER_NUMBER="${TRANSFER_NUMBER:-$(getvar TRANSFER_NUMBER)}"
[ -n "$WEBHOOK_SECRET" ] || { echo "WEBHOOK_SECRET not set (env or $VARS)" >&2; exit 1; }
[ -n "$TRANSFER_NUMBER" ] || echo "note: TRANSFER_NUMBER not set, the build uses a placeholder" >&2

cloudflared tunnel --url "http://localhost:$PORT" >"$LOG" 2>&1 &
PID=$!
TAILPID=""
trap 'kill $PID $TAILPID 2>/dev/null || true' EXIT INT TERM

URL=""
for _ in $(seq 1 60); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)
  [ -n "$URL" ] && break
  kill -0 "$PID" 2>/dev/null || { cat "$LOG" >&2; exit 1; }
  sleep 0.5
done
[ -n "$URL" ] || { echo "no tunnel URL after 30s:" >&2; cat "$LOG" >&2; exit 1; }

echo "$URL" > .tunnel-url
W="$URL" node scripts/setup-agents.mjs --build-only

cat <<EOF

Tunnel:  $URL
Saved to .tunnel-url. In other terminals:
  export W=\$(cat .tunnel-url)
Remember: agents already registered in Vapi/Retell/ElevenLabs still point at the OLD URL.
Update them:  W=\$(cat .tunnel-url) node scripts/setup-agents.mjs
--- cloudflared log (Ctrl+C to stop) ---
EOF

tail -f "$LOG" &
TAILPID=$!
wait "$PID"
