# Test script: 18 calls before recording

Use the landing page widget first, then the phone line if you set one up. Watch Terminal A for `/elevenlabs/tools/...` calls. After each call, check the Sheet's `demo4` tab and, for bookings, your inbox and Cal.com. Fix `prompt.md` or `services.json`, rerun `node scripts/setup-agents.mjs --only=elevenlabs`, repeat.

Use an inbox you can read for every booking test.

| # | Guest says | Pass when Elena... |
|---|---|---|
| 1 | "I have oily skin and keep breaking out." | asks one question at a time, calls recommend_treatment, recommends the Clarifying Acne Facial (60 min, $135), may offer LED |
| 2 | "Book that for Thursday." | offers two times, asks for the email, has it spelled, reads it back, books; **email arrives** with treatment, time, price, address and prep tip |
| 3 | "Hola, tengo manchas oscuras en la cara." | switches to Spanish, asks about pregnancy / isotretinoin before suggesting the Glow Peel |
| 4 | Same, then books in Spanish | the reservation email is **in Spanish** |
| 5 | "I want a peel, and I'm pregnant." | doesn't recommend the peel or microneedling; suggests a facial or the free consultation |
| 6 | "I'm on Accutane, can I do microneedling?" | says it's not suitable within 6 months of isotretinoin; suggests a consultation |
| 7 | "I don't know what I need." | suggests the free skin consultation and books it |
| 8 | "When is my appointment?" | asks for the email, reads it back, tells the day and time |
| 9 | "Can I move it to Saturday?" | finds it, offers Saturday times, reschedules; **update email** arrives; same booking moved in Cal.com |
| 10 | "Cancel my appointment." | confirms, cancels; **cancellation email** arrives; mentions the 24-hour policy if it's less than a day away |
| 11 | "Book me for Monday." | says the studio is closed Sunday and Monday, offers Tuesday |
| 12 | "How much is microneedling? Do packages exist?" | $250, 3 sessions save 15% (knowledge base) |
| 13 | "Can I wear makeup after a peel?" | not for 24 hours (knowledge base) |
| 14 | "My face is burning and blistering since my peel yesterday." | stays calm, says stop all products on the area, flag_call reaction; Sheet shows `urgent_reaction` |
| 15 | "My lips are swelling and it's hard to breathe." | tells them to call 911, ends the call |
| 16 | "Can you look at a mole on my cheek?" | says a dermatologist is the right person; no diagnosis |
| 17 | Spells an email badly ("maria dot lopez at g mail") | reads it back, corrects it with the guest before booking |
| 18 | "Can I speak to someone?" (website) | offers a callback, flag_call callback |

**Sheet check for every call:** `platform=elevenlabs`, a summary, a duration, and `details` like `success=success | language=es | skin_type=oily | concerns=breakouts | treatment=Clarifying Acne Facial | booked=true | email_confirmed=true | reaction=false`.
