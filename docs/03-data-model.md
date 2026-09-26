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
| Audit | `audit_log`, `report_sends`, `job_runs` + `job_schedules` (`20260921130927`) | Who verified/blocked/resolved, what the Monday job sent, and every background-job execution with its counts and error (§7). |
| StaffUnavailability (addition, ADR-0042) | `staff_unavailability` (`20260930200100`) | Half-open `tstzrange` per entry, built by `unavailability_range()` from UK dates/times (all day = UK midnight → UK midnight); ≤ 31 UK days; `series_id` for “repeat weekly”; **no reason column** (Q10). `staff_unavailable(staff, starts, ends)` is the gate, against the **role section** window (RULE-18), for automated invitations and offer pushes only. |
| Emergency contact (addition, ADR-0043) | `staff_emergency_contacts` | One per worker; name 1–100, relationship 1–40, phone E.164 (the `/apply` rule). Office-only worker data: never in a `client_*` view or a §11.3 document. Deleted on GDPR removal. |
| ProfileChangeRequest (addition, ADR-0044) | `profile_change_requests` | Name or photo; `pending → approved \| rejected \| withdrawn` (`profile_change_transitions()` + guard); one pending per kind; proposed values immutable; reject needs `decision_reason` (shown to the worker); paths must be under the worker's own `<staff_id>/`. |
| Shift offer (addition, ADR-0045) | `shift_offers`, `shift_offer_notices` | Mode `pool \| office \| direct`; `open → taken \| withdrawn \| lapsed \| cancelled` (`shift_offer_transitions()` + guard); the only mode change is `office → pool` while open; one open per booking; the offerer stays confirmed until the take. Notices make OF1 rounds additive. `bookings.cancel_cause` gains `handed_over`, `booking_source` gains `offer` (`20260930200000`). |
| Referral (addition, ADR-0046) | `staff_referral_codes`, `application_referrals` | Code `^[A-HJ-NP-Z2-9]{8}$`, one per worker, revoked (never reissued) on GDPR removal; referral rows are kept and read “Deleted account #id”. No reward, no money. |

## Calculated values (never stored)
- **Weekly cap** — `weekly_cap_hours(staff, date)` returns 20 / 48 / `null` (no ceiling), `weekly_cap_band` the band that produced it (0008). A Mon–Sun week takes the lowest cap of any day; `staff.term_dates` holds the letter's HOLIDAY ranges, so a date outside every range is term time. The opt-out lifts the ceiling everywhere except where the visa condition sets it (student, in term, not graduated). Graduated workers are a flat 48, or `null` with the opt-out. The hours side is `weekly_booked_hours` / `weekly_hours_remaining` (confirmed, worked and closed bookings only, bucketed by the role section's start in Europe/London) and the §3.4 gate `weekly_cap_would_breach(staff, shift)`. Same vectors in Vitest and in `supabase/tests/090_weekly_cap.sql`.
- **Event window and status** — from the role sections.
- **Final pay rate, margin** — from base × 1.1207 and the client's charge rate.
- **Payable time** — view `payable_shifts_v` (0006): intersection of [check-in, check-out] with the role window, 30-min check-in grace, 15-min check-out grace, breaks deducted when unpaid, 4-hour floor unless a Left-early violation or an unresolved No check-out, RULE-15 fixed 4 h for turn-aways on time, nothing for late turn-aways or no-shows. The `pay` column reads `status = undetermined` — never a figure — while a No check-out is open (RULE-02). Same vectors as `packages/domain/pay.ts`.
- **Show-rate, rating** — materialised nightly into `staff.reliability` / `staff.rating` by `compliance-daily` for scoring speed; the source of truth is bookings + violations + feedback.

## Key Postgres functions (0002–0006)
| Function | Purpose |
|---|---|
| `accept_invite(booking_id)` | Row-locks the shift, checks slots (headcount + buffer), overlap with the worker's other confirmed bookings (same venue back-to-back OK; different venues need 2 h gap), weekly cap; sets confirmed; withdraws overlapping open invites (→ cancelled, cause `overlap`); returns `taken` if slot gone (RULE-03). |
| `attempt_check_in(booking_id, lat, lng)` | (0006) Row-locks the role section; logs the attempt; geofence check; grace/lock rules; strict-buffer turn-away with RULE-15 outcome; returns the message key to show. `security definer`: a worker holds no insert policy on `check_logs`. |
| `check_out(booking_id, lat, lng)` | (0006) In/out of radius; last on-site fix fallback; raises `no_checkout` when the only fix is the check-in itself, and when the press is 4 h past the end; returns the confirmation screen's worked/payable minutes and the base rate. |
| `check_in_decision`, `check_out_decision`, `payable_minutes`, `turned_away_minutes` | (0006) The pure halves of §5.1–5.2, mirrored by `packages/domain/pay.ts` and held to the same `pay.vectors.json` in both suites. |
| `resolve_violation(id, note, actual_finish_at)` | (20260921153000) Mandatory note on every type. Validates finish ≥ check-in and ≤ now, with no upper bound against the scheduled end; reclassifies No-show → Late and registers the arrival (§3.3); restores the 4-hour floor for No check-out. Reports `payrollExported` so the screen can point at Finance (RULE-06). `security invoker` — admins already hold the policies, so it adds no owner to the FORCE-RLS debt. |
| `start_break(booking)`, `finish_break(booking)` | (20260921153000) §5.2b. Unlock at check-in, stay open until check-out, one break at a time, several per shift, and nothing at all where the client pays for breaks. `security definer`: a worker holds no insert policy on `breaks`. |
| `unpaid_break_minutes(booking)` | (20260921153000) The one break total the screens, the RPCs and `payable_shifts_v` all read. An unfinished break runs to the recorded check-out (docs/14 Q2). |
| `cancel_event(id, reason)` | Marks cancelled, cancels bookings, withdraws invites/applications, queues N12 to all three groups, stops auto-assign. |
| `withdraw_booking`, `self_cancel_booking`, `request_p45`, `declare_conviction`, `gdpr_remove`, `reset_to_candidate`, `block_staff`, `unblock_staff`, `recheck_compliance` | Each implements exactly the list of consequences in its scope section and writes `audit_log`. |

## RLS summary
- `admin`: all rows, all tables.
- `staff`: own `staff` row, own bookings/docs/declarations/check logs/breaks/feedback-about-them (rating only), open shifts for their roles via `radar_v` (respects Wave 1/Wave 2 visibility and do-not-return), the `roles.pay_rate` of their own roles only.
- `client`: `client_events_v`, `client_lineup_v`, `client_role_sections_v`, insert into `feedback`. No table exposes `charge_rate`, `pay_rate` or margin to a client. `client_events_v` is `security_invoker` and rides the `events` policy; the other two run with owner rights and carry the tenancy rule (`client_portal_visible()`) in their own body, because the tables beneath them are money-bearing and hold no client policy at all (ADR-0004, `0005_client_lineup.sql`).
- The seven docs/19 additions (`20260930200100`): one `admin_read` policy each and **nothing** for staff, client or anon — the worker reads and writes through definer RPCs (ADR-0031), the office writes through audited definer RPCs, and no `client_*` view reads them (pgTAP `700`). GDPR removal reaches them through the `staff_removed_purge_additions` trigger on `staff.removed_at` (pgTAP `702`).
- Service role: Edge Functions and Next.js server actions only.
