// Supabase via its REST API (PostgREST), no SDK needed. Tables: supabase/schema.sql.
import type { Env } from "../env";
import { fetchJson } from "./util";

export interface Member { member_id: string; phone: string; name: string | null }
export interface BookingRow {
  cal_uid: string;
  previous_cal_uid?: string | null;
  member_id?: string | null;
  phone?: string | null;
  patient_name?: string | null;
  reason?: string | null;
  start_at: string;
  end_at?: string | null;
  status?: "booked" | "cancelled";
  source?: "voice-agent" | "calcom";
  call_id?: string | null;
}

export const supabaseEnabled = (env: Env) => Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);

function headers(env: Env, prefer?: string): HeadersInit {
  const key = env.SUPABASE_SERVICE_KEY;
  const h: Record<string, string> = { apikey: key, "content-type": "application/json" };
  // Legacy service_role keys are JWTs and go in Authorization too; new sb_secret_ keys only need apikey.
  if (key.startsWith("eyJ")) h.authorization = `Bearer ${key}`;
  if (prefer) h.prefer = prefer;
  return h;
}

const rest = (env: Env, path: string) => `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`;

/** The member for this phone (last 10 digits), created with a new 6-digit ID if they're new. */
export async function getOrCreateMember(env: Env, phone: string, name: string) {
  const rows = await fetchJson<{ member_id: string; is_new: boolean }[]>(rest(env, "rpc/get_or_create_member"), {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify({ p_phone: phone, p_name: name }),
  });
  return rows[0];
}

export async function memberById(env: Env, memberId: string): Promise<Member | undefined> {
  const qs = new URLSearchParams({ member_id: `eq.${memberId}`, select: "member_id,phone,name" });
  return (await fetchJson<Member[]>(rest(env, `members?${qs}`), { headers: headers(env) }))[0];
}

export async function memberByPhone(env: Env, phone: string): Promise<Member | undefined> {
  const qs = new URLSearchParams({ phone: `eq.${phone}`, select: "member_id,phone,name" });
  return (await fetchJson<Member[]>(rest(env, `members?${qs}`), { headers: headers(env) }))[0];
}

/** Upcoming, not-cancelled bookings matching any of the member IDs or phones (last 10 digits), soonest first. */
export async function upcomingFor(env: Env, who: { memberIds: string[]; phones: string[] }): Promise<BookingRow[]> {
  // Values are digits only (normalised by the caller), so they're safe inside the PostgREST filter.
  const ids = who.memberIds.filter((v) => /^\d+$/.test(v));
  const phones = who.phones.filter((v) => /^\d+$/.test(v));
  // Phones match by suffix, so rows typed by hand ("0512 555 0142", "+1 512-555-0142") still match "5125550142".
  const or = [
    ids.length && `member_id.in.(${ids.join(",")})`,
    ...phones.map((p) => `phone.like.*${p}`),
  ].filter(Boolean);
  if (!or.length) return [];
  const qs = new URLSearchParams({
    or: `(${or.join(",")})`,
    status: "eq.booked",
    start_at: `gt.${new Date().toISOString()}`,
    order: "start_at.asc",
    select: "*",
  });
  return fetchJson<BookingRow[]>(rest(env, `bookings?${qs}`), { headers: headers(env) });
}

/** Insert or update by cal_uid. Only the fields given are written. */
export async function upsertBooking(env: Env, row: BookingRow) {
  await fetchJson(rest(env, "bookings?on_conflict=cal_uid"), {
    method: "POST",
    headers: headers(env, "resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify(row),
  });
}

/** Update the row that currently has this cal_uid (e.g. after a reschedule gives it a new uid). */
export async function updateBooking(env: Env, calUid: string, patch: Partial<BookingRow>): Promise<number> {
  const rows = await fetchJson<unknown[]>(rest(env, `bookings?cal_uid=eq.${encodeURIComponent(calUid)}`), {
    method: "PATCH",
    headers: headers(env, "return=representation"),
    body: JSON.stringify(patch),
  });
  return rows.length;
}
