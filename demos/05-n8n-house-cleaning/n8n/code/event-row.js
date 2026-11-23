// Events workflow: one Sheet row per analysed call (Retell call_analyzed).
const call = $("Retell call event").first().json.body.call ?? {};
const analysis = call.call_analysis ?? {};
const collected = Object.entries(analysis.custom_analysis_data ?? {})
  .filter(([, v]) => v != null && v !== "")
  .map(([k, v]) => `${k}=${v}`);
const duration = call.end_timestamp && call.start_timestamp ? Math.round((call.end_timestamp - call.start_timestamp) / 1000) : "";
return [{ json: { row: {
  sheet: $("Config").first().json.sheetTab,
  timestamp: new Date().toISOString(),
  demo: "house-cleaning",
  platform: "retell",
  callId: call.call_id ?? "",
  caller: (call.direction === "outbound" ? call.to_number : call.from_number) ?? "",
  event: "call_ended",
  details: [call.disconnection_reason, analysis.user_sentiment && `sentiment=${analysis.user_sentiment}`, ...collected].filter(Boolean).join(" | "),
  summary: analysis.call_summary ?? "",
  durationSec: duration,
  recordingUrl: call.recording_url ?? "",
} } }];
