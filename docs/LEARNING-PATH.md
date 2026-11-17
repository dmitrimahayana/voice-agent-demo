# Learning path: from zero to all three demos

This guide teaches the project hands-on, one small step at a time. Each lesson has a goal, the steps, and a **checkpoint**: what you should see before moving on. Don't skip checkpoints; every later lesson builds on them.

`ARCHITECTURE.md` is the reference ("how it all fits"). This file is the course ("do this, then this"). Total time is about 5 to 7 days at a relaxed pace, and the lessons follow the build order in the plan.

---

## Glossary (read once)

| Term | Meaning here |
|---|---|
| **Voice platform** | Vapi or Retell. Hosts the agent: phone, speech-to-text, LLM, text-to-speech. |
| **Assistant / agent** | One configured voice bot: prompt, voice, model, tools, limits. |
| **System prompt** | The instructions the LLM follows on every turn (`prompt.md`). |
| **Tool / function** | Something the LLM may ask to run, described by a name, a description and a JSON Schema of arguments. |
| **Webhook** | A URL that a service calls (HTTP POST) when something happens. Your Worker is a webhook receiver. |
| **Worker** | A small program on Cloudflare's network that answers HTTP requests (`functions/`). |
| **wrangler** | Cloudflare's command-line tool to run, test and deploy Workers. |
| **Tunnel** | A temporary public URL pointing to your laptop, so Vapi/Retell can reach `localhost`. |
| **Secret / env var** | A setting such as an API key, given to the Worker at runtime and never written in code. |
| **JSON Schema** | The format for describing a tool's arguments: `{type:"object", properties:{date:{type:"string"}}}`. |
| **E.164** | Phone number format with a plus and country code: `+15125550142`. |

---

## Lesson 0: The mental model (20 minutes, reading only)

Read sections 1 and 2 of `ARCHITECTURE.md`.

**Checkpoint:** you can explain in one sentence each: what Vapi does, what your Worker does, and what happens between "caller says Tuesday" and "agent offers 10 AM".

---

## Lesson 1: Talk to your first agent, with no code (30 minutes)

Goal: feel what the platform does on its own.

1. Sign up at vapi.ai (no card).
2. Create a blank assistant. In the system prompt write only: `You are a friendly receptionist for a dental clinic. Keep answers short.`
3. Click **Talk** (the browser call button) and have a 1-minute conversation. Interrupt it mid-sentence and stay silent for 10 seconds.
4. Open **Call Logs**: read the transcript, play the recording, and look at the cost.

**Checkpoint:** you've seen that turn-taking, interruptions, voice and transcripts all work with zero code. Note the cost per minute, since this is your $10 budget.

---

## Lesson 2: Prompting (1 hour)

Goal: learn that the prompt controls the behaviour, and see where it fails without tools.

1. Replace the prompt with the content of `demos/01-dental-receptionist/prompt.md`, and paste `knowledge-base.md` where it says `{{knowledge_base}}`.
2. Talk to it and try calls 2, 3, 4, 8, 11 and 12 from `test-script.md`.
3. Now try call 1 ("book a cleaning next Tuesday"). It will pretend or apologise, because it has no calendar. **This is why tools exist.**
4. Change one rule (for example, make it answer in 10 words or fewer) and hear the difference.

**Checkpoint:** you know what each prompt section does (Goals, Style, Booking, Emergencies, CLINIC INFORMATION) and why booking needs a tool.

---

## Lesson 3: See a tool call with your own eyes, still no code (30 minutes)

Goal: see the exact HTTP request a platform sends.

1. Open https://webhook.site and copy your unique URL.
2. In the Vapi assistant, add a tool: Tools > Create > Function, named `get_time` with the description "Get the current time", no parameters, and the server URL set to your webhook.site URL. Attach it to the assistant.
3. Add to the prompt: `If asked the time, call get_time.`
4. Talk: "What time is it?"
5. In webhook.site, open the request. Find `message.type` = `tool-calls`, `toolCallList[0].function.name` = `get_time` and `message.call.customer`.

The agent will say something failed, because webhook.site doesn't answer in Vapi's format. That's expected.

**Checkpoint:** you've seen the real request body. Compare it with the Vapi example in `ARCHITECTURE.md` section 2.

---

## Lesson 4: Run the Worker on your Mac (45 minutes)

Goal: run real code that answers that request.

1. Install Node 20+ (`node -v`), then:
   ```bash
   cd ~/Documents/ai-agent-workflow/voice-agent/functions
   npm install
   cp .dev.vars.example .dev.vars        # leave the fake values for now
   npx wrangler dev                      # starts http://localhost:8787
   ```
2. In a second terminal:
   ```bash
   curl http://localhost:8787/
   # {"ok":true,"service":"voice-agent-functions"}

   curl -X POST "http://localhost:8787/vapi/tools?demo=learn&key=change-me" \
     -H "content-type: application/json" \
     -d '{"message":{"type":"tool-calls","call":{"id":"test1","customer":{"number":"+15125550142"}},
          "toolCallList":[{"id":"t1","function":{"name":"get_time","arguments":{}}},
                          {"id":"t2","function":{"name":"echo","arguments":{"text":"hello"}}}]}}'
   ```
3. Try a wrong key (`key=nope`): you get `401 unauthorized`. Try a tool that doesn't exist: you get a polite "Unknown tool" result.
4. Open `functions/src/index.ts` and follow the request: `fetch()`, then `vapiTools()`, then `runTool()`, then `handlers/learn.ts`. Change the text in `echo` and save. wrangler reloads, so curl again.

**Checkpoint:** you understand the route, the `?demo=` toolset choice, the key check and the `{results:[{toolCallId,result}]}` reply.

---

## Lesson 5: Connect the agent to your laptop (45 minutes)

Goal: the full loop, with a live voice, your code and a live answer.

1. Install cloudflared (`brew install cloudflared`), then run `cloudflared tunnel --url http://localhost:8787`. Copy the `https://….trycloudflare.com` URL.
2. In Vapi, change the `get_time` tool's server URL to `https://<tunnel>/vapi/tools?demo=learn&key=change-me`.
3. Talk: "What time is it?" Watch the `wrangler dev` terminal show the request as the agent answers with your Worker's text.
4. Add the `echo` tool (one string parameter `text`) and say "Please echo the word banana."

**Checkpoint:** you heard your own code's answer spoken by the agent. This is the whole technique; everything after this is the same loop with real APIs.

---

## Lesson 6: Deploy to Cloudflare for free (30 minutes)

Goal: a permanent URL that works when your laptop is off.

```bash
npx wrangler login
npx wrangler secret put WEBHOOK_SECRET     # pick a long random string
npx wrangler deploy                        # prints https://voice-agent-functions.<you>.workers.dev
curl https://voice-agent-functions.<you>.workers.dev/
```
Update the tool URL in Vapi to the workers.dev URL with your new secret. Watch live logs with `npx wrangler tail`.

**Checkpoint:** "What time is it?" works with the tunnel closed.

---

## Lesson 7: Config as code (30 minutes)

Goal: stop clicking in dashboards.

1. Read section 2 of `scripts/setup-agents.mjs` ("build the configs"): the tool lists, `vapiAssistant()`, and where `prompt.md` is read.
2. Run:
   ```bash
   cd ~/Documents/ai-agent-workflow/voice-agent
   W=https://voice-agent-functions.<you>.workers.dev K=<secret> node scripts/setup-agents.mjs --build-only
   ```
3. Open `demos/01-dental-receptionist/assistant.vapi.json` and find the prompt, the 4 function tools with your URL, the transfer tool, `maxDurationSeconds: 180` and the `server.url` for events.

**Checkpoint:** you can say which file you'd edit to change behaviour (`prompt.md`), and which file is generated (`*.json`).

---

## Lesson 8: Demo 1 for real, with Cal.com booking (2 to 3 hours)

1. Cal.com (free): create the event type "Dental appointment" (30 minutes). Put its numeric ID in `CALCOM_EVENT_TYPE_ID` in `wrangler.toml`. Create an API key, then run `npx wrangler secret put CALCOM_API_KEY`, then `npx wrangler deploy`.
2. Test the tool by curl first (no voice minutes spent):
   ```bash
   curl -X POST "https://<worker>/vapi/tools?demo=dental&key=<secret>" -H "content-type: application/json" \
     -d '{"message":{"type":"tool-calls","call":{"id":"t","customer":{"number":"+15125550142"}},
          "toolCallList":[{"id":"1","function":{"name":"check_availability","arguments":{"date":"2026-11-17"}}}]}}'
   ```
   You should see real slots with `say` text.
3. Create the assistant: `VAPI_API_KEY=… W=… K=… TRANSFER_NUMBER=… node scripts/setup-agents.mjs --only=vapi` (no Retell key needed yet). Or paste from the JSON in the dashboard.
4. Talk in the browser and book a cleaning. Check that it appears in Cal.com.
5. Read `handlers/dental.ts` and `lib/calcom.ts` and find where `say` and `slot_iso` are made.

**Checkpoint:** a voice booking appears in your Cal.com calendar.

---

## Lesson 9: Call logging (45 minutes)

1. Follow the steps at the top of `sheets/call-log.gs`, then run `npx wrangler secret put SHEETS_WEBHOOK_URL` and deploy.
2. Make a call. After hanging up, a `dental` tab appears with a `booked` row and a `call_ended` row with the summary.
3. Read `vapiEvents()` in `index.ts` and `lib/sheets.ts`. Notice that `ctx.waitUntil` logs *after* answering, so the caller never waits for Google.

**Checkpoint:** every call produces rows.

---

## Lesson 10: Your Twilio number (30 minutes, then 20 test calls)

1. Vapi > Phone Numbers > Import > Twilio: enter the number, Account SID and Auth Token, then assign the dental assistant.
2. Call it from your phone.
3. Run all 20 calls in `test-script.md`. Fix `prompt.md`, rebuild, re-push (or paste), and repeat until all pass.

**Checkpoint:** a real phone call books a real appointment and logs it. **Demo 1 is done.**

---

## Lesson 11: Same thing on Retell (1 hour)

Goal: learn that the platforms differ in shape, not in idea.

1. Sign up at retellai.com. Create an agent with the Single Prompt type. Add a custom function `get_time` with the URL `https://<worker>/retell/tools/get_time?demo=learn&key=<secret>` and no parameters.
2. Web-call it: "What time is it?"
3. Compare with Vapi in `index.ts`: Retell uses one URL per function and sends `{call, name, args}`; Vapi uses one URL for all tools and sends `{message:{toolCallList}}`. Both end up in the same `runTool()`.

**Checkpoint:** the same Worker tool answered on both platforms.

---

## Lesson 12: Demo 2, Retell plus GoHighLevel (1 to 2 days)

1. Start the GHL trial (14 days), then follow `demos/02-ghl-home-services/ghl-setup.md` step by step.
2. Fill the `GHL_*` vars, set `GHL_API_TOKEN`, deploy, then curl `upsert_contact` first (see the Retell body in `ARCHITECTURE.md`) and confirm the contact appears in GHL.
3. Push the Retell agent (`node scripts/setup-agents.mjs --only=retell` with a real `RETELL_API_KEY`) and web-call it with `test-script.md`.
4. Read `handlers/homeServices.ts`: how `contact_id` is returned so the LLM can pass it into later calls (the Worker keeps no memory between requests).

**Checkpoint:** during a web call, the contact, fields, tags, appointment and opportunity appear in GHL.

---

## Lesson 13: Demo 3, outbound speed-to-lead (half a day)

1. Import `clients.csv` into a Google Sheet, publish it as CSV, then put the link in `CLIENTS_CSV_URL`.
2. Copy the Twilio number's **phone number ID** from Vapi into `VAPI_OUTBOUND_PHONE_NUMBER_ID`, and the speed-to-lead assistant ID into `VAPI_SPEED_TO_LEAD_ASSISTANT_ID`. Deploy.
3. Trigger it with curl to your own phone:
   ```bash
   curl -X POST https://<worker>/leads -H "content-type: application/json" \
     -d '{"client_id":"sunpeak-solar","name":"Dmitri","phone":"+1XXXXXXXXXX","message":"bill is about $250"}'
   ```
4. Open `landing/index.html`, set `ENDPOINT`, and submit as two different businesses.
5. Optional: import `n8n-workflow.json` into n8n and run the same thing visually.
6. Read `handlers/leads.ts`: how one CSV row becomes `variableValues`, and how those fill the `{{…}}` placeholders in `prompt.md`.

**Checkpoint:** two different businesses call your phone from one template.

---

## Lesson 14: Ship the portfolio (1 day)

1. Put your number, Vapi public key and assistant ID in `hub/index.html`, then deploy it to Cloudflare Pages (`npx wrangler pages deploy hub`).
2. Record the video using `docs/upwork-portfolio-and-video.md`.
3. Add the Upwork portfolio entries.
4. Run `git init`, then commit and push to a public GitHub repo. Check that `.dev.vars` is **not** committed.

---

## When something breaks

| Symptom | Where to look |
|---|---|
| Agent says "the system is not responding" | `npx wrangler tail`: the real error is logged by `runTool()` |
| `401 unauthorized` | The `?key=` in the tool URL doesn't match `WEBHOOK_SECRET` |
| Agent reads strange dates | The prompt is missing today's date, or the `TIMEZONE` var is wrong |
| Tool never called | The tool description is unclear, or the prompt doesn't say when to call it |
| Booking fails with 400 | Cal.com event type ID, or a slot outside availability: test with curl |
| GHL 401/403 | Private Integration token scopes (`ghl-setup.md` step 5) |
| Outbound call fails | Trial Twilio account calling an unverified number, or a wrong phone number ID |
