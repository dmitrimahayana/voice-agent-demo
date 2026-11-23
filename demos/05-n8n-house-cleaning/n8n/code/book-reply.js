// book_cleaning: spoken confirmation; tag, opportunity and Sheet row follow after the reply.
const cfg = cfgOf();
const a = reqOf().args;
const { hours, body } = $("Build booking").first().json;
const late = new Date(Date.parse(body.startTime) + 30 * 60_000).toISOString();
const total = Number(a.quote_total) || undefined;
return [{ json: {
  contact_id: body.contactId,
  opportunity: `Booked - ${str(a.cleaning_type, "Standard")} cleaning${total ? ` $${total}` : ""}`,
  value: total,
  result: `Booked for ${spoken(body.startTime, cfg.timezone)}. The team arrives between ${spokenTime(body.startTime, cfg.timezone)} and ${spokenTime(late, cfg.timezone)} and stays about ${hours} hours. A confirmation text is on its way.`,
  row: sheetRow("booked", `${body.startTime} | ${str(a.cleaning_type)} | ${total ? `$${total}` : "no quote"} | ${str(a.summary)}`),
} }];
