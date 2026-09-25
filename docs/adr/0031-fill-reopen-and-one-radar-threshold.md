# ADR-0031 · What fills a slot, who may reopen an ended booking, and one Radar threshold

Status: accepted · 29.09.2026 · audit 25.09 D2, D3, D33, D34, D38, D39 · raise the
marked defaults with THC (docs/15)

## Context

The 25.09 audit found the auto-assign engine and Radar disagreeing with the scope
in six places that share one subject — which bookings count, and what a booking
that has ended still means:

- **D2.** `attempt_check_in()` moves a booking `confirmed → worked` (§3.6), but
  `shift_fill()`, the booked-elsewhere gate and `accept_invite()` counted only
  `confirmed`. A fully checked-in section read as empty: the escalation job
  re-invited it every 10 minutes, and a worker on shift at venue A could be
  invited to, and accept, venue B.
- **D3.** `invite_worker()` refused `target_met` at confirmed + INVITED ≥ headcount
  + buffer, so rounds stalled on unanswered invitations. §3.4: "earlier
  invitations stay open … it keeps adding until headcount + buffer is filled".
- **D33.** Any earlier row on the section barred the worker for good
  (`already_has_booking`). §3.6: "Unlike the other cancelled triggers above,
  self-cancel permanently excludes the worker from that specific event".
- **D34.** N11's key held the new start only; the card printed field names; a
  dress-code change said "Shift time changed".
- **D38.** Withdraw was a direct UPDATE plus a second, client-flagged N10b call.
- **D39.** Radar offered a section while confirmed < headcount, but applications
  closed with N10c only at headcount + buffer: in between, the Applied card
  vanished and nothing was sent.

## Decision

1. **`worked` is staffed.** "Fill counts ONLY confirmed" (§3.2/§3.3) reads
   `status in ('confirmed','worked')` wherever the question is "is this slot
   staffed / is this worker booked": `shift_fill()` (and so every round, Radar,
   the office invite and `accept_application`), the booked-elsewhere gate and
   `accept_invite()`'s overlap net. A `worked` booking is a confirmed one that
   has checked in; it holds its slot exactly as it did a minute earlier. The
   board already listed both under Confirmed. `turned_away` is not staffed
   (RULE-15 turned them away because the section was full).
2. **Rounds gate on confirmed < target only.** Open invitations never count
   toward the target; each hourly round adds `allocation` more until the target
   is CONFIRMED, then stops. The escalation still ignores the target.
3. **An ended booking may be reopened, by whom depends on how it ended**
   (`booking_reopenable_by()` in SQL, `bookingReopenableBy()` in `state.ts`):

   | End | Who reopens it |
   |---|---|
   | self_cancel, event_cancelled, gdpr, gdpr_invite | never |
   | closed/slot_taken, cancelled/overlap_auto_withdraw, blocked(_invite), left(_invite) — ended by circumstance | anyone, an auto-assign round included |
   | closed/declined, closed/withdrawn_by_worker, cancelled/office_withdraw, cancelled/ready_cutoff — ended by a decision | a person only: the office's manual invite, or the worker's own Radar application |

   **Default to confirm with THC:** the scope says only self-cancel is permanent
   but does not say whether AUTO-ASSIGN should re-invite someone who declined,
   was withdrawn by the office, or was released at 12:05. Re-inviting a decliner
   an hour later — or, at 12:05, the worker the cutoff has just released — would
   be the machine overruling a person, so rounds reopen circumstance only.

   The row is reopened in place (`bookings` is unique on `(shift_id, staff_id)`),
   which takes three new state-machine edges: `cancelled → invited`,
   `cancelled → applied`, `closed → invited` (`closed → applied` existed).
   `cancelled` is therefore no longer terminal. A self-cancelled row can never
   leave `cancelled` — `bookings_self_cancel_is_final` makes RULE-04 a database
   constraint. A row carrying check-in history, a break or a violation is never
   reopened. A reopened invitation is a new offer: fresh stamps and its own N5,
   keyed `N5:booking:<id>:<ms>`, with `booking_push_payload()` (held equal to
   `queue_booking_push()`'s payload by pgTAP 616).
4. **Only workers have a candidate row.** Candidates mid-onboarding and rejected
   applicants no longer appear as Unavailable "Blocked — compliance"; every write
   path calls them `not_bookable`.
5. **One Radar threshold: headcount.** Radar offers a section, `apply_to_shift`
   answers `full`, `accept_application` refuses `full`, and
   `close_filled_role_applications()` closes the pending applications with N10c
   — all at confirmed (or checked in) ≥ HEADCOUNT, the point the board's own
   header reads "0 open". An application is for a seat; the buffer is filled by
   invitations, and a closed applicant can still be invited by hand (slot_taken
   is reopenable). A worker's own pending application stays on Radar until it
   resolves, whatever the wave or the gates do meanwhile, up to the section's end
   (RULE-16). **Default to confirm with THC:** the alternative single threshold is
   headcount + buffer, which would put buffer seats on Radar too.
6. **Withdraw is `withdraw_booking()`** — decides from the row under the section
   lock, cancels with `office_withdraw` and queues the push in the same
   transaction: N10b (§8, verbatim) for a confirmed worker, **N10d** for an
   invitee. N10b's trigger covers the invitation, but "You've been removed from"
   is untrue for someone who never had the shift.
7. **N11** is keyed on the role's new start AND end and a per-save marker; the
   card reads a sentence with the old window ("Start time moved by the office
   (was 09:00–14:00)"); a dress-code or venue-only change sends **N11b** "Shift
   details changed — {change}". N10d and N11b are extensions (`EXTENSION_CODES`),
   never `SCOPE_CODES`.

## Consequences

- `auto_assign_candidates()` gains a trailing `booking_cause` column (so a round
  can tell a decline from a lost slot); it is revoked from anon.
- Tests that pinned the old behaviour were changed: 300 (an office withdrawal was
  "not an invitation to re-apply"), 490 and `state.test.ts` (cancelled terminal),
  510 and `acceptApplication.test.ts` (N10c at headcount + buffer),
  `board-model.test.ts` (ended bookings in Unavailable).
- The event board lists reopenable ended bookings in the Potential pool with
  "earlier: Declined · manual only", and keeps only non-reopenable ones in
  Unavailable.
- An auto or escalation invitation now also re-reads both auto-assign switches at
  the insert (`auto_assign_off`), so a switch turned off mid-round takes effect at
  the next insert rather than the next round.
