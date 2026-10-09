# ADR-0094 · "Hide cancelled" on the events diary

**Status:** Superseded by ADR-0099 · **Refines:** Scope §3.1, §3.3

## Context
§3.3 keeps a cancelled event in the list and calendar, greyed and labelled "Cancelled", never deleted, for the record. On a busy diary that clutters the day. The status filter only offers one status or all, so there was no way to see everything except cancelled.

## Decision
- `/events` toolbar gets a **Hide cancelled** checkbox. It is **off by default**, so the screen still follows §3.3 unless a manager turns it on.
- It lives in the URL as `hide=cancelled` (like every other filter, §3.1), applies to List and Month/Week/Day, and survives the view toggle, the period arrows and Today.
- Choosing **Cancelled** in the status filter outranks it: the checkbox shows unchecked and disabled.
- When it hides anything, a line under the toolbar says how many ("2 cancelled events hidden in this period"), so an emptied period is not read as nothing booked.
- It is a view over the rows already loaded. Nothing is deleted or written; finance rules (§3.3 points 4–5) are untouched.
- Not part of a saved view: `office_saved_views` has a query-shape constraint, and keeping it out avoids a migration. Applying a saved view leaves the checkbox as it was.

## Consequences
- The control is not in `wireframes/backoffice/events.html`; this ADR is the deviation record.
- The dashboard's ten-day list and the Client Portal keep showing cancelled events greyed; add the option there only if asked.
