// upsert_contact: the GHL /contacts/upsert body. Custom fields use the bare key ("cleaning_type"), not "contact.cleaning_type".
const cfg = cfgOf();
const req = reqOf();
const a = req.args;
const [firstName, ...rest] = str(a.name).split(/\s+/);
const fields = {
  cleaning_type: a.cleaning_type,
  bedrooms: a.bedrooms,
  bathrooms: a.bathrooms,
  pets: a.pets,
  frequency: a.frequency,
  access_notes: a.access_notes,
};
return [{ json: { body: {
  locationId: cfg.locationId,
  firstName,
  lastName: rest.join(" ") || undefined,
  phone: req.phone,
  address1: str(a.address) || undefined,
  postalCode: str(a.zip) || undefined,
  source: "AI Voice Agent (n8n)",
  tags: ["ai-voice-lead"],
  customFields: Object.entries(fields).filter(([, v]) => str(v) !== "").map(([key, v]) => ({ key, field_value: str(v) })),
} } }];
