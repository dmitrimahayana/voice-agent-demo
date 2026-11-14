#!/usr/bin/env node
// Builds the importable agent configs from the prompt files, so prompts stay readable in Markdown.
//
//   WORKER_URL=https://voice-agent-functions.<you>.workers.dev WEBHOOK_SECRET=... node scripts/build-configs.mjs
//   ... node scripts/build-configs.mjs --push     # also creates the agents via the Vapi and Retell APIs
//
// --push needs VAPI_API_KEY and RETELL_API_KEY. Without --push it only writes the JSON files,
// which you can paste into the dashboards. Node 18+, no dependencies.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Secrets not set in the environment fall back to functions/.dev.vars (the file wrangler dev uses).
const devVarsPath = join(root, "functions/.dev.vars");
if (existsSync(devVarsPath)) {
  for (const line of readFileSync(devVarsPath, "utf8").split("\n")) {
    const m = line.match(/^(WEBHOOK_SECRET|VAPI_API_KEY|RETELL_API_KEY)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, "");
  }
}
const read = (p) => readFileSync(join(root, p), "utf8").trim();
const write = (p, obj) => { writeFileSync(join(root, p), JSON.stringify(obj, null, 2) + "\n"); console.log("wrote", p); };

const WORKER = (process.env.WORKER_URL || "https://YOUR-WORKER.workers.dev").replace(/\/$/, "");
const KEY = process.env.WEBHOOK_SECRET || "YOUR_WEBHOOK_SECRET";
const TRANSFER_TO = process.env.TRANSFER_NUMBER || "+15125550100"; // the "front desk" for human handoff
const url = (path, demo) => `${WORKER}${path}?demo=${demo}&key=${encodeURIComponent(KEY)}`;

const obj = (properties, required = []) => ({ type: "object", properties, required });
const s = (description) => ({ type: "string", description });

// ---------- shared tool definitions ----------
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

// ---------- Vapi ----------
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
          destinations: [{ type: "number", number: TRANSFER_TO, message: "Sure, transferring you to the front desk now." }],
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

const dentalPrompt = read("demos/01-dental-receptionist/prompt.md")
  .replace("{{knowledge_base}}", read("demos/01-dental-receptionist/knowledge-base.md"));

const dental = vapiAssistant({
  name: "Demo - Bright Smile Dental (Ava)",
  prompt: dentalPrompt,
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

// ---------- Retell ----------
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
  response_engine: { type: "retell-llm", llm_id: "<filled in by --push, or paste the LLM id>" },
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

write("demos/01-dental-receptionist/assistant.vapi.json", dental);
write("demos/03-speed-to-lead/assistant.vapi.json", lead);
write("demos/02-ghl-home-services/retell-llm.json", retellLlm);
write("demos/02-ghl-home-services/retell-agent.json", retellAgent);

// ---------- optional: create the agents via API ----------
if (process.argv.includes("--push")) {
  const post = async (endpoint, key, body) => {
    const res = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) throw new Error(`${endpoint} ${res.status}: ${text}`);
    return JSON.parse(text);
  };
  if (!process.env.VAPI_API_KEY || !process.env.RETELL_API_KEY) throw new Error("Set VAPI_API_KEY and RETELL_API_KEY to use --push");
  const a1 = await post("https://api.vapi.ai/assistant", process.env.VAPI_API_KEY, dental);
  console.log("Vapi dental assistant id:", a1.id);
  const a3 = await post("https://api.vapi.ai/assistant", process.env.VAPI_API_KEY, lead);
  console.log("Vapi speed-to-lead assistant id:", a3.id, "-> set VAPI_SPEED_TO_LEAD_ASSISTANT_ID");
  const llm = await post("https://api.retellai.com/create-retell-llm", process.env.RETELL_API_KEY, retellLlm);
  const agent = await post("https://api.retellai.com/create-agent", process.env.RETELL_API_KEY, { ...retellAgent, response_engine: { type: "retell-llm", llm_id: llm.llm_id } });
  console.log("Retell agent id:", agent.agent_id);
}
