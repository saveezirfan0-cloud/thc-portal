# ADR-0147 · The Staff directory fits inside the 8 s statement limit

**Status:** Accepted · **Refines:** ADR-0117 (the 8 s `authenticated` limit), §9.6 / §4.4 (the directory and the cap columns) · **Reported:** 16.10.2026

## Context
`/staff` showed "canceling statement due to statement timeout", an empty list and "0 workers". The page reads `staff_directory_v` whole (every worker, every column it draws), and the office session — `authenticated` — runs under `statement_timeout = 8 s` (20261012120000). The view had grown past it.

Reproduced on a local cluster of 1,040 workers (a fifth of them on a student visa, with a term calendar):

| | 1,040 workers, no history | + 50,000 bookings | + 150,000 bookings, 15,000 shifts |
|---|---|---|---|
| before | 6.5 s | **over 8 s — cancelled** | over 8 s |
| after | | | **2.3 s** |

Per column, before: `weekly_cap_until` 4.2 s of the 6.5; `weekly_cap_hours`, `weekly_cap_band` and the band again inside `weekly_cap_until`'s CASE 0.55 s each (the same `weekly_cap_for()` three times a worker); `weekly_booked_hours` 1.7 s once there was history.

## Decision
No rule changes; every value is the one it was. Three costs removed, in `20261016100000`:

1. **`cap_band_until()`** (N14's "until [date]"; the Limit-reached line) walked 53 weeks and, for each, re-derived *this* week's band: 106 `cap_term_state()` + `weekly_cap()` runs, ~18 ms a call, once per student-visa worker. It now reads the 54 weeks' days in one pass, groups them into weeks, and takes the band of each of the three possible term states once, through `weekly_cap()` itself — the rule is not copied.
2. **The directory view asks `weekly_cap_for()` once per worker**, in a lateral subquery of two `max()`s, and the three columns read it. An ungrouped aggregate is the shape the planner can prove yields one row, so it drops the join when no cap column is selected: the client page's staff picker and the feedback typeahead still cost ~8 ms. A plain function call in the FROM clause, or `(weekly_cap_for(...)).*`, runs the function once per row or once per column whatever is selected, so neither is used.
3. **`weekly_booked_hours()`** ran `booking_counts_toward_cap()` (a function the planner cannot inline) on every booking a worker has ever had and discarded all but one week's afterwards, re-deriving the week's Monday for each row it kept. It now takes the week first (`OFFSET 0` holds the order) and applies the rule to that handful. `booking_counts_toward_cap()` is untouched and is still the one place that says what counts; the rota guard, Accept and the Radar meter get the same number sooner.

## Consequences
- Equivalence was checked against the old functions: `cap_band_until` on 3,000 random calendars plus null inputs (0 differences, 1,937 dated and 1,063 open-ended results); `weekly_booked_hours` for every worker over 20 weeks with every booking status present (20,800 pairs, 0 differences). pgTAP 090, 200, 260, 290, 595, 603, 665 and 673 pass unchanged.
- pgTAP 846 pins the Sundays for the calendars that matter (a holiday ahead, one running now, a week covered by two adjacent ranges, a Saturday opening, a Thursday restart, none, past the horizon), the booked hours, that the view's columns are the functions' answers, and the clock: the page's exact column list over 1,000+ workers completes under the 8 s limit and under 5 s, and a four-column reader stays under 1 s.
- **Not fixed, and still linear in workers:** ~2 s of the 2.3 s is per-worker work that is cheap each (show rate 0.33 s, the cap 0.4 s, last shift and released count 0.4 s, booked hours 0.7 s), and the page re-reads it every 15 s per open tab (`AutoRefresh`). It has about 3.5× headroom locally; hosted is slower. If the directory grows toward 2,000 workers, the next step is to read the page in pages (the list already filters and sorts in the browser), or to compute the week's hours for everyone in one grouped pass in the view rather than one call each. Both change the screen or duplicate the booked-hours rule, so neither is done here.
- `last_shift_at` / `released_shift_count` plan well at production table sizes; on a few thousand shifts the planner scans every shift per worker, so a small test database over-states them.
