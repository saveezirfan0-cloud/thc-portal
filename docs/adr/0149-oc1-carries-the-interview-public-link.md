# ADR-0149 · The OC1 reminder carries the interview's public link

Status: accepted · 16.10.2026 · **Amends** ADR-0071 ("No Willo link in OC1")

Scope v1.6 §2.4 · `supabase/migrations/20261016120000_oc1_interview_link.sql` ·
`packages/notifications/src/{templates,outbox,email-layouts}.ts` ·
`apps/office/app/settings`

## Context

A candidate replied to the "Reminder: your video interview is still waiting" email (OC1)
with "Sorry I can't find any link". Several candidates have done the same. Willo sends the
invitation itself and nothing stores its URL (ADR-0071 listed "No Willo link in OC1" under
*Not done*), so the reminder could only say "look for the invitation from Willo". Anyone whose
invitation went to spam, or was deleted, had nothing to click and wrote to the office.

Willo's own review link (`willo_review_url`, ADR-0098) is the office's view of a recording.
It is not something a candidate can use and never goes in their email.

What does exist is the interview's **public link**: one URL, the same for everyone, which the
office copies from Willo. A candidate who records through it arrives in Willo as a second
participant, and since ADR-0148 the webhook finds them again by their email
(`willo_relink_by_email`), so they still move on the board.

## Decision

- **A setting.** `settings.willo_interview_public_url`, a JSON string, edited on `/settings`
  under the Willo block ("Interview public link — for the reminder email"). Blank deletes the
  row. The value is not hard-coded because the link is THC's, from their Willo account.
- **A strict reader.** `willo_interview_public_url()` returns the setting only when it is one
  literal `https://` URL with no spaces, no `< > " '`, no `@` before the first `/` and at most
  500 characters (the email would draw no button for the others). Anything else reads as
  not set. The Settings screen applies the same rules before saving.
- **The job.** `onboarding_chasers()` adds `interviewLink` to the OC1 payload when the reader
  returns a link. Who is chased, the variant, the key, the cadence and the 10:00–18:00 window
  do not change, and neither does the payload without a link.
- **The email.** `messageFor` adds one paragraph to an OC1 email whose row carries an http(s)
  `interviewLink` (`withInterviewLink`), straight after the paragraph about Willo's invitation (before the last paragraph when that is the one carrying the sign-off, as in `existing_repeat`):
  "You can also record your answers straight away with this link, on your phone or computer.
  Please use the email address you applied with:" followed by the link, drawn as a **Record my
  video interview** button with the URL printed under it. It applies to all six daily wordings
  (`first`, `second`, `repeat` and the `existing_*` three). The wording of Willo's invitation
  stays: the link is a second way in, not a replacement.
- **Email address.** The paragraph says to use the email address they applied with, because
  that is how the participant is matched back (ADR-0148).

## Consequences

- **Nothing changes until the setting is filled in.** Until the office pastes the link, the
  reminder is exactly what it was. THC must copy the public link from the interview's share
  settings in Willo; it is not in the repo.
- The link is public and identical for everyone, so it needs none of the protection E3's and
  OC2's one-time links have (ADR-0060). The row keeps it in `payload`, as it keeps the name.
- A reminder already queued is not rewritten: the link is in from the next one queued after
  the setting is saved.
- A candidate who records through the public link under a **different** email is still
  refused by the webhook (`unknown_willo_candidate`, ADR-0148) and has to come in through
  `/apply`; the paragraph asks them not to.
- **Owner wording.** The `existing_*` paragraphs end "Without clicking the link in Willo's email…"; a candidate using the public link is not clicking that email. Left as the owner wrote it.
- Not covered: the one-off `existing_notice` (sent once, 14.10.2026) and the first
  invitation (E1, which Willo sends).
- Vitest in packages/notifications (templates, outbox) and apps/office (settings); pgTAP 848.

## Not done

- **A per-candidate link.** If Willo's API can return or re-send each person's own
  invitation URL, that would be better than a shared one. It is unverified; `readInviteAnswer`
  reads only the participant's key today.
