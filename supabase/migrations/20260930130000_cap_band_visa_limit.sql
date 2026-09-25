-- =====================================================================
-- Migration 20260930130000 · the cap band for a visa's own hours limit
-- (audit D36; RULE-20, §2.5, docs/scope/university-completion-letter-
-- requirement.pdf §7)
--
-- A work visa or a dependant visa can carry a weekly hours limit of its
-- own (a supplementary-employment ceiling, a dependant's condition). It is
-- an immigration condition, exactly like the Student visa's term-time
-- limit, so the 48-hour opt-out cannot lift it. 20260930130100 applies it
-- in weekly_cap() and needs a band to name it by: `visa_limit`.
--
-- A label on its own migration: a value added to an enum cannot be used
-- in the transaction that added it (the precedent is 20260922093000).
-- Mirrors CapBand in packages/domain/src/cap.ts.
-- =====================================================================

alter type cap_band add value if not exists 'visa_limit';

comment on type cap_band is
  'RULE-20 band (§4.4-4.5 + the University Completion Letter requirement). visa_limit (20260930130000) is a weekly hours limit written on a work or dependant visa, captured at the right-to-work check. Mirrors CapBand in packages/domain/src/cap.ts one label for one label; held to packages/domain/src/cap.vectors.json on both sides.';
