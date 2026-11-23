# GoHighLevel setup (about 45 minutes)

Demo 5 uses its **own sub-account**, separate from Demo 2's Northside sub-account, so contacts, pipelines and workflows never mix. Every ID below goes into `demos/05-n8n-house-cleaning/.env`.

Before starting the 14-day trial you can run the whole demo against the mock (`n8n/mock-ghl.mjs`, see `n8n-setup.md`). Start the trial only when you're ready to record.

## 1. Sub-account
Create a sub-account called **Brightnest Home Cleaning (Demo)**, time zone **America/Denver**. Copy the **Location ID** (Settings > Business Profile) into `GHL_LOCATION_ID`.

## 2. Custom fields (Settings > Custom Fields, Contact object)
| Field name | Type | Key (must match `n8n/code/upsert-build.js`) |
|---|---|---|
| Cleaning Type | Dropdown: Standard, Deep, Move-in/Move-out, Post-construction | `contact.cleaning_type` |
| Bedrooms | Number | `contact.bedrooms` |
| Bathrooms | Number (decimals on) | `contact.bathrooms` |
| Pets | Single-line text | `contact.pets` |
| Frequency | Dropdown: One-time, Weekly, Biweekly, Monthly | `contact.frequency` |
| Access Notes | Multi-line text | `contact.access_notes` |

If GHL generates a different key, change it in `n8n/code/upsert-build.js` and rerun `n8n/import.sh`.

## 3. Pipelines (Opportunities > Pipelines)
**AI Voice Leads**, stages: New lead, Booked, Needs attention, Out of area. Put the pipeline ID and the New lead, Booked and Needs attention stage IDs into `GHL_PIPELINE_ID`, `GHL_STAGE_NEW`, `GHL_STAGE_BOOKED`, `GHL_STAGE_ATTENTION`.

**Recurring plans**, stages: Interested, Signed up, Declined. Put the pipeline ID and the Interested stage ID into `GHL_RECURRING_PIPELINE_ID` and `GHL_RECURRING_STAGE_INTERESTED`. The opportunity value is the plan's yearly value (visit price × visits per year). Leave them empty and the upsell still tags the contact; the opportunity step just fails quietly.

GHL keeps one opportunity per contact per pipeline, so the lead moves New lead → Booked → Needs attention rather than getting a second card.

List every pipeline and stage ID:
```bash
set -a; . demos/05-n8n-house-cleaning/.env; set +a
curl -s -H "Authorization: Bearer $GHL_API_TOKEN" -H "Version: 2021-07-28" \
  "https://services.leadconnectorhq.com/opportunities/pipelines?locationId=$GHL_LOCATION_ID" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>JSON.parse(s).pipelines.forEach(p=>{console.log(p.name,p.id);p.stages.forEach(x=>console.log("   ",x.name,x.id))}))'
```

## 4. Calendar
Use one calendar for all cleanings (a new **Cleanings** calendar, or the template's **Schedule an Appointment**): slot duration **1 hour**, slot interval **1 hour**, Monday to Saturday 8 AM to 6 PM. Copy its ID into `GHL_CALENDAR_ID`.

A GHL calendar only books its own slot length, so it rejects a 4-hour booking on a 1-hour calendar ("Selected slot duration is not a valid duration option"). n8n works around this:
- `check_calendar` gets the job's `hours` and offers only start times where every hour until the end is free and inside opening hours.
- `book_cleaning` and `reschedule_cleaning` then book the real length with GHL's slot check turned off (`ignoreFreeSlotValidation`), so a 4-hour deep clean blocks 4 hours.

Keep the slots at 1 hour: longer slots make the fit check coarser. The one gap is two callers booking the same time within seconds of each other; for a demo that's fine.

## 5. Private Integration token
Settings > Private Integrations > Create, name it "n8n voice agent". Scopes:

| Scope | Used by |
|---|---|
| contacts.readonly, contacts.write | upsert_contact, lookup_customer, tags, notes, plan email |
| calendars.readonly | check_calendar |
| calendars/events.readonly, calendars/events.write | lookup_customer (next cleaning), book_cleaning, reschedule_cleaning |
| opportunities.readonly, opportunities.write | open jobs and stage names, pipeline stages |

Put the token in `GHL_API_TOKEN`, then `docker compose up -d` again so n8n picks it up (see `n8n-setup.md`).

## 6. Workflows (Automation > Workflows)
n8n never sends messages itself. It adds **tags**, and GHL workflows react to them. The tags n8n adds:

| Tag | Added when | Workflow below |
|---|---|---|
| `ai-voice-lead` | every new or updated contact | none (for filtering) |
| `booked` | `book_cleaning` succeeds | 6.1 Booking confirmation |
| `complaint` | Maya logs a complaint | 6.2 Complaint alert |
| `recurring-interest` | caller wants a recurring plan (email saved first) | 6.3 Recurring plan |
| `recurring-declined` | caller says no to the plan | none |
| `out-of-area` | zip outside the service area | 6.4 Out of area |
| `custom-quote` | home too big for the price list | 6.5 Custom quote |
| `returning-customer` | `lookup_customer` finds the caller | 6.6 Returning client (optional) |

**Before you start:** the housekeeper template may already have workflows, for example a booking confirmation on "appointment booked". Open Automation > Workflows and switch off any that would send a second message for the same event.

### How to create each one (same steps every time)
1. Automation > Workflows > **+ Create Workflow** > **Start from Scratch**.
2. Click the name at the top left and rename it, e.g. "Demo 5 - Booking confirmation".
3. **Add New Trigger** > **Contact Tag**. Under Filters choose **Tag Added**, then pick the tag. If the tag isn't in the list yet, type it exactly as in the table above (lowercase, with the hyphen).
4. Click **+** under the trigger to add each action in the order listed below.
5. **Settings** tab: turn on **Allow Re-entry**, so a contact can go through again on a later call.
6. **Save**, then switch the toggle from **Draft** to **Publish**. A workflow left in draft never runs.

### 6.1 Booking confirmation (tag `booked`)
- **Send Email** to the contact:
  - Subject: `Your Brightnest cleaning is booked`
  - Body: `Hi {{contact.first_name}}, your {{contact.cleaning_type}} cleaning is booked. Reply to this email or call us to change it.`
- Optional: **Send SMS** with the same text (see the SMS note at the end).

### 6.2 Complaint alert (tag `complaint`)
- **Internal Notification**, type Email, to a user (you, as the manager):
  - Subject: `COMPLAINT: {{contact.name}}`
  - Body: `{{contact.name}} {{contact.phone}} reported a problem. Maya's note is on the contact. Call back today.`
- **Add Task**: title `Call {{contact.name}} about complaint`, due in 0 days, assigned to the manager.
- Optional: **Assign to User** (the manager).

n8n moves the opportunity to **Needs attention** itself, so this workflow doesn't need to.

### 6.3 Recurring plan (tag `recurring-interest`)
- **If/Else**: condition **Email** > **is not empty**.
  - **Yes** branch > **Send Email**:
    - Subject: `Your Brightnest recurring plan`
    - Body: `Hi {{contact.first_name}}, thanks for your interest in a recurring cleaning plan: weekly saves 20%, every two weeks 15%, monthly 10%. Sign up here: <your link>`
    - For the link, use a GHL form or payment link (Payments > Payment Links), or any URL for the demo.
  - **No** branch > **Add Task**: `Call {{contact.name}} about a recurring plan` (the caller gave no email).

n8n saves the email before it adds the tag, so the Yes branch sees it. The plan the caller chose (frequency and price per visit) is the name of the opportunity in **Recurring plans**. Don't use `{{contact.frequency}}` here: that field holds how often the *booked* cleaning repeats, usually One-time.

### 6.4 Out of area (tag `out-of-area`)
- **Create/Update Opportunity**: pipeline **AI Voice Leads**, stage **Out of area**.

### 6.5 Custom quote (tag `custom-quote`)
- **Add Task**: `Call {{contact.name}} with a custom quote ({{contact.bedrooms}} bed / {{contact.bathrooms}} bath)`, assigned to the manager.

### 6.6 Returning client (tag `returning-customer`, optional)
- **Internal Notification** (in-app): `{{contact.name}} called again`.

### Check it
Open a test contact, add the tag by hand (contact > Tags > type `booked`), and confirm the email or task appears. Automation > Workflows > the workflow > **Execution Logs** shows each run and any errors.

**A tag only fires once per contact.** GHL triggers on a tag being *added*. If a returning client already has `booked`, a second booking adds nothing, so no second confirmation is sent. That's fine for the demo. When you re-test with the same number, remove the tag from the contact first (or delete the contact).

SMS uses LC Phone: you pay per message, and US numbers can't send until A2P 10DLC registration is approved. For the video, email and internal notifications show the flow just as well.

## 7. Agency handoff
Export the sub-account as a Snapshot. A new cleaning client is then: load the snapshot, edit `prompt.md` (name, service area) and `pricing.json`, fill a new `.env`, run `n8n/import.sh` and `setup-retell.mjs`, pass 5 test calls.
