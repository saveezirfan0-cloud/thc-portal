-- =====================================================================
-- Bench · Radar (staff_open_shifts) and the auto-assign pool at go-live scale
--
-- Seeds, inside ONE transaction that is rolled back at the end:
--   * 1,000 workers (980 compliant, 20 blocked), 1–3 roles each, a fifth on
--     a student visa in term (20 h cap), mixed gender / languages / homes;
--   * client qualifications for about a third of each worker's (client, role)
--     pairs, a few do-not-return;
--   * 200 open events over the next four weeks, three role sections each
--     (600 sections), some "Female staff only", some needing Spanish, a few
--     multi-day series with the same-staff switch on;
--   * a booking history: 800 past sections with ~30 worked shifts per worker
--     (~30k bookings), no-show violations on ~3 %;
--   * live bookings on the open sections: confirmed about half way, a few
--     invitations and Radar applications, a few self-cancels, some sections
--     full;
--   * 60 open pool shift offers on confirmed bookings, every fourth with
--     every qualified worker already told (wave 1 exhausted by notices);
--   * ADR-0184: 2,000 shifts already FINISHED this Mon–Sun week, after the
--     overrun rule's 21.10.2026 cutoff (40 sections today × 50 workers),
--     a third signed out 30–120 minutes late, some with an unpaid break —
--     what every weekly-hours sum (RULE-20) now reads check_logs for.
-- and reports, from a temp table at the end:
--   * Radar as three staff users (many roles + qualified everywhere; two
--     roles, few qualifications; a new starter), whole list and — where the
--     database has it — the single-section read /radar/[id] uses;
--   * open shift offers (staff_open_offers) as the same three staff users;
--   * the pool per section: the board's call (auto_assign_candidates as an
--     admin, the board's filter; also on a multi-day job's section), the
--     round's call (as service_role, ordinary and escalation), and one
--     worker's gate (auto_assign_worker_gate, as the Accept/apply paths use);
--   * the wave-1 checks: offer_wave1_exhausted per offer (take_offered_shift
--     asks it once) and radar_wave1_exhausted per section;
--   * where the database has it (ADR-0170), one worker against every open
--     section in one call (auto_assign_worker_pool);
--   * the office reads that sum the week: staff_directory_v (the full
--     list), late_check_outs() and today's checkin_monitor_v, as an admin.
--
-- usage (local cluster, after migrations + seed; never against production):
--   psql -X -v ON_ERROR_STOP=1 -f scripts/bench/radar_and_pool_at_scale.sql
-- Triggers are off while seeding (session_replication_role = replica) so the
-- history can be written in bulk; they are back on before anything is timed.
-- =====================================================================
\set ON_ERROR_STOP 1
\pset pager off
begin;
set local session_replication_role = replica;
select setseed(0.4242);

create temp table bench_clock (seq serial, what text, n int, ms numeric);
grant all on bench_clock to public;
grant all on sequence bench_clock_seq_seq to public;

-- ---- reference rows -------------------------------------------------
insert into clients (id, name, contact_name, phone, staff_contact_point, contact_emails)
select md5('bench-client-' || g)::uuid, 'Bench Client ' || g, 'Contact ' || g, '+4477009' || lpad(g::text, 5, '0'),
       'Front desk', array['bench' || g || '@bench.test']
  from generate_series(1, 10) g;

insert into roles (id, name, pay_rate)
select md5('bench-role-' || g)::uuid, 'Bench Role ' || g, 12.71 + g
  from generate_series(1, 6) g;

insert into venues (id, name, address, location, venue_type, geofence_radius_m)
select md5('bench-venue-' || g)::uuid, 'Bench Venue ' || g, g || ' Bench Street, London',
       st_setsrid(st_makepoint(-0.30 + (g % 10) * 0.04, 51.42 + (g / 10) * 0.06), 4326)::geography, 'hotel', 150
  from generate_series(1, 30) g;

-- ---- workers ----------------------------------------------------------
insert into auth.users (id, email)
select md5('bench-user-' || g)::uuid, 'bench-user-' || g || '@bench.test' from generate_series(1, 3) g;
insert into auth.users (id, email) values (md5('bench-admin')::uuid, 'bench-admin@bench.test');
insert into profiles (id, role, full_name)
select md5('bench-user-' || g)::uuid, 'staff', 'Bench Worker ' || g from generate_series(1, 3) g;
insert into profiles (id, role, full_name, office_role) values (md5('bench-admin')::uuid, 'admin', 'Bench Admin', 'owner');

insert into staff (id, user_id, employee_id, first_name, last_name, email, phone, dob, status, rtw_branch,
                   term_dates, home_location, gender, languages, rating)
select md5('bench-staff-' || g)::uuid,
       case when g <= 3 then md5('bench-user-' || g)::uuid end,
       700000 + g, 'Bench', 'Worker ' || g, 'bench-staff-' || g || '@bench.test', '+447800' || lpad(g::text, 6, '0'),
       date '1996-01-01' + (g % 3000),
       case when g % 50 = 0 then 'blocked' else 'compliant' end::staff_status,
       case when g % 5 = 0 then 'international_student' else 'uk_irish' end::rtw_branch,
       case when g % 5 = 0 then array[daterange(current_date - 60, current_date + 60)] else '{}'::daterange[] end,
       st_setsrid(st_makepoint(-0.40 + random() * 0.55, 51.38 + random() * 0.30), 4326)::geography,
       case when g % 10 = 0 then null when g % 2 = 0 then 'F' else 'M' end,
       case when g % 7 = 0 then null when g % 3 = 0 then array['English', 'Spanish'] else array['English'] end,
       round((3.0 + random() * 2.0)::numeric, 1)
  from generate_series(1, 1000) g;

-- 1–3 roles each; worker 1 holds all six, worker 3 one.
insert into staff_roles (staff_id, role_id)
select distinct md5('bench-staff-' || g)::uuid, md5('bench-role-' || r)::uuid
  from generate_series(1, 1000) g
 cross join lateral (values (1 + g % 6), (case when g % 2 = 0 then 1 + (g + 2) % 6 end),
                            (case when g % 5 = 0 then 1 + (g + 3) % 6 end)) v(r)
 where v.r is not null and g <> 1
union
select md5('bench-staff-1')::uuid, md5('bench-role-' || r)::uuid from generate_series(1, 6) r;

-- Qualified at about a third of the (client, role) pairs a worker could
-- work; worker 1 at every client, worker 2 at one, worker 3 at none.
insert into client_qualifications (client_id, role_id, staff_id, do_not_return)
select md5('bench-client-' || c)::uuid, sro.role_id, sro.staff_id, false
  from staff_roles sro
  join staff s on s.id = sro.staff_id and s.email like 'bench-staff-%'
 cross join generate_series(1, 10) c
 where (s.employee_id = 700001)
    or (s.employee_id = 700002 and c = 1)
    or (s.employee_id > 700003
        and abs(hashtext(sro.staff_id::text || sro.role_id::text || c::text)) % 3 = 0);
insert into client_qualifications (client_id, role_id, staff_id, do_not_return)
select md5('bench-client-1')::uuid, md5('bench-role-1')::uuid, md5('bench-staff-' || g)::uuid, true
  from generate_series(4, 1000) g where g % 97 = 0
on conflict (client_id, role_id, staff_id) do update set do_not_return = true;

-- ---- open events: 200 x 3 sections over the next four weeks ------------
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, required_languages, series_id)
select md5('bench-event-' || k)::uuid, md5('bench-client-' || (1 + k % 10))::uuid, v.id, v.name, v.address, v.location, 150,
       'Bench Event ' || k, current_date + 1 + (k % 28), true, true,
       case when k % 20 = 0 then array['English', 'Spanish'] else array['English'] end,
       case when k % 40 in (1, 2) then md5('bench-series-' || (k / 40))::uuid end
  from generate_series(1, 200) k
  join venues v on v.id = md5('bench-venue-' || (1 + k % 30))::uuid;

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer, charge_rate, pay_rate,
                                allocation_per_hour, required_gender, same_staff_all_days)
select md5('bench-section-' || k || '-' || j)::uuid, md5('bench-event-' || k)::uuid,
       md5('bench-role-' || (1 + (k + j) % 6))::uuid,
       ((current_date + 1 + (k % 28)) + make_time(8 + j * 4, 0, 0)) at time zone 'Europe/London',
       ((current_date + 1 + (k % 28)) + make_time(8 + j * 4, 0, 0)) at time zone 'Europe/London'
         + make_interval(hours => 5 + (k + j) % 4),
       4 + (k * 3 + j) % 9, 1, 25, 14, 3,
       case when (k * 3 + j) % 25 = 0 then 'F' end,
       k % 40 in (1, 2)
  from generate_series(1, 200) k cross join generate_series(0, 2) j;

-- ---- history: 400 past events x 2 sections, ~30 worked shifts per worker
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer)
select md5('bench-past-' || k)::uuid, md5('bench-client-' || (1 + k % 10))::uuid, v.id, v.name, v.address, v.location, 150,
       'Bench Past ' || k, current_date - 1 - (k % 180), true, true
  from generate_series(1, 400) k
  join venues v on v.id = md5('bench-venue-' || (1 + k % 30))::uuid;
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer, charge_rate, pay_rate,
                                allocation_per_hour)
select md5('bench-past-section-' || k || '-' || j)::uuid, md5('bench-past-' || k)::uuid,
       md5('bench-role-' || (1 + (k + j) % 6))::uuid,
       ((current_date - 1 - (k % 180)) + make_time(9 + j * 6, 0, 0)) at time zone 'Europe/London',
       ((current_date - 1 - (k % 180)) + make_time(9 + j * 6, 0, 0)) at time zone 'Europe/London' + interval '6 hours',
       40, 0, 25, 14, 3
  from generate_series(1, 400) k cross join generate_series(0, 1) j;

create temp table bench_past as
select sr.id, row_number() over (order by sr.id) as rn
  from shift_requirements sr join events e on e.id = sr.event_id where e.title like 'Bench Past %';
create temp table bench_staff as
select id, row_number() over (order by employee_id) as rn from staff where email like 'bench-staff-%';

insert into bookings (shift_id, staff_id, status, source, confirmed_at, created_at)
select p.id, w.id, 'worked', 'auto', now() - interval '30 days', now() - interval '31 days'
  from bench_staff w
 cross join generate_series(0, 29) k
  join bench_past p on p.rn = 1 + ((w.rn * 13 + k * 53) % 800)
 where w.rn <> 3
on conflict do nothing;
insert into violations (staff_id, booking_id, type, resolved)
select b.staff_id, b.id, 'no_show', false
  from bookings b join bench_past p on p.id = b.shift_id
 where (hashtext(b.id::text) % 33) = 0;

-- ---- live bookings on the open sections --------------------------------
create temp table bench_open as
select sr.id, sr.role_id, sr.headcount, row_number() over (order by sr.id) as rn
  from shift_requirements sr join events e on e.id = sr.event_id where e.title like 'Bench Event %';

-- confirmed: about half the headcount (every 15th section full), drawn
-- from workers holding the role
insert into bookings (shift_id, staff_id, status, source, confirmed_at)
select o.id, x.staff_id, 'confirmed', 'auto', now()
  from bench_open o
 cross join lateral (
   select sro.staff_id from staff_roles sro
     join staff s on s.id = sro.staff_id and s.status = 'compliant' and s.employee_id > 700003
    where sro.role_id = o.role_id
    order by md5(o.id::text || sro.staff_id::text)
    limit case when o.rn % 15 = 0 then o.headcount else o.headcount / 2 end
 ) x
on conflict do nothing;
-- invitations, Radar applications and self-cancels
insert into bookings (shift_id, staff_id, status, source, applied_at, cancelled_at, cancel_cause, self_cancelled)
select o.id, x.staff_id,
       (case x.i when 1 then 'invited' when 2 then 'applied' else 'cancelled' end)::booking_status,
       (case x.i when 2 then 'self' else 'auto' end)::booking_source,
       case when x.i = 2 then now() - interval '1 hour' end,
       case when x.i = 3 then now() - interval '1 day' end,
       case when x.i = 3 then 'self_cancel' end,
       x.i = 3
  from bench_open o
 cross join lateral (
   select sro.staff_id, row_number() over (order by md5('x' || o.id::text || sro.staff_id::text)) as i
     from staff_roles sro
     join staff s on s.id = sro.staff_id and s.employee_id > 700003
    where sro.role_id = o.role_id
    order by md5('x' || o.id::text || sro.staff_id::text)
    limit 3
 ) x
 where x.i < 3 or o.rn % 10 = 0
on conflict do nothing;
-- worker 2 has applied on one section and is confirmed on another
insert into bookings (shift_id, staff_id, status, source, applied_at)
select o.id, md5('bench-staff-2')::uuid, 'applied', 'self', now() - interval '2 hours'
  from bench_open o join staff_roles sro on sro.role_id = o.role_id and sro.staff_id = md5('bench-staff-2')::uuid
 order by o.rn limit 1
on conflict do nothing;

-- 60 open pool offers on confirmed bookings of sections more than a day
-- away; on every fourth, every worker qualified at its client and role has
-- already been told (wave 1 exhausted by notices).
create temp table bench_offer_src as
select b.id booking_id, b.shift_id, b.staff_id, row_number() over (order by md5('offer' || b.id::text)) rn
  from bookings b join bench_open o on o.id = b.shift_id join shift_requirements sr on sr.id = b.shift_id
 where b.status = 'confirmed' and sr.starts_at > now() + interval '1 day';
insert into shift_offers (booking_id, shift_id, offered_by_staff_id, mode, status, expires_at)
select booking_id, shift_id, staff_id, 'pool', 'open', now() + interval '2 days' from bench_offer_src where rn <= 60;
insert into shift_offer_notices (offer_id, staff_id)
select o.id, cq.staff_id
  from (select so.*, row_number() over (order by so.id) k
          from shift_offers so join bench_offer_src x on x.booking_id = so.booking_id) o
  join shift_requirements sr on sr.id = o.shift_id join events ev on ev.id = sr.event_id
  join client_qualifications cq on cq.client_id = ev.client_id and cq.role_id = sr.role_id and not cq.do_not_return
 where o.k % 4 = 0
on conflict do nothing;
create temp table bench_offers as
select so.id from shift_offers so join bench_offer_src x on x.booking_id = so.booking_id;
grant all on bench_offers to public;

-- ---- ADR-0184: finished shifts this week, a third signed out late ---------
-- Sections end 20 minutes to 3 hours ago (never before the cutoff), six
-- hours long; half the events do not pay breaks.
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer)
select md5('bench-today-' || k)::uuid, md5('bench-client-' || (1 + k % 10))::uuid, v.id, v.name, v.address, v.location, 150,
       'Bench Today ' || k, (now() at time zone 'Europe/London')::date, k % 2 = 1, true
  from generate_series(1, 40) k
  join venues v on v.id = md5('bench-venue-' || (1 + k % 30))::uuid;
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer, charge_rate, pay_rate,
                                allocation_per_hour)
select md5('bench-today-section-' || k)::uuid, md5('bench-today-' || k)::uuid, md5('bench-role-' || (1 + k % 6))::uuid,
       x.ends - interval '6 hours', x.ends, 50, 0, 25, 14, 3
  from generate_series(1, 40) k
 cross join lateral (select greatest(now() - interval '20 minutes' - (k % 6) * interval '30 minutes',
                                     timestamptz '2026-10-20 23:00:00+00' + interval '6 hours') as ends) x;
create temp table bench_finished as
select md5('bench-today-booking-' || k || '-' || i)::uuid as id, md5('bench-today-section-' || k)::uuid as shift_id,
       w.id as staff_id, i % 3 = 0 as late, k % 2 = 0 as unpaid_breaks, 30 + (k * 7 + i) % 91 as late_min
  from generate_series(1, 40) k cross join generate_series(1, 50) i
  join bench_staff w on w.rn = 4 + (k * 50 + i) % 997;
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at, created_at)
select f.id, f.shift_id, f.staff_id, 'worked', 'auto', now() - interval '3 days', now() - interval '4 days'
  from bench_finished f
on conflict do nothing;
insert into check_logs (booking_id, attempted_at, outcome, check_in_at, check_out_at, check_out_pressed_at, check_out_on_site)
select f.id, sr.starts_at, 'checked_in', sr.starts_at,
       sr.ends_at + case when f.late then make_interval(mins => f.late_min) else interval '5 minutes' end,
       sr.ends_at + case when f.late then make_interval(mins => f.late_min) else interval '5 minutes' end, true
  from bench_finished f join bookings b on b.id = f.id join shift_requirements sr on sr.id = f.shift_id;
insert into breaks (booking_id, started_at, ended_at)
select f.id, sr.starts_at + interval '3 hours', sr.starts_at + interval '3 hours 30 minutes'
  from bench_finished f join bookings b on b.id = f.id join shift_requirements sr on sr.id = f.shift_id
 where f.unpaid_breaks;

set local session_replication_role = origin;
analyze check_logs; analyze breaks;
analyze shift_offers; analyze shift_offer_notices;
analyze staff; analyze staff_roles; analyze client_qualifications; analyze events;
analyze shift_requirements; analyze bookings; analyze violations;

select (select count(*) from staff where email like 'bench-staff-%')                  as workers,
       (select count(*) from bench_open)                                               as open_sections,
       (select count(*) from bookings b join bench_staff w on w.id = b.staff_id)       as bookings,
       (select count(*) from client_qualifications cq join bench_staff w on w.id = cq.staff_id) as qualifications;

-- ---- the clock ------------------------------------------------------------
create temp table bench_sections as
select id, rn from bench_open where rn % 30 = 1;       -- 20 sections
grant all on bench_sections, bench_open to public;

-- Radar, as each staff user
\set who 1
\ir radar_as_staff.psql
\set who 2
\ir radar_as_staff.psql
\set who 3
\ir radar_as_staff.psql

-- The board: auto_assign_candidates per section as an admin, with the
-- board's own filter on top.
select set_config('request.jwt.claims', json_build_object('sub', md5('bench-admin')::uuid, 'role', 'authenticated')::text, true);
set local role authenticated;
-- No limit here, so a body that is over the app's 8 s limit is measured
-- rather than cancelled; the report flags it.
set local statement_timeout = 0;
do $$
declare r record; t timestamptz; n int;
begin
  for r in select id from bench_sections order by rn loop
    t := clock_timestamp();
    select count(*) into n from auto_assign_candidates(r.id, false) c
     where c.gate is null or c.gate not in ('wrong_role', 'male_only', 'female_only', 'language_not_spoken');
    insert into bench_clock (what, n, ms) values ('board: auto_assign_candidates (admin)', n, extract(epoch from clock_timestamp() - t) * 1000);
  end loop;
  -- A multi-day job's section (same staff on all days, ADR-0117): the
  -- wrapper also reads each sibling day's pool over the candidates.
  for r in select sr.id from shift_requirements sr join events e on e.id = sr.event_id
            where e.title like 'Bench Event %' and sr.same_staff_all_days and sr.starts_at > now()
            order by sr.id limit 6 loop
    t := clock_timestamp();
    select count(*) into n from auto_assign_candidates(r.id, false) c
     where c.gate is null or c.gate not in ('wrong_role', 'male_only', 'female_only', 'language_not_spoken');
    insert into bench_clock (what, n, ms) values ('board: auto_assign_candidates, series section (admin)', n, extract(epoch from clock_timestamp() - t) * 1000);
  end loop;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- The rounds: the whole pool per section as service_role.
set local role service_role;
do $$
declare r record; t timestamptz; n int;
begin
  for r in select id from bench_sections order by rn loop
    t := clock_timestamp();
    select count(*) into n from auto_assign_candidates(r.id, false);
    insert into bench_clock (what, n, ms) values ('round: auto_assign_candidates (service_role)', n, extract(epoch from clock_timestamp() - t) * 1000);
    t := clock_timestamp();
    select count(*) into n from auto_assign_candidates_pool(r.id);
    insert into bench_clock (what, n, ms) values ('round: auto_assign_candidates_pool (service_role)', n, extract(epoch from clock_timestamp() - t) * 1000);
    t := clock_timestamp();
    select count(*) into n from auto_assign_candidates(r.id, true);
    insert into bench_clock (what, n, ms) values ('escalation: auto_assign_candidates (service_role)', n, extract(epoch from clock_timestamp() - t) * 1000);
  end loop;
end $$;
reset role;

-- One worker's gate (invite, Accept, apply, take), owner-run as the
-- SECURITY DEFINER callers run it, for a compliant worker who holds the
-- section's role (a wrong-role worker stops at the first gate).
do $$
declare r record; t timestamptz; n int;
begin
  for r in select o.id,
                  (select sro.staff_id from staff_roles sro join staff s on s.id = sro.staff_id
                    where sro.role_id = sr.role_id and s.status = 'compliant' and s.employee_id > 700003
                    order by s.employee_id offset 10 limit 1) as staff_id
             from bench_sections o join shift_requirements sr on sr.id = o.id order by o.rn loop
    t := clock_timestamp();
    select count(*) into n from auto_assign_worker_gate(r.id, r.staff_id);
    insert into bench_clock (what, n, ms) values ('one worker: auto_assign_worker_gate', n, extract(epoch from clock_timestamp() - t) * 1000);
  end loop;
end $$;

-- The wave-1 checks, owner-run as their SECURITY DEFINER callers run them.
do $$
declare r record; t timestamptz; b boolean;
begin
  for r in select id from bench_offers order by id loop
    t := clock_timestamp();
    b := offer_wave1_exhausted(r.id);
    insert into bench_clock (what, n, ms) values ('wave 1: offer_wave1_exhausted (per offer)', b::int, extract(epoch from clock_timestamp() - t) * 1000);
  end loop;
  for r in select id from bench_open where rn % 15 = 1 order by rn loop
    t := clock_timestamp();
    b := radar_wave1_exhausted(r.id);
    insert into bench_clock (what, n, ms) values ('wave 1: radar_wave1_exhausted (per section)', b::int, extract(epoch from clock_timestamp() - t) * 1000);
  end loop;
end $$;

-- One worker against every open section in one call, where the database
-- has it (ADR-0170): workers 1-3 and a few others.
do $$
declare r record; t timestamptz; n int;
begin
  if to_regprocedure('public.auto_assign_worker_pool(uuid,uuid[])') is null then return; end if;
  for r in select id from bench_staff where rn in (1, 2, 3, 100, 400, 700) order by rn loop
    t := clock_timestamp();
    execute 'select count(*) from auto_assign_worker_pool($1, array(select id from bench_open))' into n using r.id;
    insert into bench_clock (what, n, ms) values ('one worker, every open section: auto_assign_worker_pool', n, extract(epoch from clock_timestamp() - t) * 1000);
  end loop;
end $$;

-- The office reads that sum the week (RULE-20 with ADR-0184), as an admin.
select set_config('request.jwt.claims', json_build_object('sub', md5('bench-admin')::uuid, 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare t timestamptz; n int; i int;
begin
  for i in 1..3 loop
    t := clock_timestamp();
    -- Every column, as /staff reads it (a bare count(*) lets the planner
    -- skip the week's sums).
    select count(*) into n from staff_directory_v d where hashtext(d::text) is not null;
    insert into bench_clock (what, n, ms) values ('office: staff_directory_v (full list)', n, extract(epoch from clock_timestamp() - t) * 1000);
    t := clock_timestamp();
    select count(*) into n from late_check_outs();
    insert into bench_clock (what, n, ms) values ('office: late_check_outs()', n, extract(epoch from clock_timestamp() - t) * 1000);
    t := clock_timestamp();
    select count(*) into n from checkin_monitor_v m
     where hashtext(m::text) is not null and m.starts_at < ((now() at time zone 'Europe/London')::date + 1)::timestamp at time zone 'Europe/London'
       and m.ends_at > ((now() at time zone 'Europe/London')::date)::timestamp at time zone 'Europe/London';
    insert into bench_clock (what, n, ms) values ('office: checkin_monitor_v (today)', n, extract(epoch from clock_timestamp() - t) * 1000);
    -- What /checkin adds, where the database has it (20261023110100): the
    -- week against the cap of the day's late rows and the list's, in one call.
    if to_regprocedure('public.late_check_out_weeks(uuid[])') is not null then
      -- The ids as the loader has them: from the rows it already read
      -- (filtering the view on late_check_out is its own, older, slow plan).
      create temp table if not exists bench_late_ids as
        select x.booking_id from (
          select m.* from checkin_monitor_v m
           where m.starts_at < ((now() at time zone 'Europe/London')::date + 1)::timestamp at time zone 'Europe/London'
             and m.ends_at > ((now() at time zone 'Europe/London')::date)::timestamp at time zone 'Europe/London'
          offset 0) x
         where x.status = 'checked_out' and x.late_check_out
        union
        select l.booking_id from late_check_outs() l;
      t := clock_timestamp();
      execute 'select count(*) from late_check_out_weeks(array(select booking_id from bench_late_ids))' into n;
      insert into bench_clock (what, n, ms) values ('office: late_check_out_weeks (today''s late rows + the list)', n, extract(epoch from clock_timestamp() - t) * 1000);
    end if;
  end loop;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

select what, count(*) as calls, round(avg(n)) as avg_rows,
       round(avg(ms), 1) as avg_ms, round(percentile_cont(0.5) within group (order by ms)::numeric, 1) as p50_ms,
       round(max(ms), 1) as max_ms, count(*) filter (where ms > 8000) as over_8s_limit
  from bench_clock group by what order by min(seq);

rollback;
