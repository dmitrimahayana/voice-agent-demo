// Demo 3: web form -> AI outbound call in seconds. Code-first twin of demos/03-speed-to-lead/n8n-workflow.json.
import type { Env, Tool } from "../env";
import { startOutboundCall } from "../lib/vapi";
import { logRow } from "../lib/sheets";
import { digits, json, parseCsv, str } from "../lib/util";

export async function loadClient(env: Env, clientId: string): Promise<Record<string, string> | undefined> {
  if (!env.CLIENTS_CSV_URL) throw new Error("CLIENTS_CSV_URL is not set (publish clients.csv as a Google Sheet CSV link)");
  const res = await fetch(env.CLIENTS_CSV_URL);
  if (!res.ok) throw new Error(`client config fetch failed: ${res.status}`);
  return parseCsv(await res.text()).find((r) => r.client_id === clientId);
}

/** E.164 for US numbers typed loosely in a form ("(555) 123-4567" -> "+15551234567"). */
function toE164(raw: string): string {
  const d = digits(raw);
  if (raw.trim().startsWith("+")) return `+${d}`;
  return d.length === 10 ? `+1${d}` : `+${d}`;
}

export async function handleLead(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const clientId = str(body.client_id);
  const name = str(body.name);
  const phone = toE164(str(body.phone));
  if (!clientId || !name || digits(phone).length < 10) return json({ ok: false, error: "client_id, name and phone are required" }, 400);

  const client = await loadClient(env, clientId);
  if (!client) return json({ ok: false, error: `unknown client_id ${clientId}` }, 404);

  const call = await startOutboundCall(env, { number: phone, name }, {
    agent_name: client.agent_name,
    business_name: client.business_name,
    offer: str(body.offer) || client.offer,
    lead_first_name: name.split(/\s+/)[0],
    lead_message: str(body.message, "no message"),
    q1: client.q1,
    q2: client.q2,
    q3: client.q3,
    meeting_type: client.meeting_type,
    price_guidance: client.price_guidance,
  });

  ctx.waitUntil(logRow(env, { demo: `speed-to-lead:${clientId}`, platform: "vapi", callId: call.id, caller: phone, event: "lead_called", details: str(body.message) }));
  return json({ ok: true, callId: call.id, message: `Calling ${name} now on behalf of ${client.business_name}.` });
}

/** Tool the speed-to-lead agent calls before hanging up, so every lead has an outcome in the log. */
export const logOutcome: Tool = async (args, tc) => {
  tc.ctx.waitUntil(logRow(tc.env, {
    demo: "speed-to-lead", platform: tc.platform, callId: tc.callId, caller: tc.callerNumber,
    event: str(args.outcome, "unknown"), details: str(args.note),
  }));
  return "Outcome saved.";
};
