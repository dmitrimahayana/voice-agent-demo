// record_recurring_interest: decide the path. The email is saved BEFORE the tag, because the GHL workflow fires on the tag.
//   declined -> tag recurring-declined | email -> save email, tag recurring-interest
//   no_email -> tag recurring-interest (team calls) | ask -> ask once for an email
const a = reqOf().args;
const interested = a.interested === true || str(a.interested).toLowerCase() === "true";
const email = str(a.email).toLowerCase().replace(/\s+/g, "");
const frequency = matchOption({ Weekly: 1, Biweekly: 1, Monthly: 1 }, a.frequency) || "Biweekly";
const visits = PRICING.frequency[frequency].visits_per_year;
const visitPrice = Number(a.visit_price) || 0;

const path = !interested ? "declined" : EMAIL_RE.test(email) ? "email" : email === "none" ? "no_email" : "ask";
const result = {
  declined: "Noted. Don't offer the plan again on this call.",
  email: `Saved. The ${frequency.toLowerCase()} plan details are being emailed to ${email}. Spell the address back once to confirm.`,
  no_email: "Saved. Tell them the team will call about the plan.",
  ask: 'No valid email yet. Ask once for their email and spell it back, then call record_recurring_interest again with it. If they would rather not, call it with email "none".',
}[path];

return [{ json: {
  path,
  contact_id: str(a.contact_id),
  email,
  opportunity: `Recurring ${frequency.toLowerCase()} plan${visitPrice ? ` - $${visitPrice}/visit` : ""}`,
  value: visitPrice ? visitPrice * visits : undefined,
  result,
  row: sheetRow(path === "declined" ? "plan_declined" : "plan_interest", `${frequency} | ${visitPrice ? `$${visitPrice}` : "?"} | ${path === "email" ? email : "no email"}`),
} }];
