# ADR-0160 · The Back Office's heaviest views compute each fact once

**Status:** Accepted · 19.10.2026 · **Refines:** ADR-0147 (the directory inside the statement limit), ADR-0155 (RULE-20 helpers planned once; the onboarding view in one pass), ADR-0004 (owner-rights views), ADR-0163 (identity columns leave the API roles: these run after it, on its bodies) · **Reported:** go-live speed work, second wave

`supabase/migrations/20261020150000_staff_directory_history_once.sql` ·
`20261020150100_onboarding_candidates_activation_once.sql` ·
`20261020150200_compliance_blockers_plan_once.sql` ·
`20261020150300_compliance_queue_count.sql` · pgTAP `885`, `886`, `887` (and `001`, `504`
follow) · `scripts/bench/office_views_at_scale.sql` · `apps/office/app/_components/navCounts.ts`

## Context

After the first wave, three Back Office reads still did per-row work that grew with the agency
(local PostgreSQL 16, 1,342 staff rows — 1,000 workers and 300 candidates — and 114k bookings;
`authenticated` stops at 8 s):

- **`staff_directory_v`**: /staff reads it whole, two pages of 1,000, every 60 s per open tab,
  with `student_visa_v` on top. 3.5 s for page 1 and 5.2 s for page 2.
- **`onboarding_candidates_v`** `select *`: 3.6 s, most of it `quiz_blockers`. The board's own
  columns also paid twice per row for `activated` / `activated_at`.
- **`compliance_review_queue_v`**: counted exactly on every Back Office request for the
  sidebar's "Needs review" badge.

What the plans showed:

1. **The RLS gate defeats the estimates.** Every policy reads `(select current_app_role()) =
   'admin'`, a parameter the planner can only guess at: 0.5 % of the rows. It believes `staff`
   holds ~8 rows, `shift_requirements` ~5 and `bookings` a few hundred. So for `last_shift_at`,
   for **every** worker, it scanned every section ever built and probed bookings once per
   section: 1.4 million probes and 2.9 s. `weekly_worked_hours` did the same, 1.2 s. It grows
   with every event, and production builds ~16k sections a year.
2. `staff_show_rate()` per worker made two violation probes per booking: 0.4 s.
   `weekly_booked_hours()` cost one plpgsql call per worker: 0.2 s. `cap_band_until()` ran an
   EXISTS over the holiday array for each of 378 days per term-time student: 0.34 s.
3. `onboarding_quiz_blockers()` cost 2.3 ms a call, and almost none of that was work. Its chain
   (`compliance_blockers` → `current_verified_docs` → `doc_expires_on` →
   `term_letter_last_day`, and `term_letter_applies` three times) is pinned SQL functions. Each
   is parsed and planned again on every call when called from another function (ADR-0155
   §Context).
4. `activated` / `activated_at` came from two SECURITY DEFINER functions, and each asked
   `current_app_role()` (a four-table auth read) per row.
5. The sidebar's HEAD `select=*&count=exact` makes PostgREST build the queue itself (block
   reasons, previous rejections, gov.uk checks, `rtw_check_manual_allowed()`), count it by whole
   rows, and scan it a second time for the count.

## Decision

No rule changes. Every value any reader sees is the value it saw, proved against the old
definitions (below).

### 1. The directory's history is worked out once per statement, not once per worker

`reliability`, `last_shift_at`, `weekly_booked_hours` and `weekly_worked_hours` are each one
grouped query for everyone, inside an **uncorrelated scalar subquery** (an InitPlan). Each
builds a `jsonb` object keyed by staff id, and each row reads its own value by key.

The obvious shape, grouped subqueries LEFT JOINed on `staff_id`, was tried first and rejected
on its plans. With `staff` estimated at 8 rows the planner chose nested loops that recomputed
the whole aggregate once per worker: `student_visa_v` went from 0.17 s to 0.36 s, and
`last_shift_at` stayed at 2.2 s. A correlated probe into a grouped subquery took 36 s. Those
plans are the estimate's to choose, so none of them can be relied on. An InitPlan has no join
for a wrong guess to break. It runs once, and only if a column that reads it is selected, so the
pickers and the feedback typeahead still read no history at all. Inside each query the access
path cannot be turned round either: sections drive bookings through `bookings (shift_id,
status)` behind `LATERAL … OFFSET 0`.

- `reliability` is `staff_show_rate()`'s sample and formula, its two violation tests as hashed
  semi-joins. `weekly_booked_hours` is filtered by `booking_counts_toward_cap()`, the rule
  itself. Both restate a function, so the migration first checks that function's **code** on
  the database (comments dropped, whitespace collapsed) and stops if it has moved.
- The week is this Mon–Sun UK week. The UK-date test, moved verbatim from the live body,
  decides. An instant bound a day wider on each side lets the planner start from
  `shift_requirements_starts_at_idx`.
- `jsonb` keeps a numeric's scale and a timestamptz's instant, so every value reads back exactly
  as it was computed (885 compares them as text too).
- `released_shift_count` stays a per-row count. It is one index lookup on `bookings (staff_id,
  status)`, which no estimate can turn into a scan.
- `cap_band_until()` asks whether a day is a holiday with one operator against the holidays as
  a single `datemultirange` built once a call, instead of an EXISTS per day. A day is in the
  union exactly when it is in one of the ranges, and a null calendar or a null day answers false
  as EXISTS did.

The view stays `security_invoker`, and each map is read under the caller's RLS. A worker sees no
section, so their last shift is null and their released count is their own, as before.

**The cost moved:** a read of **one** worker (`staff_profile_v` by id, once per /staff/[id]
visit, not auto-refreshed) now builds the maps for everyone, as do `clients_qualified_staff_v`
and `student_visa_v`. /staff, which re-reads every 60 s per tab, is the read this is for.
Timings below.

### 2. `onboarding_candidates_v` reads the login once per statement

The view now reads a new owner-rights helper, **`staff_account_activation_v`** (security_barrier,
SELECT for `authenticated` and `service_role`, nothing for anon). Its gate is the functions'
own: the office, service_role, or the worker whose login it is. The two role reads are
InitPlans. No row means "not activated", which the view already read as `false` / null.
`staff_account_activated()` / `_at()` are untouched; /staff/[id] still calls the first. It is
the twenty-third owner-rights view (twentieth selectable, after ADR-0163's three): `001_rls_guard` and docs/14 move with
it.

### 3. The `compliance_blockers` chain keeps its plans for the session

`onboarding_quiz_blockers`, `compliance_blockers`, `current_verified_docs`,
`term_letter_applies`, `doc_expires_on` (6 arguments) and `term_letter_last_day` are plpgsql
around the **same** SQL body: `return ( … );` or `return query …;`. This is exactly 20261019130000's
transformation. Pins, security, volatility, defaults, grants and comments are unchanged. The same
chain runs on every check-in, Staff App start, unblock and document verification, which gain too.

### 4. The sidebar counts with one function

**`compliance_review_queue_count()`** is `count(*)` over the view under the caller's rights. It
is SECURITY INVOKER, so it is exactly what /compliance lists, and still exact. Executable by
`authenticated` and `service_role`. `navCounts.ts` calls it by RPC (Vitest `nav-counts.test.ts`).
`staff_block_reason_v`'s gate becomes `(select current_app_role())`, which the queue reads once
per item in five branches and `onboarding_returning_v` once per applicant. This is the same
change `staff_rejection_reason_v` had in 20261019130200.

### How the changes are applied

Every definition is re-created from the **live** one (docs/10 §3b): `pg_get_viewdef()` /
`pg_get_functiondef()` changed by named patterns on code. Each pattern must match exactly once
or the migration stops. View options are read back and restated.

They run **after** 20261020120000–120200 (ADR-0163) and are built on the bodies those leave.
`onboarding_candidates_v` keeps reading `dob`, `share_code` and `ni_number` through
`staff_identity_v`. None of the four reads a column ADR-0163 took from the API roles directly:
the directory's maps read `bookings`, `shift_requirements` and `violations`, and
`staff_account_activation_v` reads `staff.id`, `staff.user_id` and `auth.users` with its owner's
rights, as `staff_account_activated()` does.

## Equivalence

`supabase/tests/_shared/office_views_before_20261020150000.psql` recreates every replaced object
verbatim as `public._old_*`, each old object calling the old objects below it, and points the
unchanged readers (`student_visa_v`, `staff_profile_v`, `clients_qualified_staff_v`,
`compliance_review_queue_v`, `onboarding_returning_v`) at them. The comparisons run over
`_shared/cap_dataset` + `_shared/office_views_dataset`: every RULE-20 branch, history in every
booking status, open and resolved No-shows and No check-outs, released shifts, do-not-returns,
blocks with a reason, gov.uk checks, logins with and without a password. Each comparison is
`except all` both ways, every row and every column:

- `885`: the directory and its three readers as the office, a worker and a client;
  `reliability` = `staff_show_rate()` and `weekly_booked_hours` = `weekly_booked_hours()` for
  every worker; `cap_band_until()` over 4,000 generated calendars and the edge cases; each
  section read once for the whole directory, for one worker by id and for `student_visa_v`; a
  four-column reader reads no history.
- `886`: `onboarding_candidates_v` `select *` as the office, a candidate and a client; every
  chain function against its old body on four dates and over grids; the activation helper as
  the functions for every person (office and service_role), own row only for a worker, nothing
  for a client, no privilege for anon, InitPlan gate; the six are plpgsql, pinned, not definers.
- `887`: the count against the view as every role; anon refused; the block reason view, the
  queue and `onboarding_returning_v` as before for every role; the gate is an InitPlan.

## Consequences

Timings: `scripts/bench/office_views_at_scale.sql` times each read and its `[before]` twin
(the `_old_*` definitions) in the **same run**, as the office admin under `authenticated`, best
of 3, in the shape PostgREST sends. Same-run pairs are used because the local machine was shared
(load 18–24 on 4 cores) and absolute numbers drifted ~1.5× between runs:

| Read (1,342 staff rows, 114k bookings) | before | after | |
|---|---|---|---|
| /staff · `staff_directory_v`, page 1 (1,000 rows) | 4,181 ms | **882 ms** | 4.7× |
| /staff · `staff_directory_v`, page 2 | 5,975 ms | **928 ms** | 6.4× |
| `staff_directory_v`, the page's columns, every row | 6,905 ms | **1,017 ms** | 6.8× |
| /staff · `student_visa_v` | 348 ms | **180 ms** | 1.9× |
| `staff_directory_v`, four columns (pickers, typeahead) | 8.2 ms | 8.4 ms | unchanged |
| /clients/[id] · `clients_qualified_staff_v`, one client | 277 ms | **62 ms** | 4.5× |
| /staff/[id] · `staff_profile_v`, one worker by id | 11.8 ms | 116 ms | **slower**, see §1 |
| /onboarding · `onboarding_candidates_v`, the board's columns | 272 ms | **194 ms** | 1.4× |
| `onboarding_candidates_v` `select *`, every row | 5,407 ms | **4,137 ms** | 1.3× |
| /compliance · `compliance_review_queue_v` `select *` | 51 ms | **39 ms** | 1.3× |
| layout · "Needs review" count: HEAD `select=*` → `compliance_review_queue_count()` | 48 ms | **13 ms** | 3.7× |

Run on the branch after ADR-0163 (load average ~20 on 4 cores). On a quieter run before the
rebase the directory's page 1 was 3,317 → 564 ms, and `select *` on the onboarding view was
4,040 → 1,708 ms. ADR-0163 since made two helpers this work leaves alone dearer per row (below).
By column, after: the cap (`weekly_cap_for()` per worker) is 481 ms of the directory and the
history maps together ~210 ms; the four history columns cost 2.9 s, 1.2 s, 0.4 s and 0.2 s
before.

- Read the absolute numbers as relative: hosted Micro compute is slower (audit F0).
- **Not done here:** the cap columns still ask `weekly_cap_for()` once per worker. Since
  ADR-0163 an API caller's call also asks `staff_identity_facts()` (a definer, with its role and
  caller InitPlans) for the date of birth, about 0.35 ms a worker. That is now half the directory.
  Making that helper plpgsql was measured and changes nothing, because the cost is the calls
  themselves. The next step is for the directory to take the under-18 fact for everyone in one
  owner-rights read, with the same admin-or-self gate, and pass it to `weekly_cap()`. That
  restates `weekly_cap_for()`, so it belongs with whoever owns ADR-0163.
  `onboarding_documents_missing()` (`docs_missing`) has the same new per-row call. The remaining `quiz_blockers` cost is `current_app_role()` re-read by the RLS gate
  of every query inside the invoker chain, about 15–20 reads per person. It is only in `select
  *`, which no screen reads over the whole pipeline (the candidate screen reads one row).
- A single-worker read of the directory now costs the agency-wide maps. If /staff/[id] ever
  auto-refreshes, give `staff_profile_v` per-worker columns of its own.
