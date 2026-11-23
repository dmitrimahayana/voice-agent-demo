# Demo 5: Brightnest Home Cleaning booking agent (Retell + n8n + GoHighLevel)

Maya answers calls for a fictional Denver house-cleaning company. She prices the job from the home size, books it on the GHL calendar, logs access notes, offers a recurring plan once, and flags complaints for the manager. Every tool call goes to a **self-hosted n8n** workflow instead of code, so an agency can open n8n and see or change each step.

It's Demo 2's pattern (Retell + GHL, read and write during the call) rebuilt on n8n for a different trade. Demo 2 and the Worker in `functions/` are untouched; this folder is self-contained.

**Buyer:** agencies that run GHL and n8n and want voice agents they can edit without a developer.

| | Demo 2 (Northside plumbing) | Demo 5 (Brightnest cleaning) |
|---|---|---|
| Backend | Cloudflare Worker (TypeScript) | n8n workflows (Docker) |
| Pricing | fixed fees in the prompt | `get_quote`: bedrooms, bathrooms, type, pets, frequency from `pricing.json` |
| Urgent path | emergency triage → SMS to tech | complaint → Needs attention + manager alert, optional transfer |
| Upsell | Comfort Club $149/yr | recurring plan (weekly −20%, biweekly −15%, monthly −10%) |
| Booking length | calendar default | the quote's time on site |

## How a call flows
```
Caller ─▶ Retell (Maya: STT → gpt-4.1 → voice)
            │ custom function: POST {N8N_URL}/webhook/brightnest-tools?tool=get_quote&key=…
            ▼
          n8n "Brightnest tools": Config → Key OK? → Normalize → Which tool? → branch
            │   Code + GHL HTTP nodes → Respond (Maya speaks) → tags / opportunity / note / Sheet row
            ▼
          GoHighLevel sub-account "Brightnest Home Cleaning (Demo)" ─▶ GHL workflows (confirmation, manager alert, plan email)
Call ends ─▶ Retell call_analyzed ─▶ n8n "Brightnest call events" ─▶ Sheet tab demo5
```

## Tools
| Tool | What n8n does |
|---|---|
| `lookup_customer` | find by phone → open jobs, next cleaning, stage names → greet by name |
| `upsert_contact` | create/update contact with 6 custom fields → New lead opportunity |
| `get_quote` | price, crew and hours from `pricing.json`, recurring options (no API call) |
| `check_calendar` | GHL free slots, next 5 days or from a named day, 3 per day |
| `book_cleaning` | appointment with the quoted length → `booked` tag, Booked opportunity with the price |
| `reschedule_cleaning` | moves the same appointment, keeps its length, adds a note |
| `add_note_and_tags` | tags + note; `complaint` → Needs attention |
| `record_recurring_interest` | email saved first, then the `recurring-interest` tag, then a Recurring plans opportunity (yearly value) |

## Files
| File | What it is |
|---|---|
| `prompt.md` | Maya's prompt (edit this, then rerun `setup-retell.mjs`) |
| `pricing.json` | price list and rules for `get_quote` (edit, then `n8n/import.sh`) |
| `setup-retell.mjs` | creates/updates the Retell LLM + agent; IDs in `.agent.json` |
| `docker-compose.yml`, `.env.example` | self-hosted n8n and every setting |
| `tunnel.sh` | Cloudflare quick tunnel to n8n, writes `N8N_URL` |
| `n8n/code/*.js`, `n8n/build.mjs` | Code-node sources and the generator for the two workflow files |
| `n8n/tools.workflow.json`, `n8n/events.workflow.json` | generated workflows (no secrets; settings come from `$env`) |
| `n8n/import.sh` | build, import, publish, restart |
| `n8n/mock-ghl.mjs`, `n8n/smoke-test.mjs` | local GHL stand-in and a 17-call end-to-end check |
| `ghl-setup.md`, `n8n-setup.md`, `test-script.md` | setup checklists and the 16-call test |
| `n8n-flow.md` | the two n8n workflows explained node by node |

## Setup (about 1 day)
1. **n8n + mock, no accounts needed:** `n8n-setup.md` steps 1–5. `node n8n/smoke-test.mjs` should print "All steps passed."
2. **GHL:** start the trial, follow `ghl-setup.md`, fill the real `GHL_*` values, empty `GHL_BASE_URL`, `docker compose up -d`.
3. **Tunnel:** `./tunnel.sh` (or a named tunnel).
4. **Retell:** put `RETELL_API_KEY` (and optionally `TRANSFER_NUMBER`) in `.env`, then `node setup-retell.mjs`.
5. **Test:** Retell dashboard > the agent > Test (web call). Run `test-script.md`.
6. Optional phone line: a Twilio number imported into Retell over an Elastic SIP trunk (as in Demo 2 step 5). Your existing numbers stay on Vapi, Demo 2 and Demo 4.

## What to show in the video
Three panes: Retell web call, n8n Executions (each tool call lighting up its path), and the GHL contact filling in: custom fields, tags, appointment, opportunity moving to Booked, then the plan email arriving.
