-- =====================================================================
-- 502 · staff_documents_v carries rtw_no_time_limit (§2.5 pt 2)
--   20260924130300_staff_documents_rtw_no_time_limit.sql
-- =====================================================================
begin;
select plan(4);
\ir _shared/fixtures.psql

\set settled 'c5020000-0000-4000-8000-000000000001'
\set doc     'c5020000-0000-4000-8000-0000000000d1'

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'settled', 'Settled', 'Status', 'ss@502.test', '+447700950201', date '1990-01-01', 'compliant', 'eu_settled');
insert into compliance_docs (id, staff_id, doc_type, review_status, share_code, uploaded_at,
                             right_to_work_until, rtw_no_time_limit)
values (:'doc', :'settled', 'share_code_report', 'verified', 'W12345678', now(), null, true);

select has_column('staff_documents_v', 'rtw_no_time_limit',
  'staff_documents_v names the settled-status confirmation');
select is(
  (select attnum from pg_attribute where attrelid = 'public.staff_documents_v'::regclass
      and attname = 'rtw_no_time_limit'),
  (select max(attnum) from pg_attribute where attrelid = 'public.staff_documents_v'::regclass
      and attnum > 0 and not attisdropped),
  'appended at the end, so no existing column moved');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select results_eq(
  format($$ select right_to_work_until, rtw_no_time_limit from staff_documents_v where id = %L $$, :'doc'),
  $$ values (null::date, true) $$,
  'the office reads a verified settled-status share code as no time limit, not as a missing date');
select is(
  (select coalesce(bool_or(rtw_no_time_limit), false) from staff_documents_v where staff_id = :'staffa'),
  false,
  'and a document that is not a settled-status confirmation never says so');
reset role;

select * from finish();
rollback;
