# ADR-0177 · A started event still takes a new role section that starts later than now

**Status:** Accepted · 21.10.2026 · **Departs from:** §3.2 ("Once the event has started — and
therefore for any past event — editing is locked") · **Asked by:** THC, 21.10.2026 — the client
of the Leonardo Hotel St Pauls M&E event asked at 11:50 for one more Day Waiting Staff M&E from
12:30 to 16:30, and the started event had no way to take it

`packages/domain/src/shift.ts` (`canAddSectionAfterStart`, `LATE_SECTION_MESSAGE`) ·
`apps/office/app/events/actions.ts` (`addRolesAfterStart`) · `_components/ShiftBuilder.tsx`
(`canAddRoles`) · `[id]/edit/page.tsx` · `[id]/page.tsx` (**+ Add role**) ·
`supabase/migrations/20261022140000_late_role_section_on_a_started_event.sql` · pgTAP `100`

## Context

§3.2 locks an event from its derived start (earliest role start, RULE-18). On a long day the
first role starts at 07:00, so a same-day request from the client for a later shift had nowhere
to go: the board hid **Edit**, and the only way round was a second event for the same client and
venue — a second line-up, a second set of timesheets.

## Decision

- On the event's own day (or later), a started event that is not cancelled shows **+ Add role**
  on the board in place of **Edit**. It opens the same Shift Builder: every saved section and
  every event field stays read-only; only sections added in this visit are editable.
- A new section must start **later than now**. The builder holds Save off with that sentence;
  `addRolesAfterStart` re-checks it and inserts only the sections with no stored row, reading
  nothing else from the form; the database refuses a manager's insert into a started event that
  starts at or before `now()` (`late_section_guard`, `late_section_starts_in_past`).
- Nothing already saved moves, so nobody booked is asked to re-confirm (§3.5) and the derived
  start — and so the event's status — is unchanged.
- The new section is an ordinary section from then on: invites, Radar, auto-assign rounds,
  check-in and pay read its own window (RULE-18).

## Consequences

- A section added this way is locked as soon as it is saved, like the rest of the started event:
  a typo is fixed by withdrawing anyone on it and adding a corrected section. Opening a saved,
  not-yet-started section of a started event for edits is a further change to §3.2, not made
  here.
- The `event_edit_lock_guard` (UPDATE) is unchanged.
