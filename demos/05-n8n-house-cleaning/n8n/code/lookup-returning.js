// lookup_customer, found: greet by name, next cleaning, open jobs.
const cfg = cfgOf();
const contact = $("GHL: find contact by phone").first().json.contact;
const opps = $("GHL: open jobs").first().json.opportunities ?? [];
const events = $("GHL: contact appointments").first().json.events ?? [];
const pipelines = $input.first().json.pipelines ?? []; // empty if the stage-name lookup failed
const stages = Object.fromEntries(pipelines.flatMap((p) => (p.stages ?? []).map((s) => [s.id, s.name])));

const next = upcoming(events, cfg.timezone)[0];
const name = contact.firstName || contact.contactName || "";
const when = next ? `${spoken(next.startTime, cfg.timezone)}${next.endTime ? ` until ${spokenTime(next.endTime, cfg.timezone)}` : ""}` : "";

const result = JSON.stringify({
  found: true,
  contact_id: contact.id,
  first_name: name,
  is_recurring_client: (contact.tags ?? []).includes("recurring-client"),
  next_cleaning: next ? { appointment_id: next.id, say: when, title: next.title ?? "", hours: next.endTime ? Math.round((Date.parse(next.endTime) - Date.parse(next.startTime)) / 1_800_000) / 2 : 3 } : null,
  open_jobs: opps.map((o) => ({ job: o.name, stage: stages[o.pipelineStageId] ?? "open" })),
  instruction: next
    ? "Greet them by first name and tell them their next cleaning. Ask if it still works. To change it: check_calendar with hours = next_cleaning.hours, offer two times, then reschedule_cleaning with appointment_id. Use contact_id for every later tool; don't call upsert_contact."
    : "Greet them by first name. No cleaning is booked; help with what they need (get_quote, then book). Use contact_id for every later tool; don't call upsert_contact.",
});

return [{ json: { contact_id: contact.id, result, row: sheetRow("returning_customer", `${name} | next: ${next?.startTime ?? "none"}`) } }];
