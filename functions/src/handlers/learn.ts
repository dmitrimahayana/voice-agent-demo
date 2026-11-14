// Practice tools for docs/LEARNING-PATH.md. No API keys needed, so you can test the
// whole tool-calling loop before connecting Cal.com or GoHighLevel.
import type { Tool } from "../env";
import { str } from "../lib/util";

/** Returns the current time in the business time zone. */
export const getTime: Tool = async (_args, tc) => {
  const now = new Date().toLocaleString("en-US", { timeZone: tc.env.TIMEZONE, dateStyle: "full", timeStyle: "short" });
  return `It is ${now} (${tc.env.TIMEZONE}).`;
};

/** Echoes back what the agent sent, plus the call context, so you can see exactly what arrives. */
export const echo: Tool = async (args, tc) => {
  console.log("echo tool called", { platform: tc.platform, callId: tc.callId, caller: tc.callerNumber, args });
  return `You sent: ${str(args.text, JSON.stringify(args))}. Platform ${tc.platform}, caller ${tc.callerNumber ?? "unknown"}.`;
};

export const learnTools = { get_time: getTime, echo };
