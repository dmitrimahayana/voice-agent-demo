// Demo 1 tools: Bright Smile Dental receptionist (Cal.com calendar + Supabase member and booking lists).
import type { Tool, ToolArgs, ToolContext } from "../env";
import { availableSlots, cancelBooking, createBooking, rescheduleBooking, upcomingBookings } from "../lib/calcom";
import { logRow } from "../lib/sheets";
import {
  getOrCreateMember, memberById, memberByPhone, supabaseEnabled, updateBooking, upcomingFor, upsertBooking,
  type Member,
} from "../lib/supabase";
import { digits, spoken, str } from "../lib/util";

/**
 * Phone callers rarely give an email, so the booking is keyed by phone number.
 * Cal.com rejects domains that can't receive mail (e.g. example.com), so this must be a real domain.
 */
const emailFor = (phone: string, tc: ToolContext) =>
  `caller-${digits(phone) || "unknown"}@${tc.env.BOOKING_EMAIL_DOMAIN}`;

function callerPhone(args: ToolArgs, tc: ToolContext): string {
  return str(args.phone) || tc.callerNumber || "";
}

/** Last 10 digits, so "+1 (512) 555-0142" and "5125550142" match. Same key as members.phone. */
export const phoneKey = (phone: string) => digits(phone).slice(-10);
/** Member IDs are 6 digits; callers may say them with spaces or dashes. */
const memberKey = (id: string) => digits(id);
/** "482715" -> "4 8 2 7 1 5", so the agent reads it digit by digit. */
const sayDigits = (id: string) => id.split("").join(" ");

/** Runs a Supabase write after the reply, so a database hiccup never breaks the call. */
function background(tc: ToolContext, label: string, work: () => Promise<unknown>) {
  if (!supabaseEnabled(tc.env)) return;
  tc.ctx.waitUntil(work().catch((err) => console.error(`supabase ${label} failed`, err)));
}

interface Appt { uid: string; start: string; name: string }

/**
 * Who is calling. A member ID (if given) wins and works from any phone, because 1 member ID = 1 phone.
 * Returns error text for the agent when a given member ID doesn't exist.
 */
async function resolveMember(args: ToolArgs, tc: ToolContext): Promise<{ member?: Member; error?: string }> {
  if (!supabaseEnabled(tc.env)) return {};
  const id = memberKey(str(args.member_id));
  if (id) {
    const member = await memberById(tc.env, id);
    return member ? { member } : { error: `Member ID ${sayDigits(id)} was not found. Read it back to confirm, or use their phone number instead.` };
  }
  const phone = phoneKey(callerPhone(args, tc));
  return { member: phone ? await memberByPhone(tc.env, phone) : undefined };
}

/** Web/browser calls have no caller ID, so the agent must ask for a number first. */
const NO_CALLER_ID_LOOKUP =
  "This call has no caller ID. Ask for their 6-digit member number or the phone number they booked with, then call this tool again with member_id or phone.";
const NO_CALLER_ID_BOOK =
  "This call has no caller ID. Ask for their mobile number (or member number if they have one), read it back, then call book_appointment again with phone or member_id. Do not book without it.";

/**
 * Upcoming bookings, soonest first, matched by member ID OR phone number.
 * Everything known is combined: the member ID the caller gave, the phone they said, caller ID,
 * and each member's own phone / each phone's member. A booking matching any of them is returned.
 * Supabase first; Cal.com scan as fallback (bookings made before Supabase).
 */
async function findBookings(args: ToolArgs, tc: ToolContext): Promise<{ list: Appt[]; error?: string }> {
  // A member number is exactly 6 digits; anything longer is a phone number the model put in the wrong field.
  let givenId = memberKey(str(args.member_id));
  const phones = new Set([phoneKey(str(args.phone)), phoneKey(tc.callerNumber ?? "")].filter(Boolean));
  if (givenId && givenId.length !== 6) { phones.add(phoneKey(givenId)); givenId = ""; }
  if (!givenId && !phones.size) return { list: [], error: NO_CALLER_ID_LOOKUP };

  const memberIds = new Set<string>();
  let badId = false;
  if (supabaseEnabled(tc.env)) {
    if (givenId) {
      const m = await memberById(tc.env, givenId);
      if (m) { memberIds.add(m.member_id); phones.add(m.phone); } else badId = true;
    }
    for (const p of [...phones]) {
      const m = await memberByPhone(tc.env, p);
      if (m) memberIds.add(m.member_id);
    }
    const rows = await upcomingFor(tc.env, { memberIds: [...memberIds], phones: [...phones] });
    if (rows.length) return { list: rows.map((r) => ({ uid: r.cal_uid, start: r.start_at, name: r.patient_name ?? "" })) };
  }

  const list = (await upcomingBookings(tc.env))
    .filter((b) =>
      (givenId && memberKey(b.metadata?.member_id ?? "") === givenId) ||
      phones.has(phoneKey(b.metadata?.phone ?? "")) ||
      (b.attendees ?? []).some((a) => phones.has(phoneKey(a.phoneNumber ?? "")) || phones.has(phoneKey((a.email ?? "").split("@")[0]))),
    )
    .map((b) => ({ uid: b.uid, start: b.start, name: b.attendees?.[0]?.name ?? "" }))
    .sort((a, b) => a.start.localeCompare(b.start));
  if (!list.length && badId) {
    return { list, error: `Member ID ${sayDigits(givenId)} was not found and nothing matched the phone number. Read the ID back to confirm, or ask for the phone number they booked with.` };
  }
  return { list };
}

const notFound = (args: ToolArgs) =>
  str(args.member_id)
    ? "No upcoming appointment found for that member ID. Read the ID back to confirm it, or ask for the phone number they booked with."
    : "No upcoming appointment found for this phone number. Ask for their member ID or the phone number they booked with.";

/** Picks the booking the caller means: the one with the given booking_ref, else the soonest. */
function pick(list: Appt[], ref: string): Appt | undefined {
  const r = ref.toUpperCase();
  return (r && list.find((b) => b.uid.toUpperCase().startsWith(r))) || list[0];
}

export const checkAvailability: Tool = async (args, tc) => {
  const slots = (await availableSlots(tc.env, str(args.date))).slice(0, 6);
  if (!slots.length) return "No open slots on that day or the next. Offer to check another day.";
  return JSON.stringify({
    instruction: "Offer at most two of these. Pass the chosen slot_iso to book_appointment.",
    slots: slots.map((iso) => ({ slot_iso: iso, say: spoken(iso, tc.env.TIMEZONE) })),
  });
};

export const bookAppointment: Tool = async (args, tc) => {
  const name = str(args.name);
  const slot = str(args.slot_iso);
  if (!name || !slot) return "Missing name or slot_iso. Ask for the missing detail, then try again.";
  if (!str(args.member_id) && !phoneKey(callerPhone(args, tc))) return NO_CALLER_ID_BOOK;

  // Find the member, or create one for a new phone number.
  let memberId = "";
  let isNew = false;
  let phone = callerPhone(args, tc);
  if (supabaseEnabled(tc.env)) {
    try {
      if (str(args.member_id)) {
        const { member, error } = await resolveMember(args, tc);
        if (error || !member) return error ?? notFound(args);
        memberId = member.member_id;
        phone = phone || member.phone;
      } else if (phoneKey(phone)) {
        const m = await getOrCreateMember(tc.env, phoneKey(phone), name);
        memberId = m.member_id;
        isNew = m.is_new;
      }
    } catch (err) {
      console.error("supabase member lookup failed; booking without member", err);
    }
  }

  const meta: Record<string, string> = { demo: "dental", phone: phoneKey(phone) };
  if (memberId) meta.member_id = memberId;
  const booking = await createBooking(tc.env, slot, { name, phone, email: emailFor(phone, tc) }, str(args.reason), meta);

  background(tc, "insert booking", () => upsertBooking(tc.env, {
    cal_uid: booking.uid, member_id: memberId || null, phone: phoneKey(phone), patient_name: name,
    reason: str(args.reason), start_at: booking.start, status: "booked", source: "voice-agent", call_id: tc.callId,
  }));
  tc.ctx.waitUntil(
    logRow(tc.env, {
      demo: "dental", platform: tc.platform, callId: tc.callId, caller: phone,
      event: "booked", details: `${name} | ${memberId} | ${str(args.reason)} | ${booking.start}`,
    }),
  );

  const when = `Booked for ${spoken(booking.start, tc.env.TIMEZONE)}. Confirmation reference ${booking.uid.slice(0, 6).toUpperCase()}.`;
  if (isNew) return `${when} NEW PATIENT: their member number is ${sayDigits(memberId)}. Read it slowly digit by digit and ask them to keep it for next time.`;
  if (memberId) return `${when} Existing patient, member number ${sayDigits(memberId)}.`;
  return when;
};

/** Plain booking with no member list, for Demo 3 (speed-to-lead), which shares the Cal.com event type. */
export const bookMeeting: Tool = async (args, tc) => {
  const name = str(args.name);
  const phone = callerPhone(args, tc);
  const slot = str(args.slot_iso);
  if (!name || !slot) return "Missing name or slot_iso. Ask for the missing detail, then try again.";
  const booking = await createBooking(tc.env, slot, { name, phone, email: emailFor(phone, tc) }, str(args.reason));
  tc.ctx.waitUntil(
    logRow(tc.env, {
      demo: "dental", platform: tc.platform, callId: tc.callId, caller: phone,
      event: "booked", details: `${name} | ${str(args.reason)} | ${booking.start}`,
    }),
  );
  return `Booked for ${spoken(booking.start, tc.env.TIMEZONE)}. Confirmation reference ${booking.uid.slice(0, 6).toUpperCase()}.`;
};

export const findAppointment: Tool = async (args, tc) => {
  const { list, error } = await findBookings(args, tc);
  if (error) return error;
  if (!list.length) return notFound(args);
  return JSON.stringify({
    instruction: "Tell the caller their appointment time(s). Pass booking_ref to reschedule_appointment or cancel_appointment if they want a change.",
    appointments: list.slice(0, 3).map((b) => ({
      booking_ref: b.uid.slice(0, 6).toUpperCase(),
      say: spoken(b.start, tc.env.TIMEZONE),
      patient: b.name,
    })),
  });
};

export const rescheduleAppointment: Tool = async (args, tc) => {
  const slot = str(args.slot_iso);
  if (!slot) return "Missing slot_iso. Call check_availability for the new day first, then try again.";
  const { list, error } = await findBookings(args, tc);
  if (error) return error;
  const target = pick(list, str(args.booking_ref));
  if (!target) return notFound(args);
  const moved = await rescheduleBooking(tc.env, target.uid, slot, str(args.reason, "Rescheduled by phone"));

  // Cal.com gives the moved booking a new uid; keep the same Supabase row and point it at the new uid.
  background(tc, "reschedule booking", async () => {
    const patch = { cal_uid: moved.uid, previous_cal_uid: target.uid, start_at: moved.start, status: "booked" as const, call_id: tc.callId };
    if (!(await updateBooking(tc.env, target.uid, patch))) {
      const { member } = await resolveMember(args, tc);
      await upsertBooking(tc.env, {
        ...patch, member_id: member?.member_id ?? null, phone: phoneKey(member?.phone ?? callerPhone(args, tc)),
        patient_name: target.name, source: "voice-agent",
      });
    }
  });
  tc.ctx.waitUntil(
    logRow(tc.env, {
      demo: "dental", platform: tc.platform, callId: tc.callId, caller: callerPhone(args, tc),
      event: "rescheduled", details: `${target.start} -> ${moved.start}`,
    }),
  );
  return `Moved from ${spoken(target.start, tc.env.TIMEZONE)} to ${spoken(moved.start, tc.env.TIMEZONE)}. New reference ${moved.uid.slice(0, 6).toUpperCase()}.`;
};

export const cancelAppointment: Tool = async (args, tc) => {
  const phone = callerPhone(args, tc);
  const { list, error } = await findBookings(args, tc);
  if (error) return error;
  const next = pick(list, str(args.booking_ref));
  if (!next) return notFound(args);
  await cancelBooking(tc.env, next.uid, str(args.reason, "Cancelled by phone"));
  background(tc, "cancel booking", () => updateBooking(tc.env, next.uid, { status: "cancelled", call_id: tc.callId }));
  tc.ctx.waitUntil(
    logRow(tc.env, { demo: "dental", platform: tc.platform, callId: tc.callId, caller: phone, event: "cancelled", details: next.start }),
  );
  return `Cancelled the appointment on ${spoken(next.start, tc.env.TIMEZONE)}. If they want to reschedule, call check_availability next.`;
};

export const flagCall: Tool = async (args, tc) => {
  const type = str(args.type, "callback"); // "urgent" | "callback"
  tc.ctx.waitUntil(
    logRow(tc.env, {
      demo: "dental", platform: tc.platform, callId: tc.callId, caller: callerPhone(args, tc),
      event: type, details: `${str(args.name)} | ${str(args.note)}`,
    }),
  );
  return type === "urgent"
    ? "Flagged as URGENT. The team has been alerted."
    : "Callback request saved. Tell the caller the team will call back within one business day.";
};

export const dentalTools = {
  check_availability: checkAvailability,
  book_appointment: bookAppointment,
  find_appointment: findAppointment,
  reschedule_appointment: rescheduleAppointment,
  cancel_appointment: cancelAppointment,
  flag_call: flagCall,
};
