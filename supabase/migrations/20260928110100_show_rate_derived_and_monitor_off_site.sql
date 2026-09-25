-- =====================================================================
-- Migration 20260928110100 · the show-rate is derived, and Off-site
--                            ends with the section (§6, BG-03, RULE-14,
--                            §9.5, RULE-18)
--
-- 1 · staff_show_rate(p_staff) — the §6 "Show-rate (reliability)" input,
--     computed from the worker's bookings and violations.
--
--     Until now the figure auto_assign_candidates fed to the 30% show
--     factor was `staff.reliability`, a stored column that only seed.sql
--     ever wrote. So BG-03's "automatically marked No-show with the
--     show-rate penalty applied" applied nothing, and RULE-14's "once a
--     manager resolves a No check-out … the violation stops counting
--     against the worker's show-rate" had nothing to stop.
--
--     The reading of the scope this encodes (docs/15 Q4):
--
--       • The sample is every shift the worker was DUE at and the day
--         came: bookings `worked` or `turned_away`, plus a booking that
--         carries an unresolved No-show — that booking stays `confirmed`
--         in the roster by design (§3.3: "stays inside the Confirmed
--         list"), so the status alone would hide the very shift the
--         penalty is for.
--       • Shown = turned up. `worked` and `turned_away` both are: a
--         strict-buffer turn-away was on site and is paid under RULE-15,
--         and §5.2 never calls it a mark against them.
--       • Counts against, while unresolved: No-show (BG-03, §3.3) and
--         No check-out (RULE-14, above). Resolving lifts it — a resolved
--         No-show is reclassified to Late (§9.5 "Get back"), a resolved
--         No check-out means "the shift ended to the client's
--         satisfaction". §9.5's "removes or reduces" is read as REMOVES:
--         the scope gives no half weight anywhere, and a number nobody
--         agreed would be invented.
--       • Weighs nothing: Late, Left early, Left the geofence. §9.5:
--         "Three of them — Late, Left early, Left the geofence during the
--         shift — are only ever reviewed by the manager case by case,
--         with no automatic consequence." A Late arrival is a shown
--         shift at full weight. Self-cancel (RULE-04), Decline and
--         Leaving (§10.6) never enter the sample: those bookings are
--         `cancelled` / `closed`, and each is promised "no show-rate
--         impact".
--       • No history → NULL. auto_assign_candidates coalesces that to
--         90, the §6 formula's own zero point ((90 − 90)/10 = 0) and the
--         default it always used, so a new worker scores the same as
--         before this migration.
--
--     Percent, two decimals: shown / sample × 100.
--
-- 2 · auto_assign_candidates — 20260927140100 restated byte for byte
--     but for the reliability term. The board's "show 98%" chip and the
--     engine's ranking now read the derived figure.
--
-- 3 · staff.reliability stays, unread by auto-assign. Dropping it would
--     take staff_directory_v, staff_profile_v, clients_qualified_staff_v,
--     onboarding_candidates_v and staff_me() with it (their owners' views);
--     they are left to be repointed at staff_show_rate() in their own change.
--
-- 4 · checkin_monitor_v — 20260927160600 restated with ONE condition
--     added to the off_site arm: `and now() < sr.ends_at`. §9.5 says
--     Off-site is "used only while the shift is still running, never as
--     an end state", and record_ping() already stops raising
--     left_geofence after the section's end (ADR-0029 §4) — but it still
--     stores the fix, so between the end and end + 4 h a worker who went
--     home without checking out read Off-site. That fix now falls
--     through to on_shift until RULE-02's four hours are up.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The show-rate, derived
-- ---------------------------------------------------------------------
create or replace function public.staff_show_rate(p_staff uuid)
returns numeric
language sql
stable
set search_path = public, extensions
as $$
  with sample as (
    select b.id,
           exists (select 1 from violations v
                    where v.booking_id = b.id
                      and not v.resolved
                      and v.type in ('no_show', 'no_checkout')) as against
      from bookings b
     where b.staff_id = p_staff
       and (b.status in ('worked', 'turned_away')
            or exists (select 1 from violations v
                        where v.booking_id = b.id
                          and v.type = 'no_show'
                          and not v.resolved))
  )
  select case when count(*) = 0 then null
              else round(100.0 * count(*) filter (where not against) / count(*), 2)
         end
    from sample
$$;

comment on function public.staff_show_rate(uuid) is
  '§6 show-rate (reliability), percent 0–100, derived: shifts worked or turned away plus unresolved No-shows form the sample; an unresolved No-show (BG-03) or No check-out (RULE-14) counts against; resolving lifts it; Late / Left early / Left the geofence weigh nothing (§9.5 "no automatic consequence"). NULL with no history — callers default to 90, the §6 zero point (20260928110100). TypeScript twin: showRate() in packages/domain/src/pay.ts.';

grant execute on function public.staff_show_rate(uuid) to authenticated, service_role;

comment on column public.staff.reliability is
  'Stored show-rate %, written only by seed.sql. NOT read by auto-assign since 20260928110100 — staff_show_rate(id) is the derived §6 figure. Still surfaced by staff_directory_v, staff_profile_v, clients_qualified_staff_v, onboarding_candidates_v and staff_me() until their owners repoint them.';

-- ---------------------------------------------------------------------
-- 2 · The pool — 20260927140100 verbatim but for the reliability term
-- ---------------------------------------------------------------------
create or replace function public.auto_assign_candidates(
  p_shift      uuid,
  -- §3.4 same-day escalation: also gate anyone whose home is not within
  -- escalation_radius_miles() of the venue. Default false = the ordinary
  -- pool, unchanged, for every caller that existed before 20260927140100.
  p_escalation boolean default false
)
returns table (
  staff_id       uuid,
  gate           text,
  qualified      boolean,
  booking_status text,
  reliability    numeric,
  rating         numeric,
  distance_km    numeric,
  future_shifts  int,
  venue_times    int
) language sql stable
set search_path = public, extensions
as $$
  with sec as (
    select sr.id as shift_id, sr.role_id, sr.starts_at, sr.ends_at,
           ev.id as event_id, ev.client_id, ev.venue_id, ev.venue_location
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
      when exists (select 1 from client_qualifications cq
                    where cq.staff_id = s.id and cq.client_id = sec.client_id
                      and cq.do_not_return)                                     then 'do_not_return'
      when s.status <> 'compliant'                                              then 'blocked'
      when exists (select 1 from bookings b
                     join shift_requirements sr2 on sr2.id = b.shift_id
                    where b.staff_id = s.id and sr2.event_id = sec.event_id
                      and b.self_cancelled)                                     then 'self_cancelled'
      when exists (
             select 1 from bookings b
               join shift_requirements sr2 on sr2.id = b.shift_id
               join events ev2 on ev2.id = sr2.event_id
              where b.staff_id = s.id and b.status = 'confirmed' and b.shift_id <> sec.shift_id
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
    (select b.status::text from bookings b
      where b.shift_id = sec.shift_id and b.staff_id = s.id) as booking_status,
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
      where b.staff_id = s.id and b.status = 'worked' and ev4.venue_id = sec.venue_id)::int
  from staff s cross join sec cross join gap cross join rad
  where s.removed_at is null and s.left_at is null
$$;

comment on function public.auto_assign_candidates(uuid, boolean) is
  'The §3.3/§3.4 pool for one role section, computed fresh: gate, wave and the five §6 factor inputs — reliability is staff_show_rate() (20260928110100), never the stored column. Gates: wrong_role, do_not_return, blocked, self_cancelled, booked_elsewhere, rtw_expired (20260924130100), hours_limit (RULE-20), and — only with p_escalation — outside_radius: home not within escalation_radius_miles() of the venue (§3.4 same-day escalation, 20260927140100). Scoring itself is packages/domain/scoring.ts.';

-- ---------------------------------------------------------------------
-- 4 · checkin_monitor_v — 20260927160600 verbatim but for the off_site arm
-- ---------------------------------------------------------------------
create or replace view checkin_monitor_v with (security_invoker = true) as
with logs as (
  select cl.*, row_number() over (
           partition by cl.booking_id
           order by cl.check_in_at nulls last, cl.attempted_at) as rn
    from check_logs cl
)
select
  b.id                                   as booking_id,
  b.staff_id,
  sr.event_id,
  sr.id                                  as shift_id,
  e.title                                as event_title,
  r.name                                 as role_name,
  case when s.removed_at is null then s.first_name || ' ' || s.last_name
       else 'Deleted account #' || s.employee_id end                as staff_name,
  case when s.removed_at is null then s.photo_path end              as photo_path,
  sr.starts_at,                                                     -- the ROLE section's own window (RULE-18)
  sr.ends_at,
  cl.check_in_at,
  coalesce(cl.manager_finish_at, cl.check_out_at)                   as check_out_at,
  b.on_day_confirmed_at,
  ping.inside_geofence                                              as last_fix_inside,
  ping.at                                                           as last_fix_at,
  case when e.pays_breaks then null else brk.n end                  as breaks_count,
  case when e.pays_breaks then null else brk.last_at end            as last_break_at,
  coalesce(cl.manager_finish_at, cl.check_out_at) is not null
    and coalesce(cl.manager_finish_at, cl.check_out_at) > sr.ends_at + interval '15 minutes'
    and not exists (select 1 from violations v
                     where v.booking_id = b.id and v.type = 'no_checkout' and not v.resolved)
                                                                    as late_check_out,
  case
    -- RULE-02, either trigger: an open No check-out holds the row red until
    -- a manager resolves it, whatever check_out() recorded.
    when exists (select 1 from violations v
                  where v.booking_id = b.id and v.type = 'no_checkout' and not v.resolved)
      then 'no_check_out'
    when coalesce(cl.manager_finish_at, cl.check_out_at) is not null then 'checked_out'
    when cl.check_in_at is not null and now() >= sr.ends_at + interval '4 hours' then 'no_check_out'
    -- §9.5: Off-site "only while the shift is still running, never as an
    -- end state" — the ROLE section's end (RULE-18). After it, an outside
    -- fix is going home; the row stays On shift until RULE-02's four hours.
    when cl.check_in_at is not null and ping.inside_geofence is false and now() < sr.ends_at then 'off_site'
    when cl.check_in_at is not null then 'on_shift'
    when now() >= sr.starts_at - interval '30 minutes' then 'not_checked_in'
    when b.on_day_confirmed_at is null
     and (sr.starts_at at time zone 'Europe/London')::date = (now() at time zone 'Europe/London')::date
      then 'not_confirmed_today'
    else 'due'
  end                                                               as status
from bookings b
join shift_requirements sr on sr.id = b.shift_id
join events e on e.id = sr.event_id
join roles r on r.id = sr.role_id
join staff s on s.id = b.staff_id
left join logs cl on cl.booking_id = b.id and cl.rn = 1
left join lateral (
  select p.inside_geofence, p.at from location_pings p
   where p.booking_id = b.id and (cl.check_in_at is null or p.at > cl.check_in_at)
   order by p.at desc, p.id desc limit 1
) ping on true
left join lateral (
  select count(*)::int as n, max(bk.started_at) as last_at
    from breaks bk where bk.booking_id = b.id
) brk on true
where e.cancelled_at is null
  and b.status in ('confirmed', 'worked');

comment on view checkin_monitor_v is
  '§9.5 live monitor. One row per booking with the Status column resolved in SQL: an unresolved No check-out violation (RULE-02, either trigger) reads no_check_out ahead of anything check_out() recorded; Off-site only while the ROLE section is running, never after its end (20260928110100); "today" is Europe/London on both sides (§1.8); breaks read NULL, never 0, where the client pays for them.';
