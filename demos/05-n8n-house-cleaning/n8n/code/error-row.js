// After the fallback reply: log which tool failed and why. Built here because n8n expressions refuse a key named "caller".
const err = $input.first().json.error;
return [{ json: { row: sheetRow("tool_error", `${reqOf().tool}: ${str(err?.message ?? err, "unknown error").slice(0, 300)}`) } }];
