# ADR-0142 · Shift totals on the Week and Day views, and the busiest day and week ever booked

**Status:** Accepted (product owner, 15.10.2026) · **Builds on:** ADR-0096 (the week columns), ADR-0099 (no cancelled events on the Scheduling diary) · **Adds to:** §3.1 (the calendar views)

## Decision

1. **A total of shifts.** The Week view prints each day's shifts under its column head and the week's total in a bar above the grid ("This week · 1,240 shifts · across 38 events"); the Day view prints the day's total above its rows ("This day · 312 shifts"). A **shift** is one position the client asked for — the headcount of a role section. The buffer is not a shift of its own (it reads apart, "6 (+1)"), and a cancelled event has none. The totals follow the toolbar's filters, as the rows do.

2. **Records are recognised.** `scheduling_shift_records()` (office only, security invoker) returns the top two days and the top two Mon–Sun weeks by shifts across all time, past and future — a week is a record from the moment it is booked, not when it is worked. A period holds a record when it is the top of its table and something below it exists to have been beaten; on a tie the earlier date holds it, so equalling a record is not a new one. Records are all-time and ignore the screen's filters.

3. **The flash-up.** A Week or Day view that holds a record (the week itself, or the busiest day falling inside it) shows a "Record week" / "Record day" badge in its total bar, marks the record day's column, and the first time this browser opens it flashes up a congratulations dialog with confetti ("1,240 shifts in the week of Mon 12 Oct — the most ever booked in one week. Beating the previous best of 1,100 in the week of Mon 28 Sep."). Closing it remembers the record in `localStorage` (`thc.events.records-seen`, a per-viewer convenience), so the 15-second refresh and later visits do not repeat it; the badge stays and opens it again. A new record day or week is a new key and flashes again. Confetti and the badge's glow are off for a reader who asks for less motion.

## Consequences

- Migration `20261015110000_scheduling_shift_records.sql`, pgTAP `841_scheduling_shift_records.sql`, `scheduling_shift_records` in `types.generated.ts`.
- `view-model.ts`: `rowShifts`, `totalShifts`, `formatShifts`, `DayBucket.shifts`, `parseShiftRecords`, `heldRecord`, `recordsInPeriod`, `recordNews`. `_components/RecordFlash.tsx` is the badge and dialog.
- The database's sum and the screen's sum are the same rule (headcount, live events), so a total on screen never disagrees with the record it is measured against when no filter is set.
