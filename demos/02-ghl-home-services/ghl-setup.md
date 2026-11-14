# GoHighLevel setup (about 45 minutes, inside the 14-day trial)

This is also the checklist you hand an agency when you clone the build for one of their clients.

## 1. Sub-account
Create a sub-account called **Northside Plumbing & HVAC (Demo)**. Set the time zone to America/New_York. Copy the **Location ID** (Settings > Business Profile) into `GHL_LOCATION_ID`.

## 2. Custom fields (Settings > Custom Fields, Contact object)
| Field name | Type | Key (must match the code) |
|---|---|---|
| Service Type | Dropdown: Plumbing, Heating, Cooling, Water Heater, Drain | `contact.service_type` |
| Property Type | Dropdown: Residential, Commercial | `contact.property_type` |
| Issue Description | Multi-line text | `contact.issue_description` |

If GHL generates a different key, change it in `functions/src/handlers/homeServices.ts`.

## 3. Pipeline (Opportunities > Pipelines)
Pipeline **AI Voice Leads** with stages: New lead, Booked, Emergency, Out of area. Put the pipeline ID and the stage IDs for New lead, Booked and Emergency into `GHL_PIPELINE_ID`, `GHL_STAGE_NEW`, `GHL_STAGE_BOOKED`, `GHL_STAGE_EMERGENCY`. The IDs show in the URL or via the API `GET /opportunities/pipelines`.

Second pipeline **Memberships** (for the maintenance plan upsell) with stages: Interested, Signed up, Declined. Put its pipeline ID and the **Interested** stage ID into `GHL_MEMBERSHIP_PIPELINE_ID` and `GHL_MEMBERSHIP_STAGE_INTERESTED` in `functions/wrangler.toml`. `PLAN_PRICE_PER_YEAR` (default 149) becomes the opportunity value. Leave the two IDs empty and the upsell still works, it just tags the contact without creating an opportunity.

List all pipeline and stage IDs in one go:
```bash
curl -s -H "Authorization: Bearer $GHL_API_TOKEN" -H "Version: 2021-07-28" \
  "https://services.leadconnectorhq.com/opportunities/pipelines?locationId=$GHL_LOCATION_ID" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>JSON.parse(s).pipelines.forEach(p=>{console.log(p.name,p.id);p.stages.forEach(x=>console.log("   ",x.name,x.id))}))'
```

## 4. Calendar
Create a round-robin or simple calendar **Service Visits**, 2-hour slots, Mon to Sat 8 AM to 6 PM. Copy its ID into `GHL_CALENDAR_ID`.

## 5. Private Integration token
Settings > Private Integrations > Create. Scopes:

| Scope | Used by |
|---|---|
| contacts.readonly, contacts.write | upsert_contact, lookup_customer (find by phone), plan email |
| contacts/tags, contacts/notes (or the contacts.write that covers them) | tags and notes |
| calendars.readonly | check_calendar |
| calendars/events.readonly | lookup_customer (next visit) |
| calendars/events.write | book_job, reschedule_job |
| opportunities.readonly | lookup_customer (open jobs and stage names) |
| opportunities.write | pipeline stages, Memberships opportunity |

**Already have a token?** Edit the integration and tick the two `.readonly` scopes for opportunities and calendars/events. The token value stays the same. Without them `lookup_customer` fails with 401/403 in Terminal A.

Save the token with `wrangler secret put GHL_API_TOKEN` (prod) and in `functions/.dev.vars` (local).

## 6. Workflows (Automation > Workflows)
1. **Emergency alert**. Trigger: Contact tag added = `emergency`. Actions: send SMS to the on-call tech ("EMERGENCY: {{contact.name}} {{contact.phone}} {{contact.address1}}"), internal notification, assign to on-call user.
2. **Booking confirmation**. Trigger: Contact tag added = `booked`. Action: SMS to the contact ("Hi {{contact.first_name}}, your Northside visit is booked. Reply C to change.").
3. **Out-of-area**. Trigger: tag `out-of-area`. Action: move opportunity to Out of area.
4. **Plan sign-up link** (maintenance plan upsell). Trigger: Contact tag added = `plan-interest`. Filter: contact email is not empty. Action: **Send Email** (free-ish LC Email, no A2P needed): subject "Your Northside Comfort Club link", body with your sign-up link (a GHL payment link, order form, or any page). Optional second action: internal notification to the office. The Worker saves the email **before** adding the tag, so the email field is filled when this fires.
5. **Returning customer** (optional). Trigger: tag `returning-customer`. Action: internal notification "Returning customer {{contact.name}} called". Nice in the video, not required.

SMS actions (1 and 2) use LC Phone: paid per message and, for US numbers, blocked until A2P 10DLC is approved. For the demo, an internal notification or an email works just as well on screen.

## 7. What to show in the video
Split screen: Retell web call on the left, the GHL contact on the right. Refresh during the call so the contact, custom fields, tags, note, opportunity stage and calendar event appear live.

## Agency handoff ("snapshot")
For a real agency client, export this sub-account as a GHL Snapshot. Then deliver: the snapshot, `retell-llm.json` with their prompt, and the Worker env values. Cloning per client is then: load snapshot, edit prompt and price list, set 7 env values, test 5 calls.
