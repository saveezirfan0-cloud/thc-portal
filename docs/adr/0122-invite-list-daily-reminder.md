# ADR-0122 · A daily reminder to everyone on the THC invite list who has not applied

**Status:** Accepted · **Refines:** ADR-0107 (the invite list), ADR-0071 (the chasers) · Scope §8 (an addition) · **Owner request:** 13.10.2026

## Context
THC's own staff are moving off AXLR8 and onto the new app. The office loaded the invite list on 08.10 (ADR-0107) and sent the invitations. Five days later 898 of the 919 THC rows were still on the list, which is exactly "invited, not applied yet". The owner asked for a daily reminder to the THC rows, sent from within the app, until each person applies. SpudBros Express rows are not included.

The onboarding chasers (ADR-0071) start only once somebody has applied: before that there is no candidate to chase. So nothing reached these people.

## Decision
- **IR1**, a register email (`packages/notifications/src/templates.ts`, `INVITE_CODES`), sent from `admin@` like every candidate email (`settings.senders`), with replies to the office inbox. The copy is the owner's email of 13.10.2026 as register text. It is laid out in THC Light like every other email (ADR-0073): the owner's dark design is not used, and the `{applyLink}` placeholder is drawn as a **Register now** button. There are two wordings: `named` carries the first name from the sheet in the subject and the greeting, and `unnamed` covers a row without one ("Hi there"). One addition to the owner's copy: step 1 asks them to apply with this email address, because the list is matched on email. Eight people had applied under a different address and missed the match.
- **Who:** every `invite_roster` row in the `thc` group whose email no live staff record holds (`lower(btrim(staff.email))`, `removed_at is null`). A row KEPT after its person applied (a name the sheet spelt differently, or a Payroll ID somebody else holds, per ADR-0107) belongs to someone who has applied, and they are not told otherwise. Somebody who applied under a different email is not caught by this. The office removes their row, after setting their Payroll ID, which is ADR-0107's existing step 4.
- **When:** `invite_roster_reminders(p_now, p_apply_link)` runs from the hourly **onboarding-chasers** job, after the OC sweep. It queues one row per person per UK calendar day (`IR1:roster:<row id>:<UK date>`) on the first run inside `settings.invite_roster_reminders` from/until, which defaults to 10:00–18:00, so the reminders go at 10:07 UK. A missed day is not caught up. The drain sends 40 a minute, so a full list takes about 25 minutes.
- **Until:** they apply (the row is consumed and the next day queues nothing), the office removes the row on `/staff/roster`, or the reminders are switched off. The roster page says so above the list.
- **The button** is `<STAFF_APP_URL>/apply`, the ordinary link the THC invitation carried. It is built by the Edge Function from the secret the activation emails already use. The SQL accepts only an https origin (or localhost) followed by `/apply`. Anything else, or no link at all, queues nothing and the run says why, because a reminder without its button is worse than none.
- **Two ways to stop it:** `settings.invite_roster_reminders.enabled = false` stops the queueing, and the IR1 switch on `/settings` → Notifications (ADR-0083) stops the sending.

## Consequences
- About 900 more emails on the first day, falling as people apply. The app was sending about 150 a day before this. The Resend plan must cover roughly 30,000 a month while the list is long, and Resend's per-second limit is not an issue at 40 a minute.
- The office inbox (`/inbox`) does not list IR1: it goes to workers, not to THC.
- pgTAP `811_invite_roster_reminders.sql`; vitest pins the copy (`templates.test.ts`) and the button (`email-html.test.ts`).
- Follow-ups, not done: a per-row "reminded N times" on `/staff/roster`, and SpudBros rows (they would need their own copy and the `/apply/spudbros` link).
