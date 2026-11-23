# n8n setup (self-hosted, Docker)

n8n runs on your Mac in Docker (`n8nio/n8n:2.46.0`, pinned in `docker-compose.yml`). Retell reaches it through a Cloudflare tunnel. Paths below are relative to `demos/05-n8n-house-cleaning/`.

## 1. Settings
```bash
cd ~/Documents/ai-agent-workflow/voice-agent/demos/05-n8n-house-cleaning
cp .env.example .env
openssl rand -hex 24          # paste as BRIGHTNEST_WEBHOOK_KEY
```
Fill the `GHL_*` values from `ghl-setup.md`, or use the mock for now (step 5). `RETELL_API_KEY` is read only by `setup-retell.mjs`; `docker-compose.yml` passes just the workflow settings into the container.

## 2. Start n8n
```bash
docker compose up -d
open http://localhost:5678    # first run: create the owner account (local only)
```
After any `.env` change: `docker compose up -d` again (it recreates the container with the new values; data persists in the `n8n_data` volume).

## 3. Import the workflows
```bash
n8n/import.sh
```
This builds `n8n/tools.workflow.json` and `n8n/events.workflow.json` from `n8n/code/*.js` and `pricing.json`, imports both (fixed IDs, so reruns overwrite in place), publishes them, and restarts n8n.

| Workflow | Webhook | Does |
|---|---|---|
| Demo 5: Brightnest tools (Retell -> GHL) | `POST /webhook/brightnest-tools?tool=<name>&key=<key>` | the 8 tools |
| Demo 5: Brightnest call events (Retell -> Sheet) | `POST /webhook/brightnest-events?key=<key>` | one Sheet row per analysed call |

Use the **production** URLs (`/webhook/...`). `/webhook-test/...` only works while the editor is listening.

## 4. How the tools workflow reads
```
Retell tool call → Config → Key OK? → Normalize → Ready? → Which tool? → 8 branches
```
- **Config** reads the settings from the container environment (`$env`), which is why `docker-compose.yml` sets `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`. The GHL token is never copied into node output; the HTTP nodes read it straight from `$env.GHL_API_TOKEN`.
- **Normalize** unpacks Retell's `{call, name, args}`, takes caller ID from `call.from_number`, and checks the required arguments. Missing ones go straight to **Reply** with an instruction for Maya.
- Each branch: **Code** (logic) → **GHL:** HTTP nodes → **Reply** → **Respond** → after-reply nodes (**Log:**, **Tag:**, **Opportunity:**, **Note:**). Respond to Webhook answers Retell, and the nodes after it keep running, so tags, pipeline moves and Sheet rows never slow the call down.
- Every node before the reply has its error output wired to **Reply: system down**, which gives Maya a spoken fallback ("the booking system is not responding…") and logs a `tool_error` row. Retell never gets a 500.
- After-reply nodes are set to *continue on error*: a failed opportunity or Sheet write never breaks a call.

Editing: change `n8n/code/*.js`, `pricing.json` or `n8n/build.mjs`, then `n8n/import.sh`. Edits made in the n8n editor are overwritten on the next import. To keep one, copy it back into the code file first.

## 5. Test locally without GHL (mock)
```bash
node n8n/mock-ghl.mjs                   # terminal A: fake GHL + Sheets on :4010
# .env: GHL_BASE_URL=http://host.docker.internal:4010
#       SHEETS_WEBHOOK_URL=http://host.docker.internal:4010/sheets
#       GHL_API_TOKEN=mock  and any non-empty IDs (st_new, st_booked, st_attention, pipe_leads, pipe_recurring, st_rec_interested)
docker compose up -d && n8n/import.sh
node n8n/smoke-test.mjs                 # terminal B: 17 calls in conversation order, then the events webhook
curl -s localhost:4010/__state          # contacts, tags, notes, appointments, opportunities, Sheet rows
```
Switching to real GHL: empty `GHL_BASE_URL`, set the real `SHEETS_WEBHOOK_URL` and `GHL_*`, `docker compose up -d`. Then run the smoke test once with a test number (`PHONE=+1...`), because it writes real records.

## 6. Tunnel for Retell
Quick tunnel (new URL each start):
```bash
./tunnel.sh                             # writes N8N_URL into .env
node setup-retell.mjs                   # points Maya's tools + webhook at it
```
Fixed URL (recommended once you record): a named Cloudflare tunnel on your domain, e.g. `n8n-dev.your-domain.com → http://localhost:5678`, then set `N8N_URL` once and run `setup-retell.mjs` once.

## 7. Watch it work
n8n > Executions shows one execution per tool call, with the path it took highlighted. That's the screen to show next to GHL in the video.

## Troubleshooting
| Symptom | Cause |
|---|---|
| Maya says "the booking system is not responding" | Open the failed execution in n8n: the red node shows the GHL error (401 = token or scope, 422 = a wrong ID in `.env`) |
| `404 webhook not registered` | Workflow not published, or n8n not restarted after import: rerun `n8n/import.sh` |
| `401 unauthorized` | `?key=` in the Retell URL ≠ `BRIGHTNEST_WEBHOOK_KEY`: rerun `setup-retell.mjs` after changing the key |
| Custom fields empty in GHL | Field keys differ: see `ghl-setup.md` §2 |
| No Sheet rows | `SHEETS_WEBHOOK_URL` empty or not passed into the container: `docker compose up -d` after editing `.env` |
| `Cannot access "caller" due to security concerns` | n8n expressions refuse the name `caller`; build rows in a Code node (see `n8n/code/error-row.js`) |
