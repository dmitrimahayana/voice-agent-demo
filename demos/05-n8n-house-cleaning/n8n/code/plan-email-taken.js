// record_recurring_interest: GHL refused to save the email, usually "This location does not allow duplicated contacts"
// because another contact already has it (same household, or a client calling from a new phone).
// Carry on without it: the recurring-interest tag still fires the GHL plan workflow, which takes its no-email branch (office task).
const err = $input.first().json.error;
return [{ json: {
  result: "That email is already on another client's record, so it wasn't saved here. Don't spell it back. Say the team will call about the plan.",
  error: str(err?.message ?? err, "").slice(0, 200),
} }];
