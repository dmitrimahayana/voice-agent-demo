// Demo 2 tools: Northside Plumbing & HVAC lead qualifier (GoHighLevel).
import type { Tool } from "../env";
import {
  addNote, addTags, bookAppointment, createOpportunity, findContactByPhone, freeSlots, openOpportunities,
  rescheduleAppointment, stageNames, toE164, upcomingAppointments, updateContactEmail, upsertContact,
} from "../lib/ghl";
import { logRow } from "../lib/sheets";
import { spoken, str } from "../lib/util";

export const upsertContactTool: Tool = async (args, tc) => {
  const name = str(args.name);
  const phone = str(args.phone) || tc.callerNumber || "";
  if (!name || !phone) return "Need the caller's name and mobile number first.";
  const contactId = await upsertContact(tc.env, {
    name,
    phone,
    address: str(args.address),
    postalCode: str(args.zip),
    tags: ["ai-voice-lead"],
    customFields: {
      "contact.service_type": str(args.service_type),
      "contact.property_type": str(args.property_type),
      "contact.issue_description": str(args.issue),
    },
  });
  tc.ctx.waitUntil(createOpportunity(tc.env, contactId, `${name} - ${str(args.service_type, "service call")}`, tc.env.GHL_STAGE_NEW));
  return JSON.stringify({ contact_id: contactId, instruction: "Use this contact_id in every later tool call." });
};

export const checkCalendar: Tool = async (_args, tc) => {
  const slots = (await freeSlots(tc.env, Date.now())).slice(0, 8);
  if (!slots.length) return "No windows free in the next 3 days. Offer a callback from the scheduler.";
  return JSON.stringify({
    instruction: "Offer two windows. Pass the chosen slot_iso to book_job.",
    slots: slots.map((iso) => ({ slot_iso: iso, say: spoken(iso, tc.env.TIMEZONE) })),
  });
};

export const bookJob: Tool = async (args, tc) => {
  const contactId = str(args.contact_id);
  const slot = str(args.slot_iso);
  if (!contactId || !slot) return "Missing contact_id or slot_iso. Call upsert_contact or check_calendar first.";
  await bookAppointment(tc.env, contactId, slot, `Service visit: ${str(args.summary, "AI-booked job")}`);
  tc.ctx.waitUntil(Promise.all([
    addTags(tc.env, contactId, ["booked"]),
    createOpportunity(tc.env, contactId, `Booked - ${str(args.summary)}`, tc.env.GHL_STAGE_BOOKED),
    logRow(tc.env, { demo: "home-services", platform: tc.platform, callId: tc.callId, caller: tc.callerNumber, event: "booked", details: `${slot} | ${str(args.summary)}` }),
  ]));
  return `Booked for ${spoken(slot, tc.env.TIMEZONE)}. A confirmation text is on its way.`;
};

export const addNoteAndTags: Tool = async (args, tc) => {
  const contactId = str(args.contact_id);
  if (!contactId) return "Missing contact_id. Call upsert_contact first.";
  const tags = Array.isArray(args.tags) ? args.tags.map((t) => str(t)).filter(Boolean) : [str(args.tags)].filter(Boolean);
  const note = str(args.note);
  await Promise.all([
    tags.length ? addTags(tc.env, contactId, tags) : Promise.resolve(),
    note ? addNote(tc.env, contactId, `AI call note: ${note}`) : Promise.resolve(),
  ]);
  if (tags.includes("emergency")) {
    tc.ctx.waitUntil(Promise.all([
      createOpportunity(tc.env, contactId, `EMERGENCY - ${note}`, tc.env.GHL_STAGE_EMERGENCY),
      logRow(tc.env, { demo: "home-services", platform: tc.platform, callId: tc.callId, caller: tc.callerNumber, event: "emergency", details: note }),
    ]));
    return "Emergency logged. The on-call technician is being texted now.";
  }
  return "Saved to the contact record.";
};

// ---------- Feature 1: job status for returning customers ----------

const spokenTime = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });

/** "Tuesday, November 17 at 9:00 AM until 11:00 AM" */
const spokenWindow = (start: string, end: string | undefined, timeZone: string) =>
  end ? `${spoken(start, timeZone)} until ${spokenTime(end, timeZone)}` : spoken(start, timeZone);

/** Caller ID first, else a number the caller said (web calls have no caller ID). */
const lookupPhone = (args: Record<string, unknown>, tc: { callerNumber?: string }) =>
  toE164(str(args.phone) || tc.callerNumber || "");

export const lookupCustomer: Tool = async (args, tc) => {
  const phone = lookupPhone(args, tc);
  if (!phone) return "This call has no caller ID. Ask for the mobile number on their account, read it back, then call lookup_customer again with phone.";
  const contact = await findContactByPhone(tc.env, phone);
  if (!contact) return JSON.stringify({ found: false, instruction: "New customer. Continue the normal flow: qualify the job, then call upsert_contact." });

  const [opps, appts, stages] = await Promise.all([
    openOpportunities(tc.env, contact.id),
    upcomingAppointments(tc.env, contact.id),
    stageNames(tc.env).catch(() => ({} as Record<string, string>)),
  ]);
  const name = contact.firstName || contact.contactName || "";
  const next = appts[0];
  tc.ctx.waitUntil(Promise.all([
    addTags(tc.env, contact.id, ["returning-customer"]).catch((e) => console.error("GHL tag failed", e)),
    logRow(tc.env, { demo: "home-services", platform: tc.platform, callId: tc.callId, caller: phone, event: "returning_customer", details: `${name} | next: ${next?.startTime ?? "none"}` }),
  ]));

  return JSON.stringify({
    found: true,
    contact_id: contact.id,
    first_name: name,
    is_plan_member: (contact.tags ?? []).includes("plan-member"),
    next_visit: next ? { appointment_id: next.id, say: spokenWindow(next.startTime, next.endTime, tc.env.TIMEZONE), job: next.title ?? "" } : null,
    open_jobs: opps.map((o) => ({ job: o.name, stage: stages[o.pipelineStageId] ?? "open" })),
    instruction: next
      ? "Greet them by first name and tell them their next visit. Ask if they want to keep it or change it. To change it: check_calendar, offer two windows, then reschedule_job with appointment_id. Use contact_id for every later tool; don't call upsert_contact."
      : "Greet them by first name. No visit is booked; tell them the stage of any open job, then help with what they need. Use contact_id for every later tool; don't call upsert_contact.",
  });
};

export const rescheduleJob: Tool = async (args, tc) => {
  const contactId = str(args.contact_id);
  const slot = str(args.slot_iso);
  if (!contactId || !slot) return "Missing contact_id or slot_iso. Call lookup_customer and check_calendar first.";
  const appts = await upcomingAppointments(tc.env, contactId);
  const appt = appts.find((a) => a.id === str(args.appointment_id)) ?? appts[0];
  if (!appt) return "No upcoming visit found to move. Offer to book a new one with book_job instead.";
  await rescheduleAppointment(tc.env, appt, slot);
  tc.ctx.waitUntil(Promise.all([
    addNote(tc.env, contactId, `AI call: visit moved from ${spoken(appt.startTime, tc.env.TIMEZONE)} to ${spoken(slot, tc.env.TIMEZONE)}.`),
    logRow(tc.env, { demo: "home-services", platform: tc.platform, callId: tc.callId, caller: tc.callerNumber, event: "rescheduled", details: `${appt.startTime} -> ${slot}` }),
  ]).catch((e) => console.error("GHL reschedule follow-up failed", e)));
  return `Moved the visit to ${spoken(slot, tc.env.TIMEZONE)}. The technician will call when on the way.`;
};

// ---------- Feature 2: maintenance plan upsell ----------

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const recordPlanInterest: Tool = async (args, tc) => {
  const contactId = str(args.contact_id);
  if (!contactId) return "Missing contact_id. Call upsert_contact or lookup_customer first.";
  const interested = args.interested === true || str(args.interested).toLowerCase() === "true";
  const email = str(args.email).toLowerCase().replace(/\s+/g, "");
  const price = Number(tc.env.PLAN_PRICE_PER_YEAR || 149);

  if (!interested) {
    await addTags(tc.env, contactId, ["plan-declined"]);
    return "Noted. Don't offer the plan again on this call.";
  }
  const validEmail = EMAIL_RE.test(email);
  // Save the email BEFORE adding the tag: the GHL workflow fires on the tag and emails the contact.
  if (validEmail) await updateContactEmail(tc.env, contactId, email);
  await addTags(tc.env, contactId, ["plan-interest"]);
  tc.ctx.waitUntil(Promise.all([
    createOpportunity(tc.env, contactId, `Comfort Club plan - $${price}/yr`, tc.env.GHL_MEMBERSHIP_STAGE_INTERESTED ?? "", {
      pipelineId: tc.env.GHL_MEMBERSHIP_PIPELINE_ID, monetaryValue: price,
    }),
    logRow(tc.env, { demo: "home-services", platform: tc.platform, callId: tc.callId, caller: tc.callerNumber, event: "plan_interest", details: validEmail ? email : "no email" }),
  ]));
  return validEmail
    ? `Saved. The sign-up link is being emailed to ${email}. Spell the address back once to confirm.`
    : "Saved as interested, but there is no valid email. Ask once for their email, then call record_plan_interest again with it; if they'd rather not, say the team will follow up.";
};

export const homeServicesTools = {
  lookup_customer: lookupCustomer,
  upsert_contact: upsertContactTool,
  check_calendar: checkCalendar,
  book_job: bookJob,
  reschedule_job: rescheduleJob,
  add_note_and_tags: addNoteAndTags,
  record_plan_interest: recordPlanInterest,
};

