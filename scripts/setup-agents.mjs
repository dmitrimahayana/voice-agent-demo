#!/usr/bin/env node
// Step 6 in one command: build the configs, create or update the agents, connect the phone number
// to the dental assistant, and write the Demo 3 IDs into functions/wrangler.toml.
//
//   W=https://dev.your-domain.com TRANSFER_NUMBER=+1YOUR_MOBILE PHONE=+1VAPI_NUMBER node scripts/setup-agents.mjs
//
// Inputs (env vars). K, VAPI_API_KEY and RETELL_API_KEY fall back to functions/.dev.vars:
//   W  (or WORKER_URL)       public URL of the Worker: the tunnel, or workers.dev for prod   required
//   K  (or WEBHOOK_SECRET)   shared secret, must match the Worker's
//   VAPI_API_KEY, RETELL_API_KEY
//   TRANSFER_NUMBER          human handoff number (your phone, NOT the agent's number)      required
//   PHONE                    Vapi number for Demos 1 and 3       optional if Vapi has exactly one number
// Flags:
//   --new                    ignore .agents.json and create fresh agents
//
// Agent IDs are saved in .agents.json. Later runs UPDATE those agents in place (no duplicates),
// so rerun this after editing a prompt, or with the workers.dev URL to point the agents at prod.
// Node 18+, no dependencies.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const p = (f) => join(root, f);
const die = (msg) => { console.error(`\nERROR: ${msg}`); process.exit(1); };

// ---------- inputs ----------
const devVarsPath = p("functions/.dev.vars");
const devVars = existsSync(devVarsPath)
  ? Object.fromEntries(readFileSync(devVarsPath, "utf8").split("\n")
      .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
      .map((m) => [m[1], m[2].trim().replace(/^"|"$/g, "")]))
  : {};
const env = (...names) => {
  for (const n of names) if (process.env[n]) return process.env[n];
  for (const n of names) if (devVars[n]) return devVars[n];
  return "";
};

const W = env("W", "WORKER_URL").replace(/\/$/, "");
const K = env("K", "WEBHOOK_SECRET");
const VAPI = env("VAPI_API_KEY");
const RETELL = env("RETELL_API_KEY");
const TRANSFER = env("TRANSFER_NUMBER");
const PHONE = env("PHONE");
const fresh = process.argv.includes("--new");

const missing = Object.entries({ W, K, VAPI_API_KEY: VAPI, RETELL_API_KEY: RETELL, TRANSFER_NUMBER: TRANSFER })
  .filter(([, v]) => !v).map(([k]) => k);
if (missing.length) die(`missing: ${missing.join(", ")} (env var, or functions/.dev.vars for the keys)`);
if (!/^https:\/\//.test(W) || W.includes("YOUR-WORKER")) die(`W must be the public https URL of the Worker, got "${W}"`);
if (!/^\+\d{8,15}$/.test(TRANSFER)) die(`TRANSFER_NUMBER must look like +15125550123, got "${TRANSFER}"`);
if (PHONE && PHONE === TRANSFER) die("TRANSFER_NUMBER is the human handoff phone; it can't be the agent's own number (PHONE)");

console.log(`W=${W}  K=${K.length} chars  vapi=${VAPI.length} chars  retell=${RETELL.length} chars  transfer=${TRANSFER}\n`);

// ---------- 1. health check (warning only) ----------
try {
  const res = await fetch(`${W}/`, { signal: AbortSignal.timeout(8000) });
  console.log(`health: ${W}/ -> ${res.status}`);
} catch (e) {
  console.log(`health: WARNING ${W}/ unreachable (${e.message}). Agents are still set up, but calls will fail until it's up.`);
}

// ---------- 2. build the configs ----------
execFileSync(process.execPath, [p("scripts/build-configs.mjs")], {
  env: { ...process.env, WORKER_URL: W, WEBHOOK_SECRET: K, TRANSFER_NUMBER: TRANSFER },
  stdio: "inherit",
});
const readJson = (f) => JSON.parse(readFileSync(p(f), "utf8"));
const dental = readJson("demos/01-dental-receptionist/assistant.vapi.json");
const lead = readJson("demos/03-speed-to-lead/assistant.vapi.json");
const retellLlm = readJson("demos/02-ghl-home-services/retell-llm.json");
const retellAgent = readJson("demos/02-ghl-home-services/retell-agent.json");
if (!JSON.stringify(dental).includes(W)) die(`built config doesn't contain ${W}; the build didn't get the variables`);

// ---------- 3. create or update the agents ----------
async function api(method, url, key, body) {
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) { const e = new Error(`${method} ${url} -> ${res.status}: ${text}`); e.status = res.status; throw e; }
  return text ? JSON.parse(text) : {};
}

const statePath = p(".agents.json");
const saved = !fresh && existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
const save = () => writeFileSync(statePath, JSON.stringify(saved, null, 2) + "\n");

async function upsert(key, label, update, create) {
  const id = saved[key];
  if (id) {
    try { await update(id); console.log(`${label}: ${id} (updated)`); return id; }
    catch (e) { if (e.status !== 404) throw e; console.log(`${label}: ${id} no longer exists, creating a new one`); }
  }
  saved[key] = await create();
  save();
  console.log(`${label}: ${saved[key]} (created)`);
  return saved[key];
}

console.log("");
const dentalId = await upsert("vapiDentalAssistantId", "Vapi dental assistant id",
  (id) => api("PATCH", `https://api.vapi.ai/assistant/${id}`, VAPI, dental),
  async () => (await api("POST", "https://api.vapi.ai/assistant", VAPI, dental)).id);

const leadId = await upsert("vapiSpeedToLeadAssistantId", "Vapi speed-to-lead assistant id",
  (id) => api("PATCH", `https://api.vapi.ai/assistant/${id}`, VAPI, lead),
  async () => (await api("POST", "https://api.vapi.ai/assistant", VAPI, lead)).id);

const retellId = await upsert("retellAgentId", "Retell agent id",
  async (id) => {
    const agent = await api("GET", `https://api.retellai.com/get-agent/${id}`, RETELL);
    const llmId = agent.response_engine?.llm_id;
    if (!llmId) throw new Error(`Retell agent ${id} has no retell-llm attached`);
    await api("PATCH", `https://api.retellai.com/update-retell-llm/${llmId}`, RETELL, retellLlm);
    await api("PATCH", `https://api.retellai.com/update-agent/${id}`, RETELL,
      { ...retellAgent, response_engine: { type: "retell-llm", llm_id: llmId } });
  },
  async () => {
    const llm = await api("POST", "https://api.retellai.com/create-retell-llm", RETELL, retellLlm);
    const agent = await api("POST", "https://api.retellai.com/create-agent", RETELL,
      { ...retellAgent, response_engine: { type: "retell-llm", llm_id: llm.llm_id } });
    return agent.agent_id;
  });

// ---------- 4. connect the phone number to the dental assistant ----------
const numbers = await api("GET", "https://api.vapi.ai/phone-number", VAPI);
const list = numbers.map((n) => n.number).join(", ") || "none";
const num = PHONE ? numbers.find((n) => n.number === PHONE) : numbers.length === 1 ? numbers[0] : null;
if (!num) {
  console.log(`\nphone: SKIPPED. ${PHONE ? `${PHONE} is not in Vapi.` : "Set PHONE= to pick one."} Vapi numbers: ${list}`);
  console.log("       Create one: Vapi > Phone Numbers > Create Phone Number > Free Vapi Number, then rerun.");
} else {
  if (num.number === TRANSFER) die("TRANSFER_NUMBER is the agent's own Vapi number; use your phone instead");
  await api("PATCH", `https://api.vapi.ai/phone-number/${num.id}`, VAPI, { assistantId: dentalId });
  console.log(`\nphone: ${num.number} (id ${num.id}) -> inbound assistant ${dentalId}`);
}

// ---------- 5. write the Demo 3 IDs into wrangler.toml ----------
const tomlPath = p("functions/wrangler.toml");
let toml = readFileSync(tomlPath, "utf8");
const setVar = (name, value) => {
  const re = new RegExp(`^${name}\\s*=.*$`, "m");
  if (!re.test(toml)) die(`${name} not found in functions/wrangler.toml`);
  toml = toml.replace(re, `${name} = "${value}"`);
};
setVar("VAPI_SPEED_TO_LEAD_ASSISTANT_ID", leadId);
if (num) setVar("VAPI_OUTBOUND_PHONE_NUMBER_ID", num.id);
writeFileSync(tomlPath, toml);
console.log(`wrangler.toml: VAPI_SPEED_TO_LEAD_ASSISTANT_ID=${leadId}${num ? `, VAPI_OUTBOUND_PHONE_NUMBER_ID=${num.id}` : ""}`);

console.log(`
Done. IDs saved in .agents.json (next run updates these agents instead of creating new ones).
- Demo 1: call ${num ? num.number : "your Vapi number"}
- Demo 2: Retell > agent ${retellId} > Test
- Demo 3: curl -X POST "${W}/leads" -H 'content-type: application/json' -d '{"client_id":"sunpeak-solar","name":"Test","phone":"${TRANSFER}"}'
wrangler dev reloads wrangler.toml by itself; for prod, run "npx wrangler deploy" after this.`);
