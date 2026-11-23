# How the n8n workflows work, node by node

Demo 5 has two workflows in n8n:

| Workflow | Called by Retell when | Nodes |
|---|---|---|
| **Demo 5: Brightnest tools (Retell -> GHL)** | Maya uses one of her 8 tools during a call | 65 |
| **Demo 5: Brightnest call events (Retell -> Sheet)** | a call has ended and Retell has analysed it | 8 |

Both are generated from `n8n/build.mjs` and `n8n/code/*.js`. The node names below are the names on the n8n canvas. The code of each Code node is in the `n8n/code/` file named in the table.

## The idea in one picture

Every tool call is one HTTP request from Retell and one **execution** in n8n:

```
Retell ──POST──▶ shared entrance (6 nodes) ──▶ Which tool? ──▶ 1 of 8 branches ──▶ reply to Retell ──▶ after-reply nodes
                                                                                        │
                                                                     Maya speaks this ◀─┘
```

Every branch has two halves:

- **Before the reply:** the nodes Maya waits for. They read or write GHL and build the sentence she will say. If any of them fails, the execution jumps to **Reply: system down**.
- **After the reply:** a **Respond** node sends Maya her answer, and the nodes after it keep running while she talks. These are the Sheet log, tags, opportunity moves and notes. They are set to *continue on error*, so a failure there never reaches the caller.

How to read the canvas:

| Node on the canvas | What it is |
|---|---|
| Webhook | the door Retell knocks on |
| **Code** (`{ }` icon) | JavaScript: logic, no API calls |
| **HTTP Request** named `GHL: …`, `Tag: …`, `Opportunity: …`, `Note: …` | one GoHighLevel API call |
| **HTTP Request** named `Log: …` | one row to the Google Sheet call log |
| **If** / **Switch** | a fork in the road |
| **Respond to Webhook** named `Respond: …` / `Reply` | the answer Maya receives |
| A red line out of a node's lower output | the error path to **Reply: system down** |

---

## 1. Shared entrance (every tool call)

| # | Node | Type | What it does |
|---|---|---|---|
| 1 | **Retell tool call** | Webhook, `POST /webhook/brightnest-tools` | Receives Retell's request. The URL has `?tool=get_quote&key=…`, and the body is `{ call, name, args }`: `call` holds the call ID and caller ID, `args` holds what Maya filled in (bedrooms, slot, etc.). The response mode is "Using Respond to Webhook node", so n8n doesn't answer until a Respond node does. |
| 2 | **Config** | Set | Reads every setting from the container's environment (`$env`, which comes from `.env`): location, calendar, pipeline and stage IDs, time zone, Sheet tab. It also works out `authorized` = whether `?key=` matches `BRIGHTNEST_WEBHOOK_KEY`. The GHL token is **not** copied here; HTTP nodes read it directly, so it never shows in execution data. |
| 3 | **Key OK?** | If | `authorized` true → continue. False → **401 Unauthorized**. |
| 3b | **401 Unauthorized** | Respond | Answers `401 {"error":"unauthorized"}`. Stops strangers who find the URL. |
| 4 | **Normalize** (`normalize.js`) | Code | Unpacks Retell's request into one tidy item: `tool` (from `?tool=`), `args`, `phone` (from `args.phone`, or else the caller ID, converted to +1… format), `callId`, `callerNumber`. Then it checks the **required arguments** for that tool. If one is missing it sets `stop`, an instruction for Maya such as "Need the caller's full name first." `lookup_customer` and `upsert_contact` also stop when there is no phone ("This call has no caller ID. Ask for the mobile number…"). |
| 5 | **Ready?** | If | `stop` empty → continue to the tool. Otherwise → **Reply**, so Maya gets the instruction straight away without calling GHL. |
| 6 | **Which tool?** | Switch | Sends the item down one of **8 outputs**, by `tool`. These are the 8 branches below, in this order. |

### The 8 outputs of Which tool?

| Output | Tool | First node of the branch | Section |
|---|---|---|---|
| 0 | `lookup_customer` | GHL: find contact by phone | [2.1](#21-lookup_customer) |
| 1 | `upsert_contact` | Build contact | [2.2](#22-upsert_contact) |
| 2 | `get_quote` | Calculate quote | [2.3](#23-get_quote) |
| 3 | `check_calendar` | Calendar window | [2.4](#24-check_calendar) |
| 4 | `book_cleaning` | Build booking | [2.5](#25-book_cleaning) |
| 5 | `reschedule_cleaning` | GHL: appointments to move | [2.6](#26-reschedule_cleaning) |
| 6 | `add_note_and_tags` | Prep note | [2.7](#27-add_note_and_tags) |
| 7 | `record_recurring_interest` | Prep plan | [2.8](#28-record_recurring_interest) |

### Shared exits

| Node | Type | What it does |
|---|---|---|
| **Reply** | Respond | Answers `{"result": <text>}` using the `result` of whatever node came before it. Used by the branches whose reply is the last step (new client, open times, "nothing to move", the "ask for email" case) and by **Ready?** for missing arguments. |
| **Reply: system down** | Respond | Every before-the-reply node has its error output wired here. Maya gets: "The booking system is not responding right now. Apologise, take the caller's name and number, and promise a callback within the hour." Retell never sees a 500. |
| **Error row** (`error-row.js`) | Code | After the fallback answer, builds a `tool_error` Sheet row: which tool, the error message, the caller. |
| **Log: tool error** | HTTP → Sheet | Writes that row. |

Retell reads `result` as text and gives it to the model. When `result` is a JSON string (for example `{"found":true,"contact_id":"…","instruction":"…"}`), Maya reads the fields and follows the `instruction` line. That's how n8n steers what she does next.

---

## 2. The 8 branches

### 2.1 lookup_customer
Called first on every call: "is this a client we know?"

| # | Node | Type | What it does |
|---|---|---|---|
| 1 | **GHL: find contact by phone** | HTTP `GET /contacts/search/duplicate?number=…` | Looks the phone up in GHL. |
| 2 | **Found?** | If | Contact returned → returning client (step 3). None → new client (2b). |
| 2b | **Reply: new client** (`lookup-new.js`) | Code | Result: `{found:false, instruction:"New client. … collect the details, then call upsert_contact."}` → **Reply**. |
| 3 | **GHL: open jobs** | HTTP `GET /opportunities/search` | The client's open opportunities (cards). |
| 4 | **GHL: contact appointments** | HTTP `GET /contacts/{id}/appointments` | Their appointments, to find the next cleaning. |
| 5 | **GHL: stage names** | HTTP `GET /opportunities/pipelines` | Pipeline stage names, so Maya hears "Booked" instead of an ID. Not critical: if it fails, the reply has no stage names. |
| 6 | **Reply: returning client** (`lookup-returning.js`) | Code | Builds `{found:true, contact_id, first_name, is_recurring_client, next_cleaning:{appointment_id, say, hours}, open_jobs, instruction}`. `say` is spoken text like "Friday, November 27 at 8:00 AM until 12:00 PM". |
| 7 | **Respond: returning client** | Respond | **Maya gets her answer here.** |
| 8 | **Log: returning client** | HTTP → Sheet | Row `returning_customer`. *(after the reply)* |
| 9 | **Tag: returning-customer** | HTTP `POST /contacts/{id}/tags` | Adds `returning-customer` → fires GHL workflow 6.6. *(after the reply)* |

### 2.2 upsert_contact
Creates or updates the client as soon as Maya has a name.

| # | Node | Type | What it does |
|---|---|---|---|
| 1 | **Build contact** (`upsert-build.js`) | Code | Builds the GHL body: first and last name split from `name`, phone, `address1`, `postalCode`, source "AI Voice Agent (n8n)", tag `ai-voice-lead`, and the 6 custom fields (`cleaning_type`, `bedrooms`, `bathrooms`, `pets`, `frequency`, `access_notes`), leaving out empty ones. |
| 2 | **GHL: upsert contact** | HTTP `POST /contacts/upsert` | GHL updates the contact if the phone already exists, or creates it. |
| 3 | **Reply: contact saved** (`upsert-reply.js`) | Code | Result: `{contact_id, instruction:"Use this contact_id in every later tool call."}`. |
| 4 | **Respond: contact saved** | Respond | **Maya gets her answer.** |
| 5 | **Opportunity: New lead** | HTTP `POST /opportunities/upsert` | Card "Name - Standard cleaning" in AI Voice Leads > New lead. *(after the reply)* |

### 2.3 get_quote
Pure calculation, no GHL call.

| # | Node | Type | What it does |
|---|---|---|---|
| 1 | **Calculate quote** (`quote.js`) | Code | The prices from `pricing.json` are built into the code. It matches the type ("deep clean" → Deep) and computes: price = (base + bedrooms × rate + bathrooms × rate) × type multiplier + pet fee, with a minimum, rounded to $5. Hours = labour estimate × type multiplier; more than 4 hours of work means a team of two. It lists the recurring options (weekly −20%, biweekly −15%, monthly −10%) only for a one-time Standard. Over 6 bedrooms or 5 bathrooms → `custom_quote: true`. Result: `{quote_total, hours, crew_size, say, recurring_options, instruction}`. |
| 2 | **Respond: quote** | Respond | **Maya gets her answer.** |
| 3 | **Log: quote** | HTTP → Sheet | Row `quoted` (or `custom_quote`). *(after the reply)* |

### 2.4 check_calendar
Finds start times where the **whole** job fits.

| # | Node | Type | What it does |
|---|---|---|---|
| 1 | **Calendar window** (`calendar-window.js`) | Code | The time window to search: from now for 5 days, or from `preferred_day` for 2 days. |
| 2 | **GHL: free slots** | HTTP `GET /calendars/{id}/free-slots` | GHL's free 1-hour slots in that window, in Denver time. |
| 3 | **Reply: open times** (`calendar-reply.js`) | Code | Keeps only start times where every hour until the end of the job (`hours` from get_quote, default 3) is free and inside opening hours. It picks up to 3 a day, at least 2 hours apart, 8 in total. Result: `{slots:[{slot_iso, say}], instruction:"Offer two times…"}` → **Reply**. |

### 2.5 book_cleaning

| # | Node | Type | What it does |
|---|---|---|---|
| 1 | **Build booking** (`book-build.js`) | Code | The appointment: start = `slot_iso`, end = start + `hours`, title "Standard cleaning: 3 bd 2 ba, one dog". It sets `ignoreFreeSlotValidation: true` because GHL only accepts 1-hour bookings on this calendar; check_calendar already checked the fit. |
| 2 | **GHL: book appointment** | HTTP `POST /calendars/events/appointments` | Creates it on the calendar. |
| 3 | **Reply: booked** (`book-reply.js`) | Code | Spoken confirmation: day, arrival window (start + 30 min), hours. Also prepares the card name and value. |
| 4 | **Respond: booked** | Respond | **Maya gets her answer.** |
| 5 | **Log: booked** | HTTP → Sheet | Row `booked`. *(after the reply)* |
| 6 | **Tag: booked** | HTTP `POST /contacts/{id}/tags` | `booked` → fires GHL workflow 6.1 (confirmation). *(after the reply)* |
| 7 | **Opportunity: Booked** | HTTP `POST /opportunities/upsert` | Moves the card to Booked, with the price as its value. *(after the reply)* |

### 2.6 reschedule_cleaning
Moves the existing appointment; never creates a second one.

| # | Node | Type | What it does |
|---|---|---|---|
| 1 | **GHL: appointments to move** | HTTP `GET /contacts/{id}/appointments` | The client's appointments. |
| 2 | **Pick visit to move** (`reschedule-pick.js`) | Code | Takes the appointment with `appointment_id`, or else the next upcoming one. It keeps the original length and builds the update (new start, new end). Nothing upcoming → `found:false` with "No upcoming cleaning found to move…". |
| 3 | **Visit found?** | If | Yes → step 4. No → **Reply** with that sentence. |
| 4 | **GHL: move appointment** | HTTP `PUT /calendars/events/appointments/{id}` | Moves it. |
| 5 | **Reply: moved** (`reschedule-reply.js`) | Code | "Moved the cleaning to Wednesday, November 25 at 12:00 PM…". |
| 6 | **Respond: moved** | Respond | **Maya gets her answer.** |
| 7 | **Log: rescheduled** | HTTP → Sheet | Row `rescheduled`. *(after the reply)* |
| 8 | **Note: moved** | HTTP `POST /contacts/{id}/notes` | Note "cleaning moved from … to …". *(after the reply)* |

### 2.7 add_note_and_tags
Notes, and the tags that fire GHL workflows: `complaint`, `out-of-area`, `custom-quote`.

| # | Node | Type | What it does |
|---|---|---|---|
| 1 | **Prep note** (`note-prep.js`) | Code | Cleans the tags (lowercase, hyphens), writes the note "AI call note: …", and marks `complaint` if that tag is present. |
| 2 | **Any tags?** | If | Tags present → step 3. None → straight to step 4. |
| 3 | **GHL: add tags** | HTTP `POST /contacts/{id}/tags` | Adds them → fires GHL workflows 6.2 / 6.4 / 6.5. Done **before** the reply, so Maya only says "logged" once it really is. |
| 4 | **GHL: add note** | HTTP `POST /contacts/{id}/notes` | Saves the note. |
| 5 | **Respond: saved** | Respond | "Saved to the client record." or "Complaint logged. Tell them the manager will call them back today." |
| 6 | **Log: note** | HTTP → Sheet | Row `complaint` / `out_of_area` / `custom_quote` / `note`. *(after the reply)* |
| 7 | **Complaint?** | If | Complaint → step 8, otherwise end. |
| 8 | **Opportunity: Needs attention** | HTTP `POST /opportunities/upsert` | Moves the client's card to Needs attention. *(after the reply)* |

### 2.8 record_recurring_interest
The caller's answer to the recurring-plan offer.

| # | Node | Type | What it does |
|---|---|---|---|
| 1 | **Prep plan** (`plan-prep.js`) | Code | Decides the `path`: `declined` (said no), `email` (valid email given), `no_email` (email "none"), or `ask` (wants the plan but no email yet). Also computes the yearly value = price per visit × visits per year. |
| 2 | **Plan answer?** | Switch | 4 outputs, one per path: |
| | → `declined` | | **Tag: recurring-declined** → **Respond: plan declined** ("Noted. Don't offer the plan again.") |
| | → `email` | | **GHL: save email** (`PUT /contacts/{id}`) → **Tag: recurring-interest** → … |
| | → `no_email` | | **Tag: recurring-interest** directly → … |
| | → `ask` | | **Reply**: "Ask once for their email and spell it back, then call again." |
| 3 | **GHL: save email** | HTTP `PUT /contacts/{id}` | Saves the email **before** the tag, so GHL workflow 6.3 sees it. If GHL refuses (the email is already on another contact) → **Email in use**. |
| 3b | **Email in use** (`plan-email-taken.js`) | Code | Carries on without the email: Maya says the team will call, and 6.3 takes its no-email branch. |
| 4 | **Tag: recurring-interest** | HTTP `POST /contacts/{id}/tags` | Fires GHL workflow 6.3. |
| 5 | **Respond: plan saved** | Respond | "Saved. The biweekly plan details are being emailed to … Spell it back." (or the Email in use / no_email text). |
| 6 | **Log: plan** | HTTP → Sheet | Row `plan_interest`. *(after the reply)* |
| 7 | **Opportunity: Recurring plan** | HTTP `POST /opportunities/upsert` | Card in Recurring plans > Interested, worth the yearly value. *(after the reply)* |

---

## 3. Call events workflow (after the call)

| # | Node | Type | What it does |
|---|---|---|---|
| 1 | **Retell call event** | Webhook, `POST /webhook/brightnest-events` | Retell posts `call_started`, `call_ended` and `call_analyzed` here. |
| 2 | **Config** | Set | Same key check as the tools workflow. |
| 3 | **Key OK?** | If | Wrong key → **401 Unauthorized**. |
| 4 | **204 No Content** | Respond | Answers Retell at once (it only needs "received"). |
| 5 | **Call analysed?** | If | Only `call_analyzed` continues; that's the one with the summary. |
| 6 | **Call row** (`event-row.js`) | Code | Row `call_ended`: hang-up reason, sentiment, Retell's post-call fields (`booked=true`, `complaint=…`), summary, duration, recording link. |
| 7 | **Log: call ended** | HTTP → Sheet | Writes it to the `demo5` tab. |

---

## 4. Following one call in n8n

Example: the caller books a cleaning. Maya makes about 6 tool calls, so n8n > **Executions** shows 6 executions of "Brightnest tools", newest on top:

| Execution | Path lit up |
|---|---|
| lookup_customer | entrance → output 0 → find contact → Found? **false** → Reply: new client → Reply |
| upsert_contact | entrance → output 1 → Build contact → upsert → Respond → Opportunity: New lead |
| get_quote | entrance → output 2 → Calculate quote → Respond → Log |
| check_calendar | entrance → output 3 → Calendar window → free slots → Reply: open times → Reply |
| book_cleaning | entrance → output 4 → Build booking → book → Respond → Log → Tag: booked → Opportunity: Booked |
| add_note_and_tags | entrance → output 6 → Prep note → Any tags? → add note → Respond → Log |

To inspect one, open it and click a node to see its **input** and **output**. The useful ones are:
- **Normalize:** what Maya actually sent (the `args`).
- **The `Reply: …` node:** exactly what Maya was told.

A red node is where it failed. Its output shows GHL's error message (401 = token or scope, 400/422 = a wrong ID or a value GHL refused).

## 5. Changing something

| To change | Edit | Then |
|---|---|---|
| Prices, hours, limits | `pricing.json` | `n8n/import.sh` |
| What a step does or says to Maya | `n8n/code/<file>.js` | `n8n/import.sh` |
| Wiring, a new node, a new tool | `n8n/build.mjs` | `n8n/import.sh` (and `node setup-retell.mjs` for a new tool) |
| A setting (IDs, token) | `.env` | `docker compose up -d` |

Changes made in the n8n editor are overwritten by the next `n8n/import.sh`. Copy them into the code files first.
