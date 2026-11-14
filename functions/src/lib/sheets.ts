import type { Env } from "../env";

export interface CallLogRow {
  demo: string;
  platform: string;
  callId: string;
  caller?: string;
  event: string; // "booked", "emergency", "callback", "call_ended", ...
  details?: string;
  summary?: string;
  recordingUrl?: string;
  durationSec?: number;
}

/**
 * Sheet tab for a row. Tool rows and end-of-call rows use different demo labels
 * ("dental" vs ?demo=dental, "home-services" vs ?demo=home, "speed-to-lead:<client>" vs ?demo=lead),
 * so every label of one demo maps to the same tab. Tab names come from SHEET_TAB_DEMO1..3.
 */
export function sheetTab(env: Env, demo: string): string {
  const base = demo.split(":")[0];
  if (base === "dental") return env.SHEET_TAB_DEMO1 || "demo1";
  if (base === "home" || base === "home-services") return env.SHEET_TAB_DEMO2 || "demo2";
  if (base === "lead" || base === "speed-to-lead") return env.SHEET_TAB_DEMO3 || "demo3";
  return base || "log"; // e.g. the "learn" practice toolset
}

/** Appends a row to the Google Sheet through the Apps Script web app (sheets/call-log.gs). Never throws. */
export async function logRow(env: Env, row: CallLogRow): Promise<void> {
  if (!env.SHEETS_WEBHOOK_URL) return;
  try {
    await fetch(env.SHEETS_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timestamp: new Date().toISOString(), sheet: sheetTab(env, row.demo), ...row }),
    });
  } catch (err) {
    console.error("sheet log failed", err);
  }
}
