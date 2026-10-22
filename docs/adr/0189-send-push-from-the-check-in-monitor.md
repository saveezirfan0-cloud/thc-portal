# ADR-0189 · The office can write its own push to a worker from the Check In / Out monitor

**Status:** Accepted · 23.10.2026 · **Builds on:** ADR-0082 (Send push to chosen staff, OM2),
ADR-0188 (Remind to check in / out) · **Asked by:** the office, 23.10.2026 — "can we also write a free
text to the staff member … so we can write whatever we want"

`apps/office/app/checkin/MonitorTable.tsx` (reuses `apps/office/app/staff/SendPush.tsx`,
`messageActions.ts`, `send_staff_message()`)

## Context

ADR-0188's Remind button sends only the register's fixed words (N9 / N9b). A manager looking at the
monitor often has something else to say — "we're at the side door", "your manager is on 07700 …",
"bring your ID" — and had to ring or leave the screen.

## Decision

A **Send push** button sits on every row of the monitor, beside Remind (which stays where it applies).
It opens the existing Send push dialog for that one worker and sends through the existing
`send_staff_message()` as **OM2**, "Message from the office", exactly as from a staff profile or the
Staff directory (ADR-0082). Nothing new is built on the server:

- no new register code, migration, switch or priority class — OM2 already is "a push whose body the manager
  writes", with its own Settings switch (ADR-0083), the 300-character limit, a one-line audit
  (`staff.message_sent`, shown on the worker's History tab) and the "has notifications off — phone them"
  result;
- admin only through the session, never a viewer, never a removed (GDPR) worker;
- tapping the push opens the Staff App (OM2's deep link), not the shift.

It is offered on every status, including Checked out and No check-out, since the words are the manager's.

## Consequences

- The dialog is the same component, so its limits and wording cannot drift from the directory's.
- A worker cannot reply to a push; the dialog says so in the same words as everywhere else it is used.
- The monitor does not know a row's worker is removed or a viewer is signed in, so the button is shown and
  the database refuses in words — as Verify and Remind already do.
