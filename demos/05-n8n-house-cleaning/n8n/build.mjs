#!/usr/bin/env node
// Builds the two n8n workflows for Demo 5 from code/*.js and ../pricing.json:
//   tools.workflow.json   POST /webhook/brightnest-tools?tool=<name>&key=<BRIGHTNEST_WEBHOOK_KEY>   (8 Retell custom functions)
//   events.workflow.json  POST /webhook/brightnest-events?key=<BRIGHTNEST_WEBHOOK_KEY>            (Retell agent webhook)
//
//   node demos/05-n8n-house-cleaning/n8n/build.mjs
//
// Rerun after editing code/*.js or pricing.json, then re-import (see ../n8n-setup.md). The JSON holds no secrets:
// the GHL token, webhook key and Sheet URL are read from the container's environment ($env) at run time.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, f), "utf8");
const helpers = read("code/_helpers.js");
const pricing = JSON.parse(read("../pricing.json"));

const uuid = (seed) => {
  const h = createHash("sha1").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

function workflow(name, id) {
  const nodes = [];
  const connections = {};
  const byName = new Map();
  const add = (n) => {
    if (byName.has(n.name)) throw new Error(`duplicate node name ${n.name}`);
    const node = { id: uuid(`${id}/${n.name}`), position: [0, 0], ...n };
    nodes.push(node);
    byName.set(n.name, node);
    return n.name;
  };
  /** from[output] -> to. Output 1 of a node with onError "continueErrorOutput" is its error output. */
  const link = (from, to, output = 0) => {
    const c = (connections[from] ??= { main: [] });
    while (c.main.length <= output) c.main.push([]);
    c.main[output].push({ node: to, type: "main", index: 0 });
  };
  const chain = (...names) => names.forEach((n, i) => i && link(names[i - 1], n));
  /** Left-to-right layout: column = longest path from the trigger, rows in order of discovery. */
  const layout = () => {
    const depth = new Map([[nodes[0].name, 0]]);
    for (let changed = true, guard = 0; changed && guard < 200; guard++) {
      changed = false;
      for (const [from, c] of Object.entries(connections)) {
        c.main.forEach((outs, outputIndex) => outs.forEach(({ node }) => {
          // Error outputs don't push their (shared) target further right.
          const d = (depth.get(from) ?? 0) + 1;
          if (outputIndex === 1 && byName.get(from)?.onError === "continueErrorOutput" && depth.has(node)) return;
          if ((depth.get(node) ?? -1) < d) { depth.set(node, d); changed = true; }
        }));
      }
    }
    const rows = new Map();
    for (const n of nodes) {
      const d = depth.get(n.name) ?? 0;
      const r = rows.get(d) ?? 0;
      rows.set(d, r + 1);
      n.position = [d * 260, r * 180];
    }
  };
  const build = () => {
    layout();
    return { id, name, nodes, connections, settings: { executionOrder: "v1", saveDataSuccessExecution: "all", saveManualExecutions: true }, pinData: {}, active: false };
  };
  return { add, link, chain, build };
}

// ---------- node factories ----------
const cond = (leftValue, operator, rightValue = "") => ({
  options: { caseSensitive: true, leftValue: "", typeValidation: "loose", version: 2 },
  conditions: [{ id: uuid(`${leftValue}${rightValue}`), leftValue, rightValue, operator }],
  combinator: "and",
});
const isTrue = { type: "boolean", operation: "true", singleValue: true };
const equals = { type: "string", operation: "equals" };

const code = (name, file, { pricing: withPricing = false, errorOut = true } = {}) => ({
  name,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  parameters: {
    jsCode: [helpers, withPricing ? `const PRICING = ${JSON.stringify(pricing)};` : "", `// ---- ${file} ----`, read(`code/${file}`)].join("\n"),
  },
  ...(errorOut ? { onError: "continueErrorOutput" } : {}),
});

const ifNode = (name, expression) => ({
  name, type: "n8n-nodes-base.if", typeVersion: 2.2,
  parameters: { conditions: cond(`={{ ${expression} }}`, isTrue), options: {} },
});

const switchNode = (name, expression, keys) => ({
  name, type: "n8n-nodes-base.switch", typeVersion: 3.2,
  parameters: {
    rules: { values: keys.map((k) => ({ conditions: cond(`={{ ${expression} }}`, equals, k), renameOutput: true, outputKey: k })) },
    options: {},
  },
});

const respond = (name, bodyExpr, { status, noData = false } = {}) => ({
  name, type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1,
  parameters: noData
    ? { respondWith: "noData", options: { responseCode: status ?? 204 } }
    : { respondWith: "json", responseBody: `={{ ${bodyExpr} }}`, options: status ? { responseCode: status } : {} },
});
/** Reply with {result} taken from an earlier node (Respond passes its input through, so later nodes can still use it). */
const replyFrom = (name, node) => respond(name, `JSON.stringify({ result: $('${node}').first().json.result })`);

const GHL = "$('Config').first().json.ghlBase";
/**
 * GoHighLevel API v2 call. `path` and `body` are n8n expressions (without {{ }}).
 * critical: before the reply, errors go to the fallback reply. Otherwise (after the reply) errors are ignored.
 */
const ghl = (name, method, path, { query, body, critical = true } = {}) => ({
  name, type: "n8n-nodes-base.httpRequest", typeVersion: 4.2,
  parameters: {
    method,
    url: `={{ ${GHL} + ${path} }}`,
    ...(query ? { sendQuery: true, queryParameters: { parameters: Object.entries(query).map(([n, v]) => ({ name: n, value: `={{ ${v} }}` })) } } : {}),
    sendHeaders: true,
    headerParameters: { parameters: [
      { name: "Authorization", value: "=Bearer {{ $env.GHL_API_TOKEN }}" },
      { name: "Version", value: "2021-07-28" },
      { name: "Accept", value: "application/json" },
    ] },
    ...(body ? { sendBody: true, specifyBody: "json", jsonBody: `={{ JSON.stringify(${body}) }}` } : {}),
    options: { timeout: 8000 },
  },
  onError: critical ? "continueErrorOutput" : "continueRegularOutput",
});

/** Appends a row to the Google Sheet call log (Apps Script web app). Never fails the workflow. */
const sheetLog = (name, rowExpr) => ({
  name, type: "n8n-nodes-base.httpRequest", typeVersion: 4.2,
  parameters: {
    method: "POST",
    url: "={{ $env.SHEETS_WEBHOOK_URL }}",
    sendBody: true, specifyBody: "json", jsonBody: `={{ JSON.stringify(${rowExpr}) }}`,
    options: { timeout: 8000, redirect: { redirect: { followRedirects: true } } },
  },
  onError: "continueRegularOutput",
  notes: "Optional: SHEETS_WEBHOOK_URL (sheets/call-log.gs). Without it this node fails quietly.",
});

const config = (name, extra = []) => ({
  name, type: "n8n-nodes-base.set", typeVersion: 3.4,
  parameters: {
    assignments: { assignments: [
      ["authorized", "boolean", "={{ !$env.BRIGHTNEST_WEBHOOK_KEY || $json.query.key === $env.BRIGHTNEST_WEBHOOK_KEY }}"],
      ["sheetTab", "string", "={{ $env.SHEET_TAB || 'demo5' }}"],
      ...extra,
    ].map(([n, type, value]) => ({ id: uuid(`${name}/${n}`), name: n, type, value })) },
    options: {},
  },
  notes: "Settings come from the container environment (demos/05-n8n-house-cleaning/.env).",
});

const webhook = (name, path) => ({
  name, type: "n8n-nodes-base.webhook", typeVersion: 2,
  parameters: { httpMethod: "POST", path, responseMode: "responseNode", options: {} },
  webhookId: uuid(`webhook/${path}`),
});

const pipelineOpp = (name, contactExpr, nameExpr, stageExpr, { pipelineExpr = "$('Config').first().json.pipelineId", valueExpr = "undefined" } = {}) =>
  ghl(name, "POST", "'/opportunities/upsert'", {
    critical: false,
    body: `{ locationId: $('Config').first().json.locationId, pipelineId: ${pipelineExpr}, pipelineStageId: ${stageExpr}, contactId: ${contactExpr}, name: ${nameExpr}, status: 'open', monetaryValue: ${valueExpr} }`,
  });
const addTags = (name, contactExpr, tagsExpr, critical = true) =>
  ghl(name, "POST", `'/contacts/' + ${contactExpr} + '/tags'`, { critical, body: `{ tags: ${tagsExpr} }` });

// ======================================================================
// Workflow A: the 8 tools
// ======================================================================
const TOOLS = ["lookup_customer", "upsert_contact", "get_quote", "check_calendar", "book_cleaning", "reschedule_cleaning", "add_note_and_tags", "record_recurring_interest"];
const A = workflow("Demo 5: Brightnest tools (Retell -> GHL)", "brightnestTools1");
const cfg = (k) => `$('Config').first().json.${k}`;

A.add(webhook("Retell tool call", "brightnest-tools"));
A.add(config("Config", [
  ["ghlBase", "string", "={{ $env.GHL_BASE_URL || 'https://services.leadconnectorhq.com' }}"],
  ["timezone", "string", "={{ $env.TIMEZONE || 'America/Denver' }}"],
  ["locationId", "string", "={{ $env.GHL_LOCATION_ID }}"],
  ["calendarId", "string", "={{ $env.GHL_CALENDAR_ID }}"],
  ["pipelineId", "string", "={{ $env.GHL_PIPELINE_ID }}"],
  ["stageNew", "string", "={{ $env.GHL_STAGE_NEW }}"],
  ["stageBooked", "string", "={{ $env.GHL_STAGE_BOOKED }}"],
  ["stageAttention", "string", "={{ $env.GHL_STAGE_ATTENTION }}"],
  ["recurringPipelineId", "string", "={{ $env.GHL_RECURRING_PIPELINE_ID }}"],
  ["recurringStageInterested", "string", "={{ $env.GHL_RECURRING_STAGE_INTERESTED }}"],
]));
A.add(ifNode("Key OK?", "$json.authorized"));
A.add(respond("401 Unauthorized", "JSON.stringify({ error: 'unauthorized' })", { status: 401 }));
A.add(code("Normalize", "normalize.js", { errorOut: false }));
A.add(ifNode("Ready?", "!$json.stop"));
A.add(switchNode("Which tool?", "$json.tool", TOOLS));
A.add(respond("Reply", "JSON.stringify({ result: $json.result })"));
A.add(respond("Reply: system down", "JSON.stringify({ result: \"The booking system is not responding right now. Apologise, take the caller's name and number, and promise a callback within the hour.\" })"));
A.add(code("Error row", "error-row.js", { errorOut: false }));
A.add(sheetLog("Log: tool error", "$json.row"));

A.chain("Retell tool call", "Config", "Key OK?", "Normalize", "Ready?", "Which tool?");
A.link("Key OK?", "401 Unauthorized", 1);
A.link("Ready?", "Reply", 1);
A.chain("Reply: system down", "Error row", "Log: tool error");
const fail = (...names) => names.forEach((n) => A.link(n, "Reply: system down", 1));
const tool = (t) => TOOLS.indexOf(t);

// --- lookup_customer ---
A.add(ghl("GHL: find contact by phone", "GET", "'/contacts/search/duplicate'", { query: { locationId: cfg("locationId"), number: "$('Normalize').first().json.phone" } }));
A.add(ifNode("Found?", "!!$json.contact"));
A.add(code("Reply: new client", "lookup-new.js"));
A.add(ghl("GHL: open jobs", "GET", "'/opportunities/search'", { query: { location_id: cfg("locationId"), contact_id: "$('GHL: find contact by phone').first().json.contact.id", status: "'open'" } }));
A.add(ghl("GHL: contact appointments", "GET", "'/contacts/' + $('GHL: find contact by phone').first().json.contact.id + '/appointments'"));
A.add(ghl("GHL: stage names", "GET", "'/opportunities/pipelines'", { query: { locationId: cfg("locationId") }, critical: false }));
A.add(code("Reply: returning client", "lookup-returning.js"));
A.add(replyFrom("Respond: returning client", "Reply: returning client"));
A.add(sheetLog("Log: returning client", "$('Reply: returning client').first().json.row"));
A.add(addTags("Tag: returning-customer", "$('Reply: returning client').first().json.contact_id", "['returning-customer']", false));
A.link("Which tool?", "GHL: find contact by phone", tool("lookup_customer"));
A.chain("GHL: find contact by phone", "Found?");
A.link("Found?", "GHL: open jobs", 0);
A.link("Found?", "Reply: new client", 1);
A.chain("Reply: new client", "Reply");
A.chain("GHL: open jobs", "GHL: contact appointments", "GHL: stage names", "Reply: returning client", "Respond: returning client", "Log: returning client", "Tag: returning-customer");
fail("GHL: find contact by phone", "Reply: new client", "GHL: open jobs", "GHL: contact appointments", "Reply: returning client");

// --- upsert_contact ---
A.add(code("Build contact", "upsert-build.js"));
A.add(ghl("GHL: upsert contact", "POST", "'/contacts/upsert'", { body: "$json.body" }));
A.add(code("Reply: contact saved", "upsert-reply.js"));
A.add(replyFrom("Respond: contact saved", "Reply: contact saved"));
A.add(pipelineOpp("Opportunity: New lead", "$('Reply: contact saved').first().json.contact_id", "$('Reply: contact saved').first().json.opportunity", cfg("stageNew")));
A.link("Which tool?", "Build contact", tool("upsert_contact"));
A.chain("Build contact", "GHL: upsert contact", "Reply: contact saved", "Respond: contact saved", "Opportunity: New lead");
fail("Build contact", "GHL: upsert contact", "Reply: contact saved");

// --- get_quote ---
A.add(code("Calculate quote", "quote.js", { pricing: true }));
A.add(replyFrom("Respond: quote", "Calculate quote"));
A.add(sheetLog("Log: quote", "$('Calculate quote').first().json.row"));
A.link("Which tool?", "Calculate quote", tool("get_quote"));
A.chain("Calculate quote", "Respond: quote", "Log: quote");
fail("Calculate quote");

// --- check_calendar ---
A.add(code("Calendar window", "calendar-window.js"));
A.add(ghl("GHL: free slots", "GET", `'/calendars/' + ${cfg("calendarId")} + '/free-slots'`, { query: { startDate: "$json.startDate", endDate: "$json.endDate", timezone: cfg("timezone") } }));
A.add(code("Reply: open times", "calendar-reply.js"));
A.link("Which tool?", "Calendar window", tool("check_calendar"));
A.chain("Calendar window", "GHL: free slots", "Reply: open times", "Reply");
fail("Calendar window", "GHL: free slots", "Reply: open times");

// --- book_cleaning ---
A.add(code("Build booking", "book-build.js"));
A.add(ghl("GHL: book appointment", "POST", "'/calendars/events/appointments'", { body: "$json.body" }));
A.add(code("Reply: booked", "book-reply.js"));
A.add(replyFrom("Respond: booked", "Reply: booked"));
A.add(sheetLog("Log: booked", "$('Reply: booked').first().json.row"));
A.add(addTags("Tag: booked", "$('Reply: booked').first().json.contact_id", "['booked']", false));
A.add(pipelineOpp("Opportunity: Booked", "$('Reply: booked').first().json.contact_id", "$('Reply: booked').first().json.opportunity", cfg("stageBooked"), { valueExpr: "$('Reply: booked').first().json.value" }));
A.link("Which tool?", "Build booking", tool("book_cleaning"));
A.chain("Build booking", "GHL: book appointment", "Reply: booked", "Respond: booked", "Log: booked", "Tag: booked", "Opportunity: Booked");
fail("Build booking", "GHL: book appointment", "Reply: booked");

// --- reschedule_cleaning ---
A.add(ghl("GHL: appointments to move", "GET", "'/contacts/' + $('Normalize').first().json.args.contact_id + '/appointments'"));
A.add(code("Pick visit to move", "reschedule-pick.js"));
A.add(ifNode("Visit found?", "$json.found"));
A.add(ghl("GHL: move appointment", "PUT", "'/calendars/events/appointments/' + $json.appointmentId", { body: "$json.body" }));
A.add(code("Reply: moved", "reschedule-reply.js"));
A.add(replyFrom("Respond: moved", "Reply: moved"));
A.add(sheetLog("Log: rescheduled", "$('Reply: moved').first().json.row"));
A.add(ghl("Note: moved", "POST", "'/contacts/' + $('Reply: moved').first().json.contact_id + '/notes'", { critical: false, body: "{ body: $('Reply: moved').first().json.note }" }));
A.link("Which tool?", "GHL: appointments to move", tool("reschedule_cleaning"));
A.chain("GHL: appointments to move", "Pick visit to move", "Visit found?");
A.link("Visit found?", "GHL: move appointment", 0);
A.link("Visit found?", "Reply", 1);
A.chain("GHL: move appointment", "Reply: moved", "Respond: moved", "Log: rescheduled", "Note: moved");
fail("GHL: appointments to move", "Pick visit to move", "GHL: move appointment", "Reply: moved");

// --- add_note_and_tags ---
A.add(code("Prep note", "note-prep.js"));
A.add(ifNode("Any tags?", "$json.hasTags"));
A.add(addTags("GHL: add tags", "$('Prep note').first().json.contact_id", "$('Prep note').first().json.tags"));
A.add(ghl("GHL: add note", "POST", "'/contacts/' + $('Prep note').first().json.contact_id + '/notes'", { body: "{ body: $('Prep note').first().json.note }" }));
A.add(replyFrom("Respond: saved", "Prep note"));
A.add(sheetLog("Log: note", "$('Prep note').first().json.row"));
A.add(ifNode("Complaint?", "$('Prep note').first().json.complaint"));
A.add(pipelineOpp("Opportunity: Needs attention", "$('Prep note').first().json.contact_id", "$('Prep note').first().json.opportunity", cfg("stageAttention")));
A.link("Which tool?", "Prep note", tool("add_note_and_tags"));
A.chain("Prep note", "Any tags?");
A.link("Any tags?", "GHL: add tags", 0);
A.link("Any tags?", "GHL: add note", 1);
A.chain("GHL: add tags", "GHL: add note", "Respond: saved", "Log: note", "Complaint?", "Opportunity: Needs attention");
fail("Prep note", "GHL: add tags", "GHL: add note");

// --- record_recurring_interest ---
A.add(code("Prep plan", "plan-prep.js", { pricing: true }));
A.add(switchNode("Plan answer?", "$json.path", ["declined", "email", "no_email", "ask"]));
A.add(addTags("Tag: recurring-declined", "$('Prep plan').first().json.contact_id", "['recurring-declined']"));
A.add(replyFrom("Respond: plan declined", "Prep plan"));
A.add(ghl("GHL: save email", "PUT", "'/contacts/' + $('Prep plan').first().json.contact_id", { body: "{ email: $('Prep plan').first().json.email }" }));
A.add(code("Email in use", "plan-email-taken.js"));
A.add(addTags("Tag: recurring-interest", "$('Prep plan').first().json.contact_id", "['recurring-interest']"));
A.add(respond("Respond: plan saved",
  "JSON.stringify({ result: $('Email in use').isExecuted ? $('Email in use').first().json.result : $('Prep plan').first().json.result })"));
A.add(sheetLog("Log: plan", "$('Prep plan').first().json.row"));
A.add(pipelineOpp("Opportunity: Recurring plan", "$('Prep plan').first().json.contact_id", "$('Prep plan').first().json.opportunity", cfg("recurringStageInterested"),
  { pipelineExpr: cfg("recurringPipelineId"), valueExpr: "$('Prep plan').first().json.value" }));
A.link("Which tool?", "Prep plan", tool("record_recurring_interest"));
A.chain("Prep plan", "Plan answer?");
A.link("Plan answer?", "Tag: recurring-declined", 0);
A.link("Plan answer?", "GHL: save email", 1);
A.link("Plan answer?", "Tag: recurring-interest", 2);
A.link("Plan answer?", "Reply", 3);
A.chain("Tag: recurring-declined", "Respond: plan declined");
A.chain("GHL: save email", "Tag: recurring-interest", "Respond: plan saved", "Log: plan", "Opportunity: Recurring plan");
// Email refused (already on another contact): continue without it instead of "system down".
A.link("GHL: save email", "Email in use", 1);
A.chain("Email in use", "Tag: recurring-interest");
fail("Prep plan", "Tag: recurring-declined", "Email in use", "Tag: recurring-interest");

// ======================================================================
// Workflow B: call events (Retell agent webhook)
// ======================================================================
const B = workflow("Demo 5: Brightnest call events (Retell -> Sheet)", "brightnestEvents");
B.add(webhook("Retell call event", "brightnest-events"));
B.add(config("Config"));
B.add(ifNode("Key OK?", "$json.authorized"));
B.add(respond("401 Unauthorized", "JSON.stringify({ error: 'unauthorized' })", { status: 401 }));
B.add(respond("204 No Content", "", { noData: true }));
B.add(ifNode("Call analysed?", "$('Retell call event').first().json.body.event === 'call_analyzed'"));
B.add(code("Call row", "event-row.js", { errorOut: false }));
B.add(sheetLog("Log: call ended", "$json.row"));
B.chain("Retell call event", "Config", "Key OK?", "204 No Content", "Call analysed?", "Call row", "Log: call ended");
B.link("Key OK?", "401 Unauthorized", 1);

for (const [file, wf] of [["tools.workflow.json", A], ["events.workflow.json", B]]) {
  const out = wf.build();
  writeFileSync(join(here, file), JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote n8n/${file} (${out.nodes.length} nodes)`);
}
