# ADR-0148 · A Willo participant we did not create is found by the candidate's email

Status: accepted · 16.10.2026 · **Amends** ADR-0021 (refusals) and ADR-0066 §7 (finding the participant)

Scope v1.6 §2.4 · `supabase/migrations/20261016110000_willo_relink_by_email.sql` ·
`supabase/functions/willo-webhook/index.ts` · `packages/db/src/willo.ts`

## Context

The receiver finds a candidate only by the Willo key the invite sweep stored when it
created the participant. On 16.10.2026 a candidate was Accepted in Willo and never moved
on the kanban. He had applied through `/apply` on 07.10, and the sweep had created his
participant and stored its key. But he recorded the interview as a **second participant**
on the same interview, whose name was just his first name and whose `custom_id` was empty.
That is not how our invite creates one, so it most likely came from the interview's
public link (an older job advert or the previous system). All three of his deliveries
(Received, New Response, Accepted) carried that second key. Each was refused
`unknown_willo_candidate`, answered 200, and Willo did not retry. Fifteen other keys were
refused the same way between 01.10 and 16.10.

Every Willo delivery carries the participant's `email` at the top level.

## Decision

When none of a delivery's keys is ours, the receiver calls
`willo_relink_by_email(key, email)`. That moves the candidate's Willo link to the new key
only when **exactly one** candidate has that email, is not removed, and is still waiting
on the interview decision (`interview_requested` or `interview_completed`), and no row
already holds the key. The move is audited as `willo_relinked`, with the old key and the
new one. The receiver then plans again, and the event lands as it would have. Anything
else returns null and the delivery is refused as before.

The email is read by `participantEmail()`. It is never logged and never passed to the
database as event details.

## Consequences

- A candidate who records through the public link instead of their invitation moves on
  their own, Accept included. That Accept is still the office's decision, made in Willo
  after watching the video. E3 goes to the email on our row, which is the email matched.
- Deliveries refused **before** this change are not replayed (Willo does not re-send a
  200). Those candidates are moved by hand: **Mark interview complete** (ADR-0077), then
  **Accept**.
- A participant whose email matches nobody waiting (applied only in Willo, or typed a
  different email) is still refused and still has to come in through `/apply`.
