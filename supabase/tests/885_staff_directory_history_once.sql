-- =====================================================================
-- 885 · staff_directory_v reads the booking history once — and shows
--       exactly what it showed
--   20261020150000_staff_directory_history_once.sql · ADR-0166
--
-- The old directory (and the old cap_band_until() it read) are recreated
-- as public._old_* (_shared/office_views_before_20261020150000.psql), and
-- so are the three views that read the directory, pointed at the old one.
-- Over a generated agency (_shared/cap_dataset: every RULE-20 branch, ten
-- weeks of history and six ahead in every booking status; and
-- scripts/bench/office_views_dataset: no-shows open and resolved, No
-- check-outs, released shifts, do-not-returns, blocks with a reason):
--
--   * the office: staff_directory_v, student_visa_v, staff_profile_v and
--     clients_qualified_staff_v identical to the old ones, every row, every
--     column;
--   * a worker reading their own row, and a client: identical;
--   * the columns that restate a rule are that rule's answer for every
--     worker: reliability is staff_show_rate(), weekly_booked_hours is
--     weekly_booked_hours();
--   * cap_band_until() gives the old Sunday for 4,000 generated calendars
--     and the edge cases (null, empty, a null or empty range, unbounded and
--     infinite bounds, adjacent and overlapping ranges);
--   * the shape: columns, types, order and options unchanged; a reader of
--     four columns reads no history; the history columns read every
--     section ONCE however many workers there are, for the whole directory
--     and for one worker by id.
--
-- Every row is created inside the transaction and rolled back.
-- =====================================================================
begin;
select plan(23);
\ir _shared/fixtures.psql
\set cap_n 200
\set cap_cands 60
\set cap_back 70
\set cap_ahead 42
\ir _shared/cap_dataset.psql
\ir _shared/office_views_dataset.psql
\ir _shared/office_views_before_20261020150000.psql

-- How many times each plan node over shift_requirements ran, at most.
create function pg_temp.section_loops(p_sql text) returns int language plpgsql as $$
declare j jsonb;
begin
  execute 'explain (analyze, format json) ' || p_sql into j;
  return (select max((n ->> 'Actual Loops')::int)
            from jsonb_path_query(j, 'lax $.**') n
           where jsonb_typeof(n) = 'object' and n ->> 'Relation Name' = 'shift_requirements');
end $$;
grant execute on function pg_temp.section_loops(text) to authenticated;

-- ---- the shape -----------------------------------------------------------
select is(
  (select array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) order by a.attnum)
     from pg_attribute a where a.attrelid = 'public.staff_directory_v'::regclass and a.attnum > 0),
  (select array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) order by a.attnum)
     from pg_attribute a where a.attrelid = 'public._old_staff_directory_v'::regclass and a.attnum > 0),
  'staff_directory_v: the same columns, the same types, in the same order');
select is((select reloptions from pg_class where oid = 'public.staff_directory_v'::regclass),
  array['security_invoker=true'], 'staff_directory_v is still security_invoker');

-- ---- cap_band_until -------------------------------------------------------
create temp table d885_cal as
select g, array(select daterange(date '2026-01-01' + ((g * 37 + k * 101) % 900) - 200,
                                 date '2026-01-01' + ((g * 37 + k * 101) % 900) - 200 + 1 + (g * 13 + k * 7) % 60)
                  from generate_series(1, 1 + g % 4) k) as cal,
       date '2026-01-01' + ((g * 53) % 800) - 300 as d
  from generate_series(1, 4000) g;
insert into d885_cal values
  (-1, null, date '2026-12-01'), (-2, '{}', date '2026-12-01'), (-3, '{"[2026-12-14,2027-01-11)"}', null),
  (-4, array[null::daterange, daterange('2026-12-14', '2027-01-11')], date '2026-12-01'),
  (-5, array['empty'::daterange, daterange('2026-12-14', '2027-01-11')], date '2026-12-01'),
  (-6, array[daterange(null, '2026-12-20')], date '2026-12-01'),
  (-7, array[daterange('2026-12-10', null)], date '2026-11-01'),
  (-8, array[daterange('2026-12-10', 'infinity')], date '2026-11-01'),
  (-9, array[daterange('-infinity', '2026-12-10')], date '2026-11-01'),
  (-10, array[daterange('2026-12-14', '2026-12-17'), daterange('2026-12-17', '2026-12-21')], date '2026-12-01'),
  (-11, array[daterange('2026-12-12', '2026-12-30'), daterange('2026-12-20', '2027-01-11')], date '2026-12-01'),
  (-12, array[daterange('2026-12-19', '2027-01-11')], date '2026-12-19'),
  (-13, array[daterange('2028-01-01', '2028-02-01')], date '2026-12-01');
select is_empty($$
  select g from d885_cal
   where public.cap_band_until(cal, d) is distinct from public._old_cap_band_until(cal, d) $$,
  'cap_band_until() gives the old Sunday for 4,000 generated calendars and every edge case');
select ok((select count(*) filter (where public.cap_band_until(cal, d) is not null) > 1000
              and count(*) filter (where public.cap_band_until(cal, d) is null) > 100 from d885_cal),
  '... and the comparison met both a dated and an open-ended answer many times');

-- ---- the office ------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table d885_old as select * from public._old_staff_directory_v;
create temp table d885_new as select * from public.staff_directory_v;
select is((select count(*) from d885_new), (select count(*) from d885_old), 'the office sees as many staff as before');
select is_empty($$
  (select * from d885_old except all select * from d885_new)
  union all
  (select * from d885_new except all select * from d885_old) $$,
  'every row, every column, is the value it was: show-rate, last shift, released count, both weekly hours, the cap and its Sunday');
select ok(
  (select count(*) from d885_new where last_shift_at is not null) > 100
  and (select count(*) from d885_new where released_shift_count > 0) > 50
  and (select count(*) from d885_new where reliability < 100) > 20
  and (select count(*) from d885_new where reliability = 100) > 20
  and (select count(*) from d885_new where reliability is null) > 20
  and (select count(*) from d885_new where weekly_booked_hours > 0) > 50
  and (select count(*) from d885_new where weekly_worked_hours > 0) > 5
  and (select count(*) from d885_new where weekly_cap_until is not null) > 10
  and (select count(*) from d885_new where block_reason is not null) > 0
  and (select count(*) from d885_new where cardinality(do_not_return_clients) > 0) > 0,
  'the comparison met every column with a value and without one');
select is_empty($$
  (select * from public._old_student_visa_v except all select * from public.student_visa_v)
  union all (select * from public.student_visa_v except all select * from public._old_student_visa_v) $$,
  'student_visa_v, which reads the directory, is unchanged');
select is_empty($$
  (select * from public._old_staff_profile_v except all select * from public.staff_profile_v)
  union all (select * from public.staff_profile_v except all select * from public._old_staff_profile_v) $$,
  'staff_profile_v, which reads the directory, is unchanged');
select is_empty($$
  (select * from public._old_clients_qualified_staff_v except all select * from public.clients_qualified_staff_v)
  union all (select * from public.clients_qualified_staff_v except all select * from public._old_clients_qualified_staff_v) $$,
  'clients_qualified_staff_v, which reads the directory, is unchanged');
select is_empty($$
  select id from d885_new d
   where d.reliability is distinct from public.staff_show_rate(d.id)::numeric(5,2)
      or d.weekly_booked_hours is distinct from public.weekly_booked_hours(d.id, (now() at time zone 'Europe/London')::date) $$,
  'reliability is staff_show_rate() and weekly_booked_hours is weekly_booked_hours(), for every worker');
select is(
  (select row(d.*)::text from public.staff_profile_v d where d.id = (select id from staff where email = 'cap7@capset.test')),
  (select row(d.*)::text from public._old_staff_profile_v d where d.id = (select id from staff where email = 'cap7@capset.test')),
  'one worker read by id: the same row, to the character');

-- ---- the plan --------------------------------------------------------------------
select is(pg_temp.section_loops($$ select last_shift_at, reliability, weekly_booked_hours, weekly_worked_hours from public.staff_directory_v $$), 1,
  'the whole directory reads each section once, not once per worker');
select is(pg_temp.section_loops($$ select * from public.staff_profile_v where id = (select id from public.staff where email = 'cap7@capset.test') $$), 1,
  'and so does one worker read by id');
select is(pg_temp.section_loops($$ select * from public.student_visa_v $$), 1,
  'and student_visa_v');
reset role;
create temp table d885_plan (line text);
do $$
declare r text;
begin
  for r in execute 'explain (costs off) select id, display_name, employee_id, role_names from public.staff_directory_v where status = ''compliant''' loop
    insert into d885_plan values (r);
  end loop;
end $$;
select is_empty($$ select 1 from d885_plan where line ~ '(bookings|violations|shift_requirements)' $$,
  'a reader of four columns (the pickers, the feedback typeahead) reads no history at all');

-- ---- a worker, and a client ----------------------------------------------------
update staff set user_id = null where id = :'staffa';
update staff set user_id = :'staffa_uid' where email = 'cap7@capset.test';
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from public.staff_directory_v), 1, 'a worker sees one row, their own');
select is_empty($$
  (select * from public._old_staff_directory_v except all select * from public.staff_directory_v)
  union all (select * from public.staff_directory_v except all select * from public._old_staff_directory_v) $$,
  'and it is the row they saw before, every column');
select ok((select released_shift_count > 0 and last_shift_at is null and reliability is not null from public.staff_directory_v),
  '... a row with history: their own released count and show-rate, and no last shift (the sections are not theirs to read), as before');
select is_empty($$
  (select * from public._old_staff_profile_v except all select * from public.staff_profile_v)
  union all (select * from public.staff_profile_v except all select * from public._old_staff_profile_v) $$,
  'their staff_profile_v row is the one they saw before');
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.staff_directory_v), (select count(*)::int from public._old_staff_directory_v),
  'a client sees as many directory rows as before');
select is_empty($$
  (select * from public._old_staff_directory_v except all select * from public.staff_directory_v)
  union all (select * from public.staff_directory_v except all select * from public._old_staff_directory_v) $$,
  'and the same rows, every column');
select is_empty($$
  (select * from public._old_clients_qualified_staff_v except all select * from public.clients_qualified_staff_v)
  union all (select * from public.clients_qualified_staff_v except all select * from public._old_clients_qualified_staff_v) $$,
  'and the same qualified staff on their client card');
reset role;

select * from finish();
rollback;
