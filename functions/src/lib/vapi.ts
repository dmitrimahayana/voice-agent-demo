// Vapi REST API. Docs: https://docs.vapi.ai/api-reference/calls/create
import type { Env } from "../env";
import { fetchJson } from "./util";

export async function startOutboundCall(
  env: Env,
  customer: { number: string; name?: string },
  variableValues: Record<string, string>,
): Promise<{ id: string }> {
  return fetchJson<{ id: string }>("https://api.vapi.ai/call", {
    method: "POST",
    headers: { authorization: `Bearer ${env.VAPI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      assistantId: env.VAPI_SPEED_TO_LEAD_ASSISTANT_ID,
      phoneNumberId: env.VAPI_OUTBOUND_PHONE_NUMBER_ID,
      customer,
      assistantOverrides: { variableValues },
    }),
  });
}
