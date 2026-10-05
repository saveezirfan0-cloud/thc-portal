-- Migration 20261005110000 · applications get a 'duplicate_candidate' outcome
--
-- A new enum value cannot be used in the transaction that adds it, so the
-- function and the data fix that use it are in 20261005110100.
alter type application_outcome add value if not exists 'duplicate_candidate';

comment on type application_outcome is
  'candidate_created = a new candidate; returning_applicant = matched a record the office can act on (§2.12); duplicate_candidate = matched a record still in the onboarding pipeline, nothing to action.';
