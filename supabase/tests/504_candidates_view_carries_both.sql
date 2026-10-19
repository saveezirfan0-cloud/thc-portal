-- =====================================================================
-- 504 · onboarding_candidates_v keeps both 24.09 changes
--   20260924160000_candidates_view_carries_both.sql
-- =====================================================================
begin;
select plan(2);
-- Since 20261020110100 (ADR-0160) `activated` comes from staff_account_activation_v,
-- the same password test as staff_account_activated() for many rows at once.
select ok(pg_get_viewdef('onboarding_candidates_v'::regclass) like '%staff_account_activation_v%'
          and pg_get_viewdef('staff_account_activation_v'::regclass) like '%encrypted_password%',
  '`activated` means the login has a password (20260924110000), not merely that one is linked');
select ok(pg_get_viewdef('onboarding_candidates_v'::regclass) like '%staff_rejection_reason_v%',
  'and rejection_reason is still read through the owner-rights view (20260923220000, #48)');
select * from finish();
rollback;
