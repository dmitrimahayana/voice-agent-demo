# AI Voice Agent Portfolio

Four working voice-agent demos built on Retell, Vapi, ElevenLabs and GoHighLevel. Each one targets a different buyer, and all four run on free tiers and trial credits.

| Demo | Buyer | What it proves | Stack |
|---|---|---|---|
| [01 Dental receptionist](demos/01-dental-receptionist) | Business owners | Answers 24/7, books on a live calendar, flags emergencies, hands off to a human | Vapi, Cal.com, Google Sheets |
| [02 GHL home services](demos/02-ghl-home-services) | Agencies on GoHighLevel | Qualifies callers and writes contact, fields, tags, pipeline and booking into GHL during the call | Retell, GoHighLevel |
| [03 Speed-to-lead](demos/03-speed-to-lead) | White-label agencies | Web form to AI callback in about 30 seconds; one template, many clients | Vapi, n8n (or the Worker), Twilio |
| [04 Skin studio receptionist](demos/04-skincare-studio) | Spas, facial studios and salons with Spanish-speaking clients | Recommends a treatment for the guest's skin, books it, emails the reservation, switches English ⇄ Spanish mid-call, scores every call | ElevenLabs Agents, Cal.com, Resend |

## How it fits together

```
Caller / web lead
      │
      ▼
Vapi, Retell or ElevenLabs agent ──tool calls──▶ Cloudflare Worker (functions/) ──▶ Cal.com API
      │                                               │                           GoHighLevel API
      └──end-of-call events──────────────────────────┘                           Vapi outbound API
                                                      │                           Resend (emails)
                                            │
                                            ▼
                                  Google Sheet call log (sheets/call-log.gs)
```

- `functions/`: one Cloudflare Worker (TypeScript) that serves the tools for all four demos. Each platform has a thin adapter (`/vapi/*`, `/retell/*`, `/elevenlabs/*`) in front of the same tool handlers. It runs on the free plan and doesn't cold-start mid-call.
- `scripts/setup-agents.mjs`: the one script for agents. It builds the agent configs (Vapi, Retell, ElevenLabs) from the Markdown prompts plus the tool definitions inside it, then creates or updates the agents in place (IDs in `.agents.json`). Rerun it after any prompt or tool change. `--build-only` just writes the JSON, with no API calls.
- `supabase/schema.sql`: Demo 1 member list and booking list.
- `sheets/call-log.gs`: free Google Apps Script that logs every call to a sheet.
- `hub/`: the static demo landing page, with the demo number and a browser call button.
- `docs/`: `LEARNING-PATH.md` (start here to learn it step by step), `ARCHITECTURE.md` (reference), Upwork entries and the video script.

## ElevenLabs (Demo 4): configuration and process flow

ElevenLabs differs from Vapi and Retell in three ways that shape the setup:

| | Vapi / Retell | ElevenLabs |
|---|---|---|
| Tools | defined inside the agent | standalone **tool objects** (`POST /v1/convai/tools`); the agent lists their `tool_ids` |
| Call metadata in tool requests | sent automatically (`call`, caller number) | not sent; each tool maps `caller_id` ← `system__caller_id` and `conversation_id` ← `system__conversation_id` (dynamic variables) |
| End-of-call event | set per agent | **post-call webhook** set once in the dashboard, signed with HMAC (`ElevenLabs-Signature`) |
| Business facts | inlined into the prompt | uploaded as a **knowledge base** document (menu + FAQ) |
| Language | prompt says "continue in their language" | `language_detection` system tool + a Spanish `language_presets` entry |
| Phone | free Vapi number, or Twilio | your own Twilio number (or SIP trunk); the **website widget** needs no number |

**Configuration (what lives where):**

| Item | Where | Set by |
|---|---|---|
| `ELEVENLABS_API_KEY` | `functions/.dev.vars` | you (ElevenLabs > Settings > API Keys); used by the setup script only |
| `ELEVENLABS_WEBHOOK_SECRET` | `.dev.vars` locally, `wrangler secret put` in prod | you, copied from the post-call webhook |
| `SHEET_TAB_DEMO4` | `.dev.vars` (optional, default `demo4`) | you |
| `CALCOM_SKIN_EVENT_TYPE_ID` | `functions/wrangler.toml` | you (Cal.com event type "Dewlane appointment", 60 min); falls back to Demo 1's event type |
| `RESEND_API_KEY` | `.dev.vars` locally, `wrangler secret put` in prod | you (resend.com > API Keys); without it Cal.com sends its own confirmation |
| `EMAIL_FROM` | `functions/wrangler.toml` | you, e.g. `Dewlane Skin Studio <bookings@your-domain.com>` (domain verified in Resend) |
| 7 server tools, knowledge base doc, agent | ElevenLabs workspace; IDs in `.agents.json` | `node scripts/setup-agents.mjs` (step 6) |
| Prompt | `demos/04-skincare-studio/prompt.md` | you; rerun step 6 after edits |
| Treatment menu (prices, prep, suitability) | `demos/04-skincare-studio/services.json` | you; rerun step 6 **and** restart/redeploy the Worker (both read it) |
| Website widget agent ID | `demos/04-skincare-studio/landing/index.html` | step 6 writes it |
| Phone number → agent | ElevenLabs > Phone Numbers | step 6 with `EL_PHONE` (imports from Twilio with `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`) |
| Post-call webhook URL | ElevenLabs > Agents > Settings | you, once per environment (tunnel, then workers.dev) |
| `EL_LLM`, `EL_VOICE_ID`, `EL_TTS_MODEL` | env vars when running step 6 (optional) | defaults: `gpt-4.1`, "Sarah", `eleven_flash_v2` |

**Process flow of one call:**

```
1. Guest clicks "Talk to Elena" on the studio page (landing/index.html) or dials the ElevenLabs number
2. ElevenLabs agent "Elena" answers: its own speech-to-text → LLM → ElevenLabs voice
      • knowledge base answers menu/prices/aftercare questions without any tool call
      • "¿Habla español?" → language_detection system tool → rest of the call in Spanish
3. Elena asks skin type + concerns → recommend_treatment
      POST {W}/elevenlabs/tools/recommend_treatment?demo=skin&key={WEBHOOK_SECRET}
      body: {"skin_type":"oily","concerns":"breakouts","caller_id":null,"conversation_id":"conv_…"}
4. Worker: checks ?key=, strips caller_id/conversation_id into the ToolContext (platform "elevenlabs"),
      runs handlers/skincare.ts → services.json match → {"result":"…Clarifying Acne Facial, 60 min, $135…"}
5. Booking: check_availability (Cal.com slots) → Elena asks for the email, has it spelled, reads it back
      → book_appointment → Cal.com booking + reservation email (Resend, in English or Spanish)
      → Sheet rows "booked" and "email_sent" (tab demo4)
6. Reschedule / cancel: found by the same email → Cal.com change → update email
7. Skin reaction → flag_call "reaction" (urgent row); "Can I talk to someone?" → transfer_to_number (phone only)
8. Goodbye → end_call system tool
9. ElevenLabs analyses the transcript: summary, data collection (language, skin_type, concerns, treatment,
      booked, email_confirmed, reaction), evaluations "Request handled" and "Safe beauty advice"
10. Post-call webhook → POST {W}/elevenlabs/events?demo=skin with ElevenLabs-Signature: t=…,v0=…
      Worker verifies HMAC-SHA256("t.body") with ELEVENLABS_WEBHOOK_SECRET (30-minute window)
      → Sheet row: call_ended | success=success | language=es | treatment=… | booked=true, with summary and duration
```

Demo 4 has its own handlers, Cal.com event type and email; it shares only the Worker, the ElevenLabs adapter and the Sheet with the other demos. Calls on all four demos can run at the same time. Details and the test script: [demos/04-skincare-studio](demos/04-skincare-studio).

## Runbook: config → install → run local → register agents → test local → deploy → test prod

The manual steps, in order. To learn *why* each step exists, see `docs/LEARNING-PATH.md`.

```
1 Accounts & keys → 2 Config → 3 Install → 4 Run local → 5 Test local (curl)
→ 6 Register agents (tunnel URL) → 7 Test local (voice) → 8 Deploy → 9 Point agents at prod → 10 Test prod
```

---

### 1. Accounts and keys (one time)

| What | Where you get it | Goes into |
|---|---|---|
| Node 20+ | `brew install node` | your Mac |
| cloudflared (tunnel for local tests) | `brew install cloudflared`, see step 4 | your Mac |
| A domain on Cloudflare (optional) | gives the tunnel a fixed URL, see step 4 | Cloudflare DNS |
| Cloudflare account | dash.cloudflare.com (free) | `wrangler login` |
| `WEBHOOK_SECRET` | make one: `openssl rand -hex 24` | secret |
| `VAPI_API_KEY` (private) | Vapi dashboard > API Keys > Private | secret + build script |
| Vapi **public** key | Vapi dashboard > API Keys > Public | `hub/index.html` only |
| `RETELL_API_KEY` | Retell dashboard > API Keys | build script only (not the Worker) |
| `ELEVENLABS_API_KEY` | ElevenLabs > Settings > API Keys (ElevenAgents access) | setup script only (not the Worker) |
| `ELEVENLABS_WEBHOOK_SECRET` | ElevenLabs > Agents > Settings > Post-call webhook (after step 6) | secret |
| `RESEND_API_KEY` (Demo 4 emails, optional) | resend.com > API Keys; verify your domain under Domains | secret |
| `CALCOM_SKIN_EVENT_TYPE_ID` | Cal.com > Event Types > "Dewlane appointment" (60 min) > number in the URL | `wrangler.toml` |
| `CALCOM_API_KEY` | Cal.com > Settings > Developer > API Keys | secret |
| `CALCOM_EVENT_TYPE_ID` | Cal.com > Event Types > open it; the number in the URL | `wrangler.toml` |
| `SHEETS_WEBHOOK_URL` | deploy `sheets/call-log.gs` (steps at the top of that file) | secret |
| `SUPABASE_URL` | Supabase > Project Settings > API | `wrangler.toml` |
| `SUPABASE_SERVICE_KEY` | Supabase > Project Settings > API Keys > **secret** key (not the publishable/anon key) | secret |
| `CALCOM_WEBHOOK_SECRET` | make one: `openssl rand -hex 24`; same value in the Cal.com webhook | secret |
| `GHL_API_TOKEN` + `GHL_*` IDs | `demos/02-ghl-home-services/ghl-setup.md` | secret + `wrangler.toml` |
| Twilio Account SID + Auth Token | Twilio console home page | Vapi import (step 6); ElevenLabs import for Demo 4 |
| Second Twilio number (Demo 4 phone calls only) | Twilio console > Buy a number | `EL_PHONE` in step 6 |
| `CLIENTS_CSV_URL` | Google Sheet of `clients.csv` > File > Share > Publish to web > CSV | `wrangler.toml` |
| `VAPI_SPEED_TO_LEAD_ASSISTANT_ID` | printed by the build script in step 6 | `wrangler.toml` |
| `VAPI_OUTBOUND_PHONE_NUMBER_ID` | Vapi > Phone Numbers > your Twilio number > ID | `wrangler.toml` |

You don't need everything at once. Demo 1 needs only the Cloudflare, Vapi, Cal.com, Sheets, Supabase and Twilio rows. Add GHL for Demo 2, and the last three rows for Demo 3. Demo 4 needs the Cloudflare, Cal.com and Sheets rows plus the `ELEVENLABS_*` and `RESEND_API_KEY` rows; the second Twilio number only for phone tests (the website widget needs none).

---

### 2. Config

**Non-secret settings** go in `functions/wrangler.toml` under `[vars]`. It's git-ignored; create it from the template first: `cp functions/wrangler.toml.example functions/wrangler.toml`. Settings: `TIMEZONE`, `CALCOM_EVENT_TYPE_ID`, the `GHL_*` IDs, `CLIENTS_CSV_URL`, and the two `VAPI_*_ID` values. They're used both locally and in prod.

**Secrets for local runs** go in `functions/.dev.vars`, which is git-ignored:
```bash
cd ~/Documents/ai-agent-workflow/voice-agent/functions
cp .dev.vars.example .dev.vars
# edit .dev.vars: WEBHOOK_SECRET, CALCOM_API_KEY, GHL_API_TOKEN, VAPI_API_KEY, SHEETS_WEBHOOK_URL,
#                 SUPABASE_SERVICE_KEY, CALCOM_WEBHOOK_SECRET,
#                 ELEVENLABS_API_KEY, ELEVENLABS_WEBHOOK_SECRET, RESEND_API_KEY (Demo 4)
```
Secrets for prod are set separately in step 8. They are never written in `wrangler.toml`.

**Demo 1 database (Supabase, one time).** Ava keeps a member list (6-digit member number per phone) and a copy of every booking:
1. Supabase > SQL Editor > New query: paste [supabase/schema.sql](supabase/schema.sql) and run it. It creates `members`, `bookings` and the `schedule` view (the owner's list of upcoming appointments). Safe to re-run.
2. Cal.com > Settings > Developer > Webhooks > New: URL `<W>/calcom/webhook` (e.g. `https://dev.your-domain.com/calcom/webhook`, the prod URL after step 9), events Booking Created, Rescheduled and Cancelled, secret = `CALCOM_WEBHOOK_SECRET`. This keeps `bookings` in sync when someone changes a booking in Cal.com itself.

Without `SUPABASE_SERVICE_KEY`, Demo 1 still books, but finds appointments by scanning Cal.com and gives out no member numbers.

---

### 3. Install

```bash
cd ~/Documents/ai-agent-workflow/voice-agent/functions
npm install
npx wrangler login        # opens the browser once
npm run typecheck         # should print nothing (no errors)
```

---

### 4. Run local

Terminal A, the Worker:
```bash
cd ~/Documents/ai-agent-workflow/voice-agent/functions
npx wrangler dev          # http://localhost:8787, reloads on save, logs every request
```

Terminal B, the tunnel. `cloudflared` is a separate program from wrangler, so install it once first:
```bash
brew install cloudflared
cloudflared --version     # check it worked
```
If you get `command not found: brew`, use the direct download instead (Apple Silicon Mac):
```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz | tar xz
sudo mv cloudflared /usr/local/bin/
cloudflared --version
```
Then start the tunnel. It runs in its own terminal, separate from Terminal A, and both stay open while you test.

**Recommended: named tunnel (fixed URL).** Needs a domain whose DNS is on Cloudflare. Set it up once:
```bash
cloudflared tunnel login                                   # opens the browser, pick your domain
cloudflared tunnel create voice-dev
cloudflared tunnel route dns voice-dev dev.your-domain.com  # creates the DNS record
```
Then every time:
```bash
cloudflared tunnel run --url http://localhost:8787 voice-dev
# always https://dev.your-domain.com: restarting the tunnel changes nothing
```
Because the URL never changes, you build and register the agents once (step 6). After that you only rebuild when a prompt or tool changes.

**Alternative: quick tunnel (no domain, random URL).** The URL changes on every restart, so the agents you registered in step 6 must be updated every time. `scripts/tunnel.sh` starts the tunnel, saves the URL to `.tunnel-url` and rebuilds the configs:
```bash
scripts/tunnel.sh        # reads WEBHOOK_SECRET / TRANSFER_NUMBER from functions/.dev.vars
# other terminals: export W=$(cat .tunnel-url)
```
Or by hand: `cloudflared tunnel --url http://localhost:8787` and copy the `https://<random>.trycloudflare.com` URL.

If cloudflared fails with `Failed to initialize DNS local resolver ... i/o timeout`, your ISP's DNS (often its IPv6 resolver) is timing out. Switch to public DNS:
```bash
networksetup -setdnsservers Wi-Fi 1.1.1.1 1.0.0.1 8.8.8.8   # undo: networksetup -setdnsservers Wi-Fi empty
```
If it then fails on QUIC/UDP, add `--protocol http2` to the tunnel command.

---

### 5. Test local with curl (no voice minutes spent)

Run these in Terminal C. Set the variables once:
```bash
export W=https://dev.your-domain.com      # named tunnel; quick tunnel: $(cat .tunnel-url); or http://localhost:8787
export K=<your WEBHOOK_SECRET>
```

| Test | Command | Expect |
|---|---|---|
| Health | `curl $W/` | `{"ok":true,...}` |
| Auth | `curl -X POST "$W/vapi/tools?demo=learn&key=wrong" -d '{}'` | `401` |
| Practice tool | `curl -X POST "$W/vapi/tools?demo=learn&key=$K" -H 'content-type: application/json' -d '{"message":{"type":"tool-calls","toolCallList":[{"id":"1","function":{"name":"get_time","arguments":{}}}]}}'` | current time |
| Demo 1 calendar | same, with `demo=dental` and `"name":"check_availability","arguments":{"date":"2026-11-17"}` | slots with `say` text |
| Demo 2 GHL | `curl -X POST "$W/retell/tools/upsert_contact?demo=home&key=$K" -H 'content-type: application/json' -d '{"call":{"call_id":"t","from_number":"+15125550142"},"args":{"name":"Test Lead","zip":"78704"}}'` | `contact_id`, and the contact appears in GHL |
| Demo 2 returning customer | `curl -X POST "$W/retell/tools/lookup_customer?demo=home&key=$K" -H 'content-type: application/json' -d '{"call":{"call_id":"t","from_number":"+15125550142"},"args":{}}'` | `found: true`, the same `contact_id`, `next_visit` if booked; `returning-customer` tag in GHL |
| Demo 4 recommendation | `curl -X POST "$W/elevenlabs/tools/recommend_treatment?demo=skin&key=$K" -H 'content-type: application/json' -d '{"skin_type":"oily","concerns":"breakouts","caller_id":null,"conversation_id":"conv_test"}'` | `clarifying_facial` recommended |
| Demo 4 calendar | same path with `check_availability` and `-d '{"date":"2026-11-19"}'` | slots with `say` text |
| Demo 4 webhook auth | `curl -X POST "$W/elevenlabs/events?demo=skin" -H 'elevenlabs-signature: t=1,v0=bad' -d '{}'` | `401` (only when `ELEVENLABS_WEBHOOK_SECRET` is set) |
| Demo 3 callback | `curl -X POST "$W/leads" -H 'content-type: application/json' -d '{"client_id":"sunpeak-solar","name":"Dmitri","phone":"+15125550142"}'` | your phone rings (needs step 6 done) |
| Call log | any booking above | rows in the Google Sheet |

When a test fails, read Terminal A: the real error is printed there.

---

### 6. Register agents (pointing at the tunnel)

**One command (recommended).** `scripts/setup-agents.mjs` does all of 6.1 to 6.8: build the configs, create or update the agents, connect the phone number to Ava, fill in `wrangler.toml`, and (when `ELEVENLABS_API_KEY` is set) create or update Demo 4 on ElevenLabs.
```bash
cd ~/Documents/ai-agent-workflow/voice-agent
W=https://dev.your-domain.com TRANSFER_NUMBER=+1AGENT_PHONE PHONE=+1HUMAN_PHONE node scripts/setup-agents.mjs
```

| Input | Meaning | Default |
|---|---|---|
| `W` | public URL of the Worker (tunnel, or workers.dev in step 9) | required |
| `TRANSFER_NUMBER` | human handoff phone (yours, **not** the agent's number) | required |
| `PHONE` | Vapi number for Demos 1 and 3 | the only Vapi number, if there's one |
| `K`, `VAPI_API_KEY`, `RETELL_API_KEY`, `ELEVENLABS_API_KEY` | secret and API keys | read from `functions/.dev.vars`; no ElevenLabs key = Demo 4 skipped |
| `EL_PHONE` | ElevenLabs number for Demo 4 (your **second** Twilio number) | the only ElevenLabs number, if there's one |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | with `EL_PHONE`: imports that Twilio number into ElevenLabs if it isn't there yet | none |
| `--only=vapi,retell,elevenlabs` | set up only these platforms (`--only-elevenlabs` is a shortcut for `--only=elevenlabs`); keys of the others aren't needed | all |
| `--build-only` | only write the JSON configs; no API calls, no keys needed | off |

Output:
```
health: https://dev.your-domain.com/ -> 200
wrote demos/01-dental-receptionist/assistant.vapi.json
...
Vapi dental assistant id: <dental-assistant-id> (created)
Vapi speed-to-lead assistant id: <speed-to-lead-assistant-id> (created)
Retell agent id: agent_<retell-agent-id> (created)
phone: +1HUMAN_PHONE (id <phone-number-id>) -> inbound assistant <dental-assistant-id>
wrangler.toml: VAPI_SPEED_TO_LEAD_ASSISTANT_ID=..., VAPI_OUTBOUND_PHONE_NUMBER_ID=...

ElevenLabs tool check_availability: tool_... (created)
...
ElevenLabs knowledge base: <doc-id> (created)
ElevenLabs agent id: agent_... (created)
ElevenLabs phone: +1SECOND_NUMBER (id phnum_...) -> agent agent_...
```
The IDs are saved in `.agents.json`. **Running it again updates the same agents** (prints `(updated)`), so there are no duplicates. Rerun it after editing a prompt, after a quick-tunnel restart, or in step 9 with the workers.dev URL. `--new` ignores `.agents.json` and creates fresh agents. If you delete an agent in the dashboard, the next run recreates it.

**Manual steps (what the script does).** Run everything in **Terminal C**, in the same terminal from start to finish: `export` only applies to the terminal it ran in.

**6.1 Set the variables.** The keys are read from `functions/.dev.vars`, so they always match what `wrangler dev` uses:
```bash
cd ~/Documents/ai-agent-workflow/voice-agent
v() { grep "^$1=" functions/.dev.vars | cut -d= -f2- | tr -d '"'; }
export W=https://dev.your-domain.com
export K=$(v WEBHOOK_SECRET)
export VAPI_API_KEY=$(v VAPI_API_KEY) RETELL_API_KEY=$(v RETELL_API_KEY)
export TRANSFER_NUMBER=+1xxxxxxxxx
echo "W=$W  K=${#K} chars  vapi=${#VAPI_API_KEY} chars  retell=${#RETELL_API_KEY} chars"
```
None of the lengths may be `0`. `TRANSFER_NUMBER` is the human the agent hands calls to (your own phone), **not** the agent's Vapi or Twilio number; otherwise the call loops back to the agent.

**6.2 Build the configs and check them** (no API calls):
```bash
node scripts/setup-agents.mjs --build-only
grep -o 'https://[^/"]*' demos/01-dental-receptionist/assistant.vapi.json | sort -u
```
It must print `https://dev.your-domain.com`. If it prints `https://YOUR-WORKER.workers.dev`, `W` was empty: redo 6.1 in this terminal. Keep each command on one line; a line break without `\` drops the variables.

**6.3 Create the agents:**
```bash
node scripts/setup-agents.mjs --only=vapi,retell
```
It reads `W`, `K`, `TRANSFER_NUMBER` and the keys exported in 6.1, and prints three IDs (also saved in `.agents.json`):
```
Vapi dental assistant id: <dental-assistant-id>
Vapi speed-to-lead assistant id: <speed-to-lead-assistant-id>
Retell agent id: agent_<retell-agent-id>
```
Running it again updates the same agents, so there are no duplicates. It also does 6.5 and 6.6 when it finds your Vapi number. (Alternative: create the agents by hand in the dashboards, copying prompt, tools, voice and limits from `assistant.vapi.json`, `retell-llm.json` and `retell-agent.json` built in 6.2.)

**6.4 Get a phone number** (Demos 1 and 3; Demo 2 uses Retell web calls and needs none). Pick one:
- **Free Vapi number (easiest):** **Vapi > Phone Numbers > Create Phone Number > Free Vapi Number**, choose a US area code.
- **Twilio number:** **Vapi > Phone Numbers > Import > Twilio**: number, Account SID, Auth Token. If it fails with `account ... is not active`, the Twilio account is suspended or closed: fix it in console.twilio.com or use a free Vapi number.

List your numbers with their IDs (the ID is a UUID, different from the phone number):
```bash
curl -s -H "Authorization: Bearer $VAPI_API_KEY" https://api.vapi.ai/phone-number \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>JSON.parse(s).forEach(p=>console.log(p.id,p.number,"assistant:",p.assistantId||"-")))'
# <phone-number-id> +1HUMAN_PHONE assistant: -
```

**6.5 Connect the number to Ava (Demo 1 inbound).** Use the dental assistant ID from 6.3 and the number ID from 6.4:
```bash
curl -s -X PATCH -H "Authorization: Bearer $VAPI_API_KEY" -H 'content-type: application/json' \
  -d '{"assistantId":"<dental-assistant-id>"}' \
  https://api.vapi.ai/phone-number/<phone-number-id>
```
(Or in the dashboard: **Vapi > Phone Numbers > the number > Inbound > Assistant: Demo - Bright Smile Dental (Ava)**.)

**6.6 Tell the Worker which assistant and number to dial out with (Demo 3).** In [functions/wrangler.toml](functions/wrangler.toml):
```toml
VAPI_SPEED_TO_LEAD_ASSISTANT_ID = "<speed-to-lead-assistant-id>"   # speed-to-lead id from 6.3
VAPI_OUTBOUND_PHONE_NUMBER_ID = "<phone-number-id>"     # number id from 6.4
```
`wrangler dev` reloads on save.

**6.7 Check:** `curl $W/` prints `{"ok":true,...}`, and the 6.4 list shows the dental assistant ID next to your number.

**6.8 Demo 4 (ElevenLabs).** There is no manual curl path: tools, knowledge base and agent reference each other by ID, so use the script (`--only=elevenlabs` runs just this part). First set `CALCOM_SKIN_EVENT_TYPE_ID` (and `EMAIL_FROM` if you use Resend) in `wrangler.toml`; see [demos/04-skincare-studio](demos/04-skincare-studio).
```bash
W=$W TRANSFER_NUMBER=$TRANSFER_NUMBER node scripts/setup-agents.mjs --only=elevenlabs
```
It also writes the agent ID into `demos/04-skincare-studio/landing/index.html` (the website widget). Then, once, in the dashboard: **ElevenLabs > Agents > Settings > Post-call webhook > Create**: URL `$W/elevenlabs/events?demo=skin`, HMAC auth, event *transcript*. Copy its secret into `functions/.dev.vars` as `ELEVENLABS_WEBHOOK_SECRET` (wrangler dev reloads). Done; go to step 7.

---

### 7. Test local with voice

**Before every session**, three things are running:

| Terminal | Command | Check |
|---|---|---|
| A | `cd ~/Documents/ai-agent-workflow/voice-agent/functions && npx wrangler dev` | `Ready on http://localhost:8787` |
| B | `cloudflared tunnel run --url http://localhost:8787 voice-dev` | `Registered tunnel connection` |
| C | `export W=https://dev.your-domain.com K=<WEBHOOK_SECRET>` then `curl $W/` | `{"ok":true,...}` |

During a call, every tool the agent uses goes Vapi/Retell → `https://dev.your-domain.com` → tunnel → Terminal A. **Watch Terminal A**: each tool call and any error is printed there.

Start each demo with a **free browser call** (no phone minutes) before using a real phone.

#### Demo 1: Dental receptionist (Vapi, inbound)

1. Check +1HUMAN_PHONE is connected to Ava (step 6.5).
2. Browser test: **Vapi > Assistants > Ava > Talk to Assistant**. Say "I'd like to book a cleaning next Tuesday."
   Terminal A should show `check_availability`, then `book_appointment`, and the booking appears in Cal.com and the Google Sheet.
3. Phone test: call **your Vapi number** from your phone.
4. Run all 20 calls in [demos/01-dental-receptionist/test-script.md](demos/01-dental-receptionist/test-script.md). Note what fails, fix `prompt.md`, repeat.

#### Demo 2: GHL home services (Retell, web call)

**One-time setup** (all in [ghl-setup.md](demos/02-ghl-home-services/ghl-setup.md)):
1. Custom fields, the **AI Voice Leads** pipeline and the calendar, otherwise the CRM tools fail.
2. Token scopes: add `opportunities.readonly` and `calendars/events.readonly` to your Private Integration (needed by `lookup_customer`; same token).
3. **Memberships** pipeline: put its ID and the Interested stage ID into `GHL_MEMBERSHIP_PIPELINE_ID` / `GHL_MEMBERSHIP_STAGE_INTERESTED` in `functions/wrangler.toml`. `wrangler dev` reloads it.
4. Workflow **Plan sign-up link**: tag `plan-interest` → Send Email with your sign-up link.
5. Push the new prompt and tools to Retell: rerun the step 6 one-command script.

**A. New caller + plan upsell**
1. **Retell > Agents > the home-services agent > Test** (web call). Say "My kitchen sink is clogged, zip 78704." When asked, give your mobile number (web calls have no caller ID).
   Terminal A: `lookup_customer` (not found), `upsert_contact`, `check_calendar`, `book_job`.
   GHL: contact with custom fields, `booked` tag, appointment, opportunity in **AI Voice Leads > Booked**.
2. Sam offers the Comfort Club. Say "Yes, email me the link" and spell an email you can read.
   Terminal A: `record_plan_interest`. GHL: `plan-interest` tag, email on the contact, opportunity **Comfort Club plan - $149/yr** in **Memberships > Interested**, and the sign-up email arrives.

**B. Returning customer (job status + reschedule)**
1. New web call. Say "When is my technician coming?" and give the **same** mobile number.
   Terminal A: `lookup_customer` returns `found: true`. Sam greets you by first name and says the day and window from step A.
   GHL: `returning-customer` tag on the contact.
2. Say "Can we move it to Thursday?"
   Terminal A: `check_calendar`, then `reschedule_job`. GHL: the **same** appointment now shows Thursday (no second appointment) and a note "visit moved from ... to ...".
3. Optional: say "No" to the plan on a fresh booking: `plan-declined` tag, no Memberships opportunity.

Then run all 19 calls in [demos/02-ghl-home-services/test-script.md](demos/02-ghl-home-services/test-script.md), checking GHL after each one.

| Demo 2 symptom | Usual fix |
|---|---|
| `lookup_customer` → 401/403 in Terminal A | token is missing `opportunities.readonly` or `calendars/events.readonly` |
| Sam says "new customer" for a number you booked with | GHL stores the phone in another format, or the contact is in another sub-account; check the contact's phone shows as +1... |
| Plan accepted but no Memberships opportunity | `GHL_MEMBERSHIP_*` IDs empty or wrong in `wrangler.toml` (the tag is still added) |
| No sign-up email | workflow not published, or the contact has no email (Sam must spell it back) |
| Reschedule creates a second appointment | Sam called `book_job` instead of `reschedule_job`: check the transcript, tighten `prompt.md` |

#### Demo 3: Speed to lead (Vapi, outbound: the agent calls you)

1. Check both IDs are in `functions/wrangler.toml` (step 6.6).
2. Check the Google Sheet has a client row `sunpeak-solar`.
3. Trigger with curl:
   ```bash
   curl -X POST "$W/leads" -H 'content-type: application/json' \
     -d '{"client_id":"sunpeak-solar","name":"Dmitri","phone":"+15125550142"}'
   ```
   Your phone rings within seconds. Answer and play the lead.
4. Trigger with the form: in [demos/03-speed-to-lead/landing/index.html](demos/03-speed-to-lead/landing/index.html) set `const ENDPOINT = "https://dev.your-domain.com/leads";`, open the file in the browser, submit your phone.
5. If Terminal A shows a Vapi error about the phone number or outbound limits, the free Vapi number can't dial out; Demo 3 then needs a working Twilio number. Demos 1 and 2 are unaffected.

#### Demo 4: Skin studio receptionist (ElevenLabs, website widget)

1. Open [demos/04-skincare-studio/landing/index.html](demos/04-skincare-studio/landing/index.html) in the browser and click **Talk to Elena** (allow the microphone).
   Say "Hola, tengo la piel grasa y me salen granitos." Elena switches to Spanish and asks a few questions.
   Terminal A: `POST /elevenlabs/tools/recommend_treatment`, then `check_availability` and `book_appointment` after you spell an email you can read.
2. Check: the booking in Cal.com (the "Dewlane appointment" event type), the **reservation email in Spanish** in your inbox, and Sheet tab `demo4` with `booked`, `email_sent`, then about a minute later `call_ended` with `success=… | language=es | treatment=… | …`.
3. Move it ("¿Puedo cambiarla al sábado?") and cancel it: one update email each, and the same booking changes in Cal.com.
4. Phone test (only with a second Twilio number assigned in 6.8): say "Can I talk to a real person?" and check `TRANSFER_NUMBER` rings.
5. Run all 18 calls in [demos/04-skincare-studio/test-script.md](demos/04-skincare-studio/test-script.md).

| Demo 4 symptom | Usual fix |
|---|---|
| Widget shows no button or an error | agent ID missing in `landing/index.html`: rerun 6.8 |
| Nothing in Terminal A when Elena "checks" | tool URL still on an old tunnel: rerun 6.8 with the current `W` |
| No `call_ended` row | post-call webhook missing or on the old URL; `401` in Terminal A = `ELEVENLABS_WEBHOOK_SECRET` doesn't match the webhook's secret |
| Booked but no email | `email_failed` row: check `RESEND_API_KEY`; with `onboarding@resend.dev` Resend only delivers to your own account email; otherwise verify the `EMAIL_FROM` domain in Resend |
| Two confirmation emails | Cal.com also emailed: happens only if bookings were made before `RESEND_API_KEY` was set |
| Bookings land on the dental calendar | `CALCOM_SKIN_EVENT_TYPE_ID` not set in `wrangler.toml` |
| Stays in English after "español" | `language_detection` not on the agent, or Spanish not in the agent's languages: rerun 6.8 |
| `setup-agents` 401/403 from api.elevenlabs.io | API key lacks ElevenAgents permissions: create a new key with them |

#### When something fails

| Symptom | Look at | Usual fix |
|---|---|---|
| Agent says it "can't check right now" | Terminal A error | fix the handler or the API key in `.dev.vars` |
| Nothing appears in Terminal A | `curl $W/`; tool URLs in the agent | tunnel down, or agent built with `YOUR-WORKER` (redo step 6) |
| `401` in Terminal A | `key=` in the tool URL | `WEBHOOK_SECRET` in `.dev.vars` ≠ the one used in the build |
| Agent says wrong things | the transcript in Vapi/Retell > Call Logs, or ElevenLabs > Agents > Conversations | edit `prompt.md` |

To change behaviour: edit `prompt.md` → rerun the step 6 one-command script (it updates the agents in place). Code changes in `functions/src` need nothing: `wrangler dev` reloads.

---

### 8. Deploy to Cloudflare

Set each prod secret once (it prompts for the value):
```bash
cd ~/Documents/ai-agent-workflow/voice-agent/functions
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put CALCOM_API_KEY
npx wrangler secret put SHEETS_WEBHOOK_URL
npx wrangler secret put GHL_API_TOKEN
npx wrangler secret put VAPI_API_KEY
npx wrangler secret put SUPABASE_SERVICE_KEY
npx wrangler secret put CALCOM_WEBHOOK_SECRET
npx wrangler secret put ELEVENLABS_WEBHOOK_SECRET   # Demo 4
npx wrangler secret put RESEND_API_KEY              # Demo 4 emails (optional)
npx wrangler deploy
# prints https://voice-agent-functions.<your-subdomain>.workers.dev
```
After a code change, `npx wrangler deploy` alone is enough. Secrets persist.

---

### 9. Point the agents at prod

The agents still call the tunnel URL, so switch them to the Worker URL:
```bash
cd ~/Documents/ai-agent-workflow/voice-agent   # project root
W=https://voice-agent-functions.<your-subdomain>.workers.dev TRANSFER_NUMBER=+1YOUR_MOBILE PHONE=+1VAPI_NUMBER node scripts/setup-agents.mjs
cd functions && npx wrangler deploy   # ships the updated wrangler.toml IDs
```
This updates the same agents (saved in `.agents.json`) to call the workers.dev URL. The prod `WEBHOOK_SECRET` (`wrangler secret put`) must equal the one in `functions/.dev.vars`, or pass `K=<prod secret>`. To go back to local testing, rerun it with `W=https://dev.your-domain.com`.

Also set `ENDPOINT` in `landing/index.html` and the Vapi public key and assistant ID in `hub/index.html`.

Demo 4: the script above also moves the ElevenLabs tools to the workers.dev URL. The post-call webhook is set in the dashboard, so change its URL there too: **ElevenLabs > Agents > Settings > Post-call webhook** → `https://voice-agent-functions.<your-subdomain>.workers.dev/elevenlabs/events?demo=skin`. To share the studio page, deploy `demos/04-skincare-studio/landing/` (for example with `npx wrangler pages deploy ../demos/04-skincare-studio/landing`).

Close the tunnel. From here nothing runs on your Mac.

---

### 10. Test prod

```bash
export W=https://voice-agent-functions.<your-subdomain>.workers.dev
curl $W/                                  # health
cd ~/Documents/ai-agent-workflow/voice-agent/functions && npx wrangler tail         # live logs while you test
```
1. Re-run the curl table from step 5 against `$W`.
2. Call the Twilio number and run a few calls from each test script.
3. Check the Google Sheet has `booked` and `call_ended` rows (tab `demo4` for ElevenLabs), Supabase `bookings` and `members` have the Demo 1 rows, Demo 4 reservation emails arrived, and GHL has the Demo 2 records.
4. Optional: deploy the hub page with `npx wrangler pages deploy ../hub`.

**Done when:** all four test scripts pass against prod, with your laptop closed.

---

### Quick reference

| I want to... | Do |
|---|---|
| Refresh the agents after any change to `prompt.md`, `knowledge-base.md` or the tool definitions in `setup-agents.mjs` | `W=https://dev.your-domain.com TRANSFER_NUMBER=+1AGENT_PHONE PHONE=+1HUMAN_PHONE node scripts/setup-agents.mjs` (prod: `W=<workers.dev URL>`). Updates the same agents, no duplicates |
| Change what the agent says | edit `prompt.md` → run the refresh command above |
| Change what a tool does | edit `functions/src/handlers/*.ts` → `npx wrangler dev` to test → `npx wrangler deploy` |
| Add a tool | `docs/ARCHITECTURE.md` section 9 |
| See prod errors | `npx wrangler tail` |
| Rotate the secret | `wrangler secret put WEBHOOK_SECRET`, then rebuild and update the agents (the key is in every tool URL) |
| Add a Demo 3 client | add a row to the Google Sheet; no deploy needed |

## Free-tier budget

- Vapi and Retell each give **$10 of credit**, roughly 150 to 250 demo minutes in total. Every agent is capped at 3 minutes per call.
- **Phone number:** your own Twilio number, imported into Vapi, is the demo line for Demo 1 and also places Demo 3's outbound calls. Vapi's free US number is inbound only, so it's just a backup.
- A Retell-bought number costs $2/month. Demo 2 uses web calls, or a second Twilio number over Elastic SIP (one number can only route incoming calls to one platform).
- ElevenLabs free plan: a small monthly allowance of agent minutes (around 15; check the current plan page), enough for website-widget tests of Demo 4. Resend's free plan covers 3,000 emails a month. Demo 4 phone calls need a second Twilio number (about $1.15/month), because one number routes to one platform.
- The GoHighLevel trial lasts 14 days. Record Demo 2 inside the trial.
- Keep the demo number out of public pages. Share it in proposals and DMs.

## Tool endpoints

| Path | Used by |
|---|---|
| `POST /vapi/tools?demo=dental\|lead&key=…` | Vapi function tools (demos 1, 3) |
| `POST /vapi/events?demo=…&key=…` | Vapi end-of-call report |
| `POST /retell/tools/<name>?demo=home&key=…` | Retell custom functions (demo 2) |
| `POST /retell/events?demo=home&key=…` | Retell agent webhook |
| `POST /elevenlabs/tools/<name>?demo=skin&key=…` | ElevenLabs server tools (demo 4) |
| `POST /elevenlabs/events?demo=skin` | ElevenLabs post-call webhook, checked by `ELEVENLABS_WEBHOOK_SECRET` (or `?key=` when unset) |
| `POST /leads` | Demo 3 landing form |
| `POST /calcom/webhook` | Cal.com booking events → Supabase `bookings` (demo 1), checked by `CALCOM_WEBHOOK_SECRET` |

The demo businesses are fictional.
