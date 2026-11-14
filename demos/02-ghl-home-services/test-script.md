# Test script: 19 calls before recording

| # | Caller says | Pass when Sam... | Check in GHL |
|---|---|---|---|
| 1 | "My kitchen sink is clogged, zip 78704." | qualifies, quotes $89, offers 2 windows, books | contact, custom fields, `booked` tag, appointment, opportunity in Booked |
| 2 | "Water is pouring from the ceiling!" | gives shut-off advice, says tech calls in 15 minutes | `emergency` tag, Emergency stage, SMS to tech |
| 3 | "I smell gas in the basement." | tells them to leave and call 911 or the gas company | `emergency` tag |
| 4 | "No heat, it's 35 degrees out." | treats as emergency | `emergency` tag |
| 5 | "My AC is weak, zip 90210." | out of area, polite referral | `out-of-area` tag |
| 6 | "How much to replace my water heater?" | won't quote, offers a visit | note saved |
| 7 | "It's for my restaurant." | records Commercial | Property Type = Commercial |
| 8 | "Can someone come at exactly 2:15?" | explains windows, offers nearest | appointment in window |
| 9 | "Are you a real person?" | answers honestly | none |
| 10 | Caller gives a different callback number | uses that number | phone field |
| 11 | Caller hangs up mid-call | nothing breaks | partial contact exists |
| 12 | Same caller calls twice | updates the same contact | no duplicate contact |

## Returning customers (feature 1)
Set up first: book a visit with call 1 (from your phone, or a web call where you give your number). That contact is the "returning customer".

| # | Caller says | Pass when Sam... | Check in GHL / Terminal A |
|---|---|---|---|
| 13 | Same number: "Hi, when is my technician coming?" | calls `lookup_customer` straight away, greets you by first name, says the day and window | `returning-customer` tag; Terminal A shows `lookup_customer` |
| 14 | "Can we move it to Thursday?" | `check_calendar`, offers two windows, `reschedule_job` | the **same** appointment moved (no second appointment); note "visit moved from ... to ..." |
| 15 | Web call, no caller ID: "Checking on my booking" | asks for your mobile number, reads it back, finds you | `lookup_customer` called twice (first returns "no caller ID") |
| 16 | Returning caller with a new problem: "Now my water heater is leaking" | doesn't re-ask name or address, books with the existing contact | new appointment on the **same** contact, no duplicate contact |
| 17 | A number that's not in GHL | treats it as a new caller, normal flow | new contact created |

## Maintenance plan upsell (feature 2)
| # | Caller says | Pass when Sam... | Check in GHL |
|---|---|---|---|
| 18 | After a normal booking: "Sure, send me the link", gives an email | offers the plan once in two sentences, spells the email back | `plan-interest` tag, email on the contact, opportunity "Comfort Club plan - $149/yr" in Memberships > Interested, sign-up email sent by the workflow |
| 19 | After a booking: "No thanks" | accepts, doesn't offer again | `plan-declined` tag, no Memberships opportunity |

Also check: Sam does **not** offer the plan on emergency calls (2-4), out-of-area calls (5), or to a contact tagged `plan-member`.
