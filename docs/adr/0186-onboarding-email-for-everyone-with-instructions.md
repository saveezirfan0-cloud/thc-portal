# ADR-0186 · Everyone in the wizard is emailed the step, with how to do it

**Status:** Accepted (owner request, 21.10.2026). Amends ADR-0071 ("after sign-up: the reminder is in the app") and ADR-0169 ("by email only when notifications are off"). An addition to scope v1.6 §8. The new wording is for THC's approval, alongside ADR-0071's and ADR-0169's.

## Context

The owner asked that everybody stuck in the onboarding stages be emailed clear instructions of what they need to do to reach the next stage, daily, until they progress.

Most of that already runs (ADR-0071, daily, never stopping). Read from the live project on 21.10.2026, before this change:

| Stage | Who | Reminder |
|---|---|---|
| Interview requested | 342 of 342 | OC1 email, daily |
| Documents, no password yet | all | OC2 email with a fresh link, daily |
| Wizard (documents → contract) | 42 | 33 with no device: OC4 email. **9 with notifications on: OC3 push only** |
| Interview completed; documents under review | n/a | not chased: the move is the office's |

The sends that day were delivered without failure (OC1 328, OC2 16, OC4 30). Two things were wrong for the wizard:

1. A candidate with notifications on got a push and no email, so the owner's "by email" did not reach them.
2. The email named the step ("Next up: your home address") and nothing more. It did not say what to do.

## Decision

1. **OC4 goes to everyone due an app reminder**, not only to candidates with no device. A candidate with a device gets the OC3 push **and** the OC4 email. The conditions are ADR-0169's: a good `<STAFF_APP_URL>/onboarding` link, and `staff.email` is the address they sign in with.
2. **Its own key.** The push keeps OC3's key (`OC3:staff:<id>:<epoch>:<n>`), so the ladder, the board's "reminder 2 of 3", the Stalled count and the 10:00–18:00 window do not change: a day is one rung. The extra email takes `OC4:staff:<id>:<epoch>:<n>`, outside the ladder. A candidate with no device is unchanged: the email replaces the push on OC3's key.
3. **Every rung says how to do the step.** OC4's body gains "Here's what to do:" and a numbered list: sign in with this email address, then the step's own instructions, in the words the wizard uses (which documents, how many references and who counts, the quiz pass mark and attempts, and so on). The lists are `ONBOARDING_STEP_HOWTO` in `packages/notifications/src/templates.ts`, one per step word `onboarding_chaser_candidates()` writes into `step`. A test reads those words from the migration, so a step added or renamed in SQL fails until the register follows; another reads the quiz constants from `packages/domain`.
4. **They are the register's, not the row's.** `messageFor` fills `{howTo}` and `{channelNote}` for OC4 itself and overwrites whatever a payload says, as it does for the AXLR8 countdown. A row names only the step and `pushOn`.
5. **The reason line follows the candidate.** `pushOn` ('1' beside a push, '0' in place of one; absent on a row queued before this change, which reads as '0') picks `{channelNote}`: "You'll get a reminder in the app as well" or ADR-0169's "We're emailing you because notifications aren't turned on". The third rung carries no note, as before.
6. **Settings.** OC4 keeps its own switch. While it is off, the drain settles these rows as switched off; the push is unaffected.

Migration `20261023120000` re-creates `onboarding_chasers(timestamptz, text)` from its live body (md5 checked) with three edits: the `also_email` flag, the second insert, and `pushOn` on both OC4 inserts. The result gains `oc4_also`. Signature and grants are unchanged, so no redeploy of the Edge Function is needed.

## Consequences

- **More mail.** The 9 candidates today (and anyone who turns notifications on later) now get an email a day as well as the push. ADR-0071's warning about bulk-mail reputation applies.
- **The first run after deploy** emails each wizard candidate whose next rung is due; it does not catch up days already missed.
- **The board** shows a pushed rung as pushed. It does not yet say "and emailed" beside it, and the extra email's delivery is visible only in the outbox.
- pgTAP 900 follows (29 assertions); 394, 805 and 856 pass unchanged. Vitest: `packages/notifications` (`onboarding-howto`, `outbox`, `email-html`).

## Not done

- **Interview completed, and documents under review.** Not chased: the move is the office's, and telling a candidate to do something they cannot do would be wrong. They hear from the office when it acts. If the owner wants a "we're reviewing, nothing to do" email, it is a separate message.
- **OC1 and OC2** are unchanged. Their instructions (find Willo's invitation; set your password and install the app) are already specific.
- **Per-step screenshots or deep links** into a step. The app routes itself to the open step.
