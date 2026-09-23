-- =====================================================================
-- 504 · onboarding_candidates_v keeps both 24.09 changes
--   20260924160000_candidates_view_carries_both.sql
-- =====================================================================
begin;
select plan(2);
select ok(pg_get_viewdef('onboarding_candidates_v'::regclass) like '%staff_account_activated%',
  '`activated` means the login has a password (20260924110000), not merely that one is linked');
select ok(pg_get_viewdef('onboarding_candidates_v'::regclass) like '%staff_rejection_reason_v%',
  'and rejection_reason is still read through the owner-rights view (20260923220000, #48)');
select * from finish();
rollback;
