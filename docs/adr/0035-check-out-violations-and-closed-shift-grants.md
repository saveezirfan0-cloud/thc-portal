# ADR-0035 · Left early, a stale on-site fix, the late No-show and when a shift is "completed"

Status: accepted · 30.09.2026 · audit 25.09 D5, D8, D15, D16, D17, D37, D49 ·
raise the marked defaults with THC (docs/15)

Migrations `20260930100000_check_in_out_corrections.sql` and
`20260930100100_staff_shift_detail_left_early.sql`; pgTAP 650–652.

D4 (Get back) and D7 (the show-rate) were fixed on main independently —
`get_back(uuid, text)` in 20260928110200 and `staff_show_rate()` in
20260928110100 — and are not decided here. This ADR builds on both.

## Context

The 25.09 audit found the day of the shift paying, flagging and qualifying the
wrong people in seven places still open on main:

- **D5.** "Left early" (§9.5) was never raised anywhere, so RULE-14's four-hour
  floor paid a worker who went home after an hour.
- **D8.** The Staff App's check-out screen priced the shift with no violations,
  so it showed four hours to a worker payroll then paid one.
- **D15.** With screen-open pings only (ADR-0001 Option A), "the last on-site
  fix" is often the ping sent just after check-in. An off-site check-out then
  settled the shift near its start, silently.
- **D16.** `attempt_check_in()` never asked whether the worker was allowed to
  work; only the app's lock did, and it failed open.
- **D17.** Resolving a No-show after the section had ended wrote
  `check_in_at = now()`: a check-in after the end intersects nothing, so the
  shift stayed Pending for ever.
- **D37.** The automatic client qualification (§9.6) was granted when the
  booking became `worked` — at check-in, before any Late / Left early exists.
- **D49.** Breaks taken outside the paid window were still deducted.

## Decision

1. **Left early = a check-out pressed more than 15 minutes before the ROLE
   SECTION's scheduled end** (RULE-18), on site or off. `check_out_decision()`
   returns `leftEarly`; `check_out()` inserts the `left_early` violation.
   - *Default, raise with THC:* the 15 minutes mirror the check-out grace
     (§5.2). §9.5 says only "before the scheduled end". Without a tolerance,
     every worker who presses at 21:58 for a 22:00 finish lands in the coral
     log. Inside the 15 minutes the early minutes are still deducted by
     RULE-01; only the flag waits, and the floor question cannot arise on a
     shift that long.
   - *Off site too.* §9.5 calls Left early "a planned early finish … while
     still on site". A worker who walks off and then presses check-out before
     the end has finished early just the same; without the flag, RULE-14's
     floor would pay them for leaving. The press, not the fix, is the
     evidence they had stopped.
   - Not raised on a manager-entered finish (Resolve): the manager decides
     that case with the note.
2. **A stale on-site fix is reviewed.** Off site, when the last on-site fix is
   more than 30 minutes before the press AND more than 30 minutes before the
   scheduled end, `check_out()` still records that fix (§5.1's message quotes
   it, word for word) and raises `no_checkout` for a manager to confirm the
   finish. While it is unresolved RULE-14's floor is blocked and RULE-01 pays
   to the fix; resolving it with the actual finish settles the shift and
   restores the floor (§5.2).
   - *Default, raise with THC:* 30 minutes. A fix within 30 minutes of the
     press is the worker leaving and pressing on the way out; within 30
     minutes of the end is the shift worked to its end.
   - The worker is shown the normal off-site message (`checked_out_off_site`);
     the review is the office's.
   - *Consequence:* if the office has not resolved it by the Monday send, the
     shift is exported at the RULE-01 figure without the floor, and a later
     resolution shows the RULE-06 "please notify Finance to pay it" warning.
   - *Show-rate.* main's `staff_show_rate()` counts an unresolved No check-out
     against the worker. The review row is marked
     `violations.stale_fix_review` and the show-rate (SQL and its
     `showRate()` twin) leaves it out: the worker did press Check out, and
     what made the fix stale is the app's screen-open pings, not them. The
     floor still waits for the manager.
3. **Get back stays main's** `get_back(uuid, text)`, which calls
   `resolve_violation(v, note)` and so inherits point 4 below.
4. **A No-show takes a manager-entered arrival** (`p_arrived_at`, "Arrived at
   (UK time)"): not before start − 30 (check-in opens then, §5.1), not in the
   future, and **required once the section has ended**, because the press
   would then sit after the end. An optional finish (`p_actual_finish`) closes
   the shift in the same action — written as the check-out and as the
   manager-entered finish — so it settles; without one the missing check-out
   takes the normal RULE-02 path. The board's Get back sends no arrival, so
   after the end it answers `arrived_at_required`, which the board words as
   "The shift has ended — use Resolve in the violation log to enter the
   arrival and finish." The Violation log's Resolve dialog carries "Arrived at
   (UK time)" and an optional "Actual finish (UK time)" for a No-show.
5. **Only a compliant worker checks in.** `attempt_check_in()` raises
   `staff_not_compliant` when `staff.status <> 'compliant'`. A shift already
   under way is not stopped: `check_out()`, the breaks and `record_ping()` do
   not ask, because a block must not leave a shift that cannot close.
6. **A shift is completed when it closes.** The automatic client
   qualification is granted when the accepted check log gets a finish (a
   recorded or manager-entered check-out) with no unresolved violation on the
   booking; the `bookings` status trigger is gone and a `check_logs` trigger
   replaces it. `check_out()` writes its violations before it closes the log,
   so the grant sees them. Resolving a violation still re-checks.
7. **Breaks are clipped** to [max(check-in, start), min(finish, end)] in
   `unpaid_break_minutes()` and `packages/domain` `unpaidBreakMinutes()`, held
   to the `breaks` vectors. The Staff App's live chargeable timer still pauses
   for every break (§5.2b); the money uses the clipped figure.
8. **The Staff App prices the check-out as payroll does.** `earnings.ts` passes
   RULE-14's blockers: `noCheckoutOpen` and `left_early` from
   `staff_shift_detail()` (the latter appended to main's 20260928120000 body
   by 20260930100100); until the server has answered, the screen reads it
   from the check-out (a finish more than 15 minutes early), which errs
   towards the smaller figure.

## Consequences

- `check_out_decision()` and its TypeScript mirror carry `leftEarly`; the
  shared vectors (`pay.vectors.json`) changed for the off-site "left 16:00,
  pressed 21:00" case, which now also raises the review, and gained Left
  early, stale-fix and break-clipping cases.
- `resolve_violation()` gained `p_arrived_at`; the three-argument signature
  was dropped and recreated. main's `get_back(uuid, text)` is unchanged and
  keeps working through the defaults.
- main's tests that resolved a No-show on a section that had ended days ago
  (596, 603) now pass the arrival, as a manager must.
- `violations.stale_fix_review` is a new column; `types.generated.ts` needs
  regenerating after the migration is deployed.
