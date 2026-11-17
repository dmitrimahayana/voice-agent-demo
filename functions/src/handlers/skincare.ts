// Demo 4 tools: Dewlane Skin Studio beauty receptionist (ElevenLabs, English + Spanish).
// Recommends treatments from the service menu, books on Cal.com, and emails the reservation.
//
// The guest's EMAIL is the booking key: phone callers and website visitors both have one, and it's
// where the reservation goes. Email delivery:
//   RESEND_API_KEY set -> the Worker sends a branded email (lib/email.ts); Cal.com gets a placeholder
//                         attendee email (guest-<hash>@BOOKING_EMAIL_DOMAIN) so it doesn't send a second one.
//   not set            -> Cal.com gets the real email and sends its own standard confirmation.
import catalog from "../../../demos/04-skincare-studio/services.json";
import type { Env, Tool, ToolContext } from "../env";
import { availableSlots, cancelBooking, createBooking, rescheduleBooking, upcomingBookings, type Booking } from "../lib/calcom";
import { emailEnabled, normalizeEmail, reservationEmail, sendEmail } from "../lib/email";
import { logRow } from "../lib/sheets";
import { spoken, str } from "../lib/util";

type Service = (typeof catalog.services)[number];
type Lang = "en" | "es";

const eventType = (env: Env) => env.CALCOM_SKIN_EVENT_TYPE_ID || env.CALCOM_EVENT_TYPE_ID;
const lang = (v: unknown): Lang => (str(v).toLowerCase().startsWith("es") ? "es" : "en");
const ref = (uid: string) => uid.slice(0, 6).toUpperCase();
const price = (s: Service) => (s.price ? `$${s.price}` : "free");

/** Date and time in the guest's language, for emails ("martes, 18 de noviembre, 10:30 a. m."). */
function when(iso: string, env: Env, l: Lang): string {
  if (l === "en") return spoken(iso, env.TIMEZONE);
  const d = new Date(iso);
  return `${d.toLocaleDateString("es-US", { weekday: "long", month: "long", day: "numeric", timeZone: env.TIMEZONE })}, ${d.toLocaleTimeString("es-US", { hour: "numeric", minute: "2-digit", timeZone: env.TIMEZONE })}`;
}

/** Stable placeholder attendee email for a real address, so bookings can be found again after a reschedule. */
async function guestKey(email: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email)));
  return `guest-${[...hash.slice(0, 5)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function findService(idOrName: string): Service | undefined {
  const q = idOrName.toLowerCase().trim();
  if (!q) return undefined;
  return catalog.services.find((s) => s.id === q) ?? catalog.services.find((s) => s.name.toLowerCase().includes(q) || q.includes(s.name.toLowerCase()));
}

/** Upcoming studio bookings made with this email (real attendee email, or its guest-<hash> placeholder). */
async function bookingsFor(env: Env, email: string): Promise<Booking[]> {
  const key = await guestKey(email);
  return (await upcomingBookings(env, eventType(env))).filter((b) =>
    b.metadata?.email === email ||
    (b.attendees ?? []).some((a) => {
      const e = (a.email ?? "").toLowerCase();
      return e === email || e.split("@")[0] === key;
    }));
}

const pick = (list: Booking[], bookingRef: string) =>
  (bookingRef && list.find((b) => b.uid.toUpperCase().startsWith(bookingRef.toUpperCase()))) || list[0];

const serviceOf = (b: Booking) => findService(b.metadata?.service ?? "") ;

// ---------- email texts (English / Spanish) ----------
const T = {
  en: {
    booked: "Your appointment is confirmed", moved: "Your appointment has moved", cancelled: "Your appointment is cancelled",
    hi: (n: string) => `Hi ${n}, thank you for booking with us. Here are your details.`,
    hiMoved: (n: string) => `Hi ${n}, your appointment has a new time.`,
    hiCancelled: (n: string) => `Hi ${n}, your appointment has been cancelled. We hope to see you another time.`,
    treatment: "Treatment", date: "Date and time", length: "Length", price: "Price", ref: "Reference", where: "Where", prep: "Before your visit",
    minutes: (m: number) => `${m} minutes`,
    footer: [
      "New guests: please arrive 10 minutes early. Changes or cancellations: 24 hours' notice, please.",
      "To change your booking, call us or talk to Elena on our website. This is a demo by Dmitri Mahayana; the studio is fictional.",
    ],
  },
  es: {
    booked: "Su cita está confirmada", moved: "Su cita cambió de horario", cancelled: "Su cita fue cancelada",
    hi: (n: string) => `Hola ${n}, gracias por reservar con nosotros. Estos son los detalles.`,
    hiMoved: (n: string) => `Hola ${n}, su cita tiene un nuevo horario.`,
    hiCancelled: (n: string) => `Hola ${n}, su cita fue cancelada. Esperamos verle pronto.`,
    treatment: "Tratamiento", date: "Fecha y hora", length: "Duración", price: "Precio", ref: "Referencia", where: "Dirección", prep: "Antes de su visita",
    minutes: (m: number) => `${m} minutos`,
    footer: [
      "Clientes nuevos: lleguen 10 minutos antes. Cambios o cancelaciones: con 24 horas de aviso, por favor.",
      "Para cambiar su cita, llámenos o hable con Elena en nuestro sitio web. Demo creada por Dmitri Mahayana; el estudio es ficticio.",
    ],
  },
};

type Kind = "booked" | "moved" | "cancelled";

/** Sends the reservation email when Resend is set up. Returns the sentence the agent should say about it. */
async function notify(tc: ToolContext, kind: Kind, to: string, name: string, l: Lang, startIso: string, service: Service | undefined, bookingRef: string) {
  if (!emailEnabled(tc.env)) {
    return kind === "booked" ? `Cal.com is emailing the confirmation to ${to}.` : `Cal.com is emailing the update to ${to}.`;
  }
  const t = T[l];
  const rows: [string, string][] = [
    [t.treatment, service?.name ?? "Dewlane appointment"],
    [t.date, when(startIso, tc.env, l)],
    ...(service && kind !== "cancelled" ? [[t.length, t.minutes(service.minutes)], [t.price, price(service)]] as [string, string][] : []),
    [t.ref, bookingRef],
    ...(kind !== "cancelled" ? [[t.where, catalog.studio.address]] as [string, string][] : []),
    ...(service?.prep && kind !== "cancelled" ? [[t.prep, service.prep]] as [string, string][] : []),
  ];
  const heading = kind === "booked" ? t.booked : kind === "moved" ? t.moved : t.cancelled;
  const intro = kind === "booked" ? t.hi(name) : kind === "moved" ? t.hiMoved(name) : t.hiCancelled(name);
  try {
    await sendEmail(tc.env, reservationEmail({ to, studio: catalog.studio.name, heading, intro, rows, footer: t.footer }));
    tc.ctx.waitUntil(logRow(tc.env, { demo: "skin", platform: tc.platform, callId: tc.callId, caller: tc.callerNumber, event: "email_sent", details: `${kind} -> ${to}` }));
    return `The ${kind === "booked" ? "confirmation" : "update"} email was sent to ${to}.`;
  } catch (err) {
    console.error("reservation email failed", err);
    tc.ctx.waitUntil(logRow(tc.env, { demo: "skin", platform: tc.platform, callId: tc.callId, caller: tc.callerNumber, event: "email_failed", details: `${kind} -> ${to}` }));
    return "The email could not be sent right now. Tell the guest the team will email the details shortly.";
  }
}

// ---------- tools ----------

export const recommendTreatment: Tool = async (args) => {
  const skinType = str(args.skin_type).toLowerCase();
  const concerns = str(args.concerns).toLowerCase();
  // Words in a service's not_suitable text that rule it out for this guest.
  const avoid = [
    args.pregnant === true || str(args.pregnant) === "true" ? "pregnancy" : "",
    args.isotretinoin === true || str(args.isotretinoin) === "true" ? "isotretinoin" : "",
    // Active acne (not "acne scars") rules out microneedling and dermaplaning.
    /breakout|pimple|active acne|\bacne\b(?!\s*scar)/.test(concerns) ? "breakout" : "",
  ].filter(Boolean);

  const scored = catalog.services
    .filter((s) => s.concerns.length && s.id !== "led_addon")
    .filter((s) => !skinType || s.skin_types.includes(skinType))
    .filter((s) => !avoid.some((a) => s.not_suitable.toLowerCase().includes(a)))
    .map((s) => ({ s, score: s.concerns.filter((c) => concerns.includes(c) || c.split(" ").some((w) => w.length > 4 && concerns.includes(w))).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.price - b.s.price)
    .slice(0, 2);

  const led = catalog.services.find((s) => s.id === "led_addon")!;
  const ledFits = led.concerns.some((c) => concerns.includes(c));
  const consultation = catalog.services.find((s) => s.id === "consultation")!;
  if (!scored.length) {
    return JSON.stringify({
      instruction: "No treatment clearly matches. Recommend the free skin consultation and offer to book it.",
      recommendation: { service_id: consultation.id, name: consultation.name, minutes: consultation.minutes, price: "free", why: consultation.description },
    });
  }
  return JSON.stringify({
    instruction: "Recommend the first option in one or two sentences (why it fits, length, price). Mention the second only if they ask for options. Say who it is not suitable for when not_suitable is set. Offer to book.",
    recommendations: scored.map(({ s }) => ({ service_id: s.id, name: s.name, minutes: s.minutes, price: price(s), why: s.description, not_suitable: s.not_suitable || undefined })),
    add_on: ledFits ? { service_id: led.id, name: led.name, price: price(led), why: led.description } : undefined,
    also: "If they're unsure, the free 30-minute skin consultation is always an option.",
  });
};

export const checkAvailability: Tool = async (args, tc) => {
  const slots = (await availableSlots(tc.env, str(args.date), eventType(tc.env))).slice(0, 6);
  if (!slots.length) return "No open times on that day or the next. The studio is closed Sunday and Monday. Offer another day.";
  return JSON.stringify({
    instruction: "Offer at most two of these. Pass the chosen slot_iso to book_appointment.",
    slots: slots.map((iso) => ({ slot_iso: iso, say: spoken(iso, tc.env.TIMEZONE) })),
  });
};

export const bookAppointment: Tool = async (args, tc) => {
  const name = str(args.name);
  const slot = str(args.slot_iso);
  const email = normalizeEmail(str(args.email));
  const service = findService(str(args.service_id) || str(args.service));
  const l = lang(args.language);
  if (!name || !slot) return "Missing name or slot_iso. Ask for the missing detail, then try again.";
  if (!email) return "Missing or invalid email. Ask the guest to spell their email address, read it back letter by letter, then try again.";
  if (!service) return `Unknown service. Use a service_id from recommend_treatment or one of: ${catalog.services.map((s) => s.id).join(", ")}.`;

  const phone = str(args.phone) || tc.callerNumber || "";
  const attendeeEmail = emailEnabled(tc.env) ? `${await guestKey(email)}@${tc.env.BOOKING_EMAIL_DOMAIN}` : email;
  const notes = [service.name, str(args.notes)].filter(Boolean).join(" | ");
  const booking = await createBooking(tc.env, slot, { name, phone, email: attendeeEmail }, notes,
    { demo: "skin", email, service: service.id, language: l }, eventType(tc.env));

  tc.ctx.waitUntil(logRow(tc.env, {
    demo: "skin", platform: tc.platform, callId: tc.callId, caller: phone,
    event: "booked", details: `${name} | ${email} | ${service.name} | ${booking.start}`,
  }));
  const emailNote = await notify(tc, "booked", email, name, l, booking.start, service, ref(booking.uid));
  return `Booked ${service.name} for ${spoken(booking.start, tc.env.TIMEZONE)}. Reference ${ref(booking.uid)}. ${emailNote} Remind them: ${service.prep}`;
};

export const findAppointment: Tool = async (args, tc) => {
  const email = normalizeEmail(str(args.email));
  if (!email) return "Ask for the email address they booked with, read it back, then try again.";
  const list = await bookingsFor(tc.env, email);
  if (!list.length) return `No upcoming appointment found for ${email}. Read the email back to check the spelling, or offer to book a new one.`;
  return JSON.stringify({
    instruction: "Tell the guest their appointment(s). Pass booking_ref to reschedule_appointment or cancel_appointment if they want a change.",
    appointments: list.slice(0, 3).map((b) => ({
      booking_ref: ref(b.uid), say: spoken(b.start, tc.env.TIMEZONE), treatment: serviceOf(b)?.name ?? "appointment",
    })),
  });
};

export const rescheduleAppointment: Tool = async (args, tc) => {
  const email = normalizeEmail(str(args.email));
  const slot = str(args.slot_iso);
  if (!email) return "Ask for the email address they booked with, read it back, then try again.";
  if (!slot) return "Missing slot_iso. Call check_availability for the new day first.";
  const target = pick(await bookingsFor(tc.env, email), str(args.booking_ref));
  if (!target) return `No upcoming appointment found for ${email}. Check the spelling with the guest.`;
  const moved = await rescheduleBooking(tc.env, target.uid, slot, str(args.reason, "Rescheduled by the voice receptionist"));
  const name = target.attendees?.[0]?.name ?? "";
  tc.ctx.waitUntil(logRow(tc.env, {
    demo: "skin", platform: tc.platform, callId: tc.callId, caller: tc.callerNumber,
    event: "rescheduled", details: `${email} | ${target.start} -> ${moved.start}`,
  }));
  const emailNote = await notify(tc, "moved", email, name, lang(args.language ?? target.metadata?.language), moved.start, serviceOf(target), ref(moved.uid));
  return `Moved from ${spoken(target.start, tc.env.TIMEZONE)} to ${spoken(moved.start, tc.env.TIMEZONE)}. New reference ${ref(moved.uid)}. ${emailNote}`;
};

export const cancelAppointment: Tool = async (args, tc) => {
  const email = normalizeEmail(str(args.email));
  if (!email) return "Ask for the email address they booked with, read it back, then try again.";
  const target = pick(await bookingsFor(tc.env, email), str(args.booking_ref));
  if (!target) return `No upcoming appointment found for ${email}. Check the spelling with the guest.`;
  await cancelBooking(tc.env, target.uid, str(args.reason, "Cancelled by the voice receptionist"));
  tc.ctx.waitUntil(logRow(tc.env, {
    demo: "skin", platform: tc.platform, callId: tc.callId, caller: tc.callerNumber, event: "cancelled", details: `${email} | ${target.start}`,
  }));
  const emailNote = await notify(tc, "cancelled", email, target.attendees?.[0]?.name ?? "", lang(args.language ?? target.metadata?.language), target.start, serviceOf(target), ref(target.uid));
  const late = new Date(target.start).getTime() - Date.now() < 24 * 3_600_000;
  return `Cancelled the appointment on ${spoken(target.start, tc.env.TIMEZONE)}. ${emailNote}${late ? " This was less than 24 hours' notice: mention kindly that a late-cancellation fee may apply." : ""} Offer to book a new time.`;
};

export const flagCall: Tool = async (args, tc) => {
  const type = str(args.type, "callback"); // "reaction" | "complaint" | "callback"
  tc.ctx.waitUntil(logRow(tc.env, {
    demo: "skin", platform: tc.platform, callId: tc.callId, caller: tc.callerNumber,
    event: type === "reaction" ? "urgent_reaction" : type, details: `${str(args.name)} | ${str(args.email)} | ${str(args.note)}`,
  }));
  return type === "reaction"
    ? "Flagged as URGENT for the lead esthetician. Tell the guest someone will call them today, and that for swelling, blistering or trouble breathing they should seek medical care now."
    : "Saved. Tell the guest the team will get back to them within one business day.";
};

export const skincareTools = {
  recommend_treatment: recommendTreatment,
  check_availability: checkAvailability,
  book_appointment: bookAppointment,
  find_appointment: findAppointment,
  reschedule_appointment: rescheduleAppointment,
  cancel_appointment: cancelAppointment,
  flag_call: flagCall,
};
