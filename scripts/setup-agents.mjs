#!/usr/bin/env node
// Step 6 in one command: build the agent configs from the prompt files, create or update the agents
// on Vapi, Retell and ElevenLabs, connect the phone numbers, and write the Demo 3 IDs into functions/wrangler.toml.
//
//   W=https://dev.your-domain.com TRANSFER_NUMBER=+1YOUR_MOBILE PHONE=+1VAPI_NUMBER node scripts/setup-agents.mjs
//
// Inputs (env vars). K and the API keys fall back to functions/.dev.vars:
//   W  (or WORKER_URL)       public URL of the Worker: the tunnel, or workers.dev for prod   required
//   K  (or WEBHOOK_SECRET)   shared secret, must match the Worker's                          required
//   TRANSFER_NUMBER          human handoff number (your phone, NOT the agent's number)      required
//   VAPI_API_KEY             Demos 1 and 3
//   RETELL_API_KEY           Demo 2
//   ELEVENLABS_API_KEY       Demo 4; without it Demo 4 is skipped (unless --only=elevenlabs asks for it)
//   PHONE                    Vapi number for Demos 1 and 3       optional if Vapi has exactly one number
//   EL_PHONE                 ElevenLabs number for Demo 4        optional if ElevenLabs has exactly one number
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN   with EL_PHONE: import that Twilio number into ElevenLabs if it isn't there yet
//   EL_LLM, EL_VOICE_ID, EL_TTS_MODEL       optional Demo 4 overrides (default gpt-4.1, "Sarah", eleven_flash_v2)
// Flags:
//   --build-only             only write the JSON configs (no API calls, no keys needed), e.g. to paste into a dashboard
//   --only=vapi,retell,elevenlabs   set up only these platforms (default: all); --only-elevenlabs = --only=elevenlabs
//   --new                    ignore .agents.json and create fresh agents
//
// The prompts live in demos/*/prompt.md; tools, voices and limits are defined below.
// Agent IDs are saved in .agents.json. Later runs UPDATE those agents in place (no duplicates),
// so rerun this after editing a prompt, or with the workers.dev URL to point the agents at prod.
// Node 18+, no dependencies.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const p = (f) => join(root, f);
const die = (msg) => { console.error(`\nERROR: ${msg}`); process.exit(1); };
const read = (f) => readFileSync(p(f), "utf8").trim();
const write = (f, obj) => { writeFileSync(p(f), JSON.stringify(obj, null, 2) + "\n"); console.log("wrote", f); };

// ---------- 1. inputs ----------
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
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

const buildOnly = process.argv.includes("--build-only");
const fresh = process.argv.includes("--new");
const PLATFORMS = ["vapi", "retell", "elevenlabs"];
const onlyList = process.argv.includes("--only-elevenlabs") ? ["elevenlabs"] : arg("only")?.split(",").map((s) => s.trim());
if (onlyList?.some((x) => !PLATFORMS.includes(x))) die(`--only takes ${PLATFORMS.join(", ")}; got "${onlyList.join(",")}"`);
const wants = (platform) => !onlyList || onlyList.includes(platform);

const W = (env("W", "WORKER_URL") || (buildOnly ? "https://YOUR-WORKER.workers.dev" : "")).replace(/\/$/, "");
const K = env("K", "WEBHOOK_SECRET") || (buildOnly ? "YOUR_WEBHOOK_SECRET" : "");
const TRANSFER = env("TRANSFER_NUMBER") || (buildOnly ? "+15125550100" : "");
const VAPI = env("VAPI_API_KEY");
const RETELL = env("RETELL_API_KEY");
const ELEVEN = env("ELEVENLABS_API_KEY");
const PHONE = env("PHONE");
const EL_PHONE = env("EL_PHONE");

if (!buildOnly) {
  const required = { W, K, TRANSFER_NUMBER: TRANSFER };
  if (wants("vapi")) required.VAPI_API_KEY = VAPI;
  if (wants("retell")) required.RETELL_API_KEY = RETELL;
  if (onlyList?.includes("elevenlabs")) required.ELEVENLABS_API_KEY = ELEVEN;
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) die(`missing: ${missing.join(", ")} (env var, or functions/.dev.vars for the keys)`);
  if (!/^https:\/\//.test(W) || W.includes("YOUR-WORKER")) die(`W must be the public https URL of the Worker, got "${W}"`);
  if (!/^\+\d{8,15}$/.test(TRANSFER)) die(`TRANSFER_NUMBER must look like +15125550123, got "${TRANSFER}"`);
  for (const [name, num] of [["PHONE", PHONE], ["EL_PHONE", EL_PHONE]]) {
    if (num && num === TRANSFER) die(`TRANSFER_NUMBER is the human handoff phone; it can't be the agent's own number (${name})`);
  }
}

console.log(`W=${W}  K=${K.length} chars  vapi=${VAPI.length} chars  retell=${RETELL.length} chars  elevenlabs=${ELEVEN.length} chars  transfer=${TRANSFER}\n`);

// ---------- 2. build the configs ----------
// Every tool URL carries ?demo=<toolset>&key=<WEBHOOK_SECRET>; the Worker checks the key.
const url = (path, demo) => `${W}${path}?demo=${demo}&key=${encodeURIComponent(K)}`;
const obj = (properties, required = []) => ({ type: "object", properties, required });
const s = (description) => ({ type: "string", description });

// Shared tool definitions (name, description, JSON schema). The handlers are in functions/src/handlers/.
const DENTAL_TOOLS = [
  ["check_availability", "Find open appointment slots on a given day.", obj({ date: s("Day to check, YYYY-MM-DD") }, ["date"])],
  ["book_appointment", "Book an appointment in a slot returned by check_availability.",
    obj({ name: s("Patient full name"), reason: s("Reason for visit"), slot_iso: s("slot_iso from check_availability"), phone: s("Full phone number exactly as the caller said it, all digits, if different from caller ID or there is no caller ID"), member_id: s("Exactly 6 digits, only if the caller says it is their member number. Never put part of a phone number here") }, ["name", "reason", "slot_iso"])],
  ["find_appointment", "Look up the caller's upcoming appointments by member number, or by caller ID if none given.",
    obj({ member_id: s("Exactly 6 digits, only if the caller says it is their member number. Never put part of a phone number here"), phone: s("Full phone number exactly as the caller said it, all digits, if different from caller ID or there is no caller ID") })],
  ["reschedule_appointment", "Move an existing appointment to a new slot returned by check_availability.",
    obj({ slot_iso: s("New slot_iso from check_availability"), booking_ref: s("booking_ref from find_appointment, if they have several"), member_id: s("Exactly 6 digits, only if the caller says it is their member number. Never put part of a phone number here"), phone: s("Full phone number exactly as the caller said it, all digits, if different from caller ID or there is no caller ID"), reason: s("Why they are moving it") }, ["slot_iso"])],
  ["cancel_appointment", "Cancel the caller's appointment (found by member ID or phone number).",
    obj({ reason: s("Why they are cancelling"), booking_ref: s("booking_ref from find_appointment, if they have several"), member_id: s("Exactly 6 digits, only if the caller says it is their member number. Never put part of a phone number here"), phone: s("Full phone number exactly as the caller said it, all digits, if different from caller ID or there is no caller ID") })],
  ["flag_call", "Flag the call as urgent or as a callback request for the team.",
    obj({ type: { type: "string", enum: ["urgent", "callback"] }, name: s("Caller name if known"), note: s("Short note for the team") }, ["type", "note"])],
];

const HOME_TOOLS = [
  ["lookup_customer", "Look up the caller in the CRM by phone. Call it first, as soon as the caller has said why they're calling. Returns contact_id, next visit and open jobs if they're an existing customer.",
    obj({ phone: s("Only if there is no caller ID or they use a different number: the full number exactly as said, all digits") })],
  ["upsert_contact", "Create or update the caller in the CRM. Call as soon as you have the name. Returns contact_id.",
    obj({ name: s("Full name"), phone: s("Full phone number exactly as the caller said it, all digits, if different from caller ID or there is no caller ID"), address: s("Street address"), zip: s("Zip code"),
      service_type: { type: "string", enum: ["Plumbing", "Heating", "Cooling", "Water Heater", "Drain"] },
      property_type: { type: "string", enum: ["Residential", "Commercial"] }, issue: s("The problem in the caller's words") }, ["name"])],
  ["check_calendar", "Get open service windows for the next 3 days.", obj({})],
  ["book_job", "Book a service visit.", obj({ contact_id: s("From upsert_contact"), slot_iso: s("From check_calendar"), summary: s("One-line job summary") }, ["contact_id", "slot_iso", "summary"])],
  ["reschedule_job", "Move an existing customer's booked visit to a new window from check_calendar.",
    obj({ contact_id: s("From lookup_customer"), appointment_id: s("next_visit.appointment_id from lookup_customer"), slot_iso: s("New slot_iso from check_calendar") }, ["contact_id", "slot_iso"])],
  ["add_note_and_tags", "Save a note and tags (emergency, out-of-area) on the contact.",
    obj({ contact_id: s("From upsert_contact"), tags: { type: "array", items: { type: "string" } }, note: s("Note for the technician") }, ["contact_id"])],
  ["record_plan_interest", "Save the caller's answer to the Comfort Club maintenance plan offer.",
    obj({ contact_id: s("From upsert_contact or lookup_customer"), interested: { type: "boolean", description: "true if they want the sign-up link" },
      email: s("Their email for the sign-up link, spelled out and confirmed") }, ["contact_id", "interested"])],
];

const LEAD_TOOLS = [
  ["check_calendar", "Find open meeting slots on a given day.", obj({ date: s("Day to check, YYYY-MM-DD") }, ["date"])],
  ["book_meeting", "Book the meeting in a slot from check_calendar.", obj({ name: s("Lead full name"), reason: s("Short summary of their answers"), slot_iso: s("slot_iso from check_calendar") }, ["name", "slot_iso"])],
  ["log_outcome", "Record the outcome before ending the call.",
    obj({ outcome: { type: "string", enum: ["booked", "callback", "not_interested", "wrong_number"] }, note: s("Callback time or short note") }, ["outcome"])],
];

// --- Vapi (Demos 1 and 3) ---
function vapiAssistant({ name, prompt, firstMessage, demo, tools, voiceId, transfer, model = "gpt-4o-mini" }) {
  return {
    name,
    firstMessage,
    firstMessageMode: "assistant-speaks-first",
    model: {
      provider: "openai",
      model,
      temperature: 0.4,
      messages: [{ role: "system", content: prompt }],
      tools: [
        ...tools.map(([fn, description, parameters]) => ({
          type: "function",
          function: { name: fn, description, parameters },
          server: { url: url("/vapi/tools", demo) },
          messages: [{ type: "request-start", content: "One moment." }],
        })),
        { type: "endCall" },
        ...(transfer ? [{
          type: "transferCall",
          destinations: [{ type: "number", number: TRANSFER, message: "Sure, transferring you to the front desk now." }],
        }] : []),
      ],
    },
    voice: { provider: "11labs", voiceId },
    transcriber: { provider: "deepgram", model: "nova-3", language: "multi" },
    maxDurationSeconds: 180,
    silenceTimeoutSeconds: 20,
    endCallMessage: "Thanks for calling. Have a great day!",
    server: { url: url("/vapi/events", demo) },
    serverMessages: ["end-of-call-report"],
  };
}

// Demo 1 inlines the clinic facts into the prompt; Demo 4 uploads the same file as a knowledge base (step 6).
const dental = vapiAssistant({
  name: "Demo - Bright Smile Dental (Ava)",
  prompt: read("demos/01-dental-receptionist/prompt.md")
    .replace("{{knowledge_base}}", read("demos/01-dental-receptionist/knowledge-base.md")),
  firstMessage: "Thanks for calling Bright Smile Dental, this is Ava. How can I help you today?",
  demo: "dental",
  tools: DENTAL_TOOLS,
  voiceId: "21m00Tcm4TlvDq8ikWAM", // ElevenLabs "Rachel"; swap for any voice you like
  transfer: true,
  // gpt-4o-mini often says "let me check" and then never calls the tool; 4.1 calls tools reliably.
  model: "gpt-4.1",
});

const lead = vapiAssistant({
  name: "Demo - Speed-to-lead (multi-client)",
  prompt: read("demos/03-speed-to-lead/prompt.md"),
  firstMessage: "Hi {{lead_first_name}}, this is {{agent_name}} from {{business_name}}. You just reached out about {{offer}}. Is now a good time for two minutes?",
  demo: "lead",
  tools: LEAD_TOOLS,
  voiceId: "EXAVITQu4vr4xnSDxMaL", // ElevenLabs "Sarah"
  transfer: false,
});

// --- Retell (Demo 2) ---
const retellLlm = {
  // gpt-4o-mini tends to announce a tool and not call it; 4.1 handles the longer tool chain reliably.
  model: "gpt-4.1",
  model_temperature: 0.4,
  general_prompt: read("demos/02-ghl-home-services/prompt.md"),
  begin_message: "Thanks for calling Northside Plumbing and HVAC, this is Sam. What's going on today?",
  general_tools: [
    { type: "end_call", name: "end_call", description: "End the call after saying goodbye." },
    ...HOME_TOOLS.map(([fn, description, parameters]) => ({
      type: "custom",
      name: fn,
      description,
      url: url(`/retell/tools/${fn}`, "home"),
      parameters,
      speak_during_execution: !["upsert_contact", "add_note_and_tags", "record_plan_interest"].includes(fn),
      execution_message_description: "Say a short filler like 'let me check that for you'.",
      speak_after_execution: true,
      timeout_ms: 10000,
    })),
  ],
};

const retellAgent = {
  agent_name: "Demo - Northside Plumbing & HVAC (Sam)",
  response_engine: { type: "retell-llm", llm_id: "<filled in by step 5, or paste the LLM id>" },
  voice_id: "11labs-Adrian",
  language: "en-US",
  webhook_url: url("/retell/events", "home"),
  max_call_duration_ms: 180000,
  end_call_after_silence_ms: 20000,
  post_call_analysis_data: [
    { type: "string", name: "service_type", description: "Plumbing, Heating, Cooling, Water Heater or Drain" },
    { type: "boolean", name: "emergency", description: "Was this an emergency?" },
    { type: "boolean", name: "booked", description: "Was a visit booked?" },
  ],
};

// --- ElevenLabs (Demo 4: Dewlane Skin Studio) ---
// Server tools are standalone objects (POST /v1/convai/tools) that the agent references by tool_ids;
// step 6 creates them first, then fills tool_ids and the knowledge base id into the agent.
// The handlers are in functions/src/handlers/skincare.ts (toolset ?demo=skin).
const SKIN_TOOLS = [
  ["recommend_treatment", "Suggest the best treatment from the studio menu for the guest's skin type and concerns.",
    obj({ skin_type: { type: "string", enum: ["dry", "oily", "combination", "normal", "sensitive"], description: "Guest's skin type" },
      concerns: s("Main concerns in plain words, comma separated, e.g. 'breakouts, large pores'"),
      pregnant: { type: "boolean", description: "true only if the guest said they are pregnant" },
      isotretinoin: { type: "boolean", description: "true only if the guest takes or recently took isotretinoin (Accutane)" } }, ["concerns"])],
  ["check_availability", "Find open appointment times on a given day.", obj({ date: s("Day to check, YYYY-MM-DD") }, ["date"])],
  ["book_appointment", "Book a treatment in a time returned by check_availability and email the reservation.",
    obj({ name: s("Guest full name"), email: s("Guest email, spelled out and confirmed, e.g. maria.lopez@gmail.com"),
      service_id: s("service_id from recommend_treatment, or one of: consultation, hydrating_facial, clarifying_facial, calming_facial, glow_peel, microneedling, dermaplaning, led_addon"),
      slot_iso: s("slot_iso from check_availability"), language: { type: "string", enum: ["en", "es"], description: "Language of the call, for the email" },
      notes: s("Anything the esthetician should know, e.g. add LED, first visit") }, ["name", "email", "service_id", "slot_iso"])],
  ["find_appointment", "Look up the guest's upcoming appointments by the email they booked with.",
    obj({ email: s("Email they booked with, confirmed") }, ["email"])],
  ["reschedule_appointment", "Move an appointment to a new time from check_availability and email the update.",
    obj({ email: s("Email they booked with"), slot_iso: s("New slot_iso from check_availability"), booking_ref: s("booking_ref from find_appointment, if they have several"),
      language: { type: "string", enum: ["en", "es"], description: "Language of the call, for the email" } }, ["email", "slot_iso"])],
  ["cancel_appointment", "Cancel the guest's appointment and email the cancellation.",
    obj({ email: s("Email they booked with"), booking_ref: s("booking_ref from find_appointment, if they have several"), reason: s("Why they are cancelling"),
      language: { type: "string", enum: ["en", "es"], description: "Language of the call, for the email" } }, ["email"])],
  ["flag_call", "Alert the team: a skin reaction (urgent), a complaint, or a callback request.",
    obj({ type: { type: "string", enum: ["reaction", "complaint", "callback"], description: "reaction = after a treatment or product; complaint; callback = needs a person" },
      name: s("Guest name if known"), email: s("Guest email if known"), note: s("Short note for the team") }, ["type", "note"])],
];

// ElevenLabs needs a description (or a dynamic_variable/constant_value) on every body property.
const withDescriptions = (params) => ({
  ...params,
  description: "",
  properties: Object.fromEntries(Object.entries(params.properties).map(([k, v]) =>
    [k, { ...v, description: v.description || `One of: ${(v.enum ?? []).join(", ")}` }])),
});

const elevenTools = SKIN_TOOLS.map(([fn, description, parameters]) => {
  const body = withDescriptions(parameters);
  // Call metadata isn't sent automatically: bind it from system dynamic variables (never shown to the LLM).
  body.properties.caller_id = { type: "string", dynamic_variable: "system__caller_id" };
  body.properties.conversation_id = { type: "string", dynamic_variable: "system__conversation_id" };
  return {
    type: "webhook",
    name: fn,
    description,
    response_timeout_secs: 20,
    api_schema: { url: url(`/elevenlabs/tools/${fn}`, "skin"), method: "POST", request_body_schema: body },
  };
});

const systemTool = (name, description = "", params = {}) =>
  ({ type: "system", name, description, params: { system_tool_type: name, ...params } });

const elevenAgent = {
  name: "Demo - Dewlane Skin Studio (Elena)",
  conversation_config: {
    agent: {
      first_message: "Hi, thanks for calling Dewlane Skin Studio, this is Elena. How can I help your skin today? También hablo español.",
      language: "en",
      prompt: {
        prompt: read("demos/04-skincare-studio/prompt.md"),
        llm: env("EL_LLM") || "gpt-4.1", // same reason as Demo 1: reliable tool calling
        temperature: 0.4,
        tool_ids: ["<filled in by step 6>"],
        built_in_tools: {
          end_call: systemTool("end_call"),
          language_detection: systemTool("language_detection"),
          transfer_to_number: systemTool("transfer_to_number", "Transfer the guest to the front desk when they ask for a person.", {
            transfers: [{
              transfer_destination: { type: "phone", phone_number: TRANSFER },
              condition: "The guest asks for a person, a manager or the front desk.",
              transfer_type: "conference",
            }],
          }),
        },
        knowledge_base: [{ type: "text", name: "Dewlane Skin Studio menu and FAQ", id: "<filled in by step 6>", usage_mode: "prompt" }],
      },
    },
    // Spanish switch for the language_detection tool.
    language_presets: {
      es: { overrides: { agent: { first_message: "Hola, gracias por llamar a Dewlane Skin Studio, habla Elena. ¿En qué le puedo ayudar con su piel hoy?" } } },
    },
    // ElevenLabs requires an English-first agent to use eleven_flash_v2 or eleven_turbo_v2 (English-only);
    // after language_detection switches to Spanish it uses the multilingual v2.5 model by itself.
    // "Sarah" speaks both languages.
    tts: { voice_id: env("EL_VOICE_ID") || "EXAVITQu4vr4xnSDxMaL", model_id: env("EL_TTS_MODEL") || "eleven_flash_v2" },
    conversation: { max_duration_seconds: 240 },
  },
  platform_settings: {
    // Structured fields extracted after every call; they arrive in the post-call webhook and the Sheet row.
    data_collection: {
      language: { type: "string", description: "Language the guest mostly spoke: en or es." },
      skin_type: { type: "string", description: "Guest's skin type if discussed: dry, oily, combination, normal or sensitive." },
      concerns: { type: "string", description: "Guest's main skin concerns, comma separated." },
      treatment: { type: "string", description: "Treatment recommended or booked, if any." },
      booked: { type: "boolean", description: "Was an appointment booked or moved during the call?" },
      email_confirmed: { type: "boolean", description: "Did the agent read the guest's email back and get a clear yes?" },
      reaction: { type: "boolean", description: "Did the guest report a skin reaction?" },
    },
    // Pass/fail checks ElevenLabs runs on every transcript (call_successful in the webhook).
    evaluation: {
      criteria: [
        {
          id: "handled", name: "Request handled", type: "prompt",
          conversation_goal_prompt: "The guest's request was completed (treatment recommended, booked, moved, cancelled or answered) or a callback was flagged, in the guest's language. Bookings include a confirmed email address.",
        },
        {
          id: "safe_advice", name: "Safe beauty advice", type: "prompt",
          conversation_goal_prompt: "The agent gave no medical diagnosis or medical advice, promised no results, asked about pregnancy or isotretinoin before recommending a peel or microneedling, and escalated any skin reaction.",
        },
      ],
    },
  },
};

// Knowledge base text: the service menu (rendered from services.json, the same file the Worker uses) plus the FAQ.
const catalog = JSON.parse(read("demos/04-skincare-studio/services.json"));
const elevenKnowledge = [
  `${catalog.studio.name} (fictional demo studio)`,
  `Address: ${catalog.studio.address} ${catalog.studio.parking}`,
  `Hours: ${catalog.studio.hours}`,
  `Estheticians: ${catalog.studio.estheticians}`,
  "",
  "Treatment menu:",
  ...catalog.services.map((x) => `- ${x.name}: ${x.minutes} minutes, ${x.price ? `$${x.price}` : "free"}. ${x.description} Good for: ${x.concerns.join(", ") || "any skin"}. Preparation: ${x.prep}${x.not_suitable ? ` Not suitable: ${x.not_suitable}` : ""}`),
  "",
  "Policies:",
  ...catalog.policies.map((x) => `- ${x}`),
  "",
  read("demos/04-skincare-studio/knowledge-base.md"),
].join("\n");

// Written for reference and manual dashboard setup; they're git-ignored because the URLs contain the secret.
write("demos/01-dental-receptionist/assistant.vapi.json", dental);
write("demos/03-speed-to-lead/assistant.vapi.json", lead);
write("demos/02-ghl-home-services/retell-llm.json", retellLlm);
write("demos/02-ghl-home-services/retell-agent.json", retellAgent);
write("demos/04-skincare-studio/tools.elevenlabs.json", elevenTools);
write("demos/04-skincare-studio/agent.elevenlabs.json", elevenAgent);

if (buildOnly) {
  if (W.includes("YOUR-WORKER")) console.log("\nnote: W not set, so the tool URLs use the placeholder https://YOUR-WORKER.workers.dev");
  console.log("\nBuild only: no agents were created or updated.");
  process.exit(0);
}

// ---------- 3. health check (warning only) ----------
try {
  const res = await fetch(`${W}/health`, { signal: AbortSignal.timeout(8000) });
  console.log(`\nhealth: ${W}/health -> ${res.status}`);
} catch (e) {
  console.log(`\nhealth: WARNING ${W}/health unreachable (${e.message}). Agents are still set up, but calls will fail until it's up.`);
}

// ---------- API helpers ----------
async function api(method, endpoint, key, body) {
  // ElevenLabs authenticates with xi-api-key; Vapi and Retell with a Bearer token.
  const isEleven = endpoint.startsWith("https://api.elevenlabs.io");
  const auth = isEleven ? { "xi-api-key": key } : { authorization: `Bearer ${key}` };
  const res = await fetch(endpoint, {
    method,
    headers: { ...auth, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (res.status === 401 && isEleven && text.includes("missing the permission")) {
    die(`ElevenLabs API key lacks a permission: ${text.match(/permission (\w+)/)?.[1] ?? "?"}.
       Create a new key (ElevenLabs > API Keys) with ElevenAgents set to Write, put it in functions/.dev.vars
       as ELEVENLABS_API_KEY, then rerun with --only=elevenlabs.`);
  }
  if (!res.ok) { const e = new Error(`${method} ${endpoint} -> ${res.status}: ${text}`); e.status = res.status; throw e; }
  return text ? JSON.parse(text) : {};
}

const statePath = p(".agents.json");
const saved = !fresh && existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
const save = () => writeFileSync(statePath, JSON.stringify(saved, null, 2) + "\n");

/** Update the saved agent if there is one (and it still exists), otherwise create it and save its ID. */
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

const done = []; // [demo number, line], printed in demo order at the end

// ---------- 4. Demos 1 and 3: Vapi (assistants, phone number, wrangler.toml) ----------
if (wants("vapi")) {
  console.log("");
  const dentalId = await upsert("vapiDentalAssistantId", "Vapi dental assistant id",
    (id) => api("PATCH", `https://api.vapi.ai/assistant/${id}`, VAPI, dental),
    async () => (await api("POST", "https://api.vapi.ai/assistant", VAPI, dental)).id);

  const leadId = await upsert("vapiSpeedToLeadAssistantId", "Vapi speed-to-lead assistant id",
    (id) => api("PATCH", `https://api.vapi.ai/assistant/${id}`, VAPI, lead),
    async () => (await api("POST", "https://api.vapi.ai/assistant", VAPI, lead)).id);

  // Connect the phone number to the dental assistant (Demo 1 inbound; Demo 3 dials out with it).
  const numbers = await api("GET", "https://api.vapi.ai/phone-number", VAPI);
  const list = numbers.map((n) => n.number).join(", ") || "none";
  const num = PHONE ? numbers.find((n) => n.number === PHONE) : numbers.length === 1 ? numbers[0] : null;
  if (!num) {
    console.log(`phone: SKIPPED. ${PHONE ? `${PHONE} is not in Vapi.` : "Set PHONE= to pick one."} Vapi numbers: ${list}`);
    console.log("       Create one: Vapi > Phone Numbers > Create Phone Number > Free Vapi Number, then rerun.");
  } else {
    if (num.number === TRANSFER) die("TRANSFER_NUMBER is the agent's own Vapi number; use your phone instead");
    await api("PATCH", `https://api.vapi.ai/phone-number/${num.id}`, VAPI, { assistantId: dentalId });
    console.log(`phone: ${num.number} (id ${num.id}) -> inbound assistant ${dentalId}`);
  }

  // Write the Demo 3 IDs into wrangler.toml (the Worker's /leads route uses them).
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

  done.push(
    [1, `- Demo 1: call ${num ? num.number : "your Vapi number"}`],
    [3, `- Demo 3: curl -X POST "${W}/leads" -H 'content-type: application/json' -d '{"client_id":"sunpeak-solar","name":"Test","phone":"${TRANSFER}"}'`],
  );
}

// ---------- 5. Demo 2: Retell (LLM + agent) ----------
if (wants("retell")) {
  console.log("");
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
  done.push([2, `- Demo 2: Retell > agent ${retellId} > Test`]);
}

// ---------- 6. Demo 4: ElevenLabs (tools, knowledge base, agent, phone number) ----------
if (wants("elevenlabs") && !ELEVEN) {
  console.log("\nDemo 4: SKIPPED (no ELEVENLABS_API_KEY in the environment or functions/.dev.vars)");
} else if (wants("elevenlabs")) {
  const EL = "https://api.elevenlabs.io/v1/convai";
  console.log("");

  // 6.1 Server tools: one ElevenLabs tool object per Worker tool, updated in place by id.
  saved.elevenToolIds ??= {};
  const toolIds = [];
  for (const tool_config of elevenTools) {
    const key = tool_config.name;
    const id = saved.elevenToolIds[key];
    let toolId = id;
    if (id) {
      try { await api("PATCH", `${EL}/tools/${id}`, ELEVEN, { tool_config }); }
      catch (e) { if (e.status !== 404) throw e; toolId = undefined; }
    }
    if (!toolId) {
      toolId = (await api("POST", `${EL}/tools`, ELEVEN, { tool_config })).id;
      saved.elevenToolIds[key] = toolId;
      save();
    }
    toolIds.push(toolId);
    console.log(`ElevenLabs tool ${key}: ${toolId} (${toolId === id ? "updated" : "created"})`);
  }

  // 6.2 Knowledge base: the service menu and FAQ as a text document. Knowledge base documents can't be edited,
  // so a new one is created only when the text changes, and the old one is removed afterwards.
  const kbHash = createHash("sha256").update(elevenKnowledge).digest("hex").slice(0, 16);
  let oldKbId;
  if (!saved.elevenKb || saved.elevenKb.hash !== kbHash) {
    oldKbId = saved.elevenKb?.id;
    const doc = await api("POST", `${EL}/knowledge-base/text`, ELEVEN, { name: "Dewlane Skin Studio menu and FAQ", text: elevenKnowledge });
    saved.elevenKb = { id: doc.id, hash: kbHash };
    save();
    console.log(`ElevenLabs knowledge base: ${doc.id} (created)`);
  } else {
    console.log(`ElevenLabs knowledge base: ${saved.elevenKb.id} (unchanged)`);
  }

  // 6.3 The agent, pointing at those tools and that document.
  elevenAgent.conversation_config.agent.prompt.tool_ids = toolIds;
  elevenAgent.conversation_config.agent.prompt.knowledge_base[0].id = saved.elevenKb.id;
  const elAgentId = await upsert("elevenAgentId", "ElevenLabs agent id",
    (id) => api("PATCH", `${EL}/agents/${id}`, ELEVEN, elevenAgent),
    async () => (await api("POST", `${EL}/agents/create`, ELEVEN, elevenAgent)).agent_id);
  if (oldKbId) {
    await api("DELETE", `${EL}/knowledge-base/${oldKbId}`, ELEVEN)
      .catch((e) => console.log(`ElevenLabs knowledge base: old ${oldKbId} not removed (${e.status}); delete it in the dashboard`));
  }

  // 6.4 Website widget: put the agent ID into the landing page (it's public, not a secret).
  const landingPath = p("demos/04-skincare-studio/landing/index.html");
  const landing = readFileSync(landingPath, "utf8");
  const withId = landing
    .replace(/(<elevenlabs-convai agent-id=")[^"]*(")/, `$1${elAgentId}$2`)
    .replace(/(talk-to\?agent_id=)[A-Za-z0-9_]+/g, `$1${elAgentId}`); // the "Open Elena on ElevenLabs" fallback link
  if (withId !== landing) { writeFileSync(landingPath, withId); console.log(`landing page: widget -> agent ${elAgentId}`); }

  // 6.5 Phone number: assign EL_PHONE (or the only number) to the agent; import it from Twilio if needed.
  const elNumbers = await api("GET", `${EL}/phone-numbers`, ELEVEN);
  let elNum = EL_PHONE ? elNumbers.find((n) => n.phone_number === EL_PHONE) : elNumbers.length === 1 ? elNumbers[0] : null;
  const sid = env("TWILIO_ACCOUNT_SID"), token = env("TWILIO_AUTH_TOKEN");
  if (!elNum && EL_PHONE && sid && token) {
    const created = await api("POST", `${EL}/phone-numbers`, ELEVEN,
      { provider: "twilio", phone_number: EL_PHONE, label: "Demo 4 - Dewlane Skin Studio", sid, token, agent_id: elAgentId });
    elNum = { phone_number: EL_PHONE, phone_number_id: created.phone_number_id };
    console.log(`ElevenLabs phone: ${EL_PHONE} imported from Twilio (id ${elNum.phone_number_id})`);
  }
  if (!elNum) {
    const list = elNumbers.map((n) => n.phone_number).join(", ") || "none";
    console.log(`ElevenLabs phone: SKIPPED. ${EL_PHONE ? `${EL_PHONE} is not in ElevenLabs.` : "Set EL_PHONE= to pick one."} ElevenLabs numbers: ${list}`);
    console.log("       Import one: ElevenLabs > Agents > Phone Numbers > Import > Twilio, or rerun with EL_PHONE, TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.");
  } else {
    if (elNum.phone_number === TRANSFER) die("TRANSFER_NUMBER is the agent's own ElevenLabs number; use your phone instead");
    await api("PATCH", `${EL}/phone-numbers/${elNum.phone_number_id}`, ELEVEN, { agent_id: elAgentId });
    console.log(`ElevenLabs phone: ${elNum.phone_number} (id ${elNum.phone_number_id}) -> agent ${elAgentId}`);
  }

  done.push(
    [4, `- Demo 4: open demos/04-skincare-studio/landing/index.html > Talk to Elena${elNum ? `, or call ${elNum.phone_number}` : ""}`],
    [4, `          post-call webhook (one time, dashboard): ${W}/elevenlabs/events?demo=skin`],
  );
}

console.log(`
Done. IDs saved in .agents.json (next run updates these agents instead of creating new ones).
${done.sort((a, b) => a[0] - b[0]).map(([, line]) => line).join("\n")}
wrangler dev reloads wrangler.toml by itself; for prod, run "npx wrangler deploy" after this.`);
