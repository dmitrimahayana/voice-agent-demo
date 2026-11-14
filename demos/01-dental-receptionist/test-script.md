# Test script: 26 calls before recording

Run each call, note anything awkward, fix the prompt, repeat. Record the demo video only when all 26 pass.

| # | Caller says | Pass when Ava... |
|---|---|---|
| 1 | "I'd like to book a cleaning next Tuesday." | asks name and reason, offers 2 slots, books, confirms aloud |
| 2 | "Do you take Delta Dental?" | says yes, offers to book |
| 3 | "Do you take Medicaid?" | says no politely, mentions CareCredit |
| 4 | "How much is whitening?" | says from $299, adds that the dentist confirms |
| 5 | "I need to cancel my appointment." | finds it by caller ID, confirms, cancels |
| 6 | "Can I move my appointment to Friday?" | finds it, offers Friday slots, reschedules (same booking moves in Cal.com, no cancel) |
| 7 | "I broke a tooth and it really hurts." | says it's urgent, flags it, offers today |
| 8 | "My face is swelling up to my eye." | tells them to call 911 now |
| 9 | "Can I talk to a real person?" | offers a callback and flags it |
| 10 | "Hola, necesito una cita." | continues in Spanish |
| 11 | "Are you a robot?" | answers honestly |
| 12 | "What antibiotic should I take?" | declines medical advice, offers a visit |
| 13 | "Book me for Sunday." | says closed Sunday, offers Saturday or Monday |
| 14 | Caller gives name "Siobhan" | spells it back and confirms |
| 15 | Caller says nothing for 10 seconds | prompts once, then ends politely |
| 16 | "Where do I park?" | free parking behind the building |
| 17 | "Book my son, he's 7." | offers Dr. Reed and a children's check-up |
| 18 | Caller interrupts mid-sentence | stops and listens |
| 19 | "What's your address?" | gives it clearly |
| 20 | "Actually never mind, bye." | closes politely without pushing |
| 21 | "When is my appointment?" | finds it by caller ID and says the day and time |
| 22 | From another phone: "My member number is 4 8 2 7 1 5, when am I booked?" | reads the number back, finds it by member number (use a real number from the `members` table) |
| 23 | "When's my appointment?" from a number with no booking | asks for member number or the booked phone, tries once more |
| 24 | First-time caller books a cleaning | reads out a new 6-digit member number; a row appears in `members` and `bookings` |
| 25 | Same caller calls again and books | says "existing patient", no new member row |
| 26 | Move or cancel a booking in the Cal.com dashboard | the `bookings` row updates (via the Cal.com webhook) |
