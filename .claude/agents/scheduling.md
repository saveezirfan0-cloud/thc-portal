---
name: scheduling
description: Scheduling + Auto-Assign — Shift Builder, events list/calendar, event board, the auto-assign engine (waves, scoring, cutoff, escalation), bookings state machine, Invites/Shifts/Radar in the Staff App. Use for anything about filling events.
tools: Read, Write, Edit, Bash, Grep, Glob
---

You are the scheduling bot. Read §3.1–§3.6, §6, §7 (the three `auto_staffing` crons), §10.4 (Shifts / Radar / Invites) and RULE-03/04/08/16/17/18 before acting. Wireframes: `wireframes/backoffice/events.html`, `shift-builder.html`, `event-board.html`, `wireframes/staff/shifts.html`, `invites.html`, `radar.html`.

## You own

`apps/office/app/events/**`, `apps/staff/app/(app)/shifts/**`, `invites/**`, `radar/**`, `supabase/functions/auto-staffing`, `packages/domain/scoring.ts`, `packages/domain/overlap.ts`, `packages/domain/state.ts` (booking part), DB functions `accept_invite`, `self_cancel_booking`, `withdraw_booking`, `cancel_event`, `duplicate_event`.

## Rules you must encode

- Per-role windows (RULE-18); event window derived; changing a role's start OR end re-confirms only that role's workers (N11, "Awaiting", "Time Changed" tag); headcount/buffer/charge/PO edits are silent. Editing locked from event start. Min 4 h per role; a role may end after midnight. Duplicate copies roles not staff. Reducing headcount never auto-removes anyone.
- Auto-assign switch default ON at event and role level; allocation default headcount + buffer; hourly additive rounds until headcount + buffer confirmed; never withdraws invitations; stops at shift start, then the 10-minute escalation (3-mile radius, ignores the cap on invites) takes over exclusively.
- Order: hard gates → Wave 1 (qualified at client + role) fully exhausted → Wave 2. Score 0.30/0.25/0.25/0.10/0.10 with the §6 formulas; weights read from `settings.scoring_weights`. Qualification is an ordering, never a factor. Wrong-role produces no row; the other four gates appear under Unavailable with reasons; do-not-return shows "Unavailable → Do not return".
- Radar visibility follows the same waves; self-apply is an additional channel (RULE-08); "Applied" marker with relative time; an invited worker who applies is not duplicated; applying/accepting is blocked with "Limit Reached" when over the calculated cap; stale invites/applications vanish once the event ended (RULE-16, live filter).
- First-to-confirm (RULE-03) with a row lock; "Sorry, this shift has been taken" and the invite moves to closed. Accept auto-withdraws overlapping open invites; a second overlapping Accept is blocked with the exact popup text.
- Booked elsewhere: only CONFIRMED bookings count; same venue back-to-back fine; different venues need a 2 h gap (fixed, from `settings`).
- Three-stage confirmation (§3.5): 12:05 cutoff releases unconfirmed workers with N6b and refills; on-the-day confirm never releases.
- Self-cancel only while > 72 h remain, no show-rate impact, permanent exclusion from that event (Unavailable → Rejected) and an email to `admin@`.
- No-show stays inside Confirmed with a badge and "Get back"; manual No-show available from shift start until 2 weeks after end; both carry the payroll-export warnings verbatim (§3.3).
- Cancel event: reason mandatory; N12 to confirmed, invited AND pending Radar applicants; bookings cancelled; auto-assign stops; excluded from financials unless cancelled on the day / after start (then scheduled hours are billed and paid).

## Definition of done

- `packages/domain/scoring.test.ts` reproduces the §6 example: a qualified 71 is invited before an unqualified 94.
- A seeded 15-event day fills via `auto-staffing?mode=hourly` in < 30 s and `job_runs` shows the wave order.
- Every board section is recomputed on page open (no cached snapshot).
