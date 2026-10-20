# ADR-0175 · Every paged office list opens 100 rows deep

**Status:** Accepted · 20.10.2026 · **Departs from:** `wireframes/backoffice/staff.html` (the
directory pager offers "15 / page · 50 / page") and the sizes ADR-0124 and ADR-0143 settled
(10 / 25 / 50 / 100 on /clients, /venues and /staff/requests; 25 – 250 on the roster) ·
**Asked by:** THC, 20.10.2026

`apps/office/app/_lib/pageSizes.ts` (`LIST_PAGE_SIZES`, `DEFAULT_LIST_PAGE_SIZE`)

## Context

With ~1,000 workers the Staff directory opened at 15 rows a page — the office was clicking
through sixty-odd pages. THC asked for every page to default to 100 per page as a minimum.

## Decision

1. **One set of sizes for every pager with a Rows per page select: 100 / 250 / 500, default
   100.** /staff, /staff/roster, /staff/requests, /clients and /venues all read it from
   `_lib/pageSizes.ts` (a plain module, so the roster's server-side `list.ts` can read it too —
   `listQuery.ts` is a client module). An old `?size=15` in a bookmarked URL is not one of the
   sizes and falls back to 100.
2. **Fixed-size pages move to 100 as well:** the compliance Expiry radar (was 10), a client's
   Events tab (was 12), /feedback (was 20), /activity, /inbox and the check-in violation log
   (were 50). /activity's RPC clamps at 200, so 100 is inside it. The roster's email records
   dialog was already 100.
3. **No pager under 100 rows**, as before: a list that fits its smallest size draws none.

## Consequences

- Fewer page turns; a page is longer to scroll. 500 rows of the directory render client-side
  from data the screen already holds, so the larger sizes cost no extra read.
- The wireframe's 15 / 50 is superseded for the directory; ADR-0124's and ADR-0143's sizes
  are superseded, not their pagers.
