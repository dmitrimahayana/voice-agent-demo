// check_calendar: only times where the whole cleaning fits. GHL calendars book fixed-length slots (here 1 hour),
// so n8n books the real length with GHL's slot check off, and checks the fit here instead:
// a start time fits when every slot from it until the end is free, which also keeps the job inside opening hours.
// Up to 3 times per day, at least 2 hours apart, 8 in total.
const cfg = cfgOf();
const res = $input.first().json;
const hours = Number(reqOf().args.hours) > 0 ? Number(reqOf().args.hours) : 3;
const lengthMs = hours * 3_600_000;
const GAP_MS = 2 * 3_600_000;

const slots = Object.entries(res)
  .filter(([k]) => /^\d{4}-\d{2}-\d{2}$/.test(k))
  .flatMap(([, v]) => {
    const day = (v.slots ?? []).map((iso) => ({ iso, t: Date.parse(iso) })).sort((x, y) => x.t - y.t);
    const free = new Set(day.map((s) => s.t));
    const gaps = day.slice(1).map((s, i) => s.t - day[i].t).filter((d) => d > 0);
    const step = gaps.length ? Math.min(...gaps) : 3_600_000;
    const fits = (start) => {
      for (let t = start; t < start + lengthMs; t += step) if (!free.has(t)) return false;
      return true;
    };
    const picked = [];
    for (const s of day) {
      if (picked.length === 3) break;
      if (fits(s.t) && (!picked.length || s.t - picked.at(-1).t >= GAP_MS)) picked.push(s);
    }
    return picked.map((s) => s.iso);
  })
  .slice(0, 8);

const result = slots.length
  ? JSON.stringify({
      instruction: "Offer two times. Pass the chosen slot_iso to book_cleaning (or reschedule_cleaning).",
      slots: slots.map((iso) => ({ slot_iso: iso, say: spoken(iso, cfg.timezone) })),
    })
  : `No time in that window fits a ${hours}-hour cleaning. Ask for another day and call check_calendar again with preferred_day and hours.`;
return [{ json: { result } }];
