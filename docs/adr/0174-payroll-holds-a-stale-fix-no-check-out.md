# ADR-0174 · Payroll holds a shift whose No check-out is unresolved, even with a recorded finish

**Status:** Accepted · 20.10.2026 · **Restores:** §9.9 Tab 2 ("A shift with an unresolved "No
check-out" Violation shows "Pending" … and is excluded from the CSV export (§7, BG-08) until a
manager resolves it"), RULE-02 ("never a silent default") · **Builds on:** ADR-0035 (D15, the
stale-fix check-out), ADR-0172 (Ready to invoice, whose review found this) · **Asked by:** THC,
20.10.2026, before go-live

`supabase/migrations/20261022090000_payroll_holds_stale_fix.sql` · pgTAP `908` (and `902`
follows)

## Context

A worker who presses Check out away from the venue has their last on-site location fix
recorded as the finish, and a No check-out is raised for a manager to review (D15). The pay
engine prices that line on the stale finish and calls it settled. `report_payroll_lines_v`
took that verdict as it was, so:

- the Payroll tab showed a figure;
- the CSV carried it;
- the Monday send (BG-08) exported it.

A worker checked in at 12:00 whose last fix was 12:05 was paid 5 minutes for a 4-hour shift,
and no manager had looked. Invoicing (ADR-0172) already held such an event; payroll did not.

## Decision

`report_payroll_lines_v` marks a worked line **pending** while any No check-out on its booking
is unresolved, whatever the pay engine says. That is one expression, replaced in the live
definition and pinned to match exactly once. Everything that reads the view follows unchanged:

- **Payroll tab:** the shift shows Pending with no money.
- **CSV:** the shift is out, because `in_export` needs a settled line.
- **Monday send (BG-08):** the shift is recorded as **held**. It is exported the first Monday
  after a manager resolves it with the real finish, as for every other pending line.
- **A line already exported that turns pending:** it shows the existing "changed since export"
  warning, never a silent correction (RULE-06).
- **Financial tab:** the shift counts as pending.
- **Invoicing:** the line carries no amount, and the event stays Missing check-out.

## Consequences

- The pay engine (`payable_shifts_v`, `payable_minutes`) is unchanged. The worker's own
  earnings screen and the check-out answer still read it; whether they should also say
  "pending" is a separate question.
- A manager resolving the No check-out is now what releases the pay. The Check-in screen's
  Violation log is where it is done, as before.
