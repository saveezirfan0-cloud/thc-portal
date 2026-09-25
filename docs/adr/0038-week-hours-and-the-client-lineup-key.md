# ADR-0038 · "Hours this week" is worked over the cap, and the client line-up is keyed by role section

Status: accepted · 30.09.2026 · records what 20260930110400 and 20260930110500 built

## Context

- §9.6 defines the profile tile as "Hours this week (worked / calculated weekly
  limit)", and amber "if Hours this week reaches the full weekly limit". The
  wireframe annotates the same tile "booked + worked". The directory's
  "Limit reached" badge and the rota guard both work on _booked_ hours
  (`weekly_booked_hours()`), because that is what stops another booking. The
  tile printed booked hours, because no view carried worked ones.
- §11.2 groups the confirmed line-up "by role"; §11.3's PDF lists it by role
  _section_ (two sections of one role are two blocks, each with its own window,
  `packages/pdf/src/sheet.ts` `sectionKey`). The portal grouped by role name, so
  two sections of one role showed as one panel under the first one's window.

The Inactive tab's columns and the "Limit reached … until" date, which the same
earlier round also built, were shipped independently on main (20260928110000,
`StaffScreen.tsx`) and are not part of this record.

## Decision

1. **Hours this week = worked / cap**, with booked hours as the second line.
   Worked hours (`staff_directory_v.weekly_worked_hours`, 20260930110500) are the
   scheduled role-section hours (RULE-18) of this Mon–Sun week's bookings that
   reached `worked`, so they are in the same unit and the same Europe/London week
   as the booked figure and the cap. The amber highlight follows the **booked**
   hours reaching the cap: a worker with 8 h worked and 20 h booked against a
   20 h cap cannot take another shift, and the tile must not look calmer than
   the rule that is enforcing it (`hoursThisWeek()` in
   `apps/office/app/staff/[id]/profile.ts`).
2. **The client line-up is keyed by role section** (`client_lineup_v.shift_id`,
   20260930110400), matching the PDF. The shift id is an opaque key that
   `client_role_sections_v` already returns to the same caller; it carries no
   money and opens no table (pgTAP 664). `groupBySection()` in
   `apps/client/app/client/rules.ts` falls back to role + window for a row with
   no shift id, as the PDF does.

## Consequences

- `staff_directory_v` is main's 20260928110700 body with one column appended;
  the derived `staff_show_rate()` and every 20260928110000 column stay.
- `staff_profile_v` is dropped and recreated in 20260930110500 so its `d.*`
  picks up the directory's later columns; nothing depends on it. Its own
  `weekly_cap_until` is gone — the directory's arrives through `d.*` — and any
  later restatement must keep it coming from there rather than redeclaring it
  (pgTAP 665 asserts the profile names it once). The recreated view is
  select-only for `authenticated` and `service_role`.
