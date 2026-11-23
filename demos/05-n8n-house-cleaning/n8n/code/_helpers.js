// Shared helpers, prepended to every Code node by n8n/build.mjs. Ported from functions/src/lib (Demo 2's Worker).
const str = (v, fallback = "") => (typeof v === "string" ? v.trim() : v == null ? fallback : String(v));
const cfgOf = () => $("Config").first().json;
const reqOf = () => $("Normalize").first().json;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** "+1 303 555 0142", "3035550142" -> "+13035550142" (GHL stores E.164). */
function toE164(raw) {
  const d = str(raw).replace(/\D/g, "");
  if (!d) return "";
  if (str(raw).startsWith("+")) return `+${d}`;
  return d.length === 10 ? `+1${d}` : `+${d}`;
}

/** "Tuesday, November 18 at 10:30 AM" in the business time zone, for the agent to read aloud. */
function spoken(iso, timeZone) {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone });
  return `${day} at ${spokenTime(iso, timeZone)}`;
}
const spokenTime = (iso, timeZone) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });

/** GHL returns times with an offset or as local wall time ("2026-11-17 09:00:00"). Normalise both to ISO. */
function ghlTimeToIso(t, timeZone) {
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(t)) return new Date(t).toISOString();
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return new Date(t).toISOString();
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(asUtc)).map((x) => [x.type, x.value]));
  const zoned = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return new Date(asUtc - (zoned - asUtc)).toISOString();
}

/** Upcoming, not-cancelled appointments, soonest first, with ISO times. */
function upcoming(events, timeZone) {
  const now = Date.now();
  return (events ?? [])
    .map((e) => ({ ...e, startTime: ghlTimeToIso(e.startTime, timeZone), endTime: e.endTime ? ghlTimeToIso(e.endTime, timeZone) : undefined }))
    .filter((e) => !/cancel|noshow|invalid/i.test(e.appointmentStatus ?? "") && Date.parse(e.startTime) > now)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

/** One row for the Google Sheet call log (sheets/call-log.gs). */
function sheetRow(event, details) {
  const cfg = cfgOf();
  const req = reqOf();
  return { sheet: cfg.sheetTab, timestamp: new Date().toISOString(), demo: "house-cleaning", platform: "retell", callId: req.callId, caller: req.callerNumber, event, details };
}

/** Case- and punctuation-insensitive match of a spoken value to an option key ("deep clean" -> "Deep"). */
function matchOption(options, value) {
  const norm = (s) => str(s).toLowerCase().replace(/[^a-z]/g, "");
  const v = norm(value);
  if (!v) return "";
  return Object.keys(options).find((k) => norm(k) === v)
    ?? Object.keys(options).find((k) => v.startsWith(norm(k).slice(0, 4)) || norm(k).startsWith(v.slice(0, 4)))
    ?? "";
}
