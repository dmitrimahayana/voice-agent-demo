# Demo 2: Northside Plumbing & HVAC lead qualifier (Retell + GoHighLevel)

Sam answers calls for a fictional plumbing and HVAC company. He qualifies the job, checks the service area, triages emergencies and writes everything into GoHighLevel while the call is still running: contact, custom fields, tags, note, opportunity stage and calendar booking. GHL workflows then text the on-call tech or the customer.

He also **reads** from GHL:
- **Returning customers:** Sam looks the caller up by phone, greets them by name, tells them their next visit ("Tuesday, 9 to 11") and the stage of any open job, and moves the visit if they ask, without creating a duplicate.
- **Maintenance plan upsell:** after a booking, Sam offers the $149/year Comfort Club once. A yes adds the `plan-interest` tag, saves the email, and creates an opportunity in a **Memberships** pipeline; a GHL workflow emails the sign-up link.

**Buyer:** agencies that resell AI receptionists on GHL. It shows you work inside their stack, and that the build clones per sub-account.

## Files
| File | What it is |
|---|---|
| `prompt.md` | Retell general prompt (edit this) |
| `retell-llm.json` | Generated Retell LLM with the 7 custom functions (lookup_customer, upsert_contact, check_calendar, book_job, reschedule_job, add_note_and_tags, record_plan_interest) |
| `retell-agent.json` | Generated Retell agent (voice, webhook, 3-minute cap, post-call analysis) |
| `ghl-setup.md` | GHL sub-account, fields, pipeline, calendar, token and workflows |
| `test-script.md` | 12 calls, with what to check in GHL for each |

## Setup (about 2 days, inside the 14-day GHL trial)
1. Start the GHL trial **only when you're ready to build**, then follow `ghl-setup.md`.
2. Fill the `GHL_*` vars in `functions/wrangler.toml`, set `GHL_API_TOKEN`, and deploy the Worker.
3. Build the configs (`node scripts/build-configs.mjs`). Then use `--push`, or create a Retell LLM and agent in the dashboard by pasting the prompt and adding the 7 custom functions with the URLs from `retell-llm.json`.
4. Test with **web calls** from the Retell dashboard. No phone number is needed.
5. Optional phone line: your main Twilio number is already routed to Vapi, and one number can only send incoming calls to one platform. So buy a second Twilio number (about $1.15/month) for Retell. In Twilio, create an Elastic SIP trunk with origination `sip:sip.retellai.com`, then in Retell go to Phone Numbers > Import. Retell doesn't charge for imported numbers.
6. Run `test-script.md`, then record the split-screen video before the trial ends.

## What to show in the video
Retell web call on the left and the GHL contact on the right. Refresh during the call to show the fields, tags and opportunity filling in. Then show the emergency SMS arriving on your phone.

## Agency handoff
Export the sub-account as a GHL Snapshot. A new client is then: load the snapshot, edit `prompt.md` (name, service area, price list), set 7 env values, and pass 5 test calls.
