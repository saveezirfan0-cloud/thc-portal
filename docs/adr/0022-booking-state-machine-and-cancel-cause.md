# ADR-0022 · The booking state machine in the database, and one `cancel_cause`

Status: accepted · 24.09.2026 · closes docs/14 §4 B2 and B3

## Context

`packages/domain/src/state.ts` modelled four of the seven `booking_status`
values (`invited`, `confirmed`, `worked`, `cancelled`) and nothing in the
database refused an illegal status change. CLAUDE.md requires both halves.

`bookings.cancel_cause` had three vocabularies: the 0001 column comment
(`withdraw / cutoff / … / left`), `CANCEL_REASONS` in the domain
(`office_withdraw`, `compliance_block`, …) and the office Withdraw action
(`withdraw`). The Staff App's "You've been removed from this shift" screen
matched `office_withdraw`, which nothing wrote.

## Decision

1. **Seven states, ten edges** (Scope §3.6 with §3.3, §3.4, §3.5, §4.3,
   RULE-15, §10.4, §10.6, §1.7), listed with their § in
   `packages/domain/src/bookingState.vectors.json`:
   `invited → confirmed | cancelled | closed`,
   `applied → confirmed | cancelled | closed`,
   `confirmed → worked | turned_away | cancelled`, `closed → applied`;
   `worked`, `turned_away`, `cancelled` are terminal. Staying put is not a
   transition.
2. **The edges are a function, `booking_transitions()`, not a table.** They
   change only with a migration, and a function adds no RLS surface (a
   table would need policies and the 001/020/030/040 assertions). The
   `bookings_state_guard` BEFORE UPDATE OF status trigger calls
   `assert_booking_transition()` and raises
   `illegal_booking_transition: <from> -> <to>`.
3. **INSERT is not guarded.** A booking is born `invited` or `applied`, but
   fixtures and the seed insert finished history (`worked` shifts from 2025),
   which is not a transition.
4. **`cancel_cause` keeps the vocabulary the SQL write paths already emit**,
   named after the scope's own triggers: `office_withdraw`, `ready_cutoff`,
   `self_cancel`, `overlap_auto_withdraw`, `event_cancelled`, `blocked`,
   `left`, `gdpr` and the three `<cause>_invite` halves of `block_worker()`
   (status `cancelled`); `slot_taken`, `declined`, `withdrawn_by_worker`
   (status `closed`). `compliance_block` becomes `blocked`: a manual block and
   a conviction under review release through the same cascade. The check
   constraint ties each cause to its one status and allows none on a live
   row. The migration maps `withdraw`, `cutoff` and `compliance_block`, clears
   causes left on live rows, and stops, naming them, on anything else.
5. Both sides are held to the vectors: Vitest (`bookingState.test.ts`) and
   pgTAP (`490_booking_state_machine.sql`, via the generated
   `supabase/tests/_shared/booking_state_vectors.psql`), which drives all 49
   status pairs through the trigger on a real row.

## Consequences

- A worked (checked-in) booking can no longer be withdrawn or cancelled with
  the event. The board hides Withdraw for it (`canCancelBooking`), and the
  action says why if it is reached anyway. §3.3 pays a mid-shift cancellation
  from the scheduled hours, so nothing depends on cancelling it.
- Test fixtures that rewound a booking (`worked → confirmed`,
  `confirmed → invited`) now delete and re-insert the row.
