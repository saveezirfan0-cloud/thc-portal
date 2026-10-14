# ADR-0134 · Client Portal round 3: the line-up stops at the headcount, and nine approved additions

**Status:** Accepted (product owner, 14.10.2026 — the "one decision" and the N1–N9, P4 proposals in `docs/20-release-audit-2026-10-14.md`, Part B) · **Builds on:** ADR-0004, ADR-0026 (the client reads only through owner-rights `client_*` views), ADR-0050, ADR-0053, ADR-0074, ADR-0088, ADR-0089, ADR-0119, ADR-0133 · **Departs from:** §11.2 and `wireframes/client/event.html` as listed per item below

The hard lines do not move: the portal is read-only apart from the existing feedback and password writes, there is no money anywhere, and every client read is an owner-rights `client_*` view that filters by `client_portal_visible()` in its own body and names its columns. No table gains a client policy (`001_rls_guard` still pins the empty set).

## 1 · The line-up stops at the headcount

### Context
Round 2 (ADR-0133) held every COUNT to the headcount the customer booked, but kept the line-up itself whole: an over-booked role showed six faces under "Waiting Staff · 4 of 4", and the raw `confirmed = 6` reached the browser in the page's props. Either way a customer could see THC's buffer (§3.2: insurance on top of the headcount, internal to THC). The product owner chose "only up to headcount".

### Decision
- **In the views, not the screen** (`20261014140000_client_lineup_within_headcount.sql`), so what the customer is not shown is never sent:
  - `client_lineup_v` returns at most `headcount` rows per role section;
  - `client_role_sections_v.confirmed` is `least(confirmed, headcount)`;
  - `client_arrivals_v` holds both `confirmed` and `arrived` to the headcount.
- **Who takes the seats** follows the strict buffer policy (RULE-15, "the first headcount check-ins work"):
  1. anyone with a `checked_in` check-log (their own check-in, on time or Late, or the office's "Get back"), or a `worked` booking, by first check-in time;
  2. then everyone else by `bookings.confirmed_at` (`created_at` for an old row without one);
  3. then the booking id, so the order is total and a refresh never swaps two people.

  Before the event nobody has checked in, so the people confirmed first hold the seats. On the day the seats follow the door. An out-of-radius press is not a check-in and takes no seat.
- **A worker the customer has already rated stays visible** whatever their seat. The customer rated a person they saw, and the line-up (and the feedback history, N4 below) must not make that entry vanish. This is the one way a section can show more faces than its headcount, and only with a face the customer has already seen. The section's count still reads the booking ("4 of 4").
- **Arrivals agree with the faces.** Because the checked-in take the seats first, "arrived among the visible line-up" is exactly `least(arrived, headcount)`. The feedback nudge ("N to go") and the faces are computed from the rows the view returns, so all three follow the same set. The round 2 caps in `rules.ts` stay as a second guard and are a no-op on what the views now return.

### Consequences
- The seat order can change during the event. If a buffer worker checks in before a late one, the buffer worker's face replaces theirs, which is what RULE-15 does at the door.
- `submit_client_feedback()` is unchanged. It still accepts any booking on the confirmed line-up of the caller's event, but a booking id outside the trimmed set never reaches the browser.
- The admin passes `client_portal_visible()` and so reads the trimmed line-up through these views too. The Back Office has its own reads and is unaffected.
- pgTAP `815_client_lineup_within_headcount.sql`: six confirmed on four gives four rows, the right four before and during the event, the tie-break, the arrivals cap (including a fifth check-in), the rated worker kept, tenancy, and the restated views' ADR-0004 shape.
