#!/usr/bin/env bash
# Cloudflare quick tunnel to the local n8n (port 5678), so Retell can reach the webhooks.
# Writes the URL to .tunnel-url and into N8N_URL in .env. Then point Maya at it:
#   node demos/05-n8n-house-cleaning/setup-retell.mjs
# The quick-tunnel URL changes every time you start it; rerun setup-retell.mjs after each start.
# Fixed URL instead: a named tunnel on your own domain (see n8n-setup.md). Ctrl+C stops the tunnel.
set -euo pipefail
cd "$(dirname "$0")"

LOG="$(mktemp -t cloudflared)"
cloudflared tunnel --url "http://localhost:${PORT:-5678}" >"$LOG" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT INT TERM

URL=""
for _ in $(seq 1 60); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)
  [ -n "$URL" ] && break
  kill -0 "$PID" 2>/dev/null || { cat "$LOG" >&2; exit 1; }
  sleep 0.5
done
[ -n "$URL" ] || { echo "no tunnel URL after 30s:" >&2; cat "$LOG" >&2; exit 1; }

echo "$URL" > .tunnel-url
if [ -f .env ]; then
  if grep -q '^N8N_URL=' .env; then sed -i.bak "s#^N8N_URL=.*#N8N_URL=$URL#" .env && rm -f .env.bak; else echo "N8N_URL=$URL" >> .env; fi
  echo "N8N_URL=$URL written to .env"
fi

cat <<EOF

Tunnel:  $URL  ->  http://localhost:${PORT:-5678}
Next:    node demos/05-n8n-house-cleaning/setup-retell.mjs      (points Maya's tools at this URL)
Check:   N8N_URL=$URL node demos/05-n8n-house-cleaning/n8n/smoke-test.mjs
--- cloudflared log (Ctrl+C to stop) ---
EOF
tail -f "$LOG" &
wait "$PID"
