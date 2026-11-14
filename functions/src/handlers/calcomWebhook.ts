// Cal.com webhook -> Supabase bookings table, so changes made in Cal.com itself
// (owner books, moves or cancels in the dashboard, or the patient uses the email link) stay in sync.
//
// Cal.com > Settings > Developer > Webhooks > New:
//   Subscriber URL: https://<worker>/calcom/webhook
//   Events: Booking Created, Booking Rescheduled, Booking Cancelled
//   Secret: same value as CALCOM_WEBHOOK_SECRET
import type { Env } from "../env";
import { memberByPhone, supabaseEnabled, updateBooking, upsertBooking, type BookingRow } from "../lib/supabase";
import { digits, json } from "../lib/util";

interface CalPayload {
  uid?: string;
  eventTypeId?: number;
  startTime?: string;
  endTime?: string;
  rescheduleUid?: string;
  fromReschedule?: string;
  metadata?: Record<string, string>;
  attendees?: { name?: string; email?: string; phoneNumber?: string }[];
  responses?: Record<string, { value?: unknown } | undefined>;
}

const phoneKey = (p: string) => digits(p).slice(-10);

async function validSignature(secret: string, raw: string, sig: string | null): Promise<boolean> {
  if (!sig) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === sig.trim().toLowerCase();
}

export async function handleCalcomWebhook(req: Request, env: Env): Promise<Response> {
  const raw = await req.text();
  if (env.CALCOM_WEBHOOK_SECRET && !(await validSignature(env.CALCOM_WEBHOOK_SECRET, raw, req.headers.get("x-cal-signature-256")))) {
    return json({ error: "bad signature" }, 401);
  }
  if (!supabaseEnabled(env)) return json({ ok: true, skipped: "supabase not configured" });

  const { triggerEvent, payload: p = {} } = JSON.parse(raw || "{}") as { triggerEvent?: string; payload?: CalPayload };
  if (!p.uid) return json({ ok: true, skipped: triggerEvent ?? "no uid" }); // PING test etc.
  if (p.eventTypeId && String(p.eventTypeId) !== env.CALCOM_EVENT_TYPE_ID) return json({ ok: true, skipped: "other event type" });
  // Demo 3 shares the event type; its bookings are tagged by the agent but not as dental.
  const meta = p.metadata ?? {};
  if (meta.source === "voice-agent-demo" && meta.demo !== "dental") return json({ ok: true, skipped: "not dental" });

  const attendee = p.attendees?.[0] ?? {};
  const rawPhone = meta.phone || attendee.phoneNumber || String(p.responses?.attendeePhoneNumber?.value ?? "") ||
    (attendee.email ?? "").split("@")[0];
  const phone = phoneKey(rawPhone) || null;
  const memberId = meta.member_id || (phone ? (await memberByPhone(env, phone))?.member_id : undefined) || null;

  const row: BookingRow = {
    cal_uid: p.uid,
    member_id: memberId,
    phone,
    patient_name: attendee.name ?? null,
    start_at: p.startTime ?? new Date().toISOString(),
    end_at: p.endTime ?? null,
    status: "booked",
    source: meta.source === "voice-agent-demo" ? "voice-agent" : "calcom",
  };

  switch (triggerEvent) {
    case "BOOKING_CREATED":
      await upsertBooking(env, row);
      break;
    case "BOOKING_RESCHEDULED": {
      const oldUid = p.rescheduleUid ?? p.fromReschedule;
      const moved = oldUid && (await updateBooking(env, oldUid, { ...row, previous_cal_uid: oldUid }));
      if (!moved) await upsertBooking(env, { ...row, previous_cal_uid: oldUid ?? null });
      break;
    }
    case "BOOKING_CANCELLED":
      if (!(await updateBooking(env, p.uid, { status: "cancelled" }))) await upsertBooking(env, { ...row, status: "cancelled" });
      break;
    default:
      return json({ ok: true, skipped: triggerEvent });
  }
  return json({ ok: true });
}
