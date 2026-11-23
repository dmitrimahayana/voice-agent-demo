// add_note_and_tags: tags + note. A "complaint" tag also moves the lead to Needs attention (after the reply).
const a = reqOf().args;
const tags = (Array.isArray(a.tags) ? a.tags : str(a.tags).split(","))
  .map((t) => str(t).toLowerCase().replace(/\s+/g, "-")).filter(Boolean);
const note = str(a.note);
const complaint = tags.includes("complaint");
const event = ["complaint", "out-of-area", "custom-quote"].find((t) => tags.includes(t)) ?? "note";
return [{ json: {
  contact_id: str(a.contact_id),
  tags,
  hasTags: tags.length > 0,
  note: note ? `AI call note: ${note}` : `AI call: tagged ${tags.join(", ") || "(none)"}`,
  complaint,
  opportunity: `Complaint - ${note.slice(0, 60) || "see notes"}`,
  result: complaint ? "Complaint logged. Tell them the manager will call them back today." : "Saved to the client record.",
  row: sheetRow(event.replace(/-/g, "_"), `${tags.join(",")} | ${note}`),
} }];
