-- =====================================================================
-- 503 · A declined invitation grants nothing and counts for nothing (§9.6)
--   20260924150000_closed_is_not_worked.sql
-- =====================================================================
begin;
select plan(3);
\ir _shared/fixtures.psql

\set bk '50300000-0000-4000-8000-000000000001'
delete from client_qualifications where staff_id = :'staffb' and client_id = :'clienta';
insert into bookings (id, shift_id, staff_id, status, source) values (:'bk', :'shift_a', :'staffb', 'invited', 'auto');
update bookings set status = 'closed', cancel_cause = 'declined', cancelled_at = now() where id = :'bk';

select is((select count(*)::int from client_qualifications where staff_id = :'staffb' and client_id = :'clienta'), 0,
  'declining an invitation does not qualify the worker at that client');
select is((select shifts_worked from staff_profile_v where id = :'staffb'),
          (select count(*)::int from bookings where staff_id = :'staffb' and status = 'worked'),
  'and the profile counts worked shifts only');
select is_empty($$ select 1 from pg_proc where proname in ('grant_qualification_for_booking','bookings_grant_qualification')
                     and prosrc like '%''closed''%' $$,
  'neither qualification function treats closed as completed');

select * from finish();
rollback;
