// book_cleaning: the appointment body. Length = hours from get_quote (default 3).
// ignoreFreeSlotValidation: GHL rejects any length other than the calendar's slot duration
// ("Selected slot duration is not a valid duration option"). check_calendar already checked that the whole job fits.
const cfg = cfgOf();
const a = reqOf().args;
const start = new Date(str(a.slot_iso));
const hours = Number(a.hours) > 0 ? Number(a.hours) : 3;
const type = str(a.cleaning_type, "Standard");
return [{ json: { hours, body: {
  calendarId: cfg.calendarId,
  locationId: cfg.locationId,
  contactId: str(a.contact_id),
  startTime: start.toISOString(),
  endTime: new Date(start.getTime() + hours * 3_600_000).toISOString(),
  title: `${type} cleaning: ${str(a.summary, "AI-booked cleaning")}`,
  appointmentStatus: "confirmed",
  ignoreFreeSlotValidation: true,
} } }];
