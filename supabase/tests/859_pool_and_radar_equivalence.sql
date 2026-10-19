-- =====================================================================
-- 859 · The auto-assign pool and Radar, old bodies against new (ADR-0156)
--   20261019193000_auto_assign_pool_set_based.sql
--   20261019193100_radar_prefilter_and_one_section.sql
--
-- Both migrations change how the answers are computed and nothing about
-- what they are. This file holds them to it: the bodies as they stood
-- before (20261012140000's pool, the series wrapper and one-worker gate
-- that read it, and 20261017180000's Radar) are re-created below under
-- _old_ names, verbatim but for the names, and every reader is compared
-- with its old self over a fixture that reaches every gate:
--
--   A · the pool's list read, ordinary and escalation, every section: the
--       same rows, every column; the gate codes it crossed (all thirteen),
--       both waves, every booking state; and the rules spot-checked by
--       name - the 2 h gap at a different venue, back-to-back at the same
--       venue, the 20 h term cap, right to work, self-cancel, wrong role,
--       gender and languages incl. not recorded, the escalation radius,
--       and the workers who are in no pool at all;
--   B · the pool for named workers: every section x every worker one at a
--       time (the Accept / apply / Radar path), and a list of them;
--   C · the series wrapper (not_available_all_days from the calendar and
--       from a booking on the other day) and auto_assign_worker_gate();
--       rows in staff_id order;
--   D · Radar as nine workers: the same cards, every column, in the same
--       order (now total); RULE-17's wave check; Limit Reached; an
--       application on a started section; a declined invitation offered
--       again; full / cancelled / other-role sections never listed; and
--       staff_open_shifts(p_shift) is the list narrowed to one section;
--   E · invariants that outlive the old bodies: reliability is
--       staff_show_rate(), and hours_limit / rtw_expired sit exactly where
--       weekly_cap_would_breach() says;
--   F · who may read what: unchanged.
--
-- The _old_ functions, like every row here, are created inside the
-- transaction and rolled back.
-- =====================================================================
begin;
select plan(45);
-- The old bodies' plans cost far above jit_above_cost; compiling them on
-- every call is most of this file's run time and none of its meaning.
set local jit = off;
\ir _shared/fixtures.psql

-- ---- the old bodies -------------------------------------------------
CREATE FUNCTION public._old_auto_assign_candidates_pool(p_shift uuid, p_escalation boolean DEFAULT false, p_only uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(staff_id uuid, gate text, qualified boolean, booking_status text, reliability numeric, rating numeric, distance_km numeric, future_shifts integer, venue_times integer, booking_cause text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  with sec as (
    select sr.id as shift_id, sr.role_id, sr.starts_at, sr.ends_at, sr.required_gender,
           ev.id as event_id, ev.client_id, ev.venue_id, ev.venue_location,
           -- ADR-0080: the languages the event needs besides English, which
           -- is never gated — everyone THC books speaks it.
           array_remove(ev.required_languages, 'English') as extra_languages
    from shift_requirements sr join events ev on ev.id = sr.event_id
    where sr.id = p_shift
  ),
  gap as (select booked_elsewhere_gap_minutes() as mins),
  -- One statute mile is 1,609.344 m; geography distances are metres.
  rad as (select case when p_escalation then escalation_radius_miles() * 1609.344 end as metres)
  select
    s.id,
    case
      when not exists (select 1 from staff_roles sro
                        where sro.staff_id = s.id and sro.role_id = sec.role_id) then 'wrong_role'
      -- ADR-0079: the client asked for staff of one gender on this role.
      -- Straight after wrong_role because, like it, it is what the SECTION
      -- asks for rather than anything about the worker's week.
      when sec.required_gender is not null and s.gender is null              then 'gender_not_recorded'
      when sec.required_gender = 'M' and s.gender <> 'M'                      then 'male_only'
      when sec.required_gender = 'F' and s.gender <> 'F'                      then 'female_only'
      -- ADR-0080: the event needs staff who also speak another language.
      -- Next to the gender gates for the same reason: it is what the EVENT
      -- asks for. Nothing on file reads as "not shown to speak it", listed
      -- so the office can record it; on file without it is no row at all.
      when cardinality(sec.extra_languages) > 0 and s.languages is null         then 'languages_not_recorded'
      when not (sec.extra_languages <@ s.languages)                             then 'language_not_spoken'
      when exists (select 1 from client_qualifications cq
                    where cq.staff_id = s.id and cq.client_id = sec.client_id
                      and cq.do_not_return)                                     then 'do_not_return'
      when s.status <> 'compliant'                                              then 'blocked'
      when exists (select 1 from bookings b
                     join shift_requirements sr2 on sr2.id = b.shift_id
                    where b.staff_id = s.id and sr2.event_id = sec.event_id
                      and b.self_cancelled)                                     then 'self_cancelled'
      -- (1) §3.4 "only the worker's other CONFIRMED bookings count" — and a
      -- checked-in booking is a confirmed one (20260930110000, D2).
      when exists (
             select 1 from bookings b
               join shift_requirements sr2 on sr2.id = b.shift_id
               join events ev2 on ev2.id = sr2.event_id
              where b.staff_id = s.id and b.status in ('confirmed', 'worked')
                and b.shift_id <> sec.shift_id
                and booked_elsewhere_conflict(sec.starts_at, sec.ends_at, sec.venue_id,
                                              sr2.starts_at, sr2.ends_at, ev2.venue_id,
                                              gap.mins) <> 'clear')             then 'booked_elsewhere'
      -- RULE-20 and the right-to-work stop share one gate, but not one
      -- label: a worker past their right to work is not "over their
      -- hours" and the board must not say so (20260924130100).
      when weekly_cap_would_breach(s.id, sec.shift_id) then
        case when not (can_roster_staff(s.id, (sec.starts_at at time zone 'Europe/London')::date)
                       and can_roster_staff(s.id, ((sec.ends_at - interval '1 second')
                                                   at time zone 'Europe/London')::date))
             then 'rtw_expired'
             else 'hours_limit' end
      -- §3.4 same-day escalation only: "within a 3-mile radius of the
      -- venue". No home on file cannot be shown to be inside it.
      when rad.metres is not null
           and (s.home_location is null
                or not st_dwithin(s.home_location, sec.venue_location, rad.metres)) then 'outside_radius'
      else null
    end as gate,
    exists (select 1 from client_qualifications cq
             where cq.staff_id = s.id and cq.client_id = sec.client_id
               and cq.role_id = sec.role_id and not cq.do_not_return) as qualified,
    mine.status as booking_status,
    -- §6 show-rate, derived from the worker's history (20260928110100);
    -- 90 with no history is the formula's zero point, as before.
    coalesce(staff_show_rate(s.id), 90)::numeric,
    coalesce(s.rating, 4.0)::numeric,
    coalesce(st_distance(s.home_location, sec.venue_location) / 1000.0, 9999)::numeric,
    (select count(*) from bookings b join shift_requirements sr3 on sr3.id = b.shift_id
      where b.staff_id = s.id and b.status = 'confirmed' and sr3.starts_at > now())::int,
    (select count(*) from bookings b
       join shift_requirements sr4 on sr4.id = b.shift_id
       join events ev4 on ev4.id = sr4.event_id
      where b.staff_id = s.id and b.status = 'worked' and ev4.venue_id = sec.venue_id)::int,
    mine.cancel_cause as booking_cause
  from staff s cross join sec cross join gap cross join rad
  -- (3) This section's own booking, read once for its status and cause.
  -- bookings is unique on (shift_id, staff_id), so at most one row.
  left join lateral (
    select b.status::text as status, b.cancel_cause
      from bookings b
     where b.shift_id = sec.shift_id and b.staff_id = s.id
  ) mine on true
  where s.removed_at is null and s.left_at is null
    -- (2) Workers only (§2.12): compliant, or blocked (gated above). A
    -- candidate mid-onboarding or a rejected applicant is in no pool and
    -- produces no row — not an Unavailable "Blocked — compliance" row.
    and s.status in ('compliant', 'blocked')
    -- SpudBros Express staff (20261008120000): onboarding only, unless the
    -- office has switched THC shifts on for them. No row at all — like a
    -- candidate — so they never show on the board, never get an invitation
    -- and never see an offer.
    and not (s.spudbros_express and not s.thc_shifts_enabled)
    -- 20261012140000: the one clause this migration adds to the pool.
    and (p_only is null or s.id = any (p_only))
$function$;

CREATE FUNCTION public._old_series_gate_for(p_staff uuid, p_shift uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  select case
    when not exists (select 1 from series_siblings(p_shift)) then null
    -- a hard gate on another day: the sibling's own pool, for this worker
    when exists (select 1
                   from series_siblings(p_shift) sib
                  cross join lateral _old_auto_assign_candidates_pool(sib.shift_id, false, array[p_staff]) c
                  where c.gate is not null)                          then 'not_available_all_days'
    -- the availability calendar over another day
    when exists (select 1
                   from series_siblings(p_shift) sib
                   join staff_unavailability u on u.staff_id = p_staff
                    and sib.ends_at > sib.starts_at
                    and u.period && tstzrange(sib.starts_at, sib.ends_at, '[)'))
                                                                     then 'not_available_all_days'
    -- all the days' hours together against the weekly cap
    when series_hours_blocked(p_staff, p_shift)                      then 'not_available_all_days'
    else null
  end
$function$;

CREATE FUNCTION public._old_auto_assign_candidates(p_shift uuid, p_escalation boolean DEFAULT false)
 RETURNS TABLE(staff_id uuid, gate text, qualified boolean, booking_status text, reliability numeric, rating numeric, distance_km numeric, future_shifts integer, venue_times integer, booking_cause text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  with own as (
    select * from _old_auto_assign_candidates_pool(p_shift, p_escalation)
  ),
  sib as (
    select * from series_siblings(p_shift)
  ),
  -- Only workers the section's own gates left standing need the sibling
  -- days asked about them.
  cand as (
    select coalesce(array_agg(o.staff_id), array[]::uuid[]) as ids from own o where o.gate is null
  ),
  -- Barred by another day, computed ONCE per sibling over the candidates -
  -- never per worker. The sibling is judged as an ordinary day (no
  -- escalation radius: the radius is about the day the shift starts):
  --   · the sibling's own pool gate;
  --   · an availability-calendar entry over the sibling ([starts, ends),
  --     half-open like the rest of ADR-0043).
  barred as (
    select c.staff_id
      from sib
     cross join cand
     cross join lateral _old_auto_assign_candidates_pool(sib.shift_id, false, cand.ids) c
     where c.gate is not null
    union
    select u.staff_id
      from sib
      join staff_unavailability u
        on sib.ends_at > sib.starts_at
       and u.period && tstzrange(sib.starts_at, sib.ends_at, '[)')
  ),
  has_sib as (
    select exists (select 1 from sib) as on_
  )
  select p.staff_id,
         case
           -- The section's own gate always wins: the truer reason.
           when p.gate is not null then p.gate
           when h.on_ then
             -- Nested, so the per-worker hours projection is only computed
             -- for a worker nothing else has barred.
             case
               when p.staff_id in (select b.staff_id from barred b) then 'not_available_all_days'
               when series_hours_blocked(p.staff_id, p_shift)       then 'not_available_all_days'
               else null
             end
           else null
         end,
         p.qualified, p.booking_status, p.reliability, p.rating, p.distance_km,
         p.future_shifts, p.venue_times, p.booking_cause
    from own p
   cross join has_sib h
$function$;

CREATE FUNCTION public._old_auto_assign_worker_gate(p_shift uuid, p_staff uuid, p_escalation boolean DEFAULT false)
 RETURNS TABLE(gate text, qualified boolean, booking_status text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  select case when c.gate is not null then c.gate
              else _old_series_gate_for(p_staff, p_shift) end,
         c.qualified,
         c.booking_status
    from _old_auto_assign_candidates_pool(p_shift, p_escalation, array[p_staff]) c
$function$;

CREATE FUNCTION public._old_staff_open_shifts(p_staff uuid DEFAULT NULL::uuid)
 RETURNS TABLE(shift_id uuid, event_id uuid, event_title text, event_date date, role text, starts_at timestamp with time zone, ends_at timestamp with time zone, pay_rate numeric, dress_code text, venue_name text, venue_address text, distance_km numeric, headcount integer, buffer integer, confirmed_count integer, qualified boolean, hours_limit boolean, applied_at timestamp with time zone, week_start date, booked_hours numeric, cap_hours numeric, venue_lat double precision, venue_lng double precision, geofence_radius_m integer, home_lat double precision, home_lng double precision)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  with me as (select staff_caller(p_staff) as id)
  select
    sr.id, ev.id, ev.title, ev.event_date, r.name, sr.starts_at, sr.ends_at,
    case when (select current_app_role() is distinct from 'admin'::app_role or office_can('finance')) then effective_pay_rate(me.id, sr.pay_rate) end, sr.dress_code, ev.venue_name, ev.venue_address,
    round((st_distance(s.home_location, ev.venue_location) / 1000.0)::numeric, 1),
    sr.headcount, sr.buffer, f.confirmed,
    -- A pending application can outlive the worker's candidate row (the
    -- wave or a gate moved underneath it), so "not known" reads false.
    coalesce(c.my_qualified, false),
    coalesce(c.my_gate = 'hours_limit', false),
    mine.applied_at,
    -- The arithmetic behind "Limit reached", for the Mon-Sun week this
    -- SECTION falls in. §10.4 shows the worker the numbers, not just the
    -- verdict: "18 h + 4 h is over your 20 h limit". Since the cap is
    -- calculated and never typed, those figures are the only way to tell a
    -- term/holiday boundary from a mistake.
    cap_week_start((sr.starts_at at time zone 'Europe/London')::date),
    weekly_booked_hours(me.id, (sr.starts_at at time zone 'Europe/London')::date),
    weekly_cap_hours(me.id, (sr.starts_at at time zone 'Europe/London')::date),
    st_y(ev.venue_location::geometry),
    st_x(ev.venue_location::geometry),
    ev.geofence_radius_m,
    st_y(s.home_location::geometry),
    st_x(s.home_location::geometry)
  from me
    join staff s               on s.id = me.id
    -- Not started — or started but not over with this worker's own
    -- application still pending on it (RULE-16 takes it off at the end,
    -- 20260930110200).
    join shift_requirements sr on sr.ends_at > now()
                              and (sr.starts_at > now()
                                   or exists (select 1 from bookings o
                                               where o.shift_id = sr.id and o.staff_id = me.id
                                                 and o.status = 'applied'))
    join events ev             on ev.id = sr.event_id and ev.cancelled_at is null
    join roles r               on r.id = sr.role_id
    -- This worker's own pending application on the section, if any.
    left join lateral (
      select o.applied_at from bookings o
       where o.shift_id = sr.id and o.staff_id = me.id and o.status = 'applied'
    ) mine on true
    cross join lateral shift_fill(sr.id) f
    -- The viewing worker's own row of the section's pool. Reading the
    -- whole pool here, for every section, judged every worker in the agency
    -- once per section on a phone-facing screen (20261017180000).
    cross join lateral (
      select
        count(*) > 0 as me_present,
        coalesce(min(a.gate), case when sr.same_staff_all_days then _old_series_gate_for(me.id, sr.id) end) as my_gate,
        bool_or(a.qualified)  as my_qualified,
        min(a.booking_status) as my_status,
        min(a.booking_cause)  as my_cause
      -- 20261017180000: this worker's row only. RULE-17's wave check is
      -- asked below, and only when it can change the answer.
      from _old_auto_assign_candidates_pool(sr.id, false, array[me.id]) a ) c
  where
    -- §10.4: an applied card stays "until it resolves one way or the
    -- other" — confirmed (then it is on My shifts), closed with N10c at
    -- the fill, withdrawn, or the section ending (RULE-16).
    mine.applied_at is not null
    or (
          sr.starts_at > now()
      -- One threshold with apply_to_shift and close_filled_role_applications.
      and f.confirmed < sr.headcount
      and c.me_present
      and (c.my_gate is null or c.my_gate = 'hours_limit')
      and case
            when c.my_qualified then true
            -- RULE-17: is anyone qualified at this client and role still
            -- reachable? A worker not in that set waits for it to empty.
            -- Only the qualified workers can make it true, so the pool is
            -- read for them alone (20261017180000).
            else not coalesce((
              select bool_or(w.gate is null and w.qualified and w.booking_status is null)
                from _old_auto_assign_candidates_pool(sr.id, false, array(
                       select cq.staff_id from client_qualifications cq
                        where cq.client_id = ev.client_id and cq.role_id = sr.role_id
                          and not cq.do_not_return)) w), false)
          end
      -- Already invited or confirmed here: that lives on Invites or My
      -- shifts. An ended row the worker may reopen by applying — closed
      -- (declined, withdrawn, a slot that went to somebody else) or, since
      -- 20260930110100, cancelled by the office or the 12:05 cutoff — is
      -- offered again; one they may not (never: a self-cancel, an event
      -- cancellation, a GDPR removal) is not.
      and (c.my_status is null
           or booking_reopenable_by(c.my_status::booking_status, c.my_cause) in ('anyone', 'person'))
    )
  order by coalesce(c.my_qualified, false) desc,
           round((st_distance(s.home_location, ev.venue_location) / 1000.0)::numeric, 1),
           sr.starts_at
$function$;

revoke execute on function public._old_staff_open_shifts(uuid) from public, anon;
grant  execute on function public._old_staff_open_shifts(uuid) to authenticated;

-- =====================================================================
-- The fixture: one row for every gate, both waves, every booking state
-- the readers branch on. Wednesday of the week two weeks ahead is "the
-- day"; s1 is the section most things are measured against.
-- =====================================================================
select cap_week_start(current_date) + 14 as w \gset

\set role2  '85430000-0000-4000-8000-000000000001'
\set ve2    '85430000-0000-4000-8000-000000000002'
\set ve3    '85430000-0000-4000-8000-000000000003'
\set ser    '85430000-0000-4000-8000-000000000004'

\set ev1  '85410000-0000-4000-8000-000000000001'
\set ev2  '85410000-0000-4000-8000-000000000002'
\set ev3  '85410000-0000-4000-8000-000000000003'
\set ev4  '85410000-0000-4000-8000-000000000004'
\set ev5a '85410000-0000-4000-8000-000000000005'
\set ev5b '85410000-0000-4000-8000-000000000006'
\set ev6  '85410000-0000-4000-8000-000000000007'
\set ev7  '85410000-0000-4000-8000-000000000008'
\set ev8  '85410000-0000-4000-8000-000000000009'
\set ev9  '85410000-0000-4000-8000-00000000000a'
\set ev10 '85410000-0000-4000-8000-00000000000b'

\set s1   '85420000-0000-4000-8000-000000000001'
\set s2   '85420000-0000-4000-8000-000000000002'
\set s3   '85420000-0000-4000-8000-000000000003'
\set s4   '85420000-0000-4000-8000-000000000004'
\set s5   '85420000-0000-4000-8000-000000000005'
\set s6   '85420000-0000-4000-8000-000000000006'
\set s7a  '85420000-0000-4000-8000-000000000007'
\set s7b  '85420000-0000-4000-8000-000000000008'
\set sh1  '85420000-0000-4000-8000-000000000009'
\set sh2  '85420000-0000-4000-8000-00000000000a'
\set sh3  '85420000-0000-4000-8000-00000000000b'
\set s9   '85420000-0000-4000-8000-00000000000c'
\set s10  '85420000-0000-4000-8000-00000000000d'
\set s11  '85420000-0000-4000-8000-00000000000e'
\set s12  '85420000-0000-4000-8000-00000000000f'
\set s13  '85420000-0000-4000-8000-000000000010'
\set s14  '85420000-0000-4000-8000-000000000011'
\set hist '85420000-0000-4000-8000-000000000012'

\set wq     '85440000-0000-4000-8000-000000000001'
\set wn     '85440000-0000-4000-8000-000000000002'
\set wr2    '85440000-0000-4000-8000-000000000003'
\set wnull  '85440000-0000-4000-8000-000000000004'
\set wdnr   '85440000-0000-4000-8000-000000000005'
\set wblk   '85440000-0000-4000-8000-000000000006'
\set wself  '85440000-0000-4000-8000-000000000007'
\set wels   '85440000-0000-4000-8000-000000000008'
\set wback  '85440000-0000-4000-8000-000000000009'
\set wcap   '85440000-0000-4000-8000-00000000000a'
\set wrtw   '85440000-0000-4000-8000-00000000000b'
\set wfar   '85440000-0000-4000-8000-00000000000c'
\set wnoh   '85440000-0000-4000-8000-00000000000d'
\set wspud  '85440000-0000-4000-8000-00000000000e'
\set wrem   '85440000-0000-4000-8000-00000000000f'
\set wcand  '85440000-0000-4000-8000-000000000010'
\set wleft  '85440000-0000-4000-8000-000000000011'
\set waway  '85440000-0000-4000-8000-000000000012'
\set wsib   '85440000-0000-4000-8000-000000000013'
\set winv   '85440000-0000-4000-8000-000000000014'
\set wdec   '85440000-0000-4000-8000-000000000015'
\set wapp   '85440000-0000-4000-8000-000000000016'
\set wdnrb  '85440000-0000-4000-8000-000000000017'
\set wf1    '85440000-0000-4000-8000-000000000018'
\set wf2    '85440000-0000-4000-8000-000000000019'
\set wm     '85440000-0000-4000-8000-00000000001a'

\set u_q    '85450000-0000-4000-8000-000000000001'
\set u_n    '85450000-0000-4000-8000-000000000002'
\set u_null '85450000-0000-4000-8000-000000000003'
\set u_cap  '85450000-0000-4000-8000-000000000004'
\set u_app  '85450000-0000-4000-8000-000000000005'
\set u_dec  '85450000-0000-4000-8000-000000000006'
\set u_els  '85450000-0000-4000-8000-000000000007'

insert into auth.users (id, email) values
  (:'u_q', 'q.854@rls.test'), (:'u_n', 'n.854@rls.test'), (:'u_null', 'null.854@rls.test'),
  (:'u_cap', 'cap.854@rls.test'), (:'u_app', 'app.854@rls.test'), (:'u_dec', 'dec.854@rls.test'),
  (:'u_els', 'els.854@rls.test');
insert into profiles (id, role, full_name) values
  (:'u_q', 'staff', 'Q'), (:'u_n', 'staff', 'N'), (:'u_null', 'staff', 'Null'),
  (:'u_cap', 'staff', 'Cap'), (:'u_app', 'staff', 'App'), (:'u_dec', 'staff', 'Dec'), (:'u_els', 'staff', 'Els');

insert into roles (id, name, pay_rate) values (:'role2', 'Pool 854 Second Role', 14.00);
-- ve2: a different venue ~2.8 km west; ve3: ~25 km away, outside any radius.
insert into venues (id, name, address, location, venue_type, geofence_radius_m) values
  (:'ve2', 'Pool 854 Venue 2', '2 Test Street, London', st_setsrid(st_makepoint(-0.1400, 51.5000), 4326)::geography, 'hotel', 150),
  (:'ve3', 'Pool 854 Venue 3', '3 Test Street, Kent',   st_setsrid(st_makepoint( 0.2500, 51.5000), 4326)::geography, 'hotel', 150);

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, required_languages, series_id, cancelled_at) values
  (:'ev1',  :'clienta', :'venue_id', 'V1', 'a', st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'P854 day',        :'w'::date + 2, true, true, array['English'], null, null),
  (:'ev2',  :'clienta', :'venue_id', 'V1', 'a', st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'P854 Spanish',    :'w'::date + 2, true, true, array['English', 'Spanish'], null, null),
  (:'ev3',  :'clientb', :'ve2',      'V2', 'b', st_setsrid(st_makepoint(-0.1400, 51.5000), 4326)::geography, 150, 'P854 elsewhere',  :'w'::date + 2, true, true, array['English'], null, null),
  (:'ev4',  :'clienta', :'venue_id', 'V1', 'a', st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'P854 same venue', :'w'::date + 2, true, true, array['English'], null, null),
  (:'ev5a', :'clientb', :'venue_id', 'V1', 'a', st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'P854 series Fri', :'w'::date + 4, true, true, array['English'], :'ser', null),
  (:'ev5b', :'clientb', :'venue_id', 'V1', 'a', st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'P854 series Sat', :'w'::date + 5, true, true, array['English'], :'ser', null),
  (:'ev6',  :'clientb', :'ve3',      'V3', 'c', st_setsrid(st_makepoint( 0.2500, 51.5000), 4326)::geography, 150, 'P854 student week', :'w'::date, true, true, array['English'], null, null),
  (:'ev7',  :'clienta', :'venue_id', 'V1', 'a', st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'P854 Thursday',   :'w'::date + 3, true, true, array['English'], null, null),
  (:'ev8',  :'clienta', :'venue_id', 'V1', 'a', st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'P854 running',    (now() at time zone 'Europe/London')::date, true, true, array['English'], null, null),
  (:'ev9',  :'clienta', :'venue_id', 'V1', 'a', st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'P854 cancelled',  :'w'::date + 2, true, true, array['English'], null, now()),
  (:'ev10', :'clientb', :'venue_id', 'V1', 'a', st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'P854 Sunday',     :'w'::date + 6, true, true, array['English'], null, null);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer, charge_rate, pay_rate,
                                allocation_per_hour, required_gender, same_staff_all_days) values
  -- the day: 10:00-16:00 UK, 3 (+1)
  (:'s1',  :'ev1',  :'role_id', (:'w'::date + 2 + time '10:00') at time zone 'Europe/London', (:'w'::date + 2 + time '16:00') at time zone 'Europe/London', 3, 1, 20, 12, 4, null, false),
  -- Female staff only, the same evening
  (:'s2',  :'ev1',  :'role_id', (:'w'::date + 2 + time '17:00') at time zone 'Europe/London', (:'w'::date + 2 + time '22:00') at time zone 'Europe/London', 2, 0, 20, 12, 2, 'F', false),
  -- another role on the same event
  (:'s3',  :'ev1',  :'role2',   (:'w'::date + 2 + time '10:00') at time zone 'Europe/London', (:'w'::date + 2 + time '16:00') at time zone 'Europe/London', 2, 0, 20, 12, 2, null, false),
  -- needs Spanish
  (:'s4',  :'ev2',  :'role_id', (:'w'::date + 2 + time '18:00') at time zone 'Europe/London', (:'w'::date + 2 + time '23:00') at time zone 'Europe/London', 2, 0, 20, 12, 2, null, false),
  -- a different venue, starting an hour after s1 ends (inside the 2 h gap)
  (:'s5',  :'ev3',  :'role_id', (:'w'::date + 2 + time '17:00') at time zone 'Europe/London', (:'w'::date + 2 + time '21:00') at time zone 'Europe/London', 5, 0, 20, 12, 5, null, false),
  -- the SAME venue, an hour after s1 ends (back-to-back is fine there)
  (:'s6',  :'ev4',  :'role_id', (:'w'::date + 2 + time '17:00') at time zone 'Europe/London', (:'w'::date + 2 + time '21:00') at time zone 'Europe/London', 5, 0, 20, 12, 5, null, false),
  -- a two-day job asking for the same staff on both days (ADR-0117)
  (:'s7a', :'ev5a', :'role_id', (:'w'::date + 4 + time '09:00') at time zone 'Europe/London', (:'w'::date + 4 + time '17:00') at time zone 'Europe/London', 4, 0, 20, 12, 4, null, true),
  (:'s7b', :'ev5b', :'role_id', (:'w'::date + 5 + time '09:00') at time zone 'Europe/London', (:'w'::date + 5 + time '17:00') at time zone 'Europe/London', 4, 0, 20, 12, 4, null, true),
  -- the student's other 18 h that week (Mon, Tue, Thu 09:00-15:00, far away)
  (:'sh1', :'ev6',  :'role_id', (:'w'::date + 0 + time '09:00') at time zone 'Europe/London', (:'w'::date + 0 + time '15:00') at time zone 'Europe/London', 9, 0, 20, 12, 9, null, false),
  (:'sh2', :'ev6',  :'role_id', (:'w'::date + 1 + time '09:00') at time zone 'Europe/London', (:'w'::date + 1 + time '15:00') at time zone 'Europe/London', 9, 0, 20, 12, 9, null, false),
  (:'sh3', :'ev6',  :'role_id', (:'w'::date + 3 + time '17:00') at time zone 'Europe/London', (:'w'::date + 3 + time '23:00') at time zone 'Europe/London', 9, 0, 20, 12, 9, null, false),
  -- full: 2 of 2 confirmed
  (:'s9',  :'ev7',  :'role_id', (:'w'::date + 3 + time '09:00') at time zone 'Europe/London', (:'w'::date + 3 + time '15:00') at time zone 'Europe/London', 2, 1, 20, 12, 2, null, false),
  -- running now: started an hour ago
  (:'s10', :'ev8',  :'role_id', now() - interval '1 hour', now() + interval '4 hours', 3, 0, 20, 12, 3, null, false),
  -- on a cancelled event
  (:'s11', :'ev9',  :'role_id', (:'w'::date + 2 + time '10:00') at time zone 'Europe/London', (:'w'::date + 2 + time '16:00') at time zone 'Europe/London', 3, 0, 20, 12, 3, null, false),
  -- Male staff only
  (:'s12', :'ev7',  :'role_id', (:'w'::date + 3 + time '16:00') at time zone 'Europe/London', (:'w'::date + 3 + time '20:00') at time zone 'Europe/London', 2, 0, 20, 12, 2, 'M', false),
  -- overlapping the series' Saturday, same venue
  (:'s13', :'ev10', :'role_id', (:'w'::date + 5 + time '10:00') at time zone 'Europe/London', (:'w'::date + 5 + time '14:00') at time zone 'Europe/London', 3, 0, 20, 12, 3, null, false),
  -- Sunday at client B: wave 1 there is exhausted
  (:'s14', :'ev10', :'role_id', (:'w'::date + 6 + time '10:00') at time zone 'Europe/London', (:'w'::date + 6 + time '16:00') at time zone 'Europe/London', 3, 0, 20, 12, 3, null, false),
  -- history: a past section at the fixture venue
  (:'hist', :'ev8', :'role_id', now() - interval '30 days', now() - interval '30 days' + interval '6 hours', 9, 0, 20, 12, 9, null, false);

insert into staff (id, user_id, first_name, last_name, email, phone, dob, status, rtw_branch, home_location,
                   right_to_work_until, gender, languages, rating, spudbros_express, thc_shifts_enabled,
                   removed_at, left_at) values
  (:'wq',    :'u_q',    'Quinn', 'Qualified', 'q@p854.test',   '+447700985401', date '1995-01-01', 'compliant', 'uk_irish', st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, 'F', array['English', 'Spanish'], 4.8, false, false, null, null),
  (:'wn',    :'u_n',    'Nia',   'Newer',     'n@p854.test',   '+447700985402', date '1995-01-02', 'compliant', 'uk_irish', st_setsrid(st_makepoint(-0.1020, 51.5000), 4326)::geography, null, 'M', array['English'], 4.1, false, false, null, null),
  (:'wr2',   null,      'Rory',  'Otherrole', 'r2@p854.test',  '+447700985403', date '1995-01-03', 'compliant', 'uk_irish', st_setsrid(st_makepoint(-0.1030, 51.5000), 4326)::geography, null, 'M', array['English'], null, false, false, null, null),
  (:'wnull', :'u_null', 'Nell',  'Unknown',   'nu@p854.test',  '+447700985404', date '1995-01-04', 'compliant', 'uk_irish', st_setsrid(st_makepoint(-0.1040, 51.5000), 4326)::geography, null, null, null, null, false, false, null, null),
  (:'wdnr',  null,      'Dan',   'Barred',    'd@p854.test',   '+447700985405', date '1995-01-05', 'compliant', 'uk_irish', st_setsrid(st_makepoint(-0.1050, 51.5000), 4326)::geography, null, 'M', array['English'], null, false, false, null, null),
  (:'wblk',  null,      'Bo',    'Blocked',   'b@p854.test',   '+447700985406', date '1995-01-06', 'blocked',   'uk_irish', st_setsrid(st_makepoint(-0.1060, 51.5000), 4326)::geography, null, 'F', array['English'], null, false, false, null, null),
  (:'wself', null,      'Sam',   'Selfcx',    's@p854.test',   '+447700985407', date '1995-01-07', 'compliant', 'uk_irish', st_setsrid(st_makepoint(-0.1070, 51.5000), 4326)::geography, null, 'F', array['English'], null, false, false, null, null),
  (:'wels',  :'u_els',  'Elle',  'Elsewhere', 'e@p854.test',   '+447700985408', date '1995-01-08', 'compliant', 'uk_irish', st_setsrid(st_makepoint(-0.1080, 51.5000), 4326)::geography, null, 'F', array['English'], null, false, false, null, null),
  (:'wback', null,      'Ben',   'Backtoback','bb@p854.test',  '+447700985409', date '1995-01-09', 'compliant', 'uk_irish', st_setsrid(st_makepoint(-0.1090, 51.5000), 4326)::geography, null, 'M', array['English'], null, false, false, null, null),
  (:'wcap',  :'u_cap',  'Cass',  'Capped',    'c@p854.test',   '+447700985410', date '2001-01-10', 'compliant', 'international_student', st_setsrid(st_makepoint(-0.1100, 51.5000), 4326)::geography, :'w'::date + 365, 'F', array['English'], null, false, false, null, null),
  (:'wrtw',  null,      'Ria',   'Rtw',       'rt@p854.test',  '+447700985411', date '1995-01-11', 'compliant', 'work_visa', st_setsrid(st_makepoint(-0.1110, 51.5000), 4326)::geography, :'w'::date + 1, 'F', array['English'], null, false, false, null, null),
  (:'wfar',  null,      'Fay',   'Faraway',   'f@p854.test',   '+447700985412', date '1995-01-12', 'compliant', 'uk_irish', st_setsrid(st_makepoint( 0.2400, 51.5000), 4326)::geography, null, 'F', array['English'], null, false, false, null, null),
  (:'wnoh',  null,      'Ned',   'Nohome',    'nh@p854.test',  '+447700985413', date '1995-01-13', 'compliant', 'uk_irish', null, null, 'M', array['English'], null, false, false, null, null),
  (:'wspud', null,      'Spud',  'Express',   'sp@p854.test',  '+447700985414', date '1995-01-14', 'compliant', 'uk_irish', st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, 'M', array['English'], null, true,  false, null, null),
  (:'wrem',  null,      'Rem',   'Removed',   'rm@p854.test',  '+447700985415', date '1995-01-15', 'compliant', 'uk_irish', st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, 'M', array['English'], null, false, false, now(), null),
  (:'wcand', null,      'Cal',   'Candidate', 'ca@p854.test',  '+447700985416', date '1995-01-16', 'documents', 'uk_irish', st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, 'M', array['English'], null, false, false, null, null),
  (:'wleft', null,      'Lee',   'Left',      'le@p854.test',  '+447700985417', date '1995-01-17', 'compliant', 'uk_irish', st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, 'M', array['English'], null, false, false, null, now()),
  (:'waway', null,      'Ada',   'Away',      'aw@p854.test',  '+447700985418', date '1995-01-18', 'compliant', 'uk_irish', st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, 'F', array['English'], null, false, false, null, null),
  (:'wsib',  null,      'Sib',   'Sibling',   'si@p854.test',  '+447700985419', date '1995-01-19', 'compliant', 'uk_irish', st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, 'F', array['English'], null, false, false, null, null),
  (:'winv',  null,      'Ivy',   'Invited',   'i@p854.test',   '+447700985420', date '1995-01-20', 'compliant', 'uk_irish', st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, 'F', array['English'], null, false, false, null, null),
  (:'wdec',  :'u_dec',  'Dee',   'Declined',  'de@p854.test',  '+447700985421', date '1995-01-21', 'compliant', 'uk_irish', st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, 'F', array['English'], null, false, false, null, null),
  (:'wapp',  :'u_app',  'Abi',   'Applied',   'a@p854.test',   '+447700985422', date '1995-01-22', 'compliant', 'uk_irish', st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, 'F', array['English'], null, false, false, null, null),
  (:'wdnrb', null,      'Dot',   'BarredB',   'db@p854.test',  '+447700985423', date '1995-01-23', 'compliant', 'uk_irish', st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, 'F', array['English'], null, false, false, null, null),
  (:'wf1',   null,      'Fil',   'One',       'f1@p854.test',  '+447700985424', date '1995-01-24', 'compliant', 'uk_irish', st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, 'M', array['English'], null, false, false, null, null),
  (:'wf2',   null,      'Fil',   'Two',       'f2@p854.test',  '+447700985425', date '1995-01-25', 'compliant', 'uk_irish', st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, 'F', array['English'], null, false, false, null, null),
  (:'wm',    null,      'Max',   'Male',      'm@p854.test',   '+447700985426', date '1995-01-26', 'compliant', 'uk_irish', st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, 'M', array['English', 'Spanish'], 3.9, false, false, null, null);
-- the student is in term (no holiday ranges): the 20 h cap
update staff set term_dates = '{}' where id = :'wcap';

insert into staff_roles (staff_id, role_id)
select id, :'role_id' from staff where email like '%@p854.test' and id <> :'wr2';
insert into staff_roles (staff_id, role_id) values (:'wr2', :'role2'), (:'wq', :'role2');

-- Wave 1 at client A: Quinn, the capped student and Dee; do-not-return rows.
-- At client B only the student (capped out that week), the blocked worker
-- and the invited one are qualified, so wave 1 there is exhausted.
insert into client_qualifications (client_id, role_id, staff_id, do_not_return) values
  (:'clienta', :'role_id', :'wq',    false),
  (:'clienta', :'role_id', :'wcap',  false),
  (:'clienta', :'role_id', :'wdec',  false),
  (:'clienta', :'role2',   :'wq',    false),
  (:'clienta', :'role_id', :'wdnr',  true),
  (:'clientb', :'role_id', :'wdnrb', true),
  (:'clientb', :'role_id', :'wcap',  false),
  (:'clientb', :'role_id', :'wblk',  false),
  (:'clientb', :'role_id', :'winv',  false);

-- Bookings.
insert into bookings (shift_id, staff_id, status, source, confirmed_at) values
  (:'s5',  :'wels',  'confirmed', 'auto', now()),
  (:'s6',  :'wback', 'confirmed', 'auto', now()),
  (:'sh1', :'wcap',  'confirmed', 'auto', now()),
  (:'sh2', :'wcap',  'confirmed', 'auto', now()),
  (:'sh3', :'wcap',  'confirmed', 'auto', now()),
  (:'s9',  :'wf1',   'confirmed', 'auto', now()),
  (:'s9',  :'wf2',   'confirmed', 'auto', now()),
  (:'s1',  :'wf1',   'confirmed', 'auto', now()),
  (:'s1',  :'wf2',   'confirmed', 'auto', now()),
  (:'s13', :'wsib',  'confirmed', 'auto', now());
insert into bookings (shift_id, staff_id, status, source) values
  (:'s1',  :'winv',  'invited', 'auto'),
  (:'s14', :'winv',  'invited', 'auto'),
  -- the fixture's Staff Bravo is qualified at client B too
  (:'s14', :'staffb', 'invited', 'auto');
insert into bookings (shift_id, staff_id, status, source, applied_at) values
  (:'s1',  :'wapp',  'applied', 'self', now() - interval '2 hours'),
  (:'s10', :'wapp',  'applied', 'self', now() - interval '3 hours');
insert into bookings (shift_id, staff_id, status, source, cancelled_at, cancel_cause) values
  (:'s1',  :'wdec',  'closed', 'auto', now(), 'declined');
insert into bookings (shift_id, staff_id, status, source, cancelled_at, cancel_cause, self_cancelled) values
  (:'s3',  :'wself', 'cancelled', 'auto', now(), 'self_cancel', true);
-- History: worked shifts at the fixture venue, one with an open No-show.
insert into bookings (shift_id, staff_id, status, source, confirmed_at) values
  (:'hist', :'wq', 'worked', 'auto', now() - interval '31 days'),
  (:'hist', :'wn', 'worked', 'auto', now() - interval '31 days'),
  (:'hist', :'wm', 'turned_away', 'auto', now() - interval '31 days');
insert into violations (staff_id, booking_id, type, resolved)
select b.staff_id, b.id, 'no_show', false from bookings b where b.shift_id = :'hist' and b.staff_id = :'wn';
-- The calendar over the series' Saturday.
insert into staff_unavailability (staff_id, period, all_day) values
  (:'waway', unavailability_range(:'w'::date + 5), true);

create temp table t854_sec as
select id from shift_requirements where id::text like '85420000-%'
union all select :'shift_a'::uuid union all select :'shift_b'::uuid;
-- one-at-a-time reads: this file's workers and the fixture's two
create temp table t854_staff as
select id from staff where email like '%@p854.test' or id in (:'staffa', :'staffb');
create temp table t854_users (uid uuid, staff uuid);
insert into t854_users values (:'u_q', :'wq'), (:'u_n', :'wn'), (:'u_null', :'wnull'), (:'u_cap', :'wcap'),
                              (:'u_app', :'wapp'), (:'u_dec', :'wdec'), (:'u_els', :'wels'),
                              (:'staffa_uid', :'staffa'), (:'staffb_uid', :'staffb');
grant select on t854_sec, t854_staff, t854_users to public;

-- =====================================================================
-- A · the pool, old body against new, list reads
-- =====================================================================
select is((select count(*)::int from t854_sec s cross join (values (false), (true)) e(esc)
            cross join lateral (
              (select * from auto_assign_candidates_pool(s.id, e.esc)
               except all select * from _old_auto_assign_candidates_pool(s.id, e.esc))
              union all
              (select * from _old_auto_assign_candidates_pool(s.id, e.esc)
               except all select * from auto_assign_candidates_pool(s.id, e.esc))) d),
  0, 'A: every section, ordinary and escalation: the new pool returns exactly the old pool''s rows (every column)');
select is((select count(*)::int from t854_sec s cross join lateral auto_assign_candidates_pool(s.id) p),
          (select count(*)::int from t854_sec s cross join lateral _old_auto_assign_candidates_pool(s.id) p),
  'A: and the same number of them');

-- the dataset reaches every gate, both waves and every booking state
select is((select array_agg(distinct g order by g) from (
             select p.gate as g from t854_sec s cross join lateral auto_assign_candidates_pool(s.id, true) p
             union select p.gate from t854_sec s cross join lateral auto_assign_candidates_pool(s.id, false) p) x),
  array['blocked', 'booked_elsewhere', 'do_not_return', 'female_only', 'gender_not_recorded', 'hours_limit',
        'language_not_spoken', 'languages_not_recorded', 'male_only', 'outside_radius', 'rtw_expired',
        'self_cancelled', 'wrong_role', null],
  'A: coverage - the comparison above crossed every gate code the pool has');
select ok((select bool_or(p.qualified) and bool_or(not p.qualified)
             from auto_assign_candidates_pool(:'s1') p where p.gate is null),
  'A: coverage - both waves among the bookable workers on the day');
select is((select array_agg(distinct p.booking_status order by p.booking_status)
             from auto_assign_candidates_pool(:'s1') p),
  array['applied', 'closed', 'confirmed', 'invited', null],
  'A: coverage - every booking state the readers branch on');

-- the rules themselves, on the new pool
select is((select gate from auto_assign_candidates_pool(:'s1') where staff_id = :'wels'), 'booked_elsewhere',
  'A: confirmed at another venue starting an hour after the day ends: booked elsewhere (the 2 h gap)');
select is((select gate from auto_assign_candidates_pool(:'s1') where staff_id = :'wback'), null,
  'A: confirmed at the SAME venue an hour after: not booked elsewhere');
select is((select gate from auto_assign_candidates_pool(:'s5') where staff_id = :'wback'), 'booked_elsewhere',
  'A: and a section at another venue overlapping that booking is booked elsewhere too');
select is((select gate from auto_assign_candidates_pool(:'s1') where staff_id = :'wcap'), 'hours_limit',
  'A: a student with 18 h booked that week cannot take 6 more (20 h term cap)');
select is((select gate from auto_assign_candidates_pool(:'s1') where staff_id = :'wrtw'), 'rtw_expired',
  'A: a right to work ending before the day: rtw_expired, not hours_limit');
select is((select gate from auto_assign_candidates_pool(:'s1') where staff_id = :'wself'), 'self_cancelled',
  'A: a self-cancel off another section of the same event excludes the worker from the event');
select is((select gate from auto_assign_candidates_pool(:'s1') where staff_id = :'wr2'), 'wrong_role',
  'A: no role, wrong_role');
select is((select gate from auto_assign_candidates_pool(:'s2') where staff_id = :'wnull'), 'gender_not_recorded',
  'A: gender not on file on a Female-only section');
select is((select gate from auto_assign_candidates_pool(:'s4') where staff_id = :'wnull'), 'languages_not_recorded',
  'A: languages not on file on an event needing Spanish');
select is((select gate from auto_assign_candidates_pool(:'s4') where staff_id = :'wn'), 'language_not_spoken',
  'A: on file without Spanish');
select is((select gate from auto_assign_candidates_pool(:'s1', true) where staff_id = :'wfar'), 'outside_radius',
  'A: escalation: home outside the radius');
select is((select gate from auto_assign_candidates_pool(:'s1', true) where staff_id = :'wnoh'), 'outside_radius',
  'A: escalation: no home on file');
select is((select count(*)::int from auto_assign_candidates_pool(:'s1')
            where staff_id in (:'wspud', :'wrem', :'wcand', :'wleft')), 0,
  'A: SpudBros-only, removed, a candidate and a leaver produce no row at all');

-- =====================================================================
-- B · the pool for named workers (the one-worker readers, the siblings)
-- =====================================================================
select is((select count(*)::int from t854_sec s cross join t854_staff w
            where (select array_agg(x order by x::text) from auto_assign_candidates_pool(s.id, false, array[w.id]) x)
                  is distinct from
                  (select array_agg(x order by x::text) from _old_auto_assign_candidates_pool(s.id, false, array[w.id]) x)),
  0, 'B: every section x every worker, one at a time: the same row (or none) as the old pool');
select is((select count(*)::int from t854_sec s
            cross join lateral (select array_agg(id) ids from staff where email like '%@p854.test') w
            cross join lateral (
              (select * from auto_assign_candidates_pool(s.id, true, w.ids)
               except all select * from _old_auto_assign_candidates_pool(s.id, true, w.ids))
              union all
              (select * from _old_auto_assign_candidates_pool(s.id, true, w.ids)
               except all select * from auto_assign_candidates_pool(s.id, true, w.ids))) d),
  0, 'B: a list of named workers: the same rows');
select is((select count(*)::int from auto_assign_candidates_pool(:'s1', false, '{}'::uuid[])), 0,
  'B: an empty list is no rows, as before');

-- =====================================================================
-- C · the wrapper and the one-worker gate, old against new
-- =====================================================================
select is((select count(*)::int from t854_sec s cross join (values (false), (true)) e(esc)
            cross join lateral (
              (select * from auto_assign_candidates(s.id, e.esc)
               except all select * from _old_auto_assign_candidates(s.id, e.esc))
              union all
              (select * from _old_auto_assign_candidates(s.id, e.esc)
               except all select * from auto_assign_candidates(s.id, e.esc))) d),
  0, 'C: auto_assign_candidates() - the series-aware list - returns exactly what it did');
select is((select count(*)::int from auto_assign_candidates(:'s7a') where gate = 'not_available_all_days'), 2,
  'C: coverage - on the two-day job the calendar and a booking on the other day both read not_available_all_days');
select is((select count(*)::int from t854_sec s cross join t854_staff w
            where (select array_agg(x order by x::text) from auto_assign_worker_gate(s.id, w.id) x)
                  is distinct from
                  (select array_agg(x order by x::text) from _old_auto_assign_worker_gate(s.id, w.id) x)),
  0, 'C: auto_assign_worker_gate() - invite, Accept, apply, take - the same answer for every section and worker');
select ok((select bool_and(a.staff_id <= b.staff_id)
             from (select staff_id, row_number() over () rn from auto_assign_candidates(:'s1')) a
             join (select staff_id, row_number() over () rn from auto_assign_candidates(:'s1')) b on b.rn = a.rn + 1),
  'C: rows come back in staff_id order, so a reader paging through them sees a stable order');

-- =====================================================================
-- D · Radar, old body against new, as each worker
-- =====================================================================
create temp table t854_radar_new as select null::uuid uid, 0::bigint rn, x.* from staff_open_shifts() x where false;
create temp table t854_radar_old as select null::uuid uid, 0::bigint rn, x.* from staff_open_shifts() x where false;
create temp table t854_radar_one as select null::uuid uid, x.* from staff_open_shifts() x where false;
grant all on t854_radar_new, t854_radar_old, t854_radar_one to public;

do $$
declare u record;
begin
  for u in select * from t854_users loop
    perform set_config('request.jwt.claims', json_build_object('sub', u.uid, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into t854_radar_new select u.uid, row_number() over (), x.* from staff_open_shifts() x;
    insert into t854_radar_old select u.uid, row_number() over (), x.* from _old_staff_open_shifts() x;
    insert into t854_radar_one select u.uid, x.* from t854_sec s cross join lateral staff_open_shifts(null, s.id) x;
    execute 'reset role';
  end loop;
  perform set_config('request.jwt.claims', '', true);
end $$;

select is((select count(*)::int from (
             (select uid, shift_id, event_id, event_title, event_date, role, starts_at, ends_at, pay_rate, dress_code,
                     venue_name, venue_address, distance_km, headcount, buffer, confirmed_count, qualified, hours_limit,
                     applied_at, week_start, booked_hours, cap_hours, venue_lat, venue_lng, geofence_radius_m, home_lat, home_lng
                from t854_radar_new
              except all
              select uid, shift_id, event_id, event_title, event_date, role, starts_at, ends_at, pay_rate, dress_code,
                     venue_name, venue_address, distance_km, headcount, buffer, confirmed_count, qualified, hours_limit,
                     applied_at, week_start, booked_hours, cap_hours, venue_lat, venue_lng, geofence_radius_m, home_lat, home_lng
                from t854_radar_old)
             union all
             (select uid, shift_id, event_id, event_title, event_date, role, starts_at, ends_at, pay_rate, dress_code,
                     venue_name, venue_address, distance_km, headcount, buffer, confirmed_count, qualified, hours_limit,
                     applied_at, week_start, booked_hours, cap_hours, venue_lat, venue_lng, geofence_radius_m, home_lat, home_lng
                from t854_radar_old
              except all
              select uid, shift_id, event_id, event_title, event_date, role, starts_at, ends_at, pay_rate, dress_code,
                     venue_name, venue_address, distance_km, headcount, buffer, confirmed_count, qualified, hours_limit,
                     applied_at, week_start, booked_hours, cap_hours, venue_lat, venue_lng, geofence_radius_m, home_lat, home_lng
                from t854_radar_new)) d),
  0, 'D: every worker''s Radar - the new body lists exactly the old body''s cards, every column');
select is((select count(*)::int from t854_radar_new n join t854_radar_old o using (uid, rn)
            where (n.qualified, n.distance_km, n.starts_at) is distinct from (o.qualified, o.distance_km, o.starts_at)),
  0, 'D: in the same order (qualified first, then distance, then start)');
select ok((select bool_and((not a.qualified, a.distance_km, a.starts_at, a.shift_id) < (not b.qualified, b.distance_km, b.starts_at, b.shift_id))
             from t854_radar_new a join t854_radar_new b on b.uid = a.uid and b.rn = a.rn + 1),
  'D: and the order is total now: ties end on the section id');
select ok((select count(distinct uid) >= 6 from t854_radar_new),
  'D: coverage - most workers see something');
select ok(exists (select 1 from t854_radar_new where uid = :'u_n' and shift_id = :'s14')
      and not exists (select 1 from t854_radar_new where uid = :'u_n' and shift_id = :'s1'),
  'D: RULE-17 - a wave-2 worker sees the section whose wave 1 is exhausted (blocked, already invited, capped out) and not the one where a qualified worker is still free');
select ok(exists (select 1 from t854_radar_new where uid = :'u_cap' and hours_limit),
  'D: a worker over the cap still sees the card, as Limit Reached');
select ok(exists (select 1 from t854_radar_new where uid = :'u_app' and shift_id = :'s10' and applied_at is not null),
  'D: an application on a section that has started stays until RULE-16 ends it');
select ok(exists (select 1 from t854_radar_new where uid = :'u_dec' and shift_id = :'s1'),
  'D: a declined invitation is offered again');
select ok(not exists (select 1 from t854_radar_new
                        where shift_id in (:'s9', :'s11') or (shift_id = :'s3' and uid <> :'u_q'))
      and exists (select 1 from t854_radar_new where shift_id = :'s3' and uid = :'u_q'),
  'D: a full section and a cancelled event are never listed; another role only to the worker who holds it');

select is((select count(*)::int from (
             (select uid, shift_id, qualified, hours_limit, applied_at, confirmed_count from t854_radar_one
              except all select uid, shift_id, qualified, hours_limit, applied_at, confirmed_count from t854_radar_new)
             union all
             (select uid, shift_id, qualified, hours_limit, applied_at, confirmed_count from t854_radar_new
              except all select uid, shift_id, qualified, hours_limit, applied_at, confirmed_count from t854_radar_one)) d),
  0, 'D: staff_open_shifts(p_shift) is the list narrowed to that section - for every worker and every section');

-- =====================================================================
-- E · what the pool still agrees with, whatever replaces the old body
-- =====================================================================
select is((select count(*)::int from t854_sec s cross join lateral auto_assign_candidates_pool(s.id) p
            where p.reliability is distinct from coalesce(staff_show_rate(p.staff_id), 90)::numeric),
  0, 'E: reliability is staff_show_rate() (90 with no history) for every row');
select ok((select reliability from auto_assign_candidates_pool(:'s1') where staff_id = :'wn') < 90
      and (select venue_times from auto_assign_candidates_pool(:'s1') where staff_id = :'wq') = 1,
  'E: coverage - an open No-show lowers a show-rate, and a worked shift counts at the venue');
select is((select count(*)::int from t854_sec s cross join lateral auto_assign_candidates_pool(s.id) p
            where (p.gate is null or p.gate in ('hours_limit', 'rtw_expired'))
              and (p.gate is not null) is distinct from weekly_cap_would_breach(p.staff_id, s.id)),
  0, 'E: hours_limit / rtw_expired exactly where weekly_cap_would_breach() says so, for a worker no earlier gate stopped');

-- =====================================================================
-- F · who may read it - unchanged
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table t854_admin as select * from auto_assign_candidates_pool(:'s1');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from (
             (select * from t854_admin except all select * from auto_assign_candidates_pool(:'s1'))
             union all
             (select * from auto_assign_candidates_pool(:'s1') except all select * from t854_admin)) d),
  0, 'F: the office reads the whole pool through its own rights, row for row what the owner reads');
select set_config('request.jwt.claims', json_build_object('sub', :'u_q', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from auto_assign_candidates_pool(:'s1')), 0,
  'F: a worker calling the pool directly reads nothing (it is SECURITY INVOKER; sections are office-only)');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from auto_assign_candidates_pool(:'s1')), 0, 'F: nor does a client');
reset role;
select set_config('request.jwt.claims', '', true);
select ok((select not prosecdef from pg_proc where oid = 'public.auto_assign_candidates_pool(uuid,boolean,uuid[])'::regprocedure),
  'F: the pool is still SECURITY INVOKER (ADR-0156 weighed owner rights and kept the caller''s)');
select ok(has_function_privilege('authenticated', 'public.staff_open_shifts(uuid,uuid)', 'execute')
      and has_function_privilege('service_role', 'public.staff_open_shifts(uuid,uuid)', 'execute')
      and not has_function_privilege('anon', 'public.staff_open_shifts(uuid,uuid)', 'execute')
      and (select prosecdef from pg_proc where oid = 'public.staff_open_shifts(uuid,uuid)'::regprocedure),
  'F: staff_open_shifts(p_staff, p_shift): SECURITY DEFINER, workers and jobs only, as before');
select is((select count(*)::int from pg_proc where proname = 'staff_open_shifts' and pronamespace = 'public'::regnamespace), 1,
  'F: one staff_open_shifts - the one-argument form is gone, so a call with no arguments is not ambiguous');
select ok(has_function_privilege('authenticated', 'public.auto_assign_candidates_pool(uuid,boolean,uuid[])', 'execute')
      and not has_function_privilege('anon', 'public.auto_assign_candidates_pool(uuid,boolean,uuid[])', 'execute'),
  'F: pool grants as before');

select * from finish();
rollback;
