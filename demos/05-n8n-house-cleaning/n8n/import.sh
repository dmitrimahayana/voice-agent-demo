#!/usr/bin/env bash
# Rebuilds both workflows, imports them into the running n8n container, publishes them and restarts n8n
# (published webhooks are only picked up on start). Safe to rerun: the fixed workflow IDs are overwritten in place.
#
#   demos/05-n8n-house-cleaning/n8n/import.sh
#   COMPOSE_PROJECT=other demos/05-n8n-house-cleaning/n8n/import.sh    if you started compose with -p other
#
# Edits made in the n8n editor are overwritten. Port them to n8n/code/*.js or build.mjs first.
set -euo pipefail
cd "$(dirname "$0")/.."

dc() {
  if [ -n "${COMPOSE_PROJECT:-}" ]; then docker compose -p "$COMPOSE_PROJECT" "$@"; else docker compose "$@"; fi
}

node n8n/build.mjs
for wf in tools events; do dc exec -T n8n n8n import:workflow --input="/workflows/$wf.workflow.json" 2>&1 | grep -v "license SDK"; done
for id in brightnestTools1 brightnestEvents; do dc exec -T n8n n8n publish:workflow --id="$id" 2>&1 | grep -E "^Publishing|rror" || true; done
dc restart n8n >/dev/null
printf "restarting n8n"
# /healthz answers before the published webhooks are registered, so wait for the webhook itself (404 = not yet).
for _ in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' "http://localhost:5678/webhook/brightnest-tools?tool=get_quote&key=-" || true)
  case "$code" in 000|404|502|503) printf "."; sleep 1 ;; *) break ;; esac
done
echo " up."
echo "Webhooks: http://localhost:5678/webhook/brightnest-tools  and  /webhook/brightnest-events"
