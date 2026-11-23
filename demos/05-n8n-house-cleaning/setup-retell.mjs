#!/usr/bin/env node
// Demo 5: builds Maya's Retell LLM + agent from prompt.md and the tool list below, then creates or updates them.
// All 8 tools and the call-event webhook point at n8n. Standalone: it doesn't touch scripts/setup-agents.mjs or Demo 2.
//
//   node demos/05-n8n-house-cleaning/setup-retell.mjs              create or update (IDs kept in .agent.json)
//   node demos/05-n8n-house-cleaning/setup-retell.mjs --build-only write retell-llm.json + retell-agent.json only
//   node demos/05-n8n-house-cleaning/setup-retell.mjs --new        ignore .agent.json, create fresh
//
// Inputs come from demos/05-n8n-house-cleaning/.env (or the environment):
//   N8N_URL                  public https URL of n8n (tunnel)          required
//   BRIGHTNEST_WEBHOOK_KEY   same value n8n checks                     required
//   RETELL_API_KEY           Retell dashboard > API Keys              required unless --build-only
//   TRANSFER_NUMBER          optional: adds transfer_call to a person (phone calls only)
//   RETELL_VOICE_ID          optional: defaults to the first American female ElevenLabs voice in your Retell account
// Node 18+, no dependencies.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const p = (f) => join(here, f);
const die = (msg) => { console.error(`\nERROR: ${msg}`); process.exit(1); };
const dotenv = existsSync(p(".env"))
  ? Object.fromEntries(readFileSync(p(".env"), "utf8").split("\n").map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim().replace(/^"|"$/g, "")]))
  : {};
const env = (k) => process.env[k] || dotenv[k] || "";

const buildOnly = process.argv.includes("--build-only");
const fresh = process.argv.includes("--new");
const N8N = (env("N8N_URL") || (buildOnly ? "https://YOUR-N8N-TUNNEL" : "")).replace(/\/$/, "");
const KEY = env("BRIGHTNEST_WEBHOOK_KEY") || (buildOnly ? "YOUR_KEY" : "");
const RETELL = env("RETELL_API_KEY");
const TRANSFER = env("TRANSFER_NUMBER");

if (!buildOnly) {
  const missing = Object.entries({ N8N_URL: N8N, BRIGHTNEST_WEBHOOK_KEY: KEY, RETELL_API_KEY: RETELL }).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) die(`missing: ${missing.join(", ")} (set them in demos/05-n8n-house-cleaning/.env)`);
  if (!/^https:\/\//.test(N8N)) die(`N8N_URL must be the public https URL of n8n (the tunnel), got "${N8N}"`);
}
if (TRANSFER && !/^\+\d{8,15}$/.test(TRANSFER)) die(`TRANSFER_NUMBER must look like +13035550123, got "${TRANSFER}"`);

// ---------- tools ----------
const obj = (properties, required = []) => ({ type: "object", properties, required });
const s = (description) => ({ type: "string", description });
const n = (description) => ({ type: "number", description });
const TYPES = ["Standard", "Deep", "Move-in/Move-out", "Post-construction"];
const FREQ = ["One-time", "Weekly", "Biweekly", "Monthly"];
const PHONE = s("Only if there is no caller ID or they use a different number: the full number exactly as said, all digits");

const TOOLS = [
  ["lookup_customer", "Look up the caller in the CRM by phone. Call it first, as soon as the caller has said why they're calling. Returns contact_id, next cleaning and open jobs for existing clients.",
    obj({ phone: PHONE })],
  ["upsert_contact", "Create or update the caller in the CRM. Call as soon as you have the name. Returns contact_id.",
    obj({ name: s("Full name"), phone: PHONE, address: s("Street address"), zip: s("Zip code"),
      cleaning_type: { type: "string", enum: TYPES }, bedrooms: n("Number of bedrooms"), bathrooms: n("Number of bathrooms; a half bath is 0.5"),
      pets: s("Pets in the home, e.g. 'one dog', or 'none'"), frequency: { type: "string", enum: FREQ },
      access_notes: s("How the team gets in: key, lockbox, door code, someone home") }, ["name"])],
  ["get_quote", "Price and time on site for a cleaning, plus recurring options. Call once you know type, bedrooms and bathrooms.",
    obj({ cleaning_type: { type: "string", enum: TYPES }, bedrooms: n("Number of bedrooms"), bathrooms: n("Number of bathrooms; a half bath is 0.5"),
      pets: s("Pets in the home, or 'none'"), frequency: { type: "string", enum: FREQ } }, ["cleaning_type", "bedrooms", "bathrooms"])],
  ["check_calendar", "Get open cleaning times that fit the whole job: the next 5 days, or 2 days from preferred_day.",
    obj({ hours: n("hours from get_quote (or next_cleaning.hours when moving a cleaning)"),
      preferred_day: s("Day the caller asked for, YYYY-MM-DD. Leave out for the soonest times") })],
  ["book_cleaning", "Book a cleaning in a slot from check_calendar.",
    obj({ contact_id: s("From upsert_contact or lookup_customer"), slot_iso: s("From check_calendar"), cleaning_type: { type: "string", enum: TYPES },
      hours: n("hours from get_quote"), quote_total: n("quote_total from get_quote"), summary: s("One line: home size, pets, focus areas") }, ["contact_id", "slot_iso", "summary"])],
  ["reschedule_cleaning", "Move a returning client's booked cleaning to a new slot from check_calendar.",
    obj({ contact_id: s("From lookup_customer"), appointment_id: s("next_cleaning.appointment_id from lookup_customer"), slot_iso: s("New slot_iso from check_calendar") }, ["contact_id", "slot_iso"])],
  ["add_note_and_tags", "Save a note and tags on the client: complaint, out-of-area, custom-quote. Also for access and parking notes.",
    obj({ contact_id: s("From upsert_contact or lookup_customer"), tags: { type: "array", items: { type: "string" } }, note: s("Note for the team, in the caller's words") }, ["contact_id"])],
  ["record_recurring_interest", "Save the caller's answer to the recurring plan offer.",
    obj({ contact_id: s("From upsert_contact or lookup_customer"), interested: { type: "boolean", description: "true if they want the plan details" },
      frequency: { type: "string", enum: ["Weekly", "Biweekly", "Monthly"] }, visit_price: n("visit_price for that frequency from get_quote recurring_options"),
      email: s("Required when interested is true: the email the caller gave and confirmed after you spelled it back. 'none' only if they refused to give one after being asked") }, ["contact_id", "interested"])],
];

const toolUrl = (name) => `${N8N}/webhook/brightnest-tools?tool=${name}&key=${encodeURIComponent(KEY)}`;
const quiet = ["upsert_contact", "add_note_and_tags", "record_recurring_interest", "get_quote"];

const retellLlm = {
  model: "gpt-4.1",
  model_temperature: 0.4,
  general_prompt: readFileSync(p("prompt.md"), "utf8").trim(),
  begin_message: "Thanks for calling Brightnest Home Cleaning, this is Maya. How can I help today?",
  general_tools: [
    { type: "end_call", name: "end_call", description: "End the call after saying goodbye." },
    ...(TRANSFER ? [{
      type: "transfer_call", name: "transfer_call", description: "Transfer to the manager when a caller with a complaint asks for a person.",
      transfer_destination: { type: "predefined", number: TRANSFER }, transfer_option: { type: "cold_transfer" },
    }] : []),
    ...TOOLS.map(([name, description, parameters]) => ({
      type: "custom", name, description, url: toolUrl(name), parameters,
      speak_during_execution: !quiet.includes(name),
      execution_message_description: "Say a short filler like 'one moment, let me check'.",
      speak_after_execution: true,
      timeout_ms: 10000,
    })),
  ],
};

const retellAgent = {
  agent_name: "Demo - Brightnest Home Cleaning (Maya, n8n)",
  response_engine: { type: "retell-llm", llm_id: "<filled in on create>" },
  voice_id: env("RETELL_VOICE_ID") || "<picked on create>",
  language: "en-US",
  webhook_url: `${N8N}/webhook/brightnest-events?key=${encodeURIComponent(KEY)}`,
  max_call_duration_ms: 300000,
  end_call_after_silence_ms: 20000,
  post_call_analysis_data: [
    { type: "string", name: "cleaning_type", description: "Standard, Deep, Move-in/Move-out or Post-construction, if discussed" },
    { type: "boolean", name: "booked", description: "Was a cleaning booked or moved?" },
    { type: "boolean", name: "recurring_interest", description: "Did the caller want the recurring plan?" },
    { type: "boolean", name: "complaint", description: "Did the caller make a complaint?" },
    { type: "boolean", name: "out_of_area", description: "Was the address outside the service area?" },
  ],
};

// Git-ignored (demos/*/retell-*.json): the URLs contain the key.
writeFileSync(p("retell-llm.json"), JSON.stringify(retellLlm, null, 2) + "\n");
writeFileSync(p("retell-agent.json"), JSON.stringify(retellAgent, null, 2) + "\n");
console.log("wrote retell-llm.json, retell-agent.json");
if (buildOnly) { console.log("Build only: nothing created in Retell."); process.exit(0); }

// ---------- Retell API ----------
async function api(method, path, body) {
  const res = await fetch(`https://api.retellai.com${path}`, {
    method, headers: { authorization: `Bearer ${RETELL}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) { const e = new Error(`${method} ${path} -> ${res.status}: ${text}`); e.status = res.status; throw e; }
  return text ? JSON.parse(text) : {};
}

try {
  const r = await fetch(`${N8N}/healthz`, { signal: AbortSignal.timeout(8000) });
  console.log(`n8n health: ${r.status}`);
} catch (e) {
  console.log(`n8n health: WARNING ${N8N}/healthz unreachable (${e.message}). Calls will fail until the tunnel is up.`);
}

if (!env("RETELL_VOICE_ID")) {
  const voices = await api("GET", "/list-voices");
  const pick = voices.find((v) => v.provider === "elevenlabs" && /female/i.test(v.gender ?? "") && /american/i.test(v.accent ?? ""))
    ?? voices.find((v) => /female/i.test(v.gender ?? "")) ?? voices[0];
  if (!pick) die("no voices returned by Retell; set RETELL_VOICE_ID");
  retellAgent.voice_id = pick.voice_id;
  console.log(`voice: ${pick.voice_id} (${pick.voice_name ?? ""}); set RETELL_VOICE_ID to choose another`);
}

const statePath = p(".agent.json");
const saved = !fresh && existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
let agentId = saved.retellAgentId;
if (agentId) {
  try {
    const agent = await api("GET", `/get-agent/${agentId}`);
    const llmId = agent.response_engine?.llm_id;
    await api("PATCH", `/update-retell-llm/${llmId}`, retellLlm);
    await api("PATCH", `/update-agent/${agentId}`, { ...retellAgent, response_engine: { type: "retell-llm", llm_id: llmId } });
    console.log(`Retell agent ${agentId} (updated)`);
  } catch (e) {
    if (e.status !== 404) throw e;
    console.log(`Retell agent ${agentId} no longer exists, creating a new one`);
    agentId = undefined;
  }
}
if (!agentId) {
  const llm = await api("POST", "/create-retell-llm", retellLlm);
  const agent = await api("POST", "/create-agent", { ...retellAgent, response_engine: { type: "retell-llm", llm_id: llm.llm_id } });
  agentId = agent.agent_id;
  writeFileSync(statePath, JSON.stringify({ retellAgentId: agentId, retellLlmId: llm.llm_id }, null, 2) + "\n");
  console.log(`Retell agent ${agentId} (created)`);
}
console.log(`\nTest: Retell dashboard > Agents > "${retellAgent.agent_name}" > Test (web call). Watch n8n > Executions.`);
