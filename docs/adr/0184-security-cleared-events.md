# ADR-0184 · Security-cleared events — staff are told to bring ID when they are confirmed

**Status:** Accepted, 23.10.2026 (product owner request) · **Builds on:** [ADR-0080](0080-languages-spoken.md) (an event-level ask carried as one column, set in the Shift Builder), [ADR-0110](0110-client-shift-requirements.md) (a push fired by a trigger on `bookings` the moment a booking is confirmed — CR1), [ADR-0158](0158-notify-drain-priority-and-run-budget.md) (every register code has a send class), [ADR-0031](0031-worker-reads-declarations-through-rpcs-only.md) (the worker reads through definer RPCs) · **§3.2, §3.3, §8, §10.4** · **Code:** migration `20261023100000_event_security_cleared.sql`; pgTAP `921`; `packages/notifications` (`SC1`, `SECURITY_CLEARANCE_CODES`); `apps/office/app/events` (`ShiftBuilder.tsx`, `draft.ts`, `actions.ts`, `data.ts`, `[id]/page.tsx`); `apps/staff/app/_components/SecurityCleared.tsx`, `shifts/[id]/page.tsx`, `data.ts`

## Context

The product owner asked on 21.10.2026: _"Some events need to be 'security cleared' which means that the staff members need to bring with them a form of ID: passport or driving license. Can this please be a tick box when the event is being built and staff need to be informed to bring this to the event. This should be informed to the staff at the point they are confirmed on to the shift."_

The scope has nothing on it. The pieces already exist: ADR-0080 put an event-level requirement in the Shift Builder as one column, and ADR-0110's CR1 tells a worker something about their shift from a trigger on `bookings`, so every path that confirms a booking is covered without being restated.

## Decision

### 1 · One tick box, at event level

`events.security_cleared boolean not null default false`. Panel 4 of the Shift Builder (beside _Languages staff must speak_) gains a **Security cleared event** tick box — the design system's `Checkbox`, a real input — worded _staff must bring a passport or driving licence_. Event level, as the request reads ("some events"): every role section of the event is cleared together.

Like the languages (ADR-0080):

- **Every event on file reads as before** — the default is false.
- **Duplicate keeps it.** It is the client's ask for the event, not a decision about one day's people.
- **It re-confirms nobody** (`security_cleared` in `SILENT_FIELDS`). It asks the booked to bring something; the shift does not move.
- **It is not under the §3.2 edit lock** in the database. The Shift Builder itself is read-only once the event has started, so in practice the office sets it before the start.
- **The activity log names it** (`audit_event_fields` gains `securityCleared`, so ticking it reads as an `event.updated` change).

The event board's header shows a cyan **Security cleared** pill.

### 2 · The worker is told when confirmed — SC1

A push, **SC1** — _Bring ID to your shift_: _{event} · {dateTime} is a security-cleared event. Please bring your passport or driving licence with you._ — opening the booking's shift screen. Queued:

1. **When a booking becomes confirmed on a cleared event**, by an AFTER trigger on `bookings` (`bookings_security_cleared_notice`). Accept, first-to-confirm, auto-assign, a Radar application accepted, a manual pick and a take over Radar all confirm a booking, so all of them are covered. An invitation queues nothing: the ask is of the confirmed.
2. **When the box is ticked on an event that already has confirmed staff**, by an AFTER trigger on `events` (`events_security_cleared_notice`), so people confirmed before the tick are not missed. Sections that have already ended are skipped.

The key is `SC1:booking:<id>`: **once per booking**, however often the box is ticked and cleared or a confirmed booking is re-saved. The Shift Builder says how many confirmed workers will be told before the office saves (`securityClearedToTell`).

Send class **urgent**, as N5–N7: it concerns a shift days or hours away. It sits in the register as an addition (`trigger` says "Not in §8"), is switchable on /settings → Notifications like the CR codes (ADR-0083), and is not `mandatory`.

### 3 · The shift screen carries the same note

On a confirmed booking on a cleared event, an amber **Bring ID** note sits at the top of the shift screen — where the push lands, and where a worker looks again the night before. It is read through `staff_security_cleared_bookings()`: the caller's own confirmed, live bookings on a cleared event, nobody else's. A new function rather than a column on `staff_shift_detail()`, which `20261001215000` rewrites in place; a failed read shows no note rather than a shift screen that will not open (the push has told them too).

### 4 · What it is not

- **Not a gate.** Nobody is refused a booking, auto-assign and Radar are unchanged, and **check-in is unchanged** (§5.1). The office does not record that anyone brought ID.
- **Not shown on the invitation.** The request says "at the point they are confirmed". The ask appears when a worker is confirmed; if THC wants it on N5 and the invite screen as well, that is a copy change.
- **Not in the Client Portal, the PDFs or the exports.** The portal's views name their columns (ADR-0004) and this is not one; the Allocation Sheet and sign-out timesheet are unchanged.

## Consequences

- **The wording of SC1 is ours.** The owner named passport or driving licence and said nothing of what happens without one, so the copy does not say either. Confirm it with THC.
- **Clearing the box tells nobody.** A worker told in error will still bring ID; nothing is harmed. If THC wants a "no longer needed" message, it is a second code.
- **An acknowledgement ("I'll bring it") is not built.** CR2's kit message asks for one; this request did not. It would be a second table and a morning-of reminder.
- **A booking confirmed after the shift started** is still told (the push is cheap and the shift screen shows the note), though in practice the box is edit-locked by then.
- Not in the wireframes: the tick box, the pill and the note. This ADR is the deviation record; `docs/08-screen-inventory.md` lists them against `/events/new`, `/events/:id` and `/shifts/:id`.
- `staff_security_cleared_bookings()` is the 214th definer reachable by `authenticated`; `892` and `docs/14` §4 are updated.
