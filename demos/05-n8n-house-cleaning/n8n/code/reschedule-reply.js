// reschedule_cleaning: confirmation; the note and Sheet row follow after the reply.
const cfg = cfgOf();
const a = reqOf().args;
const { from, body } = $("Pick visit to move").first().json;
const was = spoken(from, cfg.timezone);
const now = spoken(body.startTime, cfg.timezone);
return [{ json: {
  contact_id: str(a.contact_id),
  note: `AI call: cleaning moved from ${was} to ${now}.`,
  result: `Moved the cleaning to ${now}. Rescheduling is free with 24 hours' notice, so there's no charge.`,
  row: sheetRow("rescheduled", `${from} -> ${body.startTime}`),
} }];
