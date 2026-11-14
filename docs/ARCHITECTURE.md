# How this project works

This guide explains the technology behind the three demos, what every folder and file does, and how a single phone call moves through the system. Read it top to bottom once and the rest of the code will make sense.

New to this? Start with `LEARNING-PATH.md`, the hands-on course, and use this file as the reference.

---

## 1. The core idea: who does what

A voice agent has two halves.

| Half | Who provides it | What it does |
|---|---|---|
| **The voice platform** (Vapi or Retell) | Hosted service, configured by you | Answers the phone, converts speech to text, runs the LLM, converts the reply to speech, handles interruptions and silence, records the call |
| **Your back end** (this repo's `functions/`) | You write it | Does the real work the LLM can't do alone: check a calendar, book, write to a CRM, start an outbound call, log the call |

You never write audio or telephony code. You give the platform three things:

1. **A prompt**: who the agent is and how it should behave (`prompt.md`).
2. **Tools**: functions the LLM is allowed to call, each with a name, a description and a JSON schema for its arguments.
3. **Webhook URLs**: where the platform sends tool calls and call events (your Worker).

### The real-time loop inside the platform

```
caller speaks
   │
   ▼
Speech-to-text (Deepgram)     ─ "I'd like a cleaning next Tuesday"
   │
   ▼
LLM (gpt-4o-mini) + your prompt + conversation so far
   │        │
   │        └─ decides to call a tool ──▶ HTTP POST to your Worker ──▶ result text back to LLM
   ▼
Text-to-speech (ElevenLabs voice)  ─ "I have 10 AM or 11:30 AM, which works?"
   │
   ▼
caller hears the reply   (the whole loop takes about 1 second)
```

The platform repeats this loop on every turn. Your code only runs at the arrow marked "HTTP POST".

---

## 2. Tool calling: the most important concept

The LLM can't book anything by itself. It can only produce text, or ask to call a tool. Here is one tool call, start to finish:

1. Your prompt says: "Call check_availability with the date as YYYY-MM-DD."
2. The caller says "next Tuesday". The LLM works out the date (the prompt includes today's date) and emits a tool call: `check_availability({"date": "2026-11-17"})`.
3. The platform sends that call to your URL.
4. Your Worker calls the Cal.com API, gets free slots, and returns a short text or JSON result.
5. The platform feeds the result back to the LLM, which turns it into a spoken sentence.

The two platforms send different request shapes, so the Worker has one small adapter for each.

**Vapi**: one URL for all tools; many calls can arrive in one request:
```json
POST /vapi/tools?demo=dental&key=SECRET
{ "message": { "type": "tool-calls",
    "call": { "id": "c1", "customer": { "number": "+15125550142" } },
    "toolCallList": [ { "id": "t1", "function": { "name": "check_availability", "arguments": { "date": "2026-11-17" } } } ] } }

→ response
{ "results": [ { "toolCallId": "t1", "result": "{\"slots\":[{\"slot_iso\":\"...\",\"say\":\"Tuesday, November 17 at 10:00 AM\"}]}" } ] }
```

**Retell**: one URL per tool; one call per request:
```json
POST /retell/tools/upsert_contact?demo=home&key=SECRET
{ "call": { "call_id": "r1", "from_number": "+15125550000", "direction": "inbound" },
  "name": "upsert_contact",
  "args": { "name": "Joe Bloggs", "zip": "78704" } }

→ response
{ "result": "{\"contact_id\":\"ct_1\",\"instruction\":\"Use this contact_id in every later tool call.\"}" }
```

Three design rules every tool here follows:
- **Return text written for the LLM, not raw API data.** Example: `{slot_iso, say}`. `say` is what the agent reads aloud; `slot_iso` is what it passes back to `book_appointment`. This stops the agent from reading "2026-11-17T15:00:00Z" to a caller.
- **Return instructions on failure, never an exception.** If Cal.com is down, the tool returns "Apologise, take name and number, promise a callback", so the agent never goes silent.
- **Be fast.** The caller is waiting. Slow work (logging to the sheet) runs after the response, through `ctx.waitUntil`.

---

## 3. Call events (after the call)

Separately from tools, the platforms send **events** to a second URL:

| Platform | Event used | What we do |
|---|---|---|
| Vapi | `end-of-call-report` | Log summary, recording URL, duration, end reason to the sheet |
| Retell | `call_analyzed` | Same, plus Retell's post-call analysis fields |

This is what produces the call-log sheet, which clients find as convincing as the call itself.

---

## 4. Folder by folder

```
voice-agent/
├── README.md                    Overview, setup steps, endpoint table
├── .gitignore                   Keeps secrets (.dev.vars) and node_modules out of git
│
├── demos/                       One folder per portfolio piece: prompts, configs, setup notes
│   ├── 01-dental-receptionist/
│   ├── 02-ghl-home-services/
│   └── 03-speed-to-lead/
│
├── functions/                   The back end: one Cloudflare Worker for all demos
│   ├── wrangler.toml            Worker name and non-secret settings (IDs, time zone)
│   ├── .dev.vars.example        List of secrets you must set
│   ├── package.json, tsconfig.json
│   └── src/
│       ├── index.ts             Router + Vapi/Retell adapters + auth
│       ├── env.ts               Types: Env (all settings), ToolContext, Tool
│       ├── handlers/            Business logic per demo (the tools)
│       │   ├── dental.ts
│       │   ├── homeServices.ts
│       │   └── leads.ts
│       └── lib/                 Thin API clients, no business logic
│           ├── calcom.ts
│           ├── ghl.ts
│           ├── vapi.ts
│           ├── sheets.ts
│           └── util.ts
│
├── scripts/build-configs.mjs    Turns prompt.md files into importable agent JSON
├── sheets/call-log.gs           Google Apps Script that receives log rows
├── hub/index.html               Public demo landing page
└── docs/                        This guide, Upwork entries, video script
```

The layering is deliberate: **`index.ts` knows about platforms, `handlers/` knows about the business, `lib/` knows about APIs.** To swap Cal.com for GoodX, you change one `lib` file and the handlers that use it. To add ElevenLabs Agents as a third platform, you add one adapter in `index.ts`; every tool keeps working.

### `functions/src/index.ts`, the router
- Reads the path and `?demo=`, then picks the toolset from `TOOLSETS` (`dental`, `home`, `lead`).
- `vapiTools()` and `retellTool()` convert each platform's request into a common call `runTool(demo, name, args, toolContext)`, then convert the result back.
- `vapiEvents()` and `retellEvents()` handle end-of-call logging.
- `authorized()` checks `?key=` (or Vapi's `x-vapi-secret` header) against `WEBHOOK_SECRET`, so strangers can't call your tools.
- `runTool()` wraps every tool in try/catch and returns a spoken fallback on error.

### `functions/src/env.ts`
- `Env`: every secret and setting the Worker reads. Cloudflare injects them at runtime.
- `ToolContext`: what each tool gets besides its arguments: `env`, `ctx` (for `waitUntil`), `platform`, `callId`, `callerNumber` (from caller ID, so the agent doesn't have to ask).
- `Tool`: the signature every tool shares, `(args, tc) => Promise<string>`.

### `functions/src/handlers/`
| File | Tools | Talks to |
|---|---|---|
| `dental.ts` | `check_availability`, `book_appointment`, `cancel_appointment`, `flag_call` | Cal.com, sheet |
| `homeServices.ts` | `upsert_contact`, `check_calendar`, `book_job`, `add_note_and_tags` | GoHighLevel, sheet |
| `leads.ts` | `handleLead` (the `/leads` form endpoint), `log_outcome` tool | client CSV, Vapi outbound API, sheet |

Demo 3 reuses the dental calendar tools under new names (`check_calendar`, `book_meeting`). See `TOOLSETS` in `index.ts`.

### `functions/src/lib/`
| File | What it wraps |
|---|---|
| `calcom.ts` | Cal.com API v2: list slots, create, find and cancel bookings. Note that each endpoint needs its own `cal-api-version` header |
| `ghl.ts` | GoHighLevel API v2: upsert contact (dedupes by phone), tags, notes, free slots, appointment, opportunity |
| `vapi.ts` | `POST https://api.vapi.ai/call` to start an outbound call with per-lead variables |
| `sheets.ts` | Posts a log row to the Apps Script URL; never throws |
| `util.ts` | `fetchJson` (errors include status and body), `spoken()` date formatting in the business time zone, phone digits, a small CSV parser |

### `demos/*`: what each file is for
| File | Meaning |
|---|---|
| `prompt.md` | **Source of truth** for the agent's behaviour. Edit this, then rebuild. |
| `knowledge-base.md` (demo 1) | Clinic facts, pasted into the prompt at build time. A one-page knowledge base in the prompt is faster and more reliable than a vector search. |
| `assistant.vapi.json`, `retell-llm.json`, `retell-agent.json` | **Generated** agent configs: model, voice, transcriber, tools with their URLs, call limits. Don't hand-edit them. |
| `test-script.md` | The calls that must pass before you record or hand over. This is your QA process, and it's worth showing to clients. |
| `ghl-setup.md` (demo 2) | Click-by-click GHL configuration. It doubles as the agency handoff checklist. |
| `clients.csv` (demo 3) | One row per business. This is what makes it white-label. |
| `n8n-workflow.json` (demo 3) | The same flow as `/leads`, but visual, for agencies who live in n8n or Make. |
| `landing/index.html` (demo 3) | The form that triggers the callback, with a live timer to show the speed. |

### `scripts/build-configs.mjs`: config as code
Prompts are long, and editing them inside a JSON string or a dashboard text box is painful and leaves no history. So:
1. You edit `prompt.md` (readable, and diffs nicely in git).
2. The script reads it, adds the tool definitions (name, description, JSON schema) and your `WORKER_URL` plus secret, and writes the platform JSON.
3. With `--push` it creates the agents through the Vapi and Retell APIs.

This is also how you'll clone for agency clients: copy a demo folder, change the prompt, and rebuild.

### `sheets/call-log.gs`
A Google Apps Script "web app" is a free HTTPS endpoint attached to a sheet. `doPost` appends a row, with one tab per demo. No Google Cloud project or service account is needed.

### `hub/index.html`
A static page: headline, demo number, a browser call button (Vapi's web widget uses your **public** key, which is safe to expose), a section for agencies, a section for businesses, and proof. Host it free on Cloudflare Pages or GitHub Pages.

---

## 5. One call, end to end (Demo 1)

```
Caller          Vapi                         Worker                    Cal.com     Sheet
  │  "Book a cleaning Tuesday"
  │───────────▶ STT → LLM
  │             LLM: check_availability({date})
  │             ─── POST /vapi/tools ───────▶ dental.checkAvailability
  │                                           ─── GET /v2/slots ──────▶
  │                                           ◀── slots ──────────────
  │             ◀── {slot_iso, say} ─────────
  │◀─────────── "10 AM or 11:30?"
  │  "10 AM, Dana Smith"
  │───────────▶ LLM: book_appointment({name, slot_iso, reason})
  │             ─── POST /vapi/tools ───────▶ dental.bookAppointment
  │                                           ─── POST /v2/bookings ──▶
  │             ◀── "Booked, ref ABC123" ────     (after reply) ─────────────────────▶ row "booked"
  │◀─────────── "You're booked for Tuesday at 10."
  │  hangs up
  │             ─── POST /vapi/events (end-of-call-report) ─▶ ─────────────────────────▶ row "call_ended" + summary
```

Demo 2 has the same shape with Retell and GoHighLevel. Demo 3 starts the other way round: form → `/leads` (or n8n) → Vapi `POST /call` → Vapi rings the lead → the same tool loop runs.

---

## 6. Variables and dates

- **Vapi** fills `{{name}}` placeholders in the prompt and first message using LiquidJS. `{{"now" | date: ...}}` gives the current date. Demo 3 passes per-lead values (`lead_first_name`, `offer`, `q1`...) through `assistantOverrides.variableValues` when it starts the call.
- **Retell** provides built-in variables such as `{{current_time_America/New_York}}` and `{{user_number}}`.
- The LLM needs today's date in the prompt to turn "next Tuesday" into `2026-11-17`. Without it, booking breaks.
- All spoken times are formatted in `TIMEZONE` (in `wrangler.toml`), so a server running in UTC still says "10 AM" in clinic time.

---

## 7. Why these choices

| Choice | Reason |
|---|---|
| Cloudflare Workers | Free (100K requests a day) and no cold start. A free Render or Railway server that sleeps adds 30+ seconds of silence mid-call. |
| One Worker for all demos | One deploy, one secret set, shared libs. `?demo=` picks the toolset. |
| TypeScript | Type-checked tool arguments and API shapes. It's also the language most Vapi and Retell examples use. |
| gpt-4o-mini | Fast and cheap. Latency matters more than raw intelligence on a phone call. |
| Tools return short text | Smaller LLM input means faster replies and fewer hallucinated readings of raw data. |
| Google Sheet log | Free, and clients understand it at a glance. Swap for Airtable or a database for real clients. |
| n8n *and* `/leads` | n8n sells to agencies visually. The Worker version needs no extra hosting. |

---

## 8. Secrets and safety
- Secrets live only in Cloudflare (`wrangler secret put`) or a local `.dev.vars`, which is git-ignored. They never go in `wrangler.toml` or the JSON configs.
- The tool URLs carry `?key=WEBHOOK_SECRET`. Rotate it if a config ever leaks.
- Vapi has a **public** key (browser widget, safe) and a **private** key (server only). Never put the private key in `hub/`.
- `/leads` is public by design. Add a Cloudflare rate-limit rule before you share the form widely.
- For real clients: get consent for outbound calls (TCPA in the US), disclose that the agent is AI when asked (every prompt does this), and handle recordings according to the client's privacy rules (HIPAA-sensitive for clinics).

---

## 9. Common changes

**Add a tool** (for example `get_directions`):
1. Write the function in the right `handlers/*.ts` file and add it to that file's tools object.
2. Add its name, description and schema to the matching list in `scripts/build-configs.mjs`.
3. Mention when to use it in `prompt.md`.
4. Rebuild the configs and redeploy the Worker (`npx wrangler deploy`).

**Clone Demo 2 for an agency client:** copy the folder, edit `prompt.md` (name, service area, price list), load the GHL snapshot into their sub-account, put their IDs in the Worker vars (or a second Worker), rebuild, then run the test script.

**Add a client to Demo 3:** add one row to the Google Sheet. No code changes.

**Swap the calendar** (for example GoodX instead of Cal.com): write `lib/goodx.ts` with the same three functions (slots, book, cancel), then point `dental.ts` at it.

---

## 10. Local development loop
```bash
cd functions
cp .dev.vars.example .dev.vars    # fill in real keys
npm install
npx wrangler dev                  # Worker on http://localhost:8787
cloudflared tunnel --url http://localhost:8787   # public URL for Vapi/Retell to reach
WORKER_URL=<tunnel url> WEBHOOK_SECRET=<same> node ../scripts/build-configs.mjs
```
Then make a web call from the Vapi or Retell dashboard and watch the requests in the `wrangler dev` terminal.
