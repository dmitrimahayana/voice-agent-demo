// upsert_contact: reply with the contact_id; the opportunity is created after the reply.
const a = reqOf().args;
const contactId = $input.first().json.contact.id;
return [{ json: {
  contact_id: contactId,
  opportunity: `${str(a.name)} - ${str(a.cleaning_type, "cleaning")} cleaning`,
  result: JSON.stringify({ contact_id: contactId, instruction: "Use this contact_id in every later tool call." }),
} }];
