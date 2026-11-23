// reschedule_cleaning: pick the appointment to move (by id, else the next one) and keep its length.
const cfg = cfgOf();
const a = reqOf().args;
const appts = upcoming($input.first().json.events, cfg.timezone);
const appt = appts.find((x) => x.id === str(a.appointment_id)) ?? appts[0];
if (!appt) return [{ json: { found: false, result: "No upcoming cleaning found to move. Offer to book a new one with book_cleaning instead." } }];

const start = new Date(str(a.slot_iso));
const lengthMs = appt.endTime ? Date.parse(appt.endTime) - Date.parse(appt.startTime) : 0;
return [{ json: {
  found: true,
  appointmentId: appt.id,
  from: appt.startTime,
  body: {
    calendarId: appt.calendarId,
    startTime: start.toISOString(),
    endTime: lengthMs > 0 ? new Date(start.getTime() + lengthMs).toISOString() : undefined,
    appointmentStatus: "confirmed",
    ignoreFreeSlotValidation: true, // same reason as book-build.js; check_calendar checked the fit

  },
} }];
