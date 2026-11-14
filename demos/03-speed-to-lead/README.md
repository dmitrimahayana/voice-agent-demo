# Demo 3: Speed-to-lead AI callback (white-label template)

A lead fills in a web form, and an AI agent calls them back in about 30 seconds. The agent references what they typed, qualifies them in 3 questions and books a meeting. One prompt template serves any number of businesses: each client is one row in `clients.csv` (name, agent name, offer, questions, meeting type, price line).

**Buyer:** agencies. The pitch is "every lead gets a call in under a minute", and the template shows you can roll it out for each client in about an hour.

## Files
| File | What it is |
|---|---|
| `prompt.md` | Shared prompt with `{{variables}}` filled per client and per lead |
| `clients.csv` | 3 sample clients (solar, med spa, roofing). Import into a Google Sheet |
| `assistant.vapi.json` | Generated Vapi assistant |
| `n8n-workflow.json` | Visual version: webhook, client lookup, Vapi call, reply |
| `landing/index.html` | Demo form with a business picker and a live timer |

There are two interchangeable back ends. Pick one, or show both:
- **n8n** (`n8n-workflow.json`): agencies like seeing the visual flow. Import it via Workflows > Import from file, edit the 3 settings in the Code node and the sheet URL, and add a Header Auth credential (`Authorization: Bearer <Vapi private key>`).
- **Worker** (`POST /leads` in `functions/`): no extra hosting. Set `CLIENTS_CSV_URL`, `VAPI_SPEED_TO_LEAD_ASSISTANT_ID` and `VAPI_OUTBOUND_PHONE_NUMBER_ID`.

## Setup (about 1 day)
1. Import `clients.csv` into a Google Sheet, then File > Share > Publish to web > CSV. Copy the link.
2. **Outbound number:** use the Twilio number you already imported into Vapi for Demo 1. Copy its phone number ID from Vapi into `VAPI_OUTBOUND_PHONE_NUMBER_ID` (Worker) or the Code node settings (n8n). If the Twilio account is still a trial, it can only call verified numbers and plays a trial notice first.
3. Build and push the assistant (`node scripts/build-configs.mjs --push`), then copy its ID.
4. Set `ENDPOINT` in `landing/index.html` and open it. Pick a business, enter your own phone and submit.

## What to show in the video
Open the config sheet with 3 clients. Submit the form as SunPeak Solar and the phone rings with "Maya from SunPeak Solar". Submit again as Glow Med Spa and it's "Chloe from Glow Med Spa". Same template, two businesses. Finish on the call-log sheet.

## Production notes for clients
- Use the client's own number with a local area code, and respect calling-hour rules and consent (the form should include a consent checkbox).
- Rate-limit `/leads` (Cloudflare WAF rule) or add a captcha before using it on a public site.
