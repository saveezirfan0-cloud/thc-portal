# ADR-0161 · The heavy Back Office routes stream behind their shell; photo links are reused; the last single-request reads are paged

**Status:** Accepted · **Builds on** ADR-0109 (streaming), ADR-0133 (the Client Portal's signed-URL cache), the go-live audit of 17–18.10.2026 (`docs/22`) · **Touches** `/events/[id]`, `/staff`, `/staff/[id]`, `/onboarding`, `/onboarding/[id]`, `/clients/[id]`, `_lib/photos.ts`, the client card's "+ Add staff" picker

## Context

The first go-live wave made every Back Office read correct at full roster (paged past PostgREST's 1,000 rows, bounded, timed out). It left three things (docs/22 §4, the office audit H2–H5, M2, M5, M11):

1. **Nothing painted until everything was read.** ADR-0109 streamed `/dashboard` and `/compliance` only. The event board waited for `auto_assign_candidates` on every section (0.2–7.5 s each under load — the read that held `/events/[id]` for 300 s on 17.10); `/staff`, `/onboarding` and the two profiles waited for their heaviest view. `loading.tsx` stays banned there (`boundaries.test.tsx`): it froze query-only navigation and turned 404s into 200s.
2. **Every refresh re-signed every face.** The directory, the board and the pipeline re-render every 60 s; each render signed ~1,000 photos and gave each a new URL, so every avatar was downloaded again.
3. **A few reads still asked once** (the review queue list, the board's calendar and offers, the dashboard lists, the client and role directories, the client card's lists) or read far more than they showed (the client card's picker read all of `staff_directory_v`).

## Decision

### 1 · Streaming, the ADR-0109 way, on six more routes

- **One `OfficeShell`, drawn by the page, outside every boundary.** The client screens that drew their own shell (`StaffScreen`, `ProfileScreen`, `OnboardingBoard`, `CandidateScreen`, `ClientCard`) gain a `bare` mode that draws only their body; rendered whole (every existing test) they still draw the shell. Their topbar pieces moved to hook-free `chrome.tsx` files, so the page and the screen draw the same crumbs and links.
- **A real 404 is decided before anything streams.** A page with an id reads one row of the SAME view the full record comes from — `staff_profile_v`, `onboarding_candidates_v`, `clients_directory_v`, two or three columns, so the view's expensive columns are never computed — and calls `notFound()` on it before its first `<Suspense>`. The full record's reads are started before that row is asked for, so the head costs no extra round trip; a failure after the head is said inside the shell.
- **The board streams per section.** `loadBoard` reads the event, its sections and everyone booked; `loadSectionPools` reads one section's pool and calendar and names only the candidates the first read did not. Each `RoleBoard` renders `SectionPools` behind its own Suspense with a pool-shaped skeleton, so one slow pool holds back neither the line-up nor another section. A pool that cannot be computed is that section's problem, not the board's. A section that draws no pool (event over or cancelled) no longer asks for one. The auto-send hint line streams too.
- **Directories stream their counts.** `/staff` and `/onboarding` stream the list behind a skeleton and the counts into the topbar from one `cache()`d read (`/staff`'s change-request number has its own boundary).
- **Skeletons are `@thc/ui`'s** (`SkeletonScreen`, `Skeleton`, `SkeletonText`, `SkeletonToolbar`, `SkeletonPanel`, `SkeletonKpis`, the `Kanban` columns), in each screen's own row and header shapes (`.skel-row`, `.phead`, `.cand-head`). Tokens only.
- **Query navigation is untouched.** None of these pages reads `searchParams`; their tabs, searches and filters move with the History API (`useListQuery`), never a router navigation. `/events` and `/checkin` still do not stream. `boundaries.test.tsx` now pins, for every streamed route: no `loading.tsx`, no `searchParams`, `notFound()` before the first boundary, no shell in a fallback, no query-only router navigation or link behind the boundary.

### 2 · Photo links are reused

`signStaffPhotos` keeps a bounded per-instance LRU of signed links keyed by Storage path (ADR-0133's shape): signed for **1 h**, handed out again for the first **30 min**, 5,000 entries. Only unseen paths are signed, in one batch; a path Storage refused is never cached. The bucket stays private and signing still goes through the manager's own session. The cache adds no reach: a path is looked up only after a view read through the caller's own session returned it, and every office session is an admin one. A worker's new selfie at the same path can show the old face for up to 30 minutes.

### 3 · The last single-request reads

Paged with `readAllPages` in a total order: the review queue list (`submitted_at, kind, item_id`; the menu badge's HEAD count is untouched), the board's `auto_assign_unavailable` and `shift_offers`, the dashboard's ten-day and short-staffed lists, `/clients`, `/roles`, the `/events` client filter, and the client card's qualified staff and events. The queue's share-code checks and date-of-birth claims are read in chunks of 100 document ids. `/events` refreshes every 60 s instead of 15 s.

The client card's **"+ Add staff"** picker no longer reads `staff_directory_v`: `searchQualifyPicker` reads 50 compliant, live workers at a time off `staff` (with an exact count) and their roles off `staff_roles`. A number (bare or `THC-00873`) is that Employee ID, exactly; words must each be in the first or last name. It searches when the dialog opens and 250 ms after typing stops, keeps only the latest answer and keeps ticks across searches. **Departures from before:** an Employee ID matches exactly, not as a substring; "Select all" selects the workers shown, not every match; a removed worker is no longer offered.

### 4 · Bulk actions

Saving an edited event (section UPDATEs, re-confirm flags and N11 queueing) and the candidate's "qualify at clients" grants run through `_lib/pool.ts` `mapPool`, eight at a time, each item still refused or done on its own.

## Consequences

- A fresh load paints the shell, the name and the line-up in one fast read; the slow parts arrive after. `router.refresh()` keeps the shown content during a refresh (it is a transition), so the skeletons appear only on the first load.
- Unit tests render the bare screens and the pages with `react-dom/static` `prerender` (every boundary resolved) and `renderToString` (the fallbacks). `cache()` dedupes only under React Server Components, so the tests check the shell count and the order of reads, not the dedupe.
- `staff/[id]/data.ts` (the personal-data reads) and the layout's badge count are not changed.
- ADR-0109's "Also not converted: `/staff`, `/clients`, `/onboarding`…" is superseded for the routes above; `/clients` (the list), `/reports` and the others still draw their shell from a client component and are not converted.
