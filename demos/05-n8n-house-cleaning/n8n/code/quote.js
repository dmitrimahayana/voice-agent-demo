// get_quote: price, time on site and recurring options from PRICING (pricing.json, inlined by build.mjs).
const a = reqOf().args;
const P = PRICING.price;
const H = PRICING.labor_hours;
const round = (n) => Math.round(n / P.round_to) * P.round_to;

const type = matchOption(PRICING.types, a.cleaning_type);
const asked = matchOption(PRICING.frequency, a.frequency) || "One-time";
const beds = Math.max(0, Math.round(Number(a.bedrooms) || 0));
const baths = Math.max(1, Math.round((Number(a.bathrooms) || 1) * 2) / 2); // half baths count as 0.5
const pets = /^(y|yes|true)$|dog|cat|pet/i.test(str(a.pets)) && !/^(no|none|false|0)$/i.test(str(a.pets));

let reply;
let row;
if (!type) {
  reply = { error: "unknown_type", instruction: "Ask which type they want: Standard, Deep, Move-in/Move-out or Post-construction. Then call get_quote again." };
} else if (beds > PRICING.limits.max_bedrooms || baths > PRICING.limits.max_bathrooms) {
  reply = { custom_quote: true, instruction: "Homes this size get a custom quote. Say a manager will call with a price today, then call add_note_and_tags with tag custom-quote." };
  row = sheetRow("custom_quote", `${type} | ${beds} bd ${baths} ba`);
} else {
  const T = PRICING.types[type];
  const oneTime = Math.max(P.minimum, round((P.base + beds * P.per_bedroom + baths * P.per_bathroom) * T.price_multiplier + (pets ? P.pets_fee : 0)));
  const canRecur = PRICING.recurring_types.includes(type);
  const frequency = canRecur ? asked : "One-time";
  const visit = round(oneTime * (1 - PRICING.frequency[frequency].discount));
  const labor = (H.base + beds * H.per_bedroom + baths * H.per_bathroom) * T.hours_multiplier;
  const crew = labor > H.two_person_crew_above ? 2 : 1;
  const hours = Math.max(2, Math.ceil((labor / crew) * 2) / 2);
  const per = frequency === "One-time" ? "" : ` a visit, ${frequency.toLowerCase()}, ${Math.round(PRICING.frequency[frequency].discount * 100)}% off`;
  reply = {
    cleaning_type: type,
    frequency,
    quote_total: visit,
    hours,
    crew_size: crew,
    includes: T.includes,
    say: `${type} cleaning for ${beds} bedrooms and ${baths} bathrooms: $${visit}${per}. ${crew === 2 ? "A team of two" : "One cleaner"}, about ${hours} hours on site.`,
    recurring_options: canRecur && frequency === "One-time"
      ? Object.entries(PRICING.frequency).filter(([k]) => k !== "One-time")
          .map(([k, f]) => ({ frequency: k, visit_price: round(oneTime * (1 - f.discount)), discount_percent: Math.round(f.discount * 100) }))
      : [],
    note: asked !== frequency ? "Recurring discounts apply to Standard cleanings only, so this is quoted as one-time." : undefined,
    instruction: "Say the price and the time on site. If they want to book: check_calendar, then book_cleaning with hours and quote_total.",
  };
  row = sheetRow("quoted", `${type} | ${beds} bd ${baths} ba | ${frequency} | $${visit} | ${hours} h`);
}

return [{ json: { result: JSON.stringify(reply), row: row ?? sheetRow("quote_question", str(a.cleaning_type)) } }];
