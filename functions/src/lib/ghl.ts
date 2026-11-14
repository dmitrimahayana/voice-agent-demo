// GoHighLevel (LeadConnector) API v2 with a Private Integration token.
// Docs: https://highlevel.stoplight.io/docs/integrations
import type { Env } from "../env";
import { fetchJson } from "./util";

const BASE = "https://services.leadconnectorhq.com";

function headers(env: Env): HeadersInit {
  return {
    authorization: `Bearer ${env.GHL_API_TOKEN}`,
    version: "2021-07-28",
    "content-type": "application/json",
    accept: "application/json",
  };
}

export interface ContactInput {
  name: string;
  phone: string;
  address?: string;
  postalCode?: string;
  /** keyed by the custom field key, e.g. "contact.service_type" */
  customFields?: Record<string, string>;
  tags?: string[];
}

export async function upsertContact(env: Env, c: ContactInput): Promise<string> {
  const [firstName, ...rest] = c.name.split(/\s+/);
  const res = await fetchJson<{ contact: { id: string } }>(`${BASE}/contacts/upsert`, {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify({
      locationId: env.GHL_LOCATION_ID,
      firstName,
      lastName: rest.join(" ") || undefined,
      phone: c.phone,
      address1: c.address || undefined,
      postalCode: c.postalCode || undefined,
      source: "AI Voice Agent",
      tags: c.tags,
      // The upsert API silently ignores "contact.service_type"; it wants the bare key "service_type".
      customFields: Object.entries(c.customFields ?? {})
        .filter(([, v]) => v)
        .map(([key, field_value]) => ({ key: key.replace(/^contact\./, ""), field_value })),
    }),
  });
  return res.contact.id;
}

export async function addTags(env: Env, contactId: string, tags: string[]) {
  await fetchJson(`${BASE}/contacts/${contactId}/tags`, { method: "POST", headers: headers(env), body: JSON.stringify({ tags }) });
}

export async function addNote(env: Env, contactId: string, body: string) {
  await fetchJson(`${BASE}/contacts/${contactId}/notes`, { method: "POST", headers: headers(env), body: JSON.stringify({ body }) });
}

export async function freeSlots(env: Env, fromMs: number, days = 3): Promise<string[]> {
  const qs = new URLSearchParams({
    startDate: String(fromMs),
    endDate: String(fromMs + days * 86_400_000),
    timezone: env.TIMEZONE,
  });
  const res = await fetchJson<Record<string, { slots?: string[] }>>(
    `${BASE}/calendars/${env.GHL_CALENDAR_ID}/free-slots?${qs}`,
    { headers: headers(env) },
  );
  return Object.entries(res)
    .filter(([k]) => /^\d{4}-\d{2}-\d{2}$/.test(k))
    .flatMap(([, v]) => v.slots ?? []);
}

export async function bookAppointment(env: Env, contactId: string, startIso: string, title: string) {
  const res = await fetchJson<{ id: string }>(`${BASE}/calendars/events/appointments`, {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify({
      calendarId: env.GHL_CALENDAR_ID,
      locationId: env.GHL_LOCATION_ID,
      contactId,
      startTime: startIso,
      title,
      appointmentStatus: "confirmed",
      ignoreFreeSlotValidation: false,
    }),
  });
  return res.id;
}

/**
 * Creates the contact's opportunity in the pipeline, or moves the existing one to `stageId`.
 * GHL allows one opportunity per contact per pipeline, so a plain create fails once the lead
 * already exists (New lead -> Booked / Emergency). Runs in waitUntil, so it logs instead of throwing.
 * Defaults to the AI Voice Leads pipeline; pass `pipelineId` for another one (e.g. Memberships).
 */
export async function createOpportunity(
  env: Env, contactId: string, name: string, stageId: string,
  opts: { pipelineId?: string; monetaryValue?: number } = {},
) {
  const pipelineId = opts.pipelineId ?? env.GHL_PIPELINE_ID;
  if (!pipelineId || !stageId) return;
  try {
    await fetchJson(`${BASE}/opportunities/upsert`, {
      method: "POST",
      headers: headers(env),
      body: JSON.stringify({
        locationId: env.GHL_LOCATION_ID,
        pipelineId,
        pipelineStageId: stageId,
        contactId,
        name,
        status: "open",
        monetaryValue: opts.monetaryValue,
      }),
    });
  } catch (err) {
    console.error("GHL opportunity upsert failed", err);
  }
}

// ---------- reads (returning customers) ----------

/** "+1 512 555 0142", "5125550142" -> "+15125550142" (GHL stores E.164). */
export function toE164(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (!d) return "";
  if (raw.trim().startsWith("+")) return `+${d}`;
  return d.length === 10 ? `+1${d}` : `+${d}`;
}

export interface GhlContact { id: string; firstName?: string; lastName?: string; contactName?: string; email?: string; phone?: string; tags?: string[] }

/** The contact with this phone number in the sub-account, if any. */
export async function findContactByPhone(env: Env, phone: string): Promise<GhlContact | undefined> {
  const number = toE164(phone);
  if (!number) return undefined;
  const qs = new URLSearchParams({ locationId: env.GHL_LOCATION_ID, number });
  const res = await fetchJson<{ contact?: GhlContact | null }>(`${BASE}/contacts/search/duplicate?${qs}`, { headers: headers(env) });
  return res.contact ?? undefined;
}

export interface GhlOpportunity { id: string; name: string; status: string; pipelineId: string; pipelineStageId: string; monetaryValue?: number }

export async function openOpportunities(env: Env, contactId: string): Promise<GhlOpportunity[]> {
  const qs = new URLSearchParams({ location_id: env.GHL_LOCATION_ID, contact_id: contactId, status: "open" });
  const res = await fetchJson<{ opportunities?: GhlOpportunity[] }>(`${BASE}/opportunities/search?${qs}`, { headers: headers(env) });
  return res.opportunities ?? [];
}

/** stageId -> stage name, for all pipelines in the sub-account. */
export async function stageNames(env: Env): Promise<Record<string, string>> {
  const qs = new URLSearchParams({ locationId: env.GHL_LOCATION_ID });
  const res = await fetchJson<{ pipelines?: { name: string; stages?: { id: string; name: string }[] }[] }>(
    `${BASE}/opportunities/pipelines?${qs}`, { headers: headers(env) },
  );
  return Object.fromEntries((res.pipelines ?? []).flatMap((p) => (p.stages ?? []).map((st) => [st.id, st.name])));
}

export interface GhlAppointment { id: string; calendarId: string; title?: string; startTime: string; endTime?: string; appointmentStatus?: string }

/**
 * GHL returns appointment times either with an offset or as local wall time ("2026-11-17 09:00:00")
 * in the location's time zone. Normalise both to an ISO instant.
 */
export function ghlTimeToIso(t: string, timeZone: string): string {
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(t)) return new Date(t).toISOString();
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return new Date(t).toISOString();
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  // Offset of the zone at that moment: format the UTC guess in the zone and compare.
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(asUtc)).map((x) => [x.type, x.value]));
  const zoned = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return new Date(asUtc - (zoned - asUtc)).toISOString();
}

/** Upcoming, not-cancelled appointments for the contact, soonest first (times as ISO). */
export async function upcomingAppointments(env: Env, contactId: string): Promise<GhlAppointment[]> {
  const res = await fetchJson<{ events?: GhlAppointment[] }>(`${BASE}/contacts/${contactId}/appointments`, { headers: headers(env) });
  const now = Date.now();
  return (res.events ?? [])
    .map((e) => ({ ...e, startTime: ghlTimeToIso(e.startTime, env.TIMEZONE), endTime: e.endTime ? ghlTimeToIso(e.endTime, env.TIMEZONE) : undefined }))
    .filter((e) => !/cancel|noshow|invalid/i.test(e.appointmentStatus ?? "") && Date.parse(e.startTime) > now)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

/** Moves an appointment, keeping its length. */
export async function rescheduleAppointment(env: Env, appt: GhlAppointment, startIso: string) {
  const start = new Date(startIso);
  const lengthMs = appt.endTime ? Date.parse(appt.endTime) - Date.parse(appt.startTime) : 0;
  await fetchJson(`${BASE}/calendars/events/appointments/${appt.id}`, {
    method: "PUT",
    headers: headers(env),
    body: JSON.stringify({
      calendarId: appt.calendarId,
      startTime: start.toISOString(),
      endTime: lengthMs > 0 ? new Date(start.getTime() + lengthMs).toISOString() : undefined,
      appointmentStatus: "confirmed",
      ignoreFreeSlotValidation: false,
    }),
  });
}

export async function updateContactEmail(env: Env, contactId: string, email: string) {
  await fetchJson(`${BASE}/contacts/${contactId}`, { method: "PUT", headers: headers(env), body: JSON.stringify({ email }) });
}
