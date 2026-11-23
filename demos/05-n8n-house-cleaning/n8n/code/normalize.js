// Reads Retell's custom-function request ({call, name, args}) and checks the required arguments.
// `stop` set = answer right away with that text instead of running the tool.
const hook = $("Retell tool call").first().json;
const body = hook.body ?? {};
const call = body.call ?? {};
const args = body.args && typeof body.args === "object" ? body.args : body;
const tool = str(hook.query?.tool) || str(body.name);
const caller = str(call.direction === "outbound" ? call.to_number : call.from_number);
const phone = toE164(str(args.phone) || caller);

const NEED = {
  lookup_customer: [[], ""],
  upsert_contact: [["name"], "Need the caller's full name first."],
  get_quote: [["cleaning_type", "bedrooms", "bathrooms"], "Need the cleaning type and the number of bedrooms and bathrooms first."],
  check_calendar: [[], ""],
  book_cleaning: [["contact_id", "slot_iso"], "Missing contact_id or slot_iso. Call upsert_contact (or lookup_customer) and check_calendar first."],
  reschedule_cleaning: [["contact_id", "slot_iso"], "Missing contact_id or slot_iso. Call lookup_customer and check_calendar first."],
  add_note_and_tags: [["contact_id"], "Missing contact_id. Call upsert_contact or lookup_customer first."],
  record_recurring_interest: [["contact_id"], "Missing contact_id. Call upsert_contact or lookup_customer first."],
};

let stop = "";
if (!NEED[tool]) stop = `Unknown tool "${tool}".`;
else if (NEED[tool][0].some((k) => str(args[k]) === "")) stop = NEED[tool][1];
else if (tool === "lookup_customer" && !phone) stop = "This call has no caller ID. Ask for the mobile number on their account, read it back, then call lookup_customer again with phone.";
else if (tool === "upsert_contact" && !phone) stop = "Need the caller's mobile number too. Ask for it, read it back, then call upsert_contact again with phone.";

return [{ json: { tool, args, phone, callId: str(call.call_id), callerNumber: caller, stop, result: stop } }];
