# ADR-0124 · The client directory lets the office choose how many rows a page holds

**Status:** Accepted · **Departs from:** `wireframes/backoffice/clients.html` (a fixed 8 rows per page) · **Owner request:** 13.10.2026

## Context
The `/clients` directory paged a fixed 8 clients at a time, as the wireframe draws it ("Showing 1–8 of 27"). With 22 clients, the office had to page three times to see them all, and asked to choose how many rows a page shows.

## Decision
- The pager under the table gets a **Rows per page** select next to Prev / Next, offering **10, 25, 50 and 100** per page. The default is **25**.
- Changing the size goes back to page 1, as every filter change already does.
- The pager appears once the filtered list is longer than the smallest size (10). This means the size can still be changed while the whole list fits on one page.
- The choice lasts for the visit only. Nothing is stored.
- This is the same control the Staff directory already has (15 / 50, from its wireframe), with sizes suited to tens of clients rather than a thousand workers.

## Consequences
- Paging still runs over rows already loaded. The directory is one query (§9.7 screen comment), so a larger page costs nothing extra.
- The wireframe still shows 8 rows. This ADR is the record of the deviation.
