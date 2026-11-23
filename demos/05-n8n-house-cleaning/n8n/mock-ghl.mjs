#!/usr/bin/env node
// In-memory stand-in for the GoHighLevel endpoints Demo 5 uses, plus a fake Sheets endpoint.
// Lets you run every tool before starting the 14-day GHL trial.
//
//   node demos/05-n8n-house-cleaning/n8n/mock-ghl.mjs          listens on :4010
//   .env: GHL_BASE_URL=http://host.docker.internal:4010   SHEETS_WEBHOOK_URL=http://host.docker.internal:4010/sheets
//   GET http://localhost:4010/__state                     everything written so far
//
// Slots are Mon-Sat 8 AM, 11 AM and 2 PM in TIMEZONE (default America/Denver). Node 18+, no dependencies.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT || 4010);
const TZ = process.env.TIMEZONE || "America/Denver";
const state = { contacts: {}, notes: [], appointments: {}, opportunities: {}, sheetRows: [], requests: 0 };
const pipelines = [
  { id: "pipe_leads", name: "AI Voice Leads", stages: [{ id: "st_new", name: "New lead" }, { id: "st_booked", name: "Booked" }, { id: "st_attention", name: "Needs attention" }, { id: "st_out", name: "Out of area" }] },
  { id: "pipe_recurring", name: "Recurring plans", stages: [{ id: "st_rec_interested", name: "Interested" }, { id: "st_rec_signed", name: "Signed up" }] },
];

/** Local wall time in TZ -> ISO instant. */
function localToIso(y, mo, d, h) {
  const asUtc = Date.UTC(y, mo, d, h);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(asUtc)).map((x) => [x.type, x.value]));
  const zoned = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return new Date(asUtc - (zoned - asUtc)).toISOString();
}

function freeSlots(fromMs, toMs) {
  const out = {};
  const taken = new Set(Object.values(state.appointments).filter((a) => a.appointmentStatus !== "cancelled").map((a) => a.startTime));
  for (let t = fromMs - 86_400_000; t < toMs + 86_400_000; t += 86_400_000) {
    const local = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(new Date(t));
    const get = (k) => local.find((x) => x.type === k).value;
    if (get("weekday") === "Sun") continue;
    const key = `${get("year")}-${get("month")}-${get("day")}`;
    const slots = [8, 11, 14].map((h) => localToIso(+get("year"), +get("month") - 1, +get("day"), h))
      .filter((iso) => Date.parse(iso) >= fromMs && Date.parse(iso) <= toMs && !taken.has(iso));
    if (slots.length) out[key] = { slots };
  }
  return out;
}

const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString() || "{}") : {};
  const path = url.pathname;
  const q = Object.fromEntries(url.searchParams);
  state.requests++;
  console.log(req.method, path, Object.keys(q).length ? q : "", Object.keys(body).length ? JSON.stringify(body).slice(0, 160) : "");

  if (path === "/__state") return json(res, 200, state);
  if (path === "/sheets") { state.sheetRows.push(body); return json(res, 200, { ok: true }); }
  if (!/^Bearer \S+/.test(req.headers.authorization ?? "") || req.headers.version !== "2021-07-28") {
    return json(res, 401, { message: "mock: missing Bearer token or Version header" });
  }
  let m;
  if (req.method === "POST" && path === "/contacts/upsert") {
    const existing = Object.values(state.contacts).find((c) => c.phone === body.phone);
    const c = existing ?? { id: `ct_${randomUUID().slice(0, 8)}`, tags: [] };
    Object.assign(c, { ...body, tags: [...new Set([...(c.tags ?? []), ...(body.tags ?? [])])] });
    state.contacts[c.id] = c;
    return json(res, existing ? 200 : 201, { new: !existing, contact: c });
  }
  if (req.method === "GET" && path === "/contacts/search/duplicate") {
    return json(res, 200, { contact: Object.values(state.contacts).find((c) => c.phone === q.number) ?? null });
  }
  if ((m = path.match(/^\/contacts\/([\w-]+)\/tags$/)) && req.method === "POST") {
    const c = state.contacts[m[1]]; if (!c) return json(res, 400, { message: "Contact not found" });
    c.tags = [...new Set([...c.tags, ...(body.tags ?? [])])];
    return json(res, 201, { tags: c.tags });
  }
  if ((m = path.match(/^\/contacts\/([\w-]+)\/notes$/)) && req.method === "POST") {
    if (!state.contacts[m[1]]) return json(res, 400, { message: "Contact not found" });
    const n = { id: `nt_${state.notes.length + 1}`, contactId: m[1], body: body.body };
    state.notes.push(n);
    return json(res, 201, { note: n });
  }
  if ((m = path.match(/^\/contacts\/([\w-]+)\/appointments$/)) && req.method === "GET") {
    return json(res, 200, { events: Object.values(state.appointments).filter((a) => a.contactId === m[1]) });
  }
  if ((m = path.match(/^\/contacts\/([\w-]+)$/)) && req.method === "PUT") {
    const c = state.contacts[m[1]]; if (!c) return json(res, 400, { message: "Contact not found" });
    Object.assign(c, body);
    return json(res, 200, { contact: c });
  }
  if ((m = path.match(/^\/calendars\/([\w-]+)\/free-slots$/)) && req.method === "GET") {
    return json(res, 200, { ...freeSlots(Number(q.startDate), Number(q.endDate)), traceId: "mock" });
  }
  if (req.method === "POST" && path === "/calendars/events/appointments") {
    if (!state.contacts[body.contactId]) return json(res, 400, { message: "Contact not found" });
    const a = { id: `ap_${randomUUID().slice(0, 8)}`, ...body };
    state.appointments[a.id] = a;
    return json(res, 201, a);
  }
  if ((m = path.match(/^\/calendars\/events\/appointments\/([\w-]+)$/)) && req.method === "PUT") {
    const a = state.appointments[m[1]]; if (!a) return json(res, 404, { message: "Appointment not found" });
    Object.assign(a, Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)));
    return json(res, 200, a);
  }
  if (req.method === "POST" && path === "/opportunities/upsert") {
    if (!body.pipelineId || !body.pipelineStageId) return json(res, 422, { message: "pipelineId and pipelineStageId are required" });
    const key = `${body.contactId}/${body.pipelineId}`;
    const o = (state.opportunities[key] ??= { id: `op_${randomUUID().slice(0, 8)}` });
    Object.assign(o, body);
    return json(res, 200, { opportunity: o });
  }
  if (req.method === "GET" && path === "/opportunities/search") {
    return json(res, 200, { opportunities: Object.values(state.opportunities).filter((o) => o.contactId === q.contact_id && o.status === "open") });
  }
  if (req.method === "GET" && path === "/opportunities/pipelines") return json(res, 200, { pipelines });
  return json(res, 404, { message: `mock: no route ${req.method} ${path}` });
}).listen(PORT, () => console.log(`mock GHL on http://localhost:${PORT}  (state: /__state)  tz=${TZ}`));
