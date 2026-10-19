-- =====================================================================
-- 886 · onboarding_candidates_v asks about the login once per statement,
--       and the compliance_blockers chain is planned once per session —
--       and both show exactly what they showed
--   20261020150100_onboarding_candidates_activation_once.sql
--   20261020150200_compliance_blockers_plan_once.sql · ADR-0160
--
-- The old view and the old SQL bodies of compliance_blockers(),
-- onboarding_quiz_blockers(), current_verified_docs(), term_letter_applies(),
-- doc_expires_on() and term_letter_last_day() are recreated as public._old_*
-- (_shared/office_views_before_20261020150000.psql, each old function
-- calling the old ones below it), and compared over the onboarding
-- pipeline and the workers of _shared/cap_dataset + office_views_dataset,
-- with expired, undated and term-dated documents, graduates and every
-- declaration state added here:
--
--   * onboarding_candidates_v `select *` (quiz_blockers, activated,
--     activated_at included) identical as the office, a candidate and a
--     client;
--   * every function of the chain the old answer for every person on
--     four dates; doc_expires_on() and term_letter_last_day() over grids;
--   * staff_account_activation_v: the functions' answers for every person
--     as the office and as service_role, only their own row for a worker,
--     nothing for a client, no privilege for anon; owner rights,
--     security_barrier, its role reads InitPlans;
--   * the six functions are plpgsql, still pinned, still not definers.
--
-- Every row is created inside the transaction and rolled back.
-- =====================================================================
begin;
select plan(25);
\ir _shared/fixtures.psql
\set cap_n 120
\set cap_cands 150
\set cap_back 14
\set cap_ahead 14
\ir _shared/cap_dataset.psql
\ir _shared/office_views_dataset.psql
\ir _shared/office_views_before_20261020150000.psql

-- What the generated sets lack: documents that have expired, term letters
-- with and without readable dates, a graduate, an open completion letter.
alter table compliance_docs disable trigger user;
alter table staff disable trigger user;
update compliance_docs d set expiry_date = (now() at time zone 'Europe/London')::date - (abs(hashtext(d.id::text)) % 30)
 where d.review_status = 'verified' and abs(hashtext(d.id::text)) % 4 = 0;
insert into compliance_docs (staff_id, doc_type, file_path, review_status, uploaded_at, reviewed_at, term_dates)
select s.id, 'university_term_dates_letter', 'documents/d886/' || s.id || '.pdf',
       (array['verified','verified','pending','rejected'])[1 + abs(hashtext(s.id::text)) % 4]::review_status,
       now() - make_interval(days => 40 + abs(hashtext(s.id::text)) % 300), now() - interval '10 days',
       case abs(hashtext(s.id::text)) % 3
         when 0 then null
         when 1 then array[daterange((now() at time zone 'Europe/London')::date - 200, (now() at time zone 'Europe/London')::date - 20)]
         else array[daterange((now() at time zone 'Europe/London')::date - 100, (now() at time zone 'Europe/London')::date + 60)] end
  from staff s where s.rtw_branch = 'international_student' and s.email like '%@capset.test';
insert into compliance_docs (staff_id, doc_type, file_path, review_status, uploaded_at, completion_date_claimed)
select s.id, 'university_completion_letter', 'documents/d886/' || s.id || '-c.pdf',
       (array['pending','rejected','verified'])[1 + abs(hashtext(s.id::text || 'c')) % 3]::review_status,
       now() - interval '5 days', (now() at time zone 'Europe/London')::date - 10
  from staff s where s.rtw_branch = 'international_student' and s.email like '%@capset.test'
   and abs(hashtext(s.id::text)) % 5 = 0;
update staff s set graduated_at = (now() at time zone 'Europe/London')::date - 15,
                   course_completion_date = (now() at time zone 'Europe/London')::date - (abs(hashtext(s.id::text)) % 3) * 20 + 10
 where s.email like 'cand%@capset.test' and s.rtw_branch = 'international_student' and abs(hashtext(s.id::text)) % 2 = 0;
alter table compliance_docs enable trigger user;
alter table staff enable trigger user;
analyze compliance_docs; analyze staff;

-- ---- the shape -----------------------------------------------------------
select is(
  (select array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) order by a.attnum)
     from pg_attribute a where a.attrelid = 'public.onboarding_candidates_v'::regclass and a.attnum > 0),
  (select array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) order by a.attnum)
     from pg_attribute a where a.attrelid = 'public._old_onboarding_candidates_v'::regclass and a.attnum > 0),
  'onboarding_candidates_v: the same columns, the same types, in the same order');
select is((select reloptions from pg_class where oid = 'public.onboarding_candidates_v'::regclass),
  array['security_invoker=true'], 'onboarding_candidates_v is still security_invoker');
select is((select reloptions from pg_class where oid = 'public.staff_account_activation_v'::regclass),
  array['security_barrier=true'], 'staff_account_activation_v runs with its owner''s rights, security_barrier');
select ok(has_table_privilege('authenticated', 'public.staff_account_activation_v', 'select')
          and not has_table_privilege('authenticated', 'public.staff_account_activation_v', 'insert')
          and not has_table_privilege('anon', 'public.staff_account_activation_v', 'select'),
  'authenticated may only SELECT it; anon holds nothing');
select is(
  (select array_agg(p.oid::regprocedure::text || ' ' || l.lanname || ' ' || (p.proconfig is not null) || ' ' || p.prosecdef
                    order by p.oid::regprocedure::text)
     from pg_proc p join pg_language l on l.oid = p.prolang
    where p.oid in ('public.compliance_blockers(uuid,date)'::regprocedure, 'public.onboarding_quiz_blockers(uuid)'::regprocedure,
                    'public.current_verified_docs(uuid)'::regprocedure, 'public.term_letter_applies(uuid,date)'::regprocedure,
                    'public.doc_expires_on(doc_type,date,date,date,timestamp with time zone,daterange[])'::regprocedure,
                    'public.term_letter_last_day(daterange[])'::regprocedure)),
  array['compliance_blockers(uuid,date) plpgsql true false',
        'current_verified_docs(uuid) plpgsql true false',
        'doc_expires_on(doc_type,date,date,date,timestamp with time zone,daterange[]) plpgsql true false',
        'onboarding_quiz_blockers(uuid) plpgsql true false',
        'term_letter_applies(uuid,date) plpgsql true false',
        'term_letter_last_day(daterange[]) plpgsql true false'],
  'the six are plpgsql, keep their pinned search_path, and none became a definer');

-- ---- the chain, function by function ------------------------------------------
create temp table d886_days as
select (now() at time zone 'Europe/London')::date + k as d from unnest(array[-60, -1, 0, 45]) k;
select is_empty($$
  (select s.id, x.d, b.reason from staff s cross join d886_days x cross join lateral public._old_compliance_blockers(s.id, x.d) b
   except all
   select s.id, x.d, b.reason from staff s cross join d886_days x cross join lateral public.compliance_blockers(s.id, x.d) b)
  union all
  (select s.id, x.d, b.reason from staff s cross join d886_days x cross join lateral public.compliance_blockers(s.id, x.d) b
   except all
   select s.id, x.d, b.reason from staff s cross join d886_days x cross join lateral public._old_compliance_blockers(s.id, x.d) b) $$,
  'compliance_blockers(): the same reasons for every person on four dates');
select ok((select count(distinct split_part(b.reason, ':', 1)) = 3
             from staff s cross join d886_days x cross join lateral public.compliance_blockers(s.id, x.d) b),
  '... and the comparison met an expired document, an unverified one and an unreviewed conviction');
select is_empty($$
  select s.id from staff s
   where public.onboarding_quiz_blockers(s.id) is distinct from public._old_onboarding_quiz_blockers(s.id) $$,
  'onboarding_quiz_blockers(): the same blockers, in the same order, for every person');
select is_empty($$
  (select s.id, d.* from staff s cross join lateral public._old_current_verified_docs(s.id) d
   except all select s.id, d.* from staff s cross join lateral public.current_verified_docs(s.id) d)
  union all
  (select s.id, d.* from staff s cross join lateral public.current_verified_docs(s.id) d
   except all select s.id, d.* from staff s cross join lateral public._old_current_verified_docs(s.id) d) $$,
  'current_verified_docs(): the same current verified document and expiry per type');
select is_empty($$
  select s.id, x.d from staff s cross join d886_days x
   where public.term_letter_applies(s.id, x.d) is distinct from public._old_term_letter_applies(s.id, x.d) $$,
  'term_letter_applies(): the same answer for every person on four dates');
select is_empty($$
  select t, e, u, r.cal from unnest(enum_range(null::doc_type)) t,
         unnest(array[null, date '2026-03-01']) e, unnest(array[null, date '2026-05-01']) u,
         unnest(array[null, timestamptz '2026-11-15 10:00+00', timestamptz '2026-06-15 23:30+00']) up,
         (values (null::daterange[]), ('{}'), (array['[2026-01-10,2026-06-20)'::daterange]), (array['empty'::daterange]),
                 (array['[2026-01-10,)'::daterange]), (array['[2026-01-10,2026-03-01)'::daterange, '[2026-04-01,2026-07-15)'::daterange])) r(cal)
   where public.doc_expires_on(t, e, u, date '2026-08-01', up, r.cal) is distinct from public._old_doc_expires_on(t, e, u, date '2026-08-01', up, r.cal)
      or public.doc_expires_on(t, e, null, null, up, r.cal) is distinct from public._old_doc_expires_on(t, e, null, null, up, r.cal) $$,
  'doc_expires_on(): the same date over every document type, expiry, right-to-work date, upload time and term calendar');
select is_empty($$
  select cal from (select array(select daterange(date '2026-01-01' + (g * k) % 400, date '2026-01-01' + (g * k) % 400 + 1 + g % 90)
                                  from generate_series(1, 1 + g % 3) k) cal from generate_series(1, 500) g
                   union all values (null::daterange[]), ('{}'), (array['empty'::daterange]), (array['[2026-01-01,)'::daterange])) c
   where public.term_letter_last_day(cal) is distinct from public._old_term_letter_last_day(cal) $$,
  'term_letter_last_day(): the same last day for 500 calendars and the edge cases');

-- ---- the office ------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table d886_old as select * from public._old_onboarding_candidates_v;
create temp table d886_new as select * from public.onboarding_candidates_v;
select is((select count(*) from d886_new), (select count(*) from d886_old), 'the office sees as many people as before');
select is_empty($$
  (select * from d886_old except all select * from d886_new)
  union all
  (select * from d886_new except all select * from d886_old) $$,
  'and every row, every column — activated, activated_at and quiz_blockers included — is the value it was');
select ok(
  (select count(*) from d886_new where activated) > 0
  and (select count(*) from d886_new where not activated and id in (select id from staff where user_id is not null)) > 0
  and (select count(*) from d886_new where activated_at is not null) > 0
  and (select count(*) from d886_new where cardinality(quiz_blockers) > 0) > 50
  and (select count(*) from d886_new where cardinality(quiz_blockers) = 0) > 0,
  'the comparison met activated and unactivated logins, and people with and without quiz blockers');
select is_empty($$
  select s.id from staff s left join public.staff_account_activation_v a on a.staff_id = s.id
   where coalesce(a.activated, false) is distinct from coalesce(public.staff_account_activated(s.id), false)
      or a.activated_at is distinct from public.staff_account_activated_at(s.id) $$,
  'staff_account_activation_v is staff_account_activated() / _at() for every person, as the office');
reset role;
create temp table d886_plan (line text);
do $$
declare r text;
begin
  for r in execute 'explain (costs off) select * from public.staff_account_activation_v' loop
    insert into d886_plan values (r);
  end loop;
end $$;
select ok(exists (select 1 from d886_plan where line ~ 'InitPlan'),
  'its role reads are InitPlans, evaluated once per statement');
select is_empty($$ select 1 from d886_plan where line ~ 'Filter: .*current_app_role\(\)' $$,
  '... and no row filter calls current_app_role() itself');

-- ---- service_role ----------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
select is_empty($$
  select s.id from staff s left join public.staff_account_activation_v a on a.staff_id = s.id
   where coalesce(a.activated, false) is distinct from coalesce(public.staff_account_activated(s.id), false)
      or a.activated_at is distinct from public.staff_account_activated_at(s.id) $$,
  'as service_role too');
reset role;

-- ---- a candidate, and a client ----------------------------------------------
-- A candidate whose login is activated reads their own row.
update staff set user_id = null where id = :'staffb';
update auth.users set encrypted_password = 'd886', email_confirmed_at = now() - interval '2 days' where id = :'staffb_uid';
update staff set user_id = :'staffb_uid'
 where id = (select id from staff where email like 'cand%@capset.test' and user_id is null order by id limit 1);
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is_empty($$
  (select * from public._old_onboarding_candidates_v except all select * from public.onboarding_candidates_v)
  union all
  (select * from public.onboarding_candidates_v except all select * from public._old_onboarding_candidates_v) $$,
  'a candidate reading their own row sees what they saw before');
select is((select count(*)::int from public.onboarding_candidates_v where activated and activated_at is not null), 1,
  '... their own login, activated, with its date');
select is((select count(*)::int from public.staff_account_activation_v), 1,
  'staff_account_activation_v shows a worker their own login and no one else''s');
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select is_empty($$
  (select * from public._old_onboarding_candidates_v except all select * from public.onboarding_candidates_v)
  union all
  (select * from public.onboarding_candidates_v except all select * from public._old_onboarding_candidates_v) $$,
  'a client sees what they saw before');
select is((select count(*)::int from public.staff_account_activation_v), 0,
  'and staff_account_activation_v shows a client nothing');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select count(*) from public.staff_account_activation_v $$, '42501', null,
  'anon cannot reach staff_account_activation_v at all');
reset role;

select * from finish();
rollback;
