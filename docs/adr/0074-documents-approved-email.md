# ADR-0074 · Email the candidate when their documents are approved

**Status:** Accepted (owner request, 29.09.2026). An addition to scope v1.6 §8.

## Context

On the live app a candidate's passport was verified at 11:28 UK time. The quiz unlocked by itself, as §2.3 requires ("the quiz unlocks automatically once every document is verified"), and the candidate heard nothing.

§8 tells a candidate when a document is **rejected** (N8, a push), but has no message for the approval. Nothing prompts them to open the app and take the quiz. The only thing that would is the daily OC3 chaser (ADR-0071), and that only fires a day later.

The owner reported "didn't get notification when docs approved", then asked for it to be **"via email"**. A push would also miss most candidates, because the onboarding screens never ask them to turn notifications on.

## Decision

**E12, "Your documents are approved"**, an email from admin@ to the candidate's own address:

> Hello {name},
>
> Good news: all your documents have been checked and verified.
>
> The next step is the Health & Safety quiz. Open the THC Staff app to take it. You need 80% to pass, and you have three attempts.
>
> The Hospitality Company

- **When:** queued by `onboarding_advance_if_ready()` (20261001216000) in the same transaction that moves the candidate from Documents to Quiz. It is sent once per onboarding period, whichever verification (document or declaration) was the last.
- **Key:** `E12:staff:<id>:<unlock epoch>`, so a candidate reset to candidate (§2.12) and verified again in a later period is told again.
- **Payload:** `{ name }`, the trimmed first name. GDPR removal matches the row by recipient and by address (20260930120100).
- **No email address on the row:** nothing is queued. The quiz still unlocks.
- **Register:** `EXTENSION_CODES`, the next free E-number after E11, with "Not in §8" in its trigger.

## Not done

- **No notifications prompt in onboarding.** The "Turn on notifications" banner still appears only inside the working app (`StaffShell`), not on the onboarding screens. So a candidate's phone is usually not subscribed, and N8 and the OC3 chaser pushes rarely reach them. That is a separate change.
