-- =====================================================================
-- 540 · A verified right-to-work document keeps its date
--   20260926120000_rtw_date_cannot_be_blanked.sql
--
-- compliance_docs_rtw_date_guard (20260923200000) acted only on the flip
-- to `verified`; a later direct UPDATE blanking the date was not refused
-- (docs/14 §4, ADR-0018). compliance_docs_rtw_date_keep refuses it for
-- every role, with one escape — set local thc.allow_rtw_date_clear = 'on'
-- — honoured only for the owner and service_role, never for anon or
-- authenticated (a custom GUC is settable by any session, so the setting
-- is not the permission; the caller's role is).
--
--   A. Admin through PostgREST (authenticated + admin_all): refused, with
--      and without the setting; a change to another date is still fine.
--   B. service_role: refused without the setting, allowed with it.
--   C. Owner: refused without the setting, allowed with it; the worker's
--      date follows the evidence.
--   D. anon / authenticated setting the GUC are still refused — directly
--      (given a temporary grant + policy so the trigger is what answers)
--      and through a SECURITY DEFINER function owned by the migration role.
--   E. A settled-status share code (rtw_no_time_limit) stays dateless
--      legitimately; switching the flag off without a date, or claiming it
--      off the EU settled branch, is refused.
--   F. A legacy verified-and-dateless row is not made worse by a touch.
-- =====================================================================
begin;
select plan(23);
\ir _shared/fixtures.psql

\set w_visa   'c5400000-0000-4000-8000-000000000001'
\set w_eu     'c5400000-0000-4000-8000-000000000002'
\set w_old    'c5400000-0000-4000-8000-000000000003'
\set d_visa   'c5410000-0000-4000-8000-000000000001'
\set d_share  'c5410000-0000-4000-8000-000000000002'
\set d_stat   'c5410000-0000-4000-8000-000000000003'
\set d_eu     'c5410000-0000-4000-8000-000000000004'
\set d_old    'c5410000-0000-4000-8000-000000000005'

select (now() at time zone 'Europe/London')::date as today \gset

insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status, rtw_branch, share_code) values
  (:'w_visa', 95401, 'Vera', 'Visa',    'vera@rtw540.test', '+447700954001', date '1995-01-01', 'compliant', 'work_visa',  'W54000001'),
  (:'w_eu',   95402, 'Emil', 'Settled', 'emil@rtw540.test', '+447700954002', date '1995-01-01', 'compliant', 'eu_settled', 'W54000002'),
  (:'w_old',  95403, 'Olga', 'Legacy',  'olga@rtw540.test', '+447700954003', date '1995-01-01', 'compliant', 'dependant_other', 'W54000003');

-- Inserted already verified (the flip guard is an UPDATE trigger), as the
-- state a real verification leaves behind.
insert into compliance_docs (id, staff_id, doc_type, uploaded_at, review_status, expiry_date,
                             right_to_work_until, rtw_no_time_limit, share_code) values
  (:'d_visa',  :'w_visa', 'visa_document',     now() - interval '3 days', 'verified', :'today'::date + 400, null, false, null),
  (:'d_share', :'w_visa', 'share_code_report', now() - interval '3 days', 'verified', null, :'today'::date + 300, false, 'W54000001'),
  (:'d_stat',  :'w_visa', 'status_document',   now() - interval '3 days', 'verified', :'today'::date + 500, null, false, null),
  (:'d_eu',    :'w_eu',   'share_code_report', now() - interval '3 days', 'verified', null, null, true, 'W54000002'),
  (:'d_old',   :'w_old',  'status_document',   now() - interval '3 days', 'verified', null, null, false, null);

-- ---------------------------------------------------------------------
-- A · admin via PostgREST
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_like(format($$ update compliance_docs set expiry_date = null where id = %L $$, :'d_visa'),
  '%rtw_date_locked%', 'A: admin cannot blank a verified visa document''s expiry');
select throws_like(format($$ update compliance_docs set right_to_work_until = null where id = %L $$, :'d_share'),
  '%rtw_date_locked%', 'A: admin cannot blank a verified share code report''s right-to-work date');
select throws_like(format($$ update compliance_docs set expiry_date = null where id = %L $$, :'d_stat'),
  '%rtw_date_locked%', 'A: admin cannot blank a verified status document''s expiry');
select throws_like(format($$ update compliance_docs set doc_type = 'share_code_report' where id = %L $$, :'d_visa'),
  '%rtw_date_locked%', 'A: admin cannot move a verified visa onto a type whose date it does not carry');

select set_config('thc.allow_rtw_date_clear', 'on', true);
select throws_like(format($$ update compliance_docs set expiry_date = null where id = %L $$, :'d_visa'),
  '%rtw_date_locked%', 'A/D: admin (authenticated) setting thc.allow_rtw_date_clear is still refused');
select set_config('thc.allow_rtw_date_clear', 'off', true);

select lives_ok(format($$ update compliance_docs set expiry_date = %L::date where id = %L $$, :'today'::date + 450, :'d_visa'),
  'A: a verified document''s date may still be corrected to another date');
reset role;
select is((select expiry_date from compliance_docs where id = :'d_visa'), :'today'::date + 450,
  'A: the correction landed');

-- ---------------------------------------------------------------------
-- B · service_role
-- ---------------------------------------------------------------------
set local role service_role;
select throws_like(format($$ update compliance_docs set right_to_work_until = null where id = %L $$, :'d_share'),
  '%rtw_date_locked%', 'B: service_role without the setting is refused');
select set_config('thc.allow_rtw_date_clear', 'on', true);
select lives_ok(format($$ update compliance_docs set expiry_date = null where id = %L $$, :'d_stat'),
  'B: service_role with the setting may blank it');
select set_config('thc.allow_rtw_date_clear', 'off', true);
reset role;
select is((select expiry_date from compliance_docs where id = :'d_stat'), null::date,
  'B: the service-role blank landed');

-- ---------------------------------------------------------------------
-- C · owner
-- ---------------------------------------------------------------------
select throws_like(format($$ update compliance_docs set right_to_work_until = null where id = %L $$, :'d_share'),
  '%rtw_date_locked%', 'C: the owner without the setting is refused');
set local thc.allow_rtw_date_clear = 'on';
select lives_ok(format($$ update compliance_docs set right_to_work_until = null where id = %L $$, :'d_share'),
  'C: the owner with the setting may blank it');
set local thc.allow_rtw_date_clear = 'off';
select is((select right_to_work_until from staff where id = :'w_visa'), :'today'::date + 450,
  'C: the worker''s date follows the remaining evidence (the visa)');
select throws_like(format($$ update compliance_docs set expiry_date = null where id = %L $$, :'d_visa'),
  '%rtw_date_locked%', 'C: the setting switched back off closes the escape again');

-- ---------------------------------------------------------------------
-- D · client roles cannot use the escape
-- ---------------------------------------------------------------------
-- Let anon and a non-admin authenticated user reach the row, so that the
-- answer comes from the trigger and not from RLS or a missing grant.
grant update on compliance_docs to anon, authenticated;
create policy t540_anon_upd on compliance_docs for update to anon using (true) with check (true);
create policy t540_anon_sel on compliance_docs for select to anon using (true);
create policy t540_auth_upd on compliance_docs for update to authenticated using (true) with check (true);
create policy t540_auth_sel on compliance_docs for select to authenticated using (true);

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select set_config('thc.allow_rtw_date_clear', 'on', true);
select throws_like(format($$ update compliance_docs set expiry_date = null where id = %L $$, :'d_visa'),
  '%rtw_date_locked%', 'D: anon setting the GUC is refused');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('thc.allow_rtw_date_clear', 'on', true);
select throws_like(format($$ update compliance_docs set expiry_date = null where id = %L $$, :'d_visa'),
  '%rtw_date_locked%', 'D: a staff (authenticated) session setting the GUC is refused');
reset role;

-- Laundering through a SECURITY DEFINER function owned by the migration
-- role: current_user inside is the owner, but the role GUC PostgREST set
-- is still authenticated.
create function public.t540_blank(p uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('thc.allow_rtw_date_clear', 'on', true);
  update compliance_docs set expiry_date = null where id = p;
end $$;
grant execute on function public.t540_blank(uuid) to anon, authenticated;

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_like(format($$ select t540_blank(%L) $$, :'d_visa'),
  '%rtw_date_locked%', 'D: authenticated cannot bypass through a SECURITY DEFINER function');
reset role;
set local role anon;
select throws_like(format($$ select t540_blank(%L) $$, :'d_visa'),
  '%rtw_date_locked%', 'D: anon cannot bypass through a SECURITY DEFINER function');
reset role;
select set_config('thc.allow_rtw_date_clear', 'off', true);
select is((select expiry_date from compliance_docs where id = :'d_visa'), :'today'::date + 450,
  'D: after every attempt the visa still carries its date');

-- ---------------------------------------------------------------------
-- E · settled status stays legitimately dateless
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(format($$ update compliance_docs set right_to_work_until = null, rtw_no_time_limit = true where id = %L $$, :'d_eu'),
  'E: a settled share code with no time limit is untouched by the guard');
select throws_like(format($$ update compliance_docs set rtw_no_time_limit = false where id = %L $$, :'d_eu'),
  '%rtw_date_locked%', 'E: switching no-time-limit off without a date is a blank and is refused');
select throws_like(format($$ update compliance_docs set right_to_work_until = null, rtw_no_time_limit = true where id = %L $$, :'d_share'),
  '%no_time_limit_not_allowed%', 'E: claiming no time limit off the EU settled branch is refused');

-- ---------------------------------------------------------------------
-- F · legacy dateless verified row
-- ---------------------------------------------------------------------
select lives_ok(format($$ update compliance_docs set expiry_date = null where id = %L $$, :'d_old'),
  'F: a verified row that was already dateless is not refused for staying so');
reset role;

select * from finish();
rollback;
