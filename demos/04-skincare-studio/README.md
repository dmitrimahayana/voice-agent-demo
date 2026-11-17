# Demo 4: Dewlane Skin Studio bilingual receptionist (ElevenLabs)

Elena answers a fictional beauty skin care studio in Miami, in English or Spanish. She asks about the guest's skin, recommends a treatment from the studio menu, books it on Cal.com, and **emails the reservation**. She also moves and cancels bookings (with an updated email each time), handles skin reactions safely, and every call ends with an AI summary, extracted fields and two pass/fail scores in the Google Sheet.

**Buyer:** spas, facial studios, med-spas and salons (many with Spanish-speaking clients), and agencies selling to them. It runs on **ElevenLabs Agents**: the best voice quality of the four demos, a website voice widget, and English ⇄ Spanish switching mid-call.

## What runs where

| Piece | Used for | Where it's defined |
|---|---|---|
| **Server tools** (7) | `recommend_treatment`, `check_availability`, `book_appointment`, `find_appointment`, `reschedule_appointment`, `cancel_appointment`, `flag_call`, each calling `POST /elevenlabs/tools/<name>?demo=skin` | `SKIN_TOOLS` in `scripts/setup-agents.mjs`; handlers in `functions/src/handlers/skincare.ts` |
| **Service menu** | treatments, prices, length, preparation, who it's not suitable for | `services.json` (one file: the Worker reads it for recommendations and emails, the setup script uploads it to the knowledge base) |
| **Knowledge base** | menu, policies and FAQ (aftercare, makeup, frequency...) | `services.json` + `knowledge-base.md` |
| **Dynamic variables** | caller ID and conversation ID in every tool body (`system__caller_id`, `system__conversation_id`), unseen by the LLM | `setup-agents.mjs` |
| **System tools** | `end_call`, `language_detection` (English ⇄ Spanish), `transfer_to_number` (front desk) | `built_in_tools` in the agent |
| **Reservation email** | booked / moved / cancelled, in the guest's language, with preparation tips | `functions/src/lib/email.ts` (Resend), or Cal.com's own email when Resend isn't set up |
| **Data collection + evaluation** | `language`, `skin_type`, `concerns`, `treatment`, `booked`, `email_confirmed`, `reaction`, plus "Request handled" and "Safe beauty advice" | `platform_settings` in the agent |
| **Post-call webhook** | summary, duration, fields and scores → Sheet tab `demo4` | ElevenLabs dashboard (one time) |
| **Website widget** | "Talk to Elena" button on the studio page | `landing/index.html` |

## Call flow

```
Guest clicks "Talk to Elena" on the website (or calls the ElevenLabs number)
   │
   ▼
ElevenLabs agent "Elena": speech-to-text → LLM (gpt-4.1) → ElevenLabs voice
   │  "¿Habla español?" → language_detection → rest of the call in Spanish
   │  asks skin type + concerns (+ pregnancy / isotretinoin before peels or microneedling)
   │
   ├─ recommend_treatment ─┐
   ├─ check_availability ──┤  POST /elevenlabs/tools/<name>?demo=skin&key=…
   ├─ book_appointment ────┤  body = tool args + caller_id + conversation_id
   │                       ▼
   │        Cloudflare Worker (handlers/skincare.ts)
   │          • services.json → recommendation
   │          • Cal.com: slots / booking on the studio event type
   │          • Resend: reservation email (EN or ES)  ── or Cal.com's own email
   │          • Sheet row (tab demo4)
   │
   ▼
Call ends → ElevenLabs analysis → post-call webhook (HMAC-signed) → POST /elevenlabs/events?demo=skin
   → Sheet row: call_ended | success=… | language=es | skin_type=oily | treatment=… | booked=true …
```

**Bookings are keyed by email.** Website callers have no phone number, and the email is where the reservation goes, so Elena asks for it, has the guest spell it, and reads it back before booking. To change or cancel, she asks for the same email.

## Email: two modes

| | Resend set up (`RESEND_API_KEY`) | Not set up |
|---|---|---|
| Who sends | the Worker, branded "Dewlane Skin Studio" | Cal.com |
| Language | English or Spanish (the call's language) | Cal.com's default |
| Content | treatment, date, length, price, reference, address, preparation tips | Cal.com's standard confirmation |
| Cal.com attendee email | a placeholder (`guest-<hash>@BOOKING_EMAIL_DOMAIN`), so Cal.com doesn't send a second email | the guest's real email |

## Setup (about 45 minutes, after the Worker runs locally)

1. **Cal.com event type:** Cal.com > Event Types > New: "Dewlane appointment", **60 minutes**, availability Tuesday to Saturday 10 AM to 7 PM. Put its ID in `functions/wrangler.toml` as `CALCOM_SKIN_EVENT_TYPE_ID = "..."` (copy the line from `wrangler.toml.example`). Without it Demo 4 books on Demo 1's dental calendar.
2. **Email (optional but recommended):**
   - Sign up at resend.com (free: 3,000 emails/month) > API Keys > Create. Put it in `functions/.dev.vars` as `RESEND_API_KEY=re_...`.
   - Domains > Add your domain (e.g. `n2m-ai.com`) and add the DNS records it shows in Cloudflare. Then set `EMAIL_FROM = "Dewlane Skin Studio <bookings@your-domain.com>"` in `wrangler.toml`.
   - Quick test without a domain: leave `EMAIL_FROM` unset. Mail goes from `onboarding@resend.dev`, but **only to the email of your own Resend account**.
   - Restart `wrangler dev` after editing `.dev.vars`.
3. **ElevenLabs:** API key with **ElevenAgents: Write** in `functions/.dev.vars` as `ELEVENLABS_API_KEY`. Then:
   ```bash
   cd ~/Documents/ai-agent-workflow/voice-agent
   W=https://dev.your-domain.com TRANSFER_NUMBER=+1YOUR_MOBILE node scripts/setup-agents.mjs --only=elevenlabs
   ```
   It creates or updates the 7 tools, the knowledge base and the agent, and writes the agent ID into `landing/index.html`.
4. **Post-call webhook (one time):** ElevenLabs > Agents > Settings > Post-call webhook: URL `https://dev.your-domain.com/elevenlabs/events?demo=skin`, HMAC auth, event *transcript*. Copy its secret into `functions/.dev.vars` as `ELEVENLABS_WEBHOOK_SECRET`.
5. **Test:** open `landing/index.html` in the browser and click **Talk to Elena**. Allow the microphone.
6. **Phone (optional):** a second Twilio number (your first one routes to Vapi). Rerun step 3 with `EL_PHONE=+1… TWILIO_ACCOUNT_SID=AC… TWILIO_AUTH_TOKEN=…`.

## Files

| File | What it is |
|---|---|
| `prompt.md` | Elena's system prompt (edit this) |
| `services.json` | Treatment menu: the single source for prices, preparation and suitability |
| `knowledge-base.md` | FAQ uploaded with the menu |
| `landing/index.html` | Studio page with the ElevenLabs voice widget |
| `test-script.md` | 18 calls to pass before recording |
| `tools.elevenlabs.json`, `agent.elevenlabs.json` | Generated by `setup-agents.mjs`; git-ignored |

After editing `prompt.md`, `services.json` or `knowledge-base.md`, rerun step 3. After editing `services.json`, also restart or redeploy the Worker (it reads the same file).

## What to show in the video
Split screen: the studio page and the guest's inbox. Ask in Spanish for help with dark spots, get the Brightening Glow Peel recommended after the safety question, book it, and spell the email. The Spanish reservation email arrives during the call. Then show the Cal.com booking and the Sheet's `demo4` row with `language=es | treatment=Brightening Glow Peel | booked=true | success=success`.

## Free-tier notes
- ElevenLabs free plan: a small monthly allowance of agent minutes (around 15; check the plan page), enough for building and a few takes.
- Resend free plan: 3,000 emails a month, 100 a day.
- Calls are capped at 4 minutes (`max_duration_seconds: 240`); booking with a spelled email takes longer than Demo 1.
- This is a beauty demo, not medical: Elena never diagnoses, asks about pregnancy and isotretinoin before peels and microneedling, and escalates reactions.
