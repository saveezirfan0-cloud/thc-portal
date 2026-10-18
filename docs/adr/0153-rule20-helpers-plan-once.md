# ADR-0153 · RULE-20's helpers are planned once; two hot reads stop repeating work

**Status:** Accepted · 18.10.2026 · **Refines:** ADR-0147 (the cap columns read once), the
`002` search-path invariant (20260921130156, 20260922183014) · **Reported:** go-live database
audit, 17.10.2026, findings F3, F4, F5

`supabase/migrations/20261018130000_rule20_helpers_plan_once.sql` ·
`20261018130100_staff_bookings_cap_only_where_read.sql` ·
`20261018130200_onboarding_candidates_one_pass.sql` · pgTAP `002`, `853`, `854`, `855` ·
`scripts/bench/rule20_staff_bookings_candidates.sql`

## Context

Three reads the apps make constantly were doing the same work many times over.

**The RULE-20 chain (F3).** Every helper in it was a SQL function with
`SET search_path = public, extensions`. Postgres never inlines a SQL function that has a SET
clause, and on 16/17 a SQL function that is not inlined keeps its plan only as long as the
`FmgrInfo` of the expression calling it. Inside another function's query that `FmgrInfo` is
rebuilt every time the outer query starts, so each nested body was parsed and planned again
on every call, all the way down: `weekly_cap_would_breach` → `rota_guard_verdict` →
`weekly_cap_for` → `weekly_cap` → `cap_term_state` → `cap_week_start`, and alongside them
`weekly_booked_hours_except`, `can_roster_staff` twice and `rota_guard_decide`. Measured on
the live project: `weekly_cap_would_breach` 3.4 ms a call. Locally, 1,000 workers and 114k
bookings: 4.8 ms, of which about 1.5 ms was work. Two further costs hid underneath:
`weekly_booked_hours(_except)` could only start from every booking the worker had ever had,
because its week test (`(starts_at at time zone 'Europe/London')::date between …`) is not
something an index can answer; and once `rota_guard_decide` was inlinable the planner pasted
its CASE (and `weekly_booked_hours_except()`) into every place that read it.

**`staff_bookings()` (F4).** Every Staff App shift screen reads it, most under AutoRefresh.
It ran that whole chain on every booking the worker has ever had: 590 ms for a worker with
~115 bookings locally, growing every week they work.

**`onboarding_candidates_v` (F5).** Per candidate it called `current_compliance_docs()` four
times (one count per status), read `quiz_attempts` four times with no index on what it filters
by, and `staff_rejection_reason_v` evaluated `current_app_role()` — a four-table auth read —
once per row because the gate was not wrapped. `select *` over 431 candidates took 3.8 s live.

## Decision

No rule changes. Every value any caller sees is the value it saw, proved against the old
definitions (below).

### 1. Pure helpers lose the pin and are inlined

`cap_week_start`, `can_roster`, `booking_counts_toward_cap`, `cap_under_18`,
`booked_elsewhere_conflict`, `booking_reopenable_by`, the three `weekly_cap` overloads, and
(20261018130200) `current_compliance_docs` are now SQL functions **without** `SET search_path`,
so the planner inlines them into the query that calls them.

Why that is safe:

- They are `SECURITY INVOKER` and not volatile. An inlined body runs with the caller's rights,
  exactly as the call did; nothing is elevated.
- Every name in their bodies is schema-qualified: `public.weekly_cap(…)`,
  `public.compliance_docs`, `::public.cap_assessment`, `pg_catalog.date_trunc`,
  `::pg_catalog.date`, `pg_catalog.make_interval`. A caller's `search_path` cannot redirect
  them. Operators and the remaining built-in types resolve in `pg_catalog`, which every
  search path searches first unless a session lists it explicitly later — and a session that
  does that only changes its own invoker-rights query. Every `SECURITY DEFINER` function still
  pins its path, so inside one the path is fixed whatever the helper says.
- The `002` invariant is now a shape, not a list: an unpinned function in `public` must be an
  invoker, non-volatile **SQL** function (anything else still fails), and assertion 1b calls
  every unpinned one under an **empty** `search_path` with a typed literal per argument, so an
  unqualified name anywhere in a body errors. 2b repeats the decoy test for the inlined
  helpers. A new unpinned helper that forgets a qualifier fails CI.

Two bodies change shape, both proved equal to the old ones:

- `cap_week_start`: `date_trunc('week', p_date)` resolved to the `timestamptz` overload — STABLE,
  session time zone — so an `IMMUTABLE` function could never have been inlined. It now truncates
  `p_date::timestamp`: the same Monday for every date (18,628 days, both infinities and null,
  under four session time zones in `853`).
- `weekly_cap` (12 arguments): the `in_force` CTE is folded into the CASE, because a body with a
  FROM clause is never inlined. The two expressions (`completionInForce()` / `optOutInForce()`
  in `cap.ts`) are moved verbatim by the migration, not retyped.

**The advisor will report these ten as `function_search_path_mutable` (lint 0011).** That is
this decision, not a regression: `docs/14` §4's advisor table counts them, and `002` holds the
two properties that lint stands in for.

### 2. Table readers become plpgsql and keep the pin

`weekly_cap_for`, `weekly_cap_hours`, `weekly_cap_would_breach`, `rota_guard_verdict`,
`rota_guard_mode` (definer), `rota_guard_decide`, `can_roster_staff`, `weekly_booked_hours`,
`weekly_booked_hours_except` and `cap_term_state` are plpgsql around the **same SQL body**,
wrapped as `return ( … );` (`return query …;` for `rota_guard_decide`, whose result columns the
migration checks are not named in the body). A plpgsql function keeps its plans for the
session however it is called. Pins, security, volatility, grants and comments are untouched;
the comment gains a line saying so.

`rota_guard_decide` stays a function rather than being inlined: inlined, the planner pasted its
CASE — and with it `can_roster_staff()` and `weekly_booked_hours_except()` — into each place
that read `g.verdict` / `g.reason`, so it ran them two or three times a call.

Two targeted body changes, each a superset-or-same rewrite:

- `weekly_booked_hours` / `weekly_booked_hours_except` also bound `sr.starts_at` to the week as
  instants, **a day wider on each side** than the UK week (`[Monday − 1 day, Monday + 8 days)`
  UTC). The UK-date test stays exactly as it was and still decides; the bound only lets the
  planner start from that week's sections (`shift_requirements_starts_at_idx`) instead of the
  worker's whole history.
- `rota_guard_verdict`'s `x` subquery gets `OFFSET 0`, so `weekly_booked_hours_except()` is
  computed once rather than pasted into both places that read `x.booked`.

### 3. `staff_bookings()` computes the cap only where a screen reads it

`hours_limit`, `booked_hours` and `cap_hours` are read by the invitation card and the
invitation screen ("Limit Reached", `explainLimit()`), for a booking whose status is
`invited` — `/invites/[id]` renders any invited row, an ended one included. Nothing reads them
on a booking that has ended. They are now computed for an invitation, whenever it is, and for
any booking whose section has not ended (a confirmed or applied shift still ahead), and are
**null on the history behind them** (the app reads `Boolean(null)` as no limit, which is what a
past shift shows). `week_start` costs nothing and stays on every row. The fill count reads the
section's confirmed rows through `(shift_id, status)` instead of every row of the section.

**History is not bounded.** My shifts' collapsed "Past shifts" (ADR-0048) lists every past
booking, and a stale push must still find its row (`apps/staff/app/shifts/model.ts`), so a
window would change what the worker sees. Every row still comes back, in the same order; the
per-row work left on a past one is a few index lookups.

### 4. `onboarding_candidates_v` reads each candidate's documents and quiz once

- The four document counts come from **one** read of `current_compliance_docs()` and the four
  quiz figures from **one** read of `quiz_attempts`, each a `LEFT JOIN LATERAL` ungrouped
  aggregate — the shape the planner proves yields exactly one row, so it drops the join when no
  column of it is selected (ADR-0147). Same filters, same functions, same types, same order.
- `staff_rejection_reason_v`'s gate is `(select current_app_role())`: an InitPlan, once per
  statement. Still admin-only (20260923220000), still an owner-rights `security_barrier` view.
- `quiz_attempts (staff_id, taken_at)` is indexed.
- The view stays `security_invoker`; every reader still sees only what its RLS allows.
- `docs_missing` / `quiz_blockers` still call `onboarding_documents_missing()` /
  `onboarding_quiz_blockers()` — they are the rule. They get cheaper because
  `current_compliance_docs()`, which both read, is now inlined into their cached plans.

### How the changes are applied

Every definition is re-created from the **live** one (docs/10 §3b; the pattern of
20261017180000): `pg_get_functiondef()` / `pg_get_viewdef()` changed by named patterns, each
of which must match the expected number of times or the migration stops. View options are read
back and restated, because `CREATE OR REPLACE VIEW` would otherwise reset them.

## Equivalence

The old definitions are recreated verbatim in a schema `_old`
(`supabase/tests/_shared/rule20_before_20261018130000.psql`; each old helper calls the old
helpers below it) and compared, inside the test transaction, over
`_shared/cap_dataset.psql` — a generated agency with every RULE-20 branch (term, holiday and
straddling weeks with holidays opening mid-week; below degree level; a completion letter dated
in the past and one verified now but dated in the future; an opt-out, an opt-out under 18, one
cancelled with its notice period ending mid-week; work and dependant visas with a weekly limit,
the visa beating the opt-out; a right to work expiring mid-week and this Thursday; undated
evidence for `can_roster_staff`), ten weeks of history and six ahead in every booking status,
overnight and Sunday-night sections, resolved and unresolved No check-outs.

- `853`: `cap_week_start` 18,628 days × 4 zones; `weekly_cap` over a 176,400-row grid of every
  input class (all eight bands reached), its 10- and 4-argument overloads; `cap_under_18`,
  `can_roster`, `booking_counts_toward_cap`, `booking_reopenable_by`,
  `booked_elsewhere_conflict`, `rota_guard_decide`, `cap_term_state` over their grids;
  `weekly_cap_for` for 120 workers on every day of 16 weeks, `weekly_cap_hours`,
  `can_roster_staff`, `weekly_booked_hours(_except)`; `rota_guard_verdict` and
  `weekly_cap_would_breach` for every worker on a section in each of ten weeks, in `block` and
  `warn` mode (ok, visa cap, working-time cap and lapsed right to work all occur); the same
  answers under a worker's own RLS. 0 differences.
- `854`: `staff_bookings()` for 60 workers: every booking, same order, every column the old
  value; the three cap columns the old values on every invitation and future booking (both
  "Limit Reached" and not, ended invitations included) and null on the rest. 0 differences.
- `855`: `onboarding_candidates_v` `select *` as the office, as a candidate (their own row) and
  as a client, identical; same columns/types/order and options; the narrow read drops both
  laterals; the gate is an InitPlan. 0 differences.
- The existing RULE-20 tests (`090` with the `cap.vectors.json` cases, `200`, `260`, `290`,
  `300`, `361`, `362`, `500`, `595`, `603`, `665`, `673`, `846`) pass unchanged.

## Consequences

Timings, `scripts/bench/rule20_staff_bookings_candidates.sql` (local PG 16, 1,000 workers,
300 candidates, 114k bookings, 1,041 sections; best of 3, as the office admin under
`authenticated`):

| Read | Before | After | |
|---|---|---|---|
| `weekly_cap_would_breach`, per call | 4.78 ms | **0.60 ms** | 8× |
| `weekly_cap_for`, per call | 0.40 ms | **0.11 ms** | 3.6× |
| `weekly_booked_hours`, per call | 0.56 ms | **0.18 ms** | 3× |
| `can_roster_staff`, per call | 0.072 ms | 0.065 ms | |
| `staff_bookings()`, one worker with ~115 bookings | 590 ms | **11.9 ms** | 50× |
| `onboarding_candidates_v`, the /onboarding board's columns | 294 ms | **104 ms** | 2.8× |
| `onboarding_candidates_v`, `select *`, every row | 2,931 ms | 1,971 ms | 1.5× (the rest is `quiz_blockers`) |
| `onboarding_candidates_v`, `select *` by id | 5.1 ms | 4.6 ms | |
| `staff_directory_v`, the /staff page's columns | 4,881 ms | 3,619 ms | 1.35× (F8 is the rest) |
| `auto_assign_candidates`, one section, 1,000-worker pool | 10,339 ms | 6,173 ms | 1.7× (F2 is the rest) |

Per call, the cap helpers measured here run as the office under RLS, which re-reads
`current_app_role()` once per query inside each invoker helper; the Staff App reaches them
through `staff_bookings()` (security definer), where that cost does not apply.

- The live project is Micro compute (audit F0): read the absolute numbers as relative.
- **Not done here:** `staff_account_activated()` / `staff_account_activated_at()` still each
  call `current_app_role()` per candidate row (~0.2 ms a row); merging them needs a new definer
  function. `quiz_blockers` (only in `select *`) is dominated by `compliance_blockers()`.
  `auto_assign_candidates*()` and `staff_open_shifts()` (F1, F2) gain from the cheaper chain but
  are not restructured.
- Postgres 18 caches nested SQL-function plans itself; when Supabase moves to it, the plpgsql
  wrappers remain correct and can stay.
