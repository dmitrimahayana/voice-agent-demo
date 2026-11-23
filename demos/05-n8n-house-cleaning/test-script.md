# Test script: 16 calls before recording

Run `node n8n/smoke-test.mjs` first: if it passes, the n8n side is fine and anything wrong on a voice call is the prompt.
For each call, check n8n > Executions (the path taken), GHL, and the Sheet tab `demo5`.

## New clients
| # | Caller says | Pass when Maya... | Check |
|---|---|---|---|
| 1 | "I need a cleaning, 3 bedrooms 2 baths, zip 80203, I have a dog." | collects name and address, calls `get_quote`, says $205 and about 4 hours, offers two times, books | contact + 6 custom fields, `booked` tag, appointment 4 h long, opportunity Booked $205, rows `quoted` + `booked` |
| 2 | "What's the difference between standard and deep?" | one sentence each, then asks which | none |
| 3 | "Deep clean, 3 bed, two and a half baths." | quotes $320, team of two, 3.5 hours | row `quoted` |
| 4 | "We're moving out on the 30th, 2 bed 1 bath." | Move-in/Move-out quote, `check_calendar` with `preferred_day` | appointment on/near that day |
| 5 | "Eight bedrooms, six bathrooms." | custom quote, a manager will call, no booking | `custom-quote` tag |
| 6 | "I'm in zip 80301." (Boulder) | out of area, polite close, no quote | `out-of-area` tag |
| 7 | "Can you clean the outside windows and the mold in the basement?" | declines those tasks politely | none |
| 8 | "Are you a real person?" | answers honestly | none |

## Recurring plan
| # | Caller says | Pass when Maya... | Check |
|---|---|---|---|
| 9 | After a one-time Standard booking: "Every two weeks sounds good", gives an email | offers once using `recurring_options`, spells the email back | email on contact, then `recurring-interest` tag, opportunity in Recurring plans > Interested (value = visit price × 26), plan email sent |
| 10 | Same, but "I'd rather not give my email" | records with email "none", says the team will call | `recurring-interest` tag, no email, office task |
| 11 | "No thanks" | accepts, doesn't offer again | `recurring-declined` tag |
| 12 | Deep clean booking | does **not** offer the plan | no plan tag |

## Returning clients
Set up first: book with call 1 from your phone (or a web call where you give your number).

| # | Caller says | Pass when Maya... | Check |
|---|---|---|---|
| 13 | Same number: "When is my cleaning?" | `lookup_customer` first, greets by first name, says the day and time | `returning-customer` tag |
| 14 | "Can we move it to Saturday?" | `check_calendar` with that day, `reschedule_cleaning` | **same** appointment moved (no second one), note "cleaning moved from … to …" |
| 15 | Web call, no caller ID: "Checking my booking" | asks for the mobile number, reads it back, finds you | `lookup_customer` called twice in Executions |

## Complaint
| # | Caller says | Pass when Maya... | Check |
|---|---|---|---|
| 16 | "The team missed the whole upstairs bathroom yesterday." | apologises once, logs it, says the manager calls today, no refund promise; on a phone call, "can I talk to someone?" → `transfer_call` | `complaint` tag, note in caller's words, opportunity in Needs attention, manager alert |

Also check after every call: one `call_ended` row in `demo5` with the summary, duration and `booked=…`/`complaint=…` from Retell's post-call analysis.

**Failure drill:** stop the mock (or put a wrong `GHL_API_TOKEN`) and call. Maya should say the system is down and take a callback number, and n8n should log a `tool_error` row.
