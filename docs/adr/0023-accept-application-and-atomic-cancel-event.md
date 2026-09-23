# ADR-0023 · Taking a Radar application forward, N10c at the fill, and an atomic Cancel event

Status: accepted · 25.09.2026 · closes three docs/14 §4 items from the 24.09 wave

## Context

- `applied → confirmed` has been a legal edge since ADR-0022, but no function
  performed it. The office could not take a Radar application forward, and N10
  / N10c were written by nothing.
- `cancelEvent` in the office did four writes from the browser session and never
  read the error from the bookings update. A refused update left a Cancelled
  event with live bookings and no N12, and the manager was told it had worked.
- `accept_invite` asked `weekly_cap_would_breach()` directly and called every
  refusal `hours_limit`, including an expired right to work, which
  auto-assign already told apart (`20260924130100`).

## Decision

1. **`accept_application(p_booking)`** (`20260925100000`). Admin only
   (definer, checks the caller in its body, revoked from anon, no service-role
   door). It locks the role section as `accept_invite` and `invite_worker` do,
   then refuses in this order: `event_cancelled`, `not_applied`, `event_ended`
   (RULE-16), `full` (confirmed ≥ headcount + buffer), `not_bookable` (no
   candidate row: removed or left), then the auto-assign hard gate by name
   (`wrong_role`, `do_not_return`, `blocked`, `self_cancelled`,
   `booked_elsewhere`, `rtw_expired`, `hours_limit`). On success it confirms
   the application, withdraws the worker's overlapping invitations
   (`overlap_auto_withdraw`, the same as `accept_invite`), queues N10 and
   applies decision 2. The rota guard trigger stays the backstop. The TS half
   is `acceptApplication()` in `packages/domain/src/state.ts`.
2. **N10c at the fill, for every kind of confirmation.** §8 says N10c goes out
   "the moment the role becomes fully confirmed … one trigger covers both a
   manual office pick of someone else and an automatic auto-assign /
   first-to-confirm fill". `close_filled_role_applications(p_shift)` is that one
   trigger. Both `accept_application` and `accept_invite` call it after they
   confirm. Once confirmed reaches headcount + buffer, it closes each pending
   application as `closed` with cause `slot_taken` (ADR-0022's cause for an
   offer that someone else's confirmation ended) and queues N10c. `closed`
   keeps §10.4's door open: the worker can apply again if the role reopens.
   N10c is keyed per application (`N10c:booking:<id>:<applied_at epoch>`), so
   a re-application that closes again is told again.
3. **No "Decline application".** The scope does not have one. §10.4 and §8
   end an application in only four ways: taken forward (N10), not taken
   forward because the role filled (N10c), withdrawn by the worker, or ended
   by the event being cancelled (N12). A manager passing over an applicant is
   not an event the scope names or notifies. The board therefore offers only
   **Accept application** on an applicant's row.
4. **`cancel_event(p_event, p_reason)`** (`20260925100100`) does §3.3 points
   1–3 in one transaction:
   - requires a reason (`reason_required`);
   - refuses a second press (`already_cancelled`);
   - marks the event and stops auto-assign for the event and every role on it;
   - cancels confirmed, invited and applied bookings with `event_cancelled`;
   - queues N12 to each, with the key the office action used before.

   `worked` bookings are untouched, because §3.6 has no edge out of `worked`.
   A failure anywhere rolls the whole cancellation back. The office action is
   now a single RPC call, and it surfaces any error.
5. **`accept_invite` answers `rtw_expired`** when the gate that fired is the
   right-to-work stop. It uses the same test as the rota guard: the shift's
   start and end UK days must both fall inside the right to work.
   `ACCEPT_REFUSAL_COPY` gains `rtw_expired`, with the same words as the Radar
   copy, and `event_ended`, which the RPC already returned but the Staff App
   had no words for.

## Consequences

- `accept_invite`'s success result now also carries `closedApplications`.
- `361_completion_letter` AC6 now expects `rtw_expired` from `accept_invite`.
- The board lists pending applications in the Potential pool with "Applied Xh
  ago" and Accept. The ranked pool itself is still the separate auto-assign
  change.
