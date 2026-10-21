# ADR-0184 · A sign-out more than 15 minutes past the end is paid and charged to the actual finish

**Status:** Accepted · 21.10.2026 · **Changes:** §5.2 RULE-01 as written ("Between 15 minutes and
4 hours after the scheduled end, a late check-out still pays only up to the scheduled end …
it does not change the payable amount") — a deliberate change from the scope, listed as item 4
in `CLAUDE.md` · **Builds on:** ADR-0095 (a late check-in is paid from the actual check-in),
ADR-0035 (D5 Left early, D15 stale fix), ADR-0172 / ADR-0176 (ready to invoice, invoices and the
sign-in log) · **Asked by:** THC's owner, 21.10.2026

`supabase/migrations/20261022200000_overrun_paid_to_actual_finish.sql`,
`20261022200100_overrun_capped_and_dated.sql`, `20261023110000_overrun_followups.sql`,
`20261023110100_overrun_set_based.sql` · pgTAP
`921`, `923` (and `010`, `070`, `140`, `892` follow) · `packages/domain/src/pay.ts`, `pay.vectors.json` ·
`packages/pdf/src/invoice.ts`, `signInLog.ts`, `csv.ts` · `apps/office/app/checkin/`
(`status.ts`, `MonitorTable.tsx`, `MonitorScreen.tsx`, `VerifyLateModal.tsx`, `actions.ts`,
`data.ts`) · `apps/staff/app/shifts/[id]/earnings.ts`, `FullScreens.tsx`

## Context

THC, verbatim: "For the sign out between 16:15 and 20:00 we need to be able to pay and charge for
the time the staff actually finished their shift. It should flag to say that this staff member
signed out late. This then needs to be verified by the office by speaking to the staff member to
find out the reason. Charging and paying to 16:00 won't work in this instance as the staff member
has worked longer. The shift doesn't need to be approved by the office if the staff member's
shift is overrunning. Quite often the events run over late at night so this won't be possible.
The shift that over ran should feature as it's own line on the invoice so it's clear. The 15
minute period between 16:00 and 16:15 (pay and charge is to 16:00 is correct)".

16:00 is the scheduled end of the worker's **role section** (RULE-18), never the event's.

## Decision

1. **The pay window's end.** A check-out at or before end + 15 min is paid and charged to the
   scheduled end, as before. A check-out **more than 15 minutes** after it — up to end + 4 h,
   where RULE-02's No check-out takes over unchanged — is paid **and** charged to the **actual
   recorded finish**: the on-site press, or the last on-site fix when pressed off site
   (`check_out_decision`, unchanged). A finish the office enters resolving a No check-out is the
   check-out too, so the same rule applies to it. **The paid end is capped at the scheduled end
   + 4 h** (`NO_CHECK_OUT_AFTER_MIN`): THC's rule is for sign-outs "between 16:15 and 20:00",
   a worker's own press cannot be later (check-out locks), and a finish the office types —
   resolving a No check-out, or a No-show's "Get back" with a finish — still has no upper
   bound in §9.5, so a typo would otherwise be paid and invoiced in full. Such a finish is still
   accepted and recorded; the finish field's hint says time more than 4 hours after the
   scheduled end is not paid. Same hourly pay rate and same client charge rate;
   holiday 12.07 % is still broken out, never blended. `payable_minutes()` /
   `payableMinutes()` return the minutes paid past the end as **`overrunMin`** (at most 240).

   **Effective date — no history is re-priced.** The rule applies only to role sections whose
   **scheduled end is on or after 21 October 2026, 00:00 Europe/London** (= 2026-10-20
   23:00:00+00). An earlier section keeps the rule it was worked under: paid to the scheduled
   end however late the check-out (its `overrunMin` is 0; the §9.5 red flag is the clock and is
   unchanged). The cutoff is one named constant on each side — `OVERRUN_PAID_FROM` in
   `packages/domain/src/pay.ts`, and the literal `timestamptz '2026-10-20 23:00:00+00'` in
   `payable_minutes()` / `break_window_minutes()` (20261022200100, commented to here) — and
   `pay.vectors.json` holds both to it with a vector on each side (the vectors' base date
   moved to 14 November 2026 so the rest exercise the rule as it stands). `late_check_outs()`
   leaves out sections before the cutoff.
2. **RULE-14's four-hour floor** applies to the total, unchanged (Left early and an unresolved
   No check-out still block it). On the invoice, the floor's top-up sits on the shift's own line.
3. **Breaks.** The paid window now runs to the actual finish on an overrun, so a break taken
   during the overrun is inside it and is unpaid like any other (a worker on a break is not
   working). The deduction is taken off the **main part**: the overrun is the clock time from
   the scheduled end to the finish, which the client can check against the sign-out on the log.
   Only when the breaks are longer than the whole main part — not a real shift — does the
   excess come off the overrun, so main + overrun is always the worked total.
4. **A check-in at or after the scheduled end** still intersects nothing and stays
   undetermined: the overrun extends a shift that reached its end; it never creates one.
5. **"Signed out late" is a flag, never a hold.** It is **not** a row in `violations` — those
   feed the show-rate, the invoice sign-off (ADR-0172) and the payroll holds (ADR-0174). Payroll,
   ready-to-invoice and the invoice never wait for it, and verifying changes nothing the invoice
   sign-off's fingerprint covers.
6. **Verify.** The office records that it spoke to the worker: who, when and a note (1–500
   characters), with `verify_late_check_out(booking, note)` — `current_app_role()` admin and
   `office_can('write')` (owner, manager, scheduler; a viewer is refused), audited as
   `booking.late_check_out_verified`. Verifying again replaces the note and is audited again.
   The columns (`late_check_out_verified_at`, `_by`, `_note`) are on the accepted **`check_logs`**
   row — the row that already carries `check_out_at` and `manager_finish_at` — rather than on
   `bookings`: `bookings` is readable by its worker (`staff_self_bookings`), `check_logs` only by
   the office, and the note is the office's, as a violation's resolution note is.
   `late_check_outs(days, include_verified)` lists them for the office (sections ended in the
   last 1–92 days, default 14; a still-open No check-out is left to the violation log).
7. **The office.** `/checkin`'s monitor keeps §9.5's red "Checked out" pill on a late sign-out,
   with "Signed out late — verify with the worker" and a **Verify** button under it; once
   verified the pill goes back to neutral and the line says who verified it, and the row leaves
   "Needs attention". Because the board shows only today's sections and late nights are usually
   followed up the next day, a **"Signed out late — verify with the worker · last 14 days"** panel
   lists every unverified one, each with Verify. The Verify window shows the scheduled end (UK),
   the sign-out (viewer's time), the overrun, and says nothing waits for it.
8. **The invoice.** `report_payroll_lines_v` carries `overrun_min` and `overrun_invoicing` (of
   `payable_min` / `invoicing`). `invoice_claim()` issues a shift signed out late as **two
   lines**: the shift (scheduled start–end, its break, the rest of the minutes) and, straight
   after it, an **`overrun`** line — same worker, role and charge rate, Start = the scheduled end,
   End = the actual finish, no break — printed "Overrun – <role>". The main amount is the shift's
   charge less the overrun's, so the two add up to the penny and the invoice net is unchanged.
   The ready-event CSV (`invoice_export_rows`) splits the same way.
9. **The sign-in / sign-out log** keeps one row per shift (one sign-in, one sign-out): the
   overrun line is folded back into its shift's row by `bookingId` (now in
   `invoice_document_data`), the hours are both lines' together, and the note reads e.g.
   "Overrun 1 h 15 min". The log's total hours remain the invoice's.
10. **The Staff App** pays the worker the same figure (it runs the same `payableMinutes`); the
    shift-complete summary adds "You checked out 1 h 15 m after the scheduled end, so you're paid
    to when you checked out. The office will be in touch to ask why the shift ran late."

## Consequences

- Every surface that prices a shift follows from `payable_minutes()`: `payable_shifts_v`,
  `report_payroll_lines_v` (payroll, BG-08, finance), `staff_earnings()`,
  `staff_shift_history_v`, `check_out()`'s answer.
- Forward-only and dated (1): nothing that ended before 21.10.2026 00:00 UK is re-priced, so
  no payroll export, ready-to-invoice sign-off or invoice of an earlier shift changes. Issued
  invoices are immutable in any case.
- The scope's 16:15 example ("checked out at 16:15 for a 16:00 finish → paid to 16:00") is
  unchanged and still in the vectors.

## Follow-ups (THC's owner, 21.10.2026)

Four points first left for later, decided the same day (`20261023110000`, made set-based in
`20261023110100`; pgTAP `923`):

1. **RULE-20 counts the paid overrun.** The weekly cap is judged on booked hours — each counted
   booking's scheduled length. A shift signed out late now adds its paid overrun
   (`cap_overrun_minutes()` / `capOverrunMinutes()`: `overrunMin` once the pay is settled, so
   nothing while a No check-out is open; held together by the `capOverrun` vectors) wherever a
   Mon–Sun week is summed: `weekly_booked_hours()` (the Staff App's meter, `staff_bookings`,
   open shifts), `weekly_booked_hours_except()` (the rota guard), `series_hours_blocked()`
   (ADR-0117), the auto-assign pool (`auto_assign_candidates_pool_pairs()`, so
   `auto_assign_worker_gate()` and the lists) and `staff_directory_v` (its booked and worked
   hours this week, and `staff_profile_v` / `student_visa_v` on it). Each sum reads the
   overrun **once, as a set** (`20261023110100`, after QA measured the first, per-booking
   version at up to 10× slower): `booking_overruns(ids)` returns the paid overrun of the given
   bookings in one statement — their accepted check-in rows, the unpaid breaks of those signed
   out late, `cap_overrun_minutes()` on those only — and each sum passes only its bookings
   whose section ended on or after the cutoff and at least 15 minutes ago, and LEFT JOINs the
   result (an empty set returns without a read). `scripts/bench/radar_and_pool_at_scale.sql`
   seeds 2,000 shifts finished this week, a third signed out late; every read it times is back
   within about 1.2× of the figures before this follow-up.
   Nothing is refused after the fact: a late sign-out that takes a worker over the cap is
   **flagged**, "Over weekly limit: 21 h 15 of 20 h" (amber) on the `/checkin` row, the
   "Signed out late" list and the Verify window, from `late_check_out_weeks(ids)`: the hours
   counted against the cap for each booking's Mon–Sun week, overrun included — booked hours,
   as the cap itself counts them — and the cap, for a set of bookings in one read. `/checkin`
   asks it once for the monitor's late rows and the list's rows together (neither
   `checkin_monitor_v` nor `late_check_outs()` computes it per row). Later bookings that week
   are judged against the real hours.
2. **Each invoice line is its own minutes × rate.** A shift's `invoicing` in
   `report_payroll_lines_v` is now round(main minutes × rate / 60, 2) + round(overrun minutes ×
   rate / 60, 2), so both invoice lines are priced on their own and still add up to the shift;
   ready to invoice, the invoice net, the CSV and the financial report all sum that figure.
   £17.35/h, 465 minutes of which 75 overrun: £112.78 + £21.69 = £134.47 (one price would have
   been £134.46). Pay stays one figure: payroll never shows the split. The overrun line ends at
   the scheduled end plus its own minutes — the actual finish, or end + 4 h for a later finish
   entered by the office — on the invoice, the CSV and the office's review alike.
3. **The office's review shows the split.** `invoice_event_lines()` returns `overrun_min`,
   `overrun_invoicing`, `late_check_out` and `late_check_out_verified`;
   `/reports/invoicing/:eventId` draws "Overrun – <role>" under the shift, from the scheduled
   end to the paid end with its minutes, rate and amount, and a "Signed out late · verified /
   not verified" marker. The sign-off fingerprint needs nothing new — it already covers each
   line's check-out, payable minutes and amount, from which the split follows — and Verify
   still changes nothing it covers.
4. **`check_logs` is written only through functions.** `check_logs_write_guard` refuses any
   insert, update or delete made directly by an API role (anon, authenticated): 42501
   `not_permitted`. The writers — `attempt_check_in`, `check_out`, `record_ping`,
   `remove_worker`, `verify_late_check_out` — were already SECURITY DEFINER;
   `resolve_violation` (and through it `get_back`) was the one invoker writer and is now a
   definer, its own admin check and the viewer's `office_read_only` unchanged (`892` pins it:
   215). Jobs use the service role. No app code writes `check_logs` directly.

