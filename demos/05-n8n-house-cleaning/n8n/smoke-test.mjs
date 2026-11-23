#!/usr/bin/env node
// Calls every tool the way Retell does ({call, name, args}) and prints the replies, in call order:
// new client -> quote -> book -> note -> recurring plan -> returning client -> reschedule -> complaint -> events.
//
//   node demos/05-n8n-house-cleaning/n8n/smoke-test.mjs                 against http://localhost:5678
//   N8N_URL=https://n8n.your-domain.com node .../smoke-test.mjs          against the tunnel
//   PHONE=+13035550199 node .../smoke-test.mjs                           caller ID to use (default +13035550142)
//
// Writes real data when n8n points at real GHL: use a test number. Exit code 1 if any step fails.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const envFile = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
const dotenv = existsSync(envFile)
  ? Object.fromEntries(readFileSync(envFile, "utf8").split("\n").map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]))
  : {};
const env = (k, d = "") => process.env[k] || dotenv[k] || d;
const BASE = (process.env.N8N_URL || "http://localhost:5678").replace(/\/$/, "");
const KEY = env("BRIGHTNEST_WEBHOOK_KEY");
const PHONE = env("PHONE", "+13035550142");
const call = { call_id: `smoke_${Date.now()}`, direction: "inbound", from_number: PHONE, to_number: "+13035550100" };

let failures = 0;
async function tool(name, args, { expect } = {}) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/webhook/brightnest-tools?tool=${name}&key=${encodeURIComponent(KEY)}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ call, name, args }),
  });
  const text = await res.text();
  const ms = Date.now() - t0;
  let result;
  try { result = JSON.parse(text).result; } catch { result = undefined; }
  const ok = res.ok && typeof result === "string" && !/not responding/.test(result) && (!expect || expect.test(result));
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(26)} ${String(ms).padStart(5)} ms  ${(result ?? `${res.status} ${text}`).slice(0, 220)}`);
  try { return JSON.parse(result); } catch { return result; }
}

console.log(`n8n: ${BASE}   caller: ${PHONE}\n`);
const unauth = await fetch(`${BASE}/webhook/brightnest-tools?tool=get_quote&key=wrong`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
console.log(`${unauth.status === 401 || !KEY ? "ok  " : "FAIL"} wrong key -> ${unauth.status}${KEY ? "" : " (BRIGHTNEST_WEBHOOK_KEY not set, auth is off)"}`);
if (KEY && unauth.status !== 401) failures++;

const first = await tool("lookup_customer", {});
let contactId = first?.contact_id;
if (!first?.found) {
  contactId = (await tool("upsert_contact", { name: "Jordan Smoke", address: "1200 Pearl St", zip: "80203", cleaning_type: "Standard", bedrooms: 3, bathrooms: 2, pets: "one dog", frequency: "One-time", access_notes: "Lockbox code 2468" }, { expect: /contact_id/ }))?.contact_id;
}
await tool("get_quote", { cleaning_type: "deep clean", bedrooms: 3, bathrooms: 2.5, pets: "none" }, { expect: /quote_total/ });
const quote = await tool("get_quote", { cleaning_type: "Standard", bedrooms: 3, bathrooms: 2, pets: "one dog", frequency: "one time" }, { expect: /recurring_options/ });
await tool("get_quote", { cleaning_type: "Standard", bedrooms: 8, bathrooms: 6 }, { expect: /custom_quote/ });
const cal = await tool("check_calendar", { hours: quote?.hours }, { expect: /slot_iso/ });
const slot = cal?.slots?.[0]?.slot_iso;
await tool("book_cleaning", { contact_id: contactId, slot_iso: slot, cleaning_type: "Standard", hours: quote?.hours, quote_total: quote?.quote_total, summary: "3 bd 2 ba, one dog" }, { expect: /^Booked/ });
await tool("add_note_and_tags", { contact_id: contactId, note: "Lockbox 2468 by the side door. Park in the driveway. Focus on the kitchen." }, { expect: /Saved/ });
const biweekly = quote?.recurring_options?.find((o) => o.frequency === "Biweekly");
await tool("record_recurring_interest", { contact_id: contactId, interested: true, frequency: "every two weeks", visit_price: biweekly?.visit_price }, { expect: /No valid email/ });
await tool("record_recurring_interest", { contact_id: contactId, interested: true, frequency: "Biweekly", visit_price: biweekly?.visit_price, email: "jordan.smoke@example.com" }, { expect: /emailed/ });

const back = await tool("lookup_customer", {}, { expect: /"found":true/ });
const cal2 = await tool("check_calendar", { hours: back?.next_cleaning?.hours, preferred_day: cal?.slots?.at(-1)?.slot_iso?.slice(0, 10) }, { expect: /slot_iso/ });
await tool("reschedule_cleaning", { contact_id: contactId, appointment_id: back?.next_cleaning?.appointment_id, slot_iso: cal2?.slots?.at(-1)?.slot_iso }, { expect: /^Moved/ });
await tool("add_note_and_tags", { contact_id: contactId, tags: ["complaint"], note: "Bathroom mirror was left streaky last visit." }, { expect: /Complaint logged/ });
await tool("book_cleaning", { slot_iso: slot }, { expect: /Missing contact_id/ });
await tool("lookup_customer", {}, { expect: /"found":true/ });

const ev = await fetch(`${BASE}/webhook/brightnest-events?key=${encodeURIComponent(KEY)}`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ event: "call_analyzed", call: { ...call, start_timestamp: Date.now() - 95_000, end_timestamp: Date.now(), disconnection_reason: "user_hangup", call_analysis: { call_summary: "Smoke test call.", user_sentiment: "Positive", custom_analysis_data: { cleaning_type: "Standard", booked: true } } } }),
});
console.log(`${ev.status === 204 ? "ok  " : "FAIL"} events call_analyzed -> ${ev.status}`);
if (ev.status !== 204) failures++;

console.log(failures ? `\n${failures} step(s) failed. Open n8n > Executions to see which node.` : "\nAll steps passed.");
process.exit(failures ? 1 : 0);
