# ADR-0109 · The Back Office paints its chrome first and streams the page in behind it

**Status:** Accepted · **Builds on** ADR-0108 · **Touches** the root layout, `OfficeShell`, `/dashboard`, `/events`, `/compliance`, `/checkin`, `apps/office/vercel.json`

## Context

Four things stood in front of every Back Office page:

1. **The root layout waited.** It awaited the operator's profile and the menu counters before returning, and a page below a layout does not start rendering until the layout has returned. Every page's own queries therefore began one database round trip late.
2. **Nothing painted until everything was read.** With no Suspense boundary above an async page, the response sends no HTML until the page's last query returns. On a click the old screen stays up (or, on a fresh load, the tab is blank) for the whole read.
3. **`loading.tsx` is not the answer here.** `boundaries.test.tsx` records why: on Next 15.5 a segment `loading.tsx` froze query-only navigation (`?view=`, filters), answered 200 for an unknown id under it, and put two topbars in the document on `/dashboard`.
4. **Distance.** The database is in London (`eu-west-2`). Vercel's default function region is Washington (`iad1`); every sequential query pays about 75 ms of transatlantic round trip. The Vercel connector in this workspace could not see the THC projects, so the project's actual setting was not read.

Measured on the live database (read-only `EXPLAIN ANALYZE`): the two menu counters cost 1.9 ms and 0.1 ms to execute. The cost of a page is round trips, not queries.

## Decision

1. **The layout returns at once.** `officeUser()` and `officeNavCounts()` are started, not awaited, and handed to the two context providers as promises. `useOfficeUser()` and the counters read them with `use()`; plain values still work (the component tests, anything outside the layout). The clock is a cookie read and is still awaited. A failed lookup is no name / no counters, never a broken page.
2. **The shell owns the Suspense for those promises.** `OfficeShell` wraps the sidebar (fallback: the brand alone) and the read-only banner (fallback: nothing) in their own boundaries. The page body is not inside either, so it is never held back by them.
3. **Pages that read a lot stream.** `/dashboard`, `/events`, `/compliance` and `/checkin` become a thin `page.tsx` (URL parsing, one `OfficeShell`) plus an async body component behind a `<Suspense>` with a skeleton. Data that the topbar also needs (the dashboard's "as of", the compliance and check-in counts) is read once through a `cache()`d loader and streamed into the topbar by its own small boundary.
   - **One `OfficeShell`, outside the Suspense.** A skeleton that drew its own shell is what put two topbars in the document under `loading.tsx`.
   - **No `key` on the Suspense.** Stepping `/events` by period keeps the old period on screen until the new one is ready, exactly as before; it never shows the skeleton over content already there.
   - The `AutoRefresh` stays in the shell, so a screen keeps refreshing while its body is suspended.
4. **Not converted:** `/staff`, `/clients`, `/onboarding`, `/reports` and the other screens whose shell is drawn by a client component that takes the data as props. They would need their shell lifted out of the client screen first; that is a separate change.
5. **Functions run in London.** `apps/office/vercel.json` pins `regions` to `["lhr1"]`, next to the database. If the project already ran there this is a no-op; if it did not, every sequential query gets cheaper. The Staff App and Client Portal share the database and have the same question; they are not changed here.

## Consequences

- The unit tests for these pages render the body component (`DashboardBody`, `ComplianceBody`…); the shell is a plain synchronous tree.
- The menu paints a moment after the page on a fresh load (the brand first, then the items, counters and name), and the items a role cannot use are never drawn at all, as before.
- `boundaries.test.tsx` is unchanged and still holds: no `loading.tsx` anywhere it forbids one.
- To undo the region pin, delete `apps/office/vercel.json`; the dashboard's Function Region setting then applies again.
