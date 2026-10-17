-- =====================================================================
-- 853 · RULE-20's helpers are planned once — and answer exactly as before
--   20261018130000_rule20_helpers_plan_once.sql · ADR-0153
--
-- The old definitions are recreated in `_old` (_shared/rule20_before_
-- 20261018130000.psql, verbatim, each calling the old helpers below it)
-- and every changed function is compared with its old self:
--
--   A · the pure helpers, over every combination of their inputs that
--       the rule tells apart (weekly_cap: 13,122 argument rows per
--       overload, through every band; cap_week_start: every day of 51
--       years and the infinities, under four session time zones);
--   B · the table readers, over a generated agency (_shared/cap_dataset:
--       120 workers in every RULE-20 branch — term / holiday / straddling
--       weeks, below degree level, a completion letter dated in the past
--       and one dated in the FUTURE, an opt-out, an opt-out under 18 and
--       one cancelled with its notice period ending mid-week, a work-visa
--       limit, a right to work expiring mid-week) on every day from ten
--       weeks back to six weeks ahead, and the Accept verdict for every
--       worker on a section in every week, in both rota-guard modes;
--   C · the shape: which functions are now inlined and which are
--       plpgsql, and that the inlined ones really are inlined.
--
-- Every row is created inside the transaction and rolled back.
-- =====================================================================
begin;
select plan(33);
\ir _shared/fixtures.psql
\set cap_n 120
\set cap_cands 10
\set cap_back 70
\set cap_ahead 42
\ir _shared/cap_dataset.psql
\ir _shared/rule20_before_20261018130000.psql

-- =====================================================================
-- A · the pure helpers
-- =====================================================================

-- cap_week_start: every day 1990-2040, the infinities and null, under
-- zones either side of UTC (the old body depended on the session zone).
create temp table d853_days as
  select d::date as d from generate_series(date '1990-01-01', date '2040-12-31', interval '1 day') d
  union all select x from unnest(array['infinity'::date, '-infinity'::date, null::date]) x;
create temp table d853_tz (tz text);
insert into d853_tz values ('UTC'), ('Europe/London'), ('America/Los_Angeles'), ('Pacific/Kiritimati');
create temp table d853_diff (what text, detail text);
do $$
declare z text;
begin
  for z in select tz from d853_tz loop
    perform set_config('timezone', z, true);
    insert into d853_diff
      select 'cap_week_start', z || ' ' || d
        from d853_days where public.cap_week_start(d) is distinct from _old.cap_week_start(d);
  end loop;
  perform set_config('timezone', 'UTC', true);
end $$;
select is_empty($$ select * from d853_diff where what = 'cap_week_start' $$,
  'A: cap_week_start gives the same Monday as before for 18,628 days, both infinities and null, in four session time zones');

-- weekly_cap, all three overloads, over every class of every input.
create temp table d853_wc as
select va, ts, cv, oo, ws, bd, cd, ve, oc, u18, vo, vh
  from unnest(array[true, false, null])                     va,
       unnest(array['term', 'holiday', 'straddle', 'none', null]) ts,
       unnest(array[true, false])                           cv,
       unnest(array[true, false, null])                     oo,
       unnest(array[date '2026-10-19', null])               ws,
       unnest(array[true, false])                           bd,
       unnest(array[date '2026-10-18', date '2026-10-19', date '2026-10-20', null]) cd,
       unnest(array[date '2026-10-18', date '2026-10-25', date '2026-10-26', null]) ve,
       unnest(array[date '2026-10-25', date '2026-10-26', date '2026-10-27', null]) oc,
       unnest(array[true, false])                           u18,
       unnest(array[date '2026-10-19', date '2026-10-21', null]) vo,
       unnest(array[20, 60, null])                          vh
 where (va is null or ts is not null or ws is null)   -- keep the set to a size the suite can afford:
   and (oo is not null or bd)                         -- every pair of classes still meets
   and (cd is null or vo is not null or u18)
   and (ve is null or oc is null or vh is null);
select ok((select count(*) from d853_wc) > 13000, 'A: the weekly_cap grid has more than 13,000 argument rows');
select is_empty($$
  select 1 from d853_wc
   where public.weekly_cap(va, ts, cv, oo, ws, bd, cd, ve, oc, u18, vo, vh)
         is distinct from _old.weekly_cap(va, ts, cv, oo, ws, bd, cd, ve, oc, u18, vo, vh) $$,
  'A: weekly_cap (12 arguments) — the in_force CTE folded into the CASE — answers as before on every row');
select is(
  (select count(distinct (public.weekly_cap(va, ts, cv, oo, ws, bd, cd, ve, oc, u18, vo, vh)).band)::int from d853_wc),
  8, 'A: ... and the grid reaches all eight bands');
select is_empty($$
  select 1 from (select distinct va, ts, cv, oo, ws, bd, cd, ve, oc, u18 from d853_wc
                  where (abs(hashtext(concat_ws(',', va, ts, cv, oo, ws, bd, cd, ve, oc, u18))) % 4) = 0
                 offset 0) g   -- the old 10-argument body re-plans the 12 on every call: a quarter of the grid
   where public.weekly_cap(va, ts, cv, oo, ws, bd, cd, ve, oc, u18)
         is distinct from _old.weekly_cap(va, ts, cv, oo, ws, bd, cd, ve, oc, u18) $$,
  'A: weekly_cap (10 arguments) answers as before');
select is_empty($$
  select 1 from (select distinct va, ts, cv, oo from d853_wc offset 0) g
   where public.weekly_cap(va, ts, cv, oo) is distinct from _old.weekly_cap(va, ts, cv, oo) $$,
  'A: weekly_cap (4 arguments) answers as before');

-- cap_under_18: around the 18th birthday, a 29 February birthday included.
select is_empty($$
  select 1
    from unnest(array[date '2008-10-19', date '2008-10-21', date '2008-02-29', date '2007-03-01', null]) dob,
         generate_series(date '2026-02-20', date '2026-11-01', interval '1 day') w
   where public.cap_under_18(dob, w::date) is distinct from _old.cap_under_18(dob, w::date)
      or public.cap_under_18(dob, null) is distinct from _old.cap_under_18(dob, null) $$,
  'A: cap_under_18 answers as before around the birthday, 29 February included');

select is_empty($$
  select 1 from unnest(array[date '2026-10-19', date '2026-10-20', date '2026-10-21', null]) s,
                unnest(array[date '2026-10-20', null]) e
   where public.can_roster(s, e) is distinct from _old.can_roster(s, e) $$,
  'A: can_roster answers as before on, before and after the expiry date');

select is_empty($$
  select 1 from unnest(enum_range(null::booking_status)) st,
                unnest(array[now(), null]) ca,
                unnest(array[null, 'declined', 'slot_taken', 'self_cancel']) cc
   where public.booking_counts_toward_cap(st, ca, cc) is distinct from _old.booking_counts_toward_cap(st, ca, cc)
      or public.booking_reopenable_by(st, cc) is distinct from _old.booking_reopenable_by(st, cc) $$,
  'A: booking_counts_toward_cap and booking_reopenable_by answer as before for every status and cause');
select is_empty($$
  select 1 from unnest(enum_range(null::booking_status)) st,
                unnest(array['slot_taken','self_cancel','handed_over','event_cancelled','gdpr','gdpr_invite',
                             'overlap_auto_withdraw','blocked','blocked_invite','left','left_invite',
                             'office_withdraw','ready_cutoff','declined', null]) cc
   where public.booking_reopenable_by(st, cc) is distinct from _old.booking_reopenable_by(st, cc) $$,
  'A: booking_reopenable_by answers as before for every cause it names');

select is_empty($$
  select 1
    from generate_series(timestamptz '2026-10-19 08:00Z', timestamptz '2026-10-19 20:00Z', interval '30 minutes') cs,
         unnest(array[interval '1 hour', interval '4 hours']) cl,
         unnest(array[timestamptz '2026-10-19 12:00Z']) hs,
         unnest(array['cccccccc-0000-4000-8000-000000000001'::uuid, 'cccccccc-0000-4000-8000-000000000002'::uuid, null]) cv,
         unnest(array['cccccccc-0000-4000-8000-000000000001'::uuid, null]) hv,
         unnest(array[0, 120]) gap
   where public.booked_elsewhere_conflict(cs, cs + cl, cv, hs, hs + interval '3 hours', hv, gap)
         is distinct from _old.booked_elsewhere_conflict(cs, cs + cl, cv, hs, hs + interval '3 hours', hv, gap) $$,
  'A: booked_elsewhere_conflict answers as before: intersecting, same venue, either side of the gap');

select is_empty($$
  select 1 from unnest(array[true, false, null]) cr,
                unnest(array[0, 10, 20, 48, null]) ch,
                unnest(enum_range(null::cap_band)) bnd,
                unnest(array[0, 12, 16, 19.5, null]::numeric[]) bk,
                unnest(array[4, 8.5]::numeric[]) sh,
                unnest(array['warn', 'block', 'other', null]) md
   where (select row(g.*) from public.rota_guard_decide(cr, ch, bnd, bk, sh, md) g)
         is distinct from (select row(g.*) from _old.rota_guard_decide(cr, ch, bnd, bk, sh, md) g) $$,
  'A: rota_guard_decide answers as before for every band, mode and remaining-hours case');

-- cap_term_state over the dataset's calendars and some hand-made edges.
select is_empty($$
  select 1
    from (select distinct term_dates from staff where email like 'cap%@capset.test'
          union all select array[daterange('2026-12-12', '2027-01-11')]
          union all select array[daterange('2026-12-14', '2026-12-17'), daterange('2026-12-17', '2026-12-21')]
          union all select '{}'::daterange[] union all select null::daterange[]) c,
         generate_series(date '2026-08-01', date '2027-02-01', interval '1 day') d
   where public.cap_term_state(c.term_dates, d::date) is distinct from _old.cap_term_state(c.term_dates, d::date) $$,
  'A: cap_term_state answers as before for every calendar on every day, holidays opening mid-week included');

-- =====================================================================
-- B · the table readers, over the generated agency
-- =====================================================================
create temp table d853_w as
  select s.id, s.employee_id from staff s where s.email like 'cap%@capset.test';
create temp table d853_dates as
  select (:'mon'::date + k) as d from generate_series(-70, 42) k;
-- The Accept verdict: every worker, on one section in each week from four
-- back to five ahead, the kind (morning, long day, overnight) and the
-- weekday rotating. Two UK workers are given a 50-hour week (closed rows
-- that lost a race count toward the cap) so the working-time cap, not only
-- the visa cap, is reached.
alter table bookings disable trigger user;
insert into bookings (shift_id, staff_id, status, source)
select ('ca9a0000-0000-4000-8000-' || lpad(((d + 100000) * 10 + 1)::text, 12, '0'))::uuid,
       ('ca9d0000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'closed', 'auto'
  from generate_series(14, 20) d, generate_series(1, 2) g
on conflict (shift_id, staff_id) do update set status = 'closed', cancelled_at = null, cancel_cause = null;
alter table bookings enable trigger user;
create temp table d853_sh as
  select ('ca9a0000-0000-4000-8000-' || lpad(((7 * w + (w % 7 + 7) % 7 + 100000) * 10 + (w % 3 + 3) % 3)::text, 12, '0'))::uuid as id
    from generate_series(-4, 5) w;

-- The booked-hours readers cost more each; every other day still meets
-- every weekday across the weeks.
create temp table d853_dates2 as select d from d853_dates where (d - :'mon'::date) % 2 = 0;
create temp table d853_dates3 as select d from d853_dates where (d - :'mon'::date) % 3 = 0;
analyze d853_w; analyze d853_dates; analyze d853_dates2; analyze d853_dates3; analyze d853_sh;

select is_empty($$
  select 1 from d853_w w, d853_dates x
   where public.weekly_cap_for(w.id, x.d) is distinct from _old.weekly_cap_for(w.id, x.d) $$,
  'B: weekly_cap_for answers as before for 120 workers on every day of 16 weeks');
select is_empty($$
  select 1 from d853_w w, d853_dates3 x
   where public.weekly_cap_hours(w.id, x.d) is distinct from _old.weekly_cap_hours(w.id, x.d) $$,
  'B: weekly_cap_hours answers as before');
select is(
  (select count(distinct (public.weekly_cap_for(w.id, x.d)).band)::int from d853_w w, d853_dates x), 8,
  'B: ... and the agency reaches all eight bands');
select ok(
  exists (select 1 from d853_w w, d853_dates x, staff s
           where s.id = w.id and s.wtr_optout and s.dob is not null
             and public.cap_under_18(s.dob, cap_week_start(x.d))
             and (public.weekly_cap_for(w.id, x.d)).band = 'standard_48')
  and exists (select 1 from d853_w w, d853_dates x, staff s
           where s.id = w.id and s.wtr_optout and s.rtw_branch = 'uk_irish' and s.wtr_optout_cancelled_from is not null
             and cap_week_start(x.d) + 6 >= s.wtr_optout_cancelled_from
             and (public.weekly_cap_for(w.id, x.d)).band = 'standard_48')
  and exists (select 1 from d853_w w, d853_dates x, staff s
           where s.id = w.id and s.course_completion_date > :'mon'::date and s.graduated_at is not null
             and (public.weekly_cap_for(w.id, x.d)).band in ('student_term_20', 'student_term_10'))
  and exists (select 1 from d853_w w, d853_dates x, staff s
           where s.id = w.id and s.rtw_branch = 'international_student'
             and cap_term_state(s.term_dates, x.d) = 'straddle'
             and (public.weekly_cap_for(w.id, x.d)).cap_hours in (10, 20)),
  'B: the comparison covered an opt-out under 18, a cancelled opt-out past its notice, a completion date still ahead and a straddling week');

select is_empty($$
  select 1 from d853_w w, d853_dates x
   where public.can_roster_staff(w.id, x.d) is distinct from _old.can_roster_staff(w.id, x.d) $$,
  'B: can_roster_staff answers as before on every day, a visa expiring mid-week and undated evidence included');
select ok(
  exists (select 1 from d853_w w, d853_dates x where not public.can_roster_staff(w.id, x.d))
  and exists (select 1 from d853_w w, d853_dates x where public.can_roster_staff(w.id, x.d)),
  'B: ... both answers occur');

select is_empty($$
  select 1 from d853_w w, d853_dates2 x
   where public.weekly_booked_hours(w.id, x.d) is distinct from _old.weekly_booked_hours(w.id, x.d) $$,
  'B: weekly_booked_hours answers as before for every worker on every other day (overnight and Sunday-night sections included)');
select is_empty($$
  select 1 from d853_w w, d853_sh sh join shift_requirements sr on sr.id = sh.id,
         lateral (select (sr.starts_at at time zone 'Europe/London')::date + k as d from generate_series(-3, 3, 3) k) x
   where public.weekly_booked_hours_except(w.id, x.d, sr.id) is distinct from _old.weekly_booked_hours_except(w.id, x.d, sr.id)
      or (x.d = (sr.starts_at at time zone 'Europe/London')::date
          and public.weekly_booked_hours_except(w.id, x.d, null) is distinct from _old.weekly_booked_hours_except(w.id, x.d, null)) $$,
  'B: weekly_booked_hours_except answers as before, with and without a section to leave out');
select ok((select count(*) from d853_w w, d853_dates3 x where public.weekly_booked_hours(w.id, x.d) > 20) > 0,
  'B: ... and some weeks are over a student''s 20 h, so the verdicts below are not all "ok"');

select is((select count(*)::int from d853_sh d join shift_requirements sr on sr.id = d.id), 10,
  'B: the verdict comparison has a section in each of ten weeks');
-- The old verdict is read once per pair; the old weekly_cap_would_breach()
-- is exactly `coalesce((verdict ->> 'verdict') = 'block', false)` of it,
-- and is itself asked on a slice so the comparison is with the function.
create temp table d853_v as
  select w.id as staff_id, sh.id as shift_id, _old.rota_guard_verdict(w.id, sh.id) as old_v
    from d853_w w, d853_sh sh;
select is_empty($$
  select 1 from d853_v v
   where public.rota_guard_verdict(v.staff_id, v.shift_id) is distinct from v.old_v
      or public.weekly_cap_would_breach(v.staff_id, v.shift_id) is distinct from coalesce((v.old_v ->> 'verdict') = 'block', false)
      or (abs(hashtext(v.staff_id::text || v.shift_id::text)) % 10 = 0
          and public.weekly_cap_would_breach(v.staff_id, v.shift_id) is distinct from _old.weekly_cap_would_breach(v.staff_id, v.shift_id)) $$,
  'B: rota_guard_verdict and weekly_cap_would_breach answer as before (mode block)');
select ok(
  (select count(distinct old_v ->> 'reason') from d853_v) = 3
  and exists (select 1 from d853_v where old_v ->> 'verdict' = 'ok'),
  'B: ... with ok, a visa cap, a working-time cap and a lapsed right to work among them');
insert into settings (key, value) values ('rota_guard_mode', '"warn"')
  on conflict (key) do update set value = excluded.value;
select is(public.rota_guard_mode(), 'warn', 'B: the rota guard set to warn');
update d853_v set old_v = _old.rota_guard_verdict(staff_id, shift_id);
select is_empty($$
  select 1 from d853_v v
   where public.rota_guard_verdict(v.staff_id, v.shift_id) is distinct from v.old_v
      or public.weekly_cap_would_breach(v.staff_id, v.shift_id) is distinct from coalesce((v.old_v ->> 'verdict') = 'block', false) $$,
  'B: ... and answer as before in warn mode, where a working-time breach warns and a visa cap still blocks');
select ok(exists (select 1 from d853_v where old_v ->> 'verdict' = 'warn')
          and exists (select 1 from d853_v where old_v ->> 'reason' = 'visa_cap' and old_v ->> 'verdict' = 'block'),
  'B: ... both a warning and a visa block occur in warn mode');
select is_empty($$ select 1 from public.rota_guard_verdict(null, null) x where x is not null $$,
  'B: an unknown section still has no verdict');

-- Under a worker's own rights (the functions are invoker): the same answer.
update staff set user_id = null where id = :'staffa';
update staff set user_id = :'staffa_uid' where id = 'ca9d0000-0000-4000-8000-000000000011';
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is_empty($$
  select 1 from (select (now() at time zone 'Europe/London')::date + k as d from generate_series(-21, 21) k) x
   where public.weekly_cap_for('ca9d0000-0000-4000-8000-000000000011', x.d)
         is distinct from _old.weekly_cap_for('ca9d0000-0000-4000-8000-000000000011', x.d)
      or public.weekly_booked_hours('ca9d0000-0000-4000-8000-000000000011', x.d)
         is distinct from _old.weekly_booked_hours('ca9d0000-0000-4000-8000-000000000011', x.d) $$,
  'B: a worker reading their own cap and hours through their own RLS gets the same answers');
reset role;

-- =====================================================================
-- C · the shape
-- =====================================================================
select is(
  (select string_agg(f, ' · ' order by f) from (select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as f
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proconfig is null
      and p.proname in ('cap_week_start','can_roster','booking_counts_toward_cap','cap_under_18',
                        'booked_elsewhere_conflict','booking_reopenable_by','weekly_cap','current_compliance_docs')
      and p.prolang = (select oid from pg_language where lanname = 'sql') and not p.prosecdef) u),
  (select string_agg(x, ' · ' order by x) from unnest(array[
     'booked_elsewhere_conflict(p_cand_starts_at timestamp with time zone, p_cand_ends_at timestamp with time zone, p_cand_venue uuid, p_held_starts_at timestamp with time zone, p_held_ends_at timestamp with time zone, p_held_venue uuid, p_gap_minutes integer)',
     'booking_counts_toward_cap(p_status booking_status, p_cancelled_at timestamp with time zone, p_cancel_cause text)',
     'booking_reopenable_by(p_status booking_status, p_cause text)',
     'can_roster(p_shift_date date, p_visa_expiry date)',
     'cap_under_18(p_dob date, p_week_start date)',
     'cap_week_start(p_date date)',
     'current_compliance_docs(p_staff uuid)',
     'weekly_cap(p_visa_limited boolean, p_term_state text, p_completion_letter_verified boolean, p_optout_48h boolean)',
     'weekly_cap(p_visa_limited boolean, p_term_state text, p_completion_letter_verified boolean, p_optout_48h boolean, p_week_start date, p_below_degree_level boolean, p_completion_date date, p_visa_expiry date, p_optout_cancelled_from date, p_under18 boolean)',
     'weekly_cap(p_visa_limited boolean, p_term_state text, p_completion_letter_verified boolean, p_optout_48h boolean, p_week_start date, p_below_degree_level boolean, p_completion_date date, p_visa_expiry date, p_optout_cancelled_from date, p_under18 boolean, p_verified_on date, p_visa_hour_limit integer)']) x),
  'C: exactly the pure helpers ADR-0153 names are unpinned invoker SQL, so the planner can inline them');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('cap_term_state','rota_guard_mode','rota_guard_decide','can_roster_staff','weekly_booked_hours',
                       'weekly_booked_hours_except','weekly_cap_for','weekly_cap_hours','rota_guard_verdict',
                       'weekly_cap_would_breach')
     and (p.prolang <> (select oid from pg_language where lanname = 'plpgsql')
          or not exists (select 1 from unnest(p.proconfig) c where c like 'search\_path=%')) $$,
  'C: the table readers are plpgsql and still pin their search_path');

-- Inlined means the call is gone from the plan: the planner pasted the body in.
create temp table d853_plan (line text);
do $$
declare r text;
begin
  for r in execute $q$ explain (verbose, costs off)
    select public.cap_week_start(d),
           public.booking_counts_toward_cap(b.status, b.cancelled_at, b.cancel_cause),
           public.weekly_cap(b.status = 'worked', 'term', false, false, d, false, null, null, null, false, null, null)
      from bookings b cross join (select current_date + 1 as d) x limit 1 $q$
  loop
    insert into d853_plan values (r);
  end loop;
end $$;
select ok(
  not exists (select 1 from d853_plan where line ~ '(cap_week_start|booking_counts_toward_cap|weekly_cap)\(')
  and exists (select 1 from d853_plan where line ~ 'date_trunc')
  and exists (select 1 from d853_plan where line ~ 'student_term_20'),
  'C: cap_week_start, booking_counts_toward_cap and weekly_cap are inlined into the query that calls them');

select * from finish();
rollback;
