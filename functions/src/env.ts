export interface Env {
  // secrets
  WEBHOOK_SECRET: string;
  CALCOM_API_KEY: string;
  GHL_API_TOKEN: string;
  VAPI_API_KEY: string;
  SHEETS_WEBHOOK_URL: string;
  // Supabase service-role / secret key (Demo 1 member + booking lists). Optional: without it Demo 1 uses Cal.com only.
  SUPABASE_SERVICE_KEY: string;
  // Signing secret of the Cal.com webhook (optional but recommended)
  CALCOM_WEBHOOK_SECRET?: string;
  // HMAC secret of the ElevenLabs post-call webhook (Demo 4). Without it /elevenlabs/events falls back to ?key=.
  ELEVENLABS_WEBHOOK_SECRET?: string;
  // Resend API key for Demo 4's reservation emails. Without it Cal.com sends its own confirmation email instead.
  RESEND_API_KEY?: string;
  // Sheet tab per demo (set in .dev.vars; default demo1/demo2/demo3/demo4)
  SHEET_TAB_DEMO1?: string;
  SHEET_TAB_DEMO2?: string;
  SHEET_TAB_DEMO3?: string;
  SHEET_TAB_DEMO4?: string;
  // vars
  TIMEZONE: string;
  CALCOM_EVENT_TYPE_ID: string;
  // Demo 4 (skin studio) Cal.com event type; falls back to CALCOM_EVENT_TYPE_ID when unset
  CALCOM_SKIN_EVENT_TYPE_ID?: string;
  // Sender of Demo 4's reservation emails, e.g. "Dewlane Skin Studio <bookings@your-domain.com>" (domain verified in Resend)
  EMAIL_FROM?: string;
  BOOKING_EMAIL_DOMAIN: string;
  SUPABASE_URL: string;
  GHL_LOCATION_ID: string;
  GHL_CALENDAR_ID: string;
  GHL_PIPELINE_ID: string;
  GHL_STAGE_NEW: string;
  GHL_STAGE_BOOKED: string;
  GHL_STAGE_EMERGENCY: string;
  // Demo 2 maintenance plan upsell (optional: without them the tool only tags the contact)
  GHL_MEMBERSHIP_PIPELINE_ID?: string;
  GHL_MEMBERSHIP_STAGE_INTERESTED?: string;
  PLAN_PRICE_PER_YEAR?: string;
  VAPI_SPEED_TO_LEAD_ASSISTANT_ID: string;
  VAPI_OUTBOUND_PHONE_NUMBER_ID: string;
  CLIENTS_CSV_URL: string;
}

/** Context every tool gets, whichever platform (Vapi, Retell or ElevenLabs) made the call. */
export interface ToolContext {
  env: Env;
  ctx: ExecutionContext;
  platform: "vapi" | "retell" | "elevenlabs";
  callId: string;
  callerNumber?: string;
}

export type ToolArgs = Record<string, unknown>;
export type Tool = (args: ToolArgs, tc: ToolContext) => Promise<string>;
