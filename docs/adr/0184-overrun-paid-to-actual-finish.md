# ADR-0184 · A sign-out more than 15 minutes past the end is paid and charged to the actual finish

**Status:** Accepted · 21.10.2026 · **Changes:** §5.2 RULE-01 as written ("Between 15 minutes and
4 hours after the scheduled end, a late check-out still pays only up to the scheduled end …
it does not change the payable amount") — a deliberate change from the scope, listed as item 4
in `CLAUDE.md` · **Builds on:** ADR-0095 (a late check-in is paid from the actual check-in),
ADR-0035 (D5 Left early, D15 stale fix), ADR-0172 / ADR-0176 (ready to invoice, invoices and the
sign-in log) · **Asked by:** THC's owner, 21.10.2026

`supabase/migrations/20261022200000_overrun_paid_to_actual_finish.sql` · pgTAP `921` (and `070`,
`892` follow) · `packages/domain/src/pay.ts`, `pay.vectors.json` ·
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
   check-out too, so the same rule applies to it (no upper bound, as before: the manager is
   entering when the worker really left). Same hourly pay rate and same client charge rate;
   holiday 12.07 % is still broken out, never blended. `payable_minutes()` /
   `payableMinutes()` return the minutes past the end as **`overrunMin`**.
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
- Forward-only, applied to every shift not yet exported: a shift already in a payroll export
  whose payable minutes now differ shows RULE-06's existing "changed since export" warning — it
  is never corrected retroactively. An event's ready-to-invoice sign-off whose lines change goes
  back to review through its fingerprint, as for any change. Issued invoices are immutable.
- The scope's 16:15 example ("checked out at 16:15 for a 16:00 finish → paid to 16:00") is
  unchanged and still in the vectors.
