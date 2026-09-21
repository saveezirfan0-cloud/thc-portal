# 03 · Data model

Implemented in `supabase/migrations/0001_init.sql`. This page explains the choices; the SQL is the truth.

## Entities (§1.5 → tables)

| Scope entity | Table(s) | Notes |
|---|---|---|
| Role | `roles` | `pay_rate` base £/h; final = `final_rate(pay_rate)` = ×1.1207, computed, never stored. |
| Staff / Candidate | `staff`, `staff_roles`, `staff_references`, `bank_details`, `hmrc_checklists`, `quiz_attempts` | `status` is the §2.12 state machine. `employee_id` from a sequence, assigned once at contract signature and **kept across resets**. `term_dates daterange[]` is the only input to the cap. No stored cap column, by design (RULE-20). |
| Client, ClientRateCard | `clients`, `client_rate_cards` | Break/buffer policies at client level; dress codes are a text array per client+role. |
| Venue | `venues`, `venue_types` | Soft delete; events snapshot venue name/address/location/radius so deleting a venue never breaks an event (§9.11). |
| Event | `events` + view `event_windows` + fn `event_status()` | Status is derived (Upcoming/Ongoing/Completed) except `cancelled_at`. PO number free text. |
| ShiftRequirement | `shift_requirements` | One per role section with its own `starts_at/ends_at` (RULE-18), `headcount`, `buffer` (absolute), `allocation_per_hour`, role-level `auto_assign`. CHECK: ≥ 4 h. |
| ClientQualification | `client_qualifications` | Unique per (client, role, staff). `granted_by` null = automatic; `granted_from_event` names the clean shift. `do_not_return` is the only hard gate on this table. |
| Booking | `bookings` | Statuses: invited → confirmed → worked; cancelled; closed (invite lost to first-to-confirm); applied (Radar self-application, `source = self`); turned_away (RULE-15). `self_cancelled` flags permanent exclusion from that event (RULE-04). `reconfirm_required` = the "Awaiting" state after a time/venue/dress change. |
| CriminalDeclaration | `criminal_declarations` | Append-only history. `answer=false` rows are created already `verified`. |
| ComplianceDoc | `compliance_docs` | One row per upload; `superseded` after Reset to candidate; term letters carry `term_dates`, completion letters carry `completion_date`. Share-code result stored as `doc_type = share_code_report` with the PDF path. |
| CheckLog | `check_logs` | One row per **attempt**, outcome `checked_in / turned_away / out_of_radius`. The successful row also carries check-out fields. |
| Breaks | `breaks` | Only exist where the client does not pay breaks. |
| Violation | `violations` | Five types; `actual_finish_at` only for `no_checkout` resolution. |
| Feedback | `feedback` | Client rows count toward rating only once `read_at` is set. |
| Notifications | `push_subscriptions`, `notification_outbox` | Outbox `key` is unique → idempotent sends. |
| Config | `settings`, `venue_types` | Replaces Django Admin. |
| Audit | `audit_log`, `report_sends`, `job_runs` (0002) | Who verified/blocked/resolved, and what the Monday job sent. |

## Calculated values (never stored)
- **Weekly cap** — `weekly_cap_hours(staff, date)` returns 20 / 48 / `null` (no ceiling with opt-out). A Mon–Sun week takes the lowest cap of any day. Graduated workers return 48. Same vectors tested in `packages/domain/cap.test.ts`.
- **Event window and status** — from the role sections.
- **Final pay rate, margin** — from base × 1.1207 and the client's charge rate.
- **Payable time** — view `payable_shifts_v` (0005): intersection of [check-in, check-out] with the role window, 30-min check-in grace, 15-min check-out grace, breaks deducted when unpaid, 4-hour floor unless a Left-early violation or an unresolved No check-out, RULE-15 fixed 4 h for turn-aways on time, nothing for late turn-aways or no-shows. The `pay` column reads `status = undetermined` — never a figure — while a No check-out is open (RULE-02). Same vectors as `packages/domain/pay.ts`.
- **Show-rate, rating** — materialised nightly into `staff.reliability` / `staff.rating` by `compliance-daily` for scoring speed; the source of truth is bookings + violations + feedback.

## Key Postgres functions (0002–0005)
| Function | Purpose |
|---|---|
| `accept_invite(booking_id)` | Row-locks the shift, checks slots (headcount + buffer), overlap with the worker's other confirmed bookings (same venue back-to-back OK; different venues need 2 h gap), weekly cap; sets confirmed; withdraws overlapping open invites (→ cancelled, cause `overlap`); returns `taken` if slot gone (RULE-03). |
| `attempt_check_in(booking_id, lat, lng)` | (0005) Row-locks the role section; logs the attempt; geofence check; grace/lock rules; strict-buffer turn-away with RULE-15 outcome; returns the message key to show. `security definer`: a worker holds no insert policy on `check_logs`. |
| `check_out(booking_id, lat, lng)` | (0005) In/out of radius; last on-site fix fallback; raises `no_checkout` when the only fix is the check-in itself, and when the press is 4 h past the end; returns the confirmation screen's worked/payable minutes and the base rate. |
| `check_in_decision`, `check_out_decision`, `payable_minutes`, `turned_away_minutes` | (0005) The pure halves of §5.1–5.2, mirrored by `packages/domain/pay.ts` and held to the same `pay.vectors.json` in both suites. |
| `resolve_violation(id, note, actual_finish_at)` | Validates finish ≥ check-in and ≤ now; reclassifies No-show → Late; restores the 4-hour floor for No check-out. |
| `cancel_event(id, reason)` | Marks cancelled, cancels bookings, withdraws invites/applications, queues N12 to all three groups, stops auto-assign. |
| `withdraw_booking`, `self_cancel_booking`, `request_p45`, `declare_conviction`, `gdpr_remove`, `reset_to_candidate`, `block_staff`, `unblock_staff`, `recheck_compliance` | Each implements exactly the list of consequences in its scope section and writes `audit_log`. |

## RLS summary
- `admin`: all rows, all tables.
- `staff`: own `staff` row, own bookings/docs/declarations/check logs/breaks/feedback-about-them (rating only), open shifts for their roles via `radar_v` (respects Wave 1/Wave 2 visibility and do-not-return), the `roles.pay_rate` of their own roles only.
- `client`: `client_events_v`, `client_lineup_v`, `client_role_sections_v`, insert into `feedback`. No table exposes `charge_rate`, `pay_rate` or margin to a client. `client_events_v` is `security_invoker` and rides the `events` policy; the other two run with owner rights and carry the tenancy rule (`client_portal_visible()`) in their own body, because the tables beneath them are money-bearing and hold no client policy at all (ADR-0004, `0005_client_lineup.sql`).
- Service role: Edge Functions and Next.js server actions only.
