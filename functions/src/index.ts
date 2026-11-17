// One Cloudflare Worker serves the tool calls and call events for all four demos.
//
//   POST /vapi/tools?demo=dental|home|lead&key=SECRET     Vapi "tool-calls" server messages
//   POST /vapi/events?demo=...&key=SECRET                 Vapi end-of-call-report
//   POST /retell/tools/<name>?demo=home&key=SECRET        Retell custom function (one URL per function)
//   POST /retell/events?demo=home&key=SECRET              Retell agent webhook (call_analyzed)
//   POST /elevenlabs/tools/<name>?demo=skin&key=SECRET    ElevenLabs server tool (one URL per tool, Demo 4)
//   POST /elevenlabs/events?demo=skin                     ElevenLabs post-call webhook (HMAC-signed)
//   POST /leads                                           Demo 3 form submit -> outbound call
//   POST /calcom/webhook                                  Cal.com booking events -> Supabase (Demo 1)
//   GET  /health                                          health check (GET / is the showcase page in ../site)
import type { Env, Tool, ToolArgs, ToolContext } from "./env";
import { handleCalcomWebhook } from "./handlers/calcomWebhook";
import { bookMeeting, dentalTools } from "./handlers/dental";
import { homeServicesTools } from "./handlers/homeServices";
import { handleLead, logOutcome } from "./handlers/leads";
import { learnTools } from "./handlers/learn";
import { skincareTools } from "./handlers/skincare";
import { logRow } from "./lib/sheets";
import { hmacSha256Hex, json, str } from "./lib/util";

const TOOLSETS: Record<string, Record<string, Tool>> = {
  dental: dentalTools,
  home: homeServicesTools,
  // Demo 3 books on the same Cal.com event type as Demo 1.
  // Practice toolset for docs/LEARNING-PATH.md (no API keys needed).
  learn: learnTools,
  lead: { check_calendar: dentalTools.check_availability, book_meeting: bookMeeting, log_outcome: logOutcome },
  // Demo 4: Dewlane Skin Studio on ElevenLabs (own Cal.com event type, reservation emails).
  skin: skincareTools,
};

async function runTool(demo: string, name: string, args: ToolArgs, tc: ToolContext): Promise<string> {
  const tool = TOOLSETS[demo]?.[name];
  if (!tool) return `Unknown tool ${name} for demo ${demo}.`;
  try {
    return await tool(args, tc);
  } catch (err) {
    console.error(`tool ${demo}/${name} failed`, err);
    // Spoken fallback so the agent never goes silent on a failed API call.
    return "The system is not responding right now. Apologise, take the caller's name and number, and promise a callback.";
  }
}

function authorized(req: Request, url: URL, env: Env): boolean {
  if (!env.WEBHOOK_SECRET) return true;
  return url.searchParams.get("key") === env.WEBHOOK_SECRET || req.headers.get("x-vapi-secret") === env.WEBHOOK_SECRET;
}

// ---------- Vapi ----------
interface VapiToolCall { id: string; function: { name: string; arguments: ToolArgs | string } }
interface VapiMessage {
  type: string;
  call?: { id: string; customer?: { number?: string } };
  // Vapi puts the caller here on phone calls; call.customer is often missing.
  customer?: { number?: string };
  toolCallList?: VapiToolCall[];
  // end-of-call-report fields
  endedReason?: string;
  durationSeconds?: number;
  summary?: string;
  recordingUrl?: string;
  analysis?: { summary?: string };
  artifact?: { recordingUrl?: string };
}

/** Caller ID from a Vapi message: top-level customer first, then call.customer. Empty on web/browser calls. */
const vapiCaller = (m: VapiMessage) => m.customer?.number || m.call?.customer?.number || undefined;

async function vapiTools(req: Request, env: Env, ctx: ExecutionContext, demo: string) {
  const { message } = (await req.json()) as { message: VapiMessage };
  const callerNumber = vapiCaller(message);
  if (!callerNumber) console.warn(`vapi ${demo}: no caller number in tool-calls message (web call?)`);
  const tc: ToolContext = { env, ctx, platform: "vapi", callId: message.call?.id ?? "", callerNumber };
  const results = await Promise.all(
    (message.toolCallList ?? []).map(async (c) => {
      const args = typeof c.function.arguments === "string" ? JSON.parse(c.function.arguments || "{}") : c.function.arguments;
      return { toolCallId: c.id, result: await runTool(demo, c.function.name, args ?? {}, tc) };
    }),
  );
  return json({ results });
}

async function vapiEvents(req: Request, env: Env, ctx: ExecutionContext, demo: string) {
  const { message } = (await req.json()) as { message: VapiMessage };
  if (message.type === "end-of-call-report") {
    ctx.waitUntil(logRow(env, {
      demo, platform: "vapi", callId: message.call?.id ?? "", caller: vapiCaller(message),
      event: "call_ended", details: message.endedReason,
      summary: message.analysis?.summary ?? message.summary,
      recordingUrl: message.artifact?.recordingUrl ?? message.recordingUrl,
      durationSec: message.durationSeconds,
    }));
  }
  return json({ ok: true });
}

// ---------- Retell ----------
interface RetellCall {
  call_id: string;
  from_number?: string;
  to_number?: string;
  direction?: string;
  recording_url?: string;
  start_timestamp?: number;
  end_timestamp?: number;
  disconnection_reason?: string;
  call_analysis?: { call_summary?: string };
}

async function retellTool(req: Request, env: Env, ctx: ExecutionContext, demo: string, name: string) {
  const body = (await req.json()) as { call?: RetellCall; args?: ToolArgs; name?: string };
  const call = body.call;
  const caller = call?.direction === "outbound" ? call?.to_number : call?.from_number;
  const tc: ToolContext = { env, ctx, platform: "retell", callId: call?.call_id ?? "", callerNumber: caller };
  // Retell sends {call, name, args}; with "args only" enabled it sends the args object directly.
  const args = body.args ?? (body as ToolArgs);
  return json({ result: await runTool(demo, name || str(body.name), args, tc) });
}

async function retellEvents(req: Request, env: Env, ctx: ExecutionContext, demo: string) {
  const { event, call } = (await req.json()) as { event: string; call: RetellCall };
  if (event === "call_analyzed") {
    const dur = call.end_timestamp && call.start_timestamp ? Math.round((call.end_timestamp - call.start_timestamp) / 1000) : undefined;
    ctx.waitUntil(logRow(env, {
      demo, platform: "retell", callId: call.call_id, caller: call.from_number,
      event: "call_ended", details: call.disconnection_reason,
      summary: call.call_analysis?.call_summary, recordingUrl: call.recording_url, durationSec: dur,
    }));
  }
  return new Response(null, { status: 204 });
}

// ---------- ElevenLabs ----------
// Server (webhook) tools: one URL per tool, the body is exactly the tool's request_body_schema.
// ElevenLabs adds no call metadata by itself, so each tool schema maps two extra body fields to
// system dynamic variables: caller_id <- system__caller_id, conversation_id <- system__conversation_id.

/** system__caller_id is null on browser/test calls; it can arrive as null, "", "None" or "null". */
const elCaller = (v: unknown) => {
  const s = str(v);
  return s && !/^(none|null|undefined|unknown)$/i.test(s) ? s : undefined;
};

async function elevenTool(req: Request, env: Env, ctx: ExecutionContext, demo: string, name: string) {
  const { caller_id, conversation_id, ...args } = (await req.json()) as ToolArgs;
  const callerNumber = elCaller(caller_id);
  if (!callerNumber) console.warn(`elevenlabs ${demo}/${name}: no caller_id (browser test call?)`);
  const tc: ToolContext = { env, ctx, platform: "elevenlabs", callId: str(conversation_id), callerNumber };
  return json({ result: await runTool(demo, name, args, tc) });
}

/**
 * ElevenLabs-Signature: t=<unix seconds>,v0=<hex hmac>[,v0=...]. HMAC-SHA256 of "<t>.<raw body>"
 * with the webhook secret; any v0 may match; reject timestamps older than 30 minutes.
 */
async function validElevenSignature(secret: string, raw: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v0").map(([, v]) => v?.toLowerCase());
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > 30 * 60) return false;
  return sigs.includes(await hmacSha256Hex(secret, `${t}.${raw}`));
}

interface ElevenPostCall {
  type: string; // "post_call_transcription" | "post_call_audio" | "call_initiation_failure"
  data?: {
    agent_id?: string;
    conversation_id?: string;
    status?: string;
    metadata?: { call_duration_secs?: number; phone_call?: { external_number?: string } };
    analysis?: {
      transcript_summary?: string;
      call_successful?: string;
      data_collection_results?: Record<string, { value?: unknown }>;
    };
    conversation_initiation_client_data?: { dynamic_variables?: Record<string, unknown> };
    failure_reason?: string;
  };
}

async function elevenEvents(req: Request, url: URL, env: Env, ctx: ExecutionContext, demo: string) {
  const raw = await req.text();
  // Signed by ElevenLabs when the secret is set; otherwise the URL must carry ?key= like the other routes.
  const ok = env.ELEVENLABS_WEBHOOK_SECRET
    ? await validElevenSignature(env.ELEVENLABS_WEBHOOK_SECRET, raw, req.headers.get("elevenlabs-signature"))
    : authorized(req, url, env);
  if (!ok) return json({ error: "unauthorized" }, 401);

  const { type, data } = JSON.parse(raw) as ElevenPostCall;
  if (data && (type === "post_call_transcription" || type === "call_initiation_failure")) {
    const caller = elCaller(data.conversation_initiation_client_data?.dynamic_variables?.system__caller_id)
      ?? elCaller(data.metadata?.phone_call?.external_number);
    // Data collection fields (booked, language, reason...) and the success evaluation, as one readable string.
    const collected = Object.entries(data.analysis?.data_collection_results ?? {})
      .filter(([, r]) => r?.value != null && r.value !== "")
      .map(([k, r]) => `${k}=${str(r.value)}`);
    const details = type === "call_initiation_failure"
      ? str(data.failure_reason, "call initiation failed")
      : [`success=${str(data.analysis?.call_successful, "unknown")}`, ...collected].join(" | ");
    ctx.waitUntil(logRow(env, {
      demo, platform: "elevenlabs", callId: str(data.conversation_id), caller,
      event: type === "call_initiation_failure" ? "call_failed" : "call_ended", details,
      summary: data.analysis?.transcript_summary, durationSec: data.metadata?.call_duration_secs,
    }));
  }
  // ElevenLabs disables a webhook after repeated non-200 answers, so always acknowledge.
  return json({ ok: true });
}

// ---------- router ----------
export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const demo = url.searchParams.get("demo") ?? "dental";

    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type" },
      });
    }
    // "/" itself is the showcase page (static assets in ../site); /health is the API health check.
    if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) return json({ ok: true, service: "voice-agent-functions" });
    if (req.method !== "POST") return json({ error: "not found" }, 404);

    try {
      // Public endpoint for the demo landing form (rate-limit it with a Cloudflare WAF rule before sharing widely).
      if (url.pathname === "/leads") return await handleLead(req, env, ctx);
      // Verified by Cal.com's HMAC signature (CALCOM_WEBHOOK_SECRET), not ?key=.
      if (url.pathname === "/calcom/webhook") return await handleCalcomWebhook(req, env);
      // Verified by the ElevenLabs HMAC signature (ELEVENLABS_WEBHOOK_SECRET), or ?key= when that's unset.
      if (url.pathname === "/elevenlabs/events") return await elevenEvents(req, url, env, ctx, demo);

      if (!authorized(req, url, env)) return json({ error: "unauthorized" }, 401);
      if (url.pathname === "/vapi/tools") return await vapiTools(req, env, ctx, demo);
      if (url.pathname === "/vapi/events") return await vapiEvents(req, env, ctx, demo);
      if (url.pathname === "/retell/events") return await retellEvents(req, env, ctx, demo);
      const m = url.pathname.match(/^\/retell\/tools\/([\w-]+)$/);
      if (m) return await retellTool(req, env, ctx, demo, m[1]);
      const e = url.pathname.match(/^\/elevenlabs\/tools\/([\w-]+)$/);
      if (e) return await elevenTool(req, env, ctx, demo, e[1]);
      return json({ error: "not found" }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: String(err) }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
