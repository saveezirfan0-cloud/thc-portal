-- =====================================================================
-- Migration 20260930100000 · booking_source += 'offer'
--   (ADR-0039 Offer up a shift; docs/18 §4, Phase 0-A)
--
-- A worker who takes a shift another worker offered up is booked by
-- take_offered_shift() (Agent A, 20260930110100) with source = 'offer',
-- so the event board, the reports and the audit trail can tell a hand-over
-- from an invitation (auto / escalation / manual) or a Radar application
-- (self). §3.6's booking machine is unchanged: the taker's row still
-- reaches `confirmed` by the existing edges.
--
-- On its own because `alter type … add value` cannot be USED in the
-- transaction that adds it (docs/18 §0 "Reserved numbers"). Nothing in
-- 20260930100100 writes the new value; the first writer is Agent A's
-- migration, a later transaction.
--
-- Forward-only. `if not exists` makes a re-run harmless.
-- =====================================================================

alter type booking_source add value if not exists 'offer';

comment on type booking_source is
  'How a booking came about: auto (hourly auto-assign, §3.4), escalation (same-day escalation, §3.4), manual (the office invited by hand, §3.3), self (Radar application, §10.4), offer (took a shift another worker offered up, ADR-0039).';
