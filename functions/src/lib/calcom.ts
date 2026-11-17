// Cal.com API v2. Docs: https://cal.com/docs/api-reference/v2
import type { Env } from "../env";
import { dayWindow, fetchJson } from "./util";

const BASE = "https://api.cal.com/v2";

function headers(env: Env, version: string): HeadersInit {
  return {
    authorization: `Bearer ${env.CALCOM_API_KEY}`,
    "cal-api-version": version,
    "content-type": "application/json",
  };
}

/** Free slot start times (ISO) on the given day and the next one. eventTypeId defaults to Demo 1's. */
export async function availableSlots(env: Env, date: string, eventTypeId = env.CALCOM_EVENT_TYPE_ID): Promise<string[]> {
  const { start, end } = dayWindow(date);
  const qs = new URLSearchParams({ eventTypeId, start, end, timeZone: env.TIMEZONE });
  const res = await fetchJson<{ data: Record<string, { start: string }[]> }>(`${BASE}/slots?${qs}`, {
    headers: headers(env, "2024-09-04"),
  });
  return Object.values(res.data ?? {}).flat().map((s) => s.start).filter((s) => new Date(s) > new Date());
}

export interface Attendee { name: string; phone: string; email: string }

/** Extra keys saved on the booking so it can be found again by phone or member ID. */
export type BookingMeta = Record<string, string>;

export async function createBooking(
  env: Env, startIso: string, a: Attendee, notes: string, meta: BookingMeta = {}, eventTypeId = env.CALCOM_EVENT_TYPE_ID,
) {
  const res = await fetchJson<{ data: { uid: string; start: string } }>(`${BASE}/bookings`, {
    method: "POST",
    headers: headers(env, "2024-08-13"),
    body: JSON.stringify({
      start: new Date(startIso).toISOString(),
      eventTypeId: Number(eventTypeId),
      attendee: { name: a.name, email: a.email, timeZone: env.TIMEZONE, phoneNumber: a.phone || undefined },
      bookingFieldsResponses: { notes },
      metadata: { source: "voice-agent-demo", ...meta },
    }),
  });
  return res.data;
}

export interface Booking {
  uid: string;
  start: string;
  status: string;
  title?: string;
  metadata?: Record<string, string>;
  attendees?: { name?: string; email?: string; phoneNumber?: string }[];
  bookingFieldsResponses?: Record<string, unknown>;
}

/** All upcoming bookings on an event type (default: Demo 1's clinic), soonest first. */
export async function upcomingBookings(env: Env, eventTypeId = env.CALCOM_EVENT_TYPE_ID): Promise<Booking[]> {
  const qs = new URLSearchParams({ eventTypeId, status: "upcoming", sortStart: "asc", take: "100" });
  const res = await fetchJson<{ data: Booking[] }>(`${BASE}/bookings?${qs}`, { headers: headers(env, "2024-08-13") });
  return res.data ?? [];
}

/** Moves a booking to a new start time. Cal.com returns the new booking (it has a new uid). */
export async function rescheduleBooking(env: Env, uid: string, startIso: string, reason: string) {
  const res = await fetchJson<{ data: { uid: string; start: string } }>(`${BASE}/bookings/${uid}/reschedule`, {
    method: "POST",
    headers: headers(env, "2024-08-13"),
    body: JSON.stringify({ start: new Date(startIso).toISOString(), reschedulingReason: reason }),
  });
  return res.data;
}

export async function cancelBooking(env: Env, uid: string, reason: string) {
  await fetchJson(`${BASE}/bookings/${uid}/cancel`, {
    method: "POST",
    headers: headers(env, "2024-08-13"),
    body: JSON.stringify({ cancellationReason: reason }),
  });
}
