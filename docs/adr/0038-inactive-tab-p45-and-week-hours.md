# ADR-0038 · The Inactive tab's P45 column, "Hours this week" and the client line-up key

Status: accepted · 25.09.2026 · records what 20260929160000–20260929160200 built; raise the P45 point with THC

## Context

- §9.6: "The Inactive tab lists everyone who has left through the app (§10.6),
  newest first, showing the date they left and the reason they gave — so the
  office has a single place to work through outstanding P45s and final pay."
  `wireframes/backoffice/staff.html` draws that tab with three more columns:
  Last completed shift, Released shifts, and **P45**, whose pill reads either
  *Requested* ("E8 sent 21:14") or *Issued* ("payroll 14 Sep").
- §10.6, "What it does not do": "The system does not produce the P45 itself. A
  P45 is issued by payroll … this action is the trigger and the audit record for
  THC to issue it through its own payroll process, nothing more." No section
  gives the office a control to record that payroll has issued it, and §2.8
  rules out storing a P45 file.
- §9.6 defines the profile tile as "Hours this week (worked / calculated weekly
  limit)", and amber "if Hours this week reaches the full weekly limit". The
  wireframe annotates the same tile "booked + worked". The directory's
  "Limit reached" badge and the rota guard both work on *booked* hours
  (`weekly_booked_hours()`), because that is what stops another booking.
- §11.2 groups the confirmed line-up "by role"; §11.3's PDF lists it by role
  *section* (two sections of one role are two blocks, each with its own window).

## Decision

1. **P45 column = Requested, with the E8 state.** `staff_directory_v` carries
   the E8 outbox row's `sent_at` / `failed_at` for an inactive worker, and the
   pill always reads *Requested*, with "E8 sent 17 Sep 21:14", "E8 queued" or
   "E8 failed to send — check the outbox" beneath it. There is no *Issued*
   state, because the platform holds no fact that says so and inventing a
   "mark issued" write path is outside the scope's §10.6 boundary.
   *If THC wants the tab to track completion*, the smallest change is a
   `p45_issued_at` column on `staff` with one admin RPC and a button on this
   row; the view and pill already have the slot.
2. **Released shifts** are the confirmed bookings `request_p45()` released —
   `cancel_cause = 'left'` stamped at `left_at`, the same rows E8's list is read
   from. Withdrawn invitations (`left_invite`) are not lost shifts and are not
   counted. **Last completed shift** is the latest `worked` booking.
3. **Hours this week = worked / cap**, with booked hours as the second line.
   Worked hours are the scheduled role-section hours (RULE-18) of this Mon–Sun
   week's bookings that reached `worked`, so they are in the same unit and the
   same Europe/London week as the booked figure and the cap. The amber
   highlight follows the **booked** hours reaching the cap: a worker with 8 h
   worked and 20 h booked against a 20 h cap cannot take another shift, and the
   tile must not look calmer than the rule that is enforcing it.
4. **The client line-up is keyed by role section** (`client_lineup_v.shift_id`,
   20260929160000), matching the PDF. The shift id is an opaque key that
   `client_role_sections_v` already returns to the same caller; it carries no
   money and opens no table (pgTAP 640).

## Consequences

- `staff_profile_v` is dropped and recreated in 20260929160100 so its `d.*`
  picks up the directory's new columns; nothing depends on it. Any later
  restatement must keep `phone` and `weekly_cap_until` coming through `d.*`
  rather than redeclaring them.
- The Inactive tab never shows *Issued* until THC decides on point 1.
