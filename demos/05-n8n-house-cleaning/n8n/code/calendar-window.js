// check_calendar: the free-slots window. From now (or the preferred day), 5 days; 2 days when a day was named.
const cfg = cfgOf();
const day = str(reqOf().args.preferred_day);
const dayStart = /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(ghlTimeToIso(`${day} 00:00:00`, cfg.timezone)) : NaN;
const from = Math.max(Date.now(), Number.isNaN(dayStart) ? 0 : dayStart);
const days = Number.isNaN(dayStart) ? 5 : 2;
return [{ json: { startDate: String(from), endDate: String(from + days * 86_400_000) } }];
