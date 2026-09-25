# ADR-0036 · Worker availability: a hard gate for automated invitations, advisory for people

Status: proposed — awaiting THC · 25.09.2026

Addition to Scope v1.6: §1.5 (new entity *StaffUnavailability*), §3.4 and §6 (a gate on
automated invitations), §3.3 (Unavailable reason), §9.6 (profile tab), §10.1 (Profile
row). Plan: `docs/18-staff-features-plan.md` §1. THC: Q9, Q10 (`docs/15-open-questions.md`).

## Context

The scope gives a worker no way to say "I can't work that day". Auto-assign (§3.4, §6)
invites everyone who passes the hard gates, so a worker on holiday, in exams or at a
second job is pushed invitations they will only decline, and every decline costs a round
of the hourly allocation. The product owner approved an availability calendar in the
Staff App.

Two ways to feed it into auto-assign were on the table:

- **A sixth scoring factor.** §6's five weights (0.30 show · 0.25 rating · 0.25 proximity ·
  0.10 fair · 0.10 venue) are contractual. A sixth factor either changes them or can be
  outscored, and a high-scoring worker would still be pushed invitations for days they
  said they cannot work.
- **A hard gate.** It sits beside the existing gates (wrong role, blocked, booked
  elsewhere, hours limit, self-cancelled, do-not-return) and leaves the weights alone.

## Decision

1. **Unavailability is a hard gate on what the machine does, and advice to people.** It
   stops: hourly rounds, the first round, cutoff refills, same-day escalation, and offer
   pushes (OF1, ADR-0039). It does **not** stop:
   - a manager's manual invite — allowed after a confirm dialog, in the spirit of
     RULE-17's override: "{name} marked themselves unavailable for this time. Invite
     anyway?";
   - the worker's own Accept, Radar apply or Take-offer — the worker has changed their
     mind, which is their call;
   - open invitations — never withdrawn by auto-assign (§3.4);
   - a confirmed booking — never cancelled by a calendar entry. The Staff App warns the
     worker and points at Cancel / Offer on the shift.
2. **Overlap is measured against the role section**, never the event window (RULE-18):
   `staff_unavailable(p_staff, p_starts, p_ends)` tests `&&` against the section's
   start/end.
3. **Times are Europe/London.** An all-day entry is UK midnight → UK midnight (23 h on
   29.03.2026, 25 h on 25.10.2026). A window whose end is at or before its start on one
   date is overnight. Weekly repeats keep the UK wall-clock time across a clock change.
   The Add sheet labels its time inputs "(UK time)" and shows a "your time" line when the
   viewer's zone differs (§1.8).
4. **No reason field.** A reason invites health data the platform has no basis to hold;
   Q10 asks THC whether they want one.
5. **Limits:** single days, ranges ≤ 31 days, or a time window on a day; "Repeat weekly
   for N weeks" ≤ 26; up to 365 days ahead; no entry in the past; at most 200 future
   rows. Refusals: `in_past`, `too_far`, `too_long`, `bad_window`, `too_many`.
6. **Surfaces.** Staff App: `/profile/availability` (only when `appLock() === 'none'`),
   and a Profile row "Availability — Days you can't work". Back Office: a read-only
   **Availability** tab on `/staff/:id` (next 8 weeks, UK), and on `/events/:id` the
   Unavailable section gains "Marked unavailable · {UK window}" with **Invite anyway**
   behind the confirm above, calling the existing `office_invite_worker`.

### Data model (Phase 0)

`staff_unavailability`: `id uuid pk`, `staff_id → staff`, `period tstzrange not null`
(half-open, finite, not empty, ≤ 31 days), `all_day bool`, `series_id uuid null` (one
"repeat weekly"), `created_at`. GiST on `period`, btree on `staff_id`. Builders
`unavailability_range(p_from_date, p_to_date, p_from, p_to) → tstzrange` and
`staff_unavailable(p_staff, p_starts, p_ends) → bool`. RLS: one `admin_read` select
policy; **no staff policy and no client policy**. Workers read and write through
`security definer` RPCs (`my_unavailability`, `add_my_unavailability`,
`remove_my_unavailability`), the ADR-0031 pattern. `invite_worker` is restated once
(from `20260928110200`) so `p_source in ('auto','escalation')` refuses
`unavailable`; `'manual'` still invites.

The TS twin is `packages/domain/src/availability.ts`, held to
`availability.vectors.json` (Vitest and pgTAP 651). `HARD_GATES` in `scoring.ts` is
unchanged: the calendar gate is overlaid by `withAvailability()` so office code does not
ripple.

## Consequences

- **What never changes.** §6's weights; the existing hard gates; open invitations are
  still never withdrawn; confirmed bookings are never cancelled by the calendar; the
  client sees none of it — no client policy, no `client_*` view reads the table
  (ADR-0004/0026; `001_rls_guard`'s empty set holds, pgTAP 650 adds a `pg_depend`
  check). No PDF, report or payroll export reads it. No notification is added.
- GDPR removal deletes the rows (trigger `staff_removed_purge_additions`, pgTAP 652).
- pgTAP 650–652 (Phase 0), 655 (worker RPCs), 656 (`invite_worker` refuses
  `unavailable` for auto and escalation, manual still invites, accept/apply still
  succeed, every earlier `invite_worker` refusal re-asserted in one file).
- **THC to confirm** (docs/15): Q9 — gate or preference, and whether it should also stop
  manual invitations; Q10 — the shape (ranges, repeats, horizon) and whether a reason is
  wanted.
