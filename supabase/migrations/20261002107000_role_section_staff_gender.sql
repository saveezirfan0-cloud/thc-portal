-- =====================================================================
-- Migration 20261002107000 · A staff gender on a role section
--   (ADR-0078; THC requests 01.10.2026)
--
-- Some clients ask for male staff on a role, some for female staff. The
-- Shift Builder gets a "Staff gender" choice per role section — Any,
-- Male staff only, Female staff only — and auto-assign then books only
-- that gender onto the section.
--
--   1 · shift_requirements.required_gender — null (anyone), 'M' or 'F',
--       HMRC's two values, the same ones staff.gender holds. Null by
--       default, so every section on file reads exactly as before. Not
--       under the §3.2 edit lock (event_edit_lock_guard names the columns
--       it freezes, and this is not one): like the Auto-Assign switch it
--       steers who is invited next, not the shift as booked.
--   2 · auto_assign_candidates() — 20260930110000's body with ONE change:
--       three gates straight after wrong_role, on a section that names a
--       gender only.
--         male_only            an 'M' section, staff.gender = 'F'
--         female_only          an 'F' section, staff.gender = 'M'
--         gender_not_recorded  either, staff.gender is null — a worker who
--                              never reached step 7 (the HMRC checklist),
--                              or was brought across from payroll
--                              (ADR-0076). Not shown to match, so not
--                              booked; the board lists them under
--                              Unavailable so the office can record it
--                              (3 below).
--       The gender is the one HMRC's New Starter record already holds
--       (20260926100100, M or F); nothing new is asked of the worker.
--       Every path that books somebody re-reads this pool, so the one
--       change reaches them all: the hourly rounds and the first round,
--       the 12:05 refills, same-day escalation, invite_worker (manual
--       invites too), accept_invite, apply_to_shift, accept_application,
--       Radar (staff_open_shifts) and the shift-offer pushes and takes.
--       Nothing already standing is withdrawn — setting a gender on a
--       section with others invited leaves their invitations live until
--       they answer (§3.4: auto-assign never withdraws), and Accept then
--       refuses with the gate's name; a confirmed booking is the
--       manager's to withdraw on the event board (§3.6).
--   3 · set_staff_gender() — the office records M or F on /staff/:id for
--       a worker it is missing for, or corrects it. The worker's own
--       answer on step 7 still writes the same column.
--
-- §6's five weights are contractual and untouched: this is a gate, not a
-- factor. Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The column
-- ---------------------------------------------------------------------
alter table shift_requirements
  add column if not exists required_gender text
    constraint shift_requirements_required_gender_m_or_f check (required_gender in ('M', 'F'));

comment on column shift_requirements.required_gender is
  'ADR-0078: the client asked for staff of one gender on this role — M (male staff only) or F (female staff only); null is anyone. auto_assign_candidates() gates everyone whose staff.gender differs (male_only / female_only) or is not on file (gender_not_recorded), so no automatic round, Radar listing, offer or Accept books them. Not under the §3.2 edit lock.';

-- 20261001203000 replaced SELECT on this table with SELECT on every
-- column but the two rates; a column added since needs its own grant
-- (753 asserts the set column by column).
grant select (required_gender) on public.shift_requirements to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2 · auto_assign_candidates — 20260930110000's body but for the three
--     gates marked (ADR-0078). Same signature and columns, so every
--     caller and grant stands.
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
  venue_times    int,
  -- (3) appended 20260930110000: this section's own booking's cause.
  booking_cause  text
) language sql stable
set search_path = public, extensions
as $$
  with sec as (
    select sr.id as shift_id, sr.role_id, sr.starts_at, sr.ends_at, sr.required_gender,
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
      -- ADR-0078: the client asked for staff of one gender on this role.
      -- Straight after wrong_role because, like it, it is what the SECTION
      -- asks for rather than anything about the worker's week.
      when sec.required_gender is not null and s.gender is null              then 'gender_not_recorded'
      when sec.required_gender = 'M' and s.gender <> 'M'                      then 'male_only'
      when sec.required_gender = 'F' and s.gender <> 'F'                      then 'female_only'
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
$$;

comment on function public.auto_assign_candidates(uuid, boolean) is
  'The §3.3/§3.4 pool for one role section, computed fresh: gate, wave, the five §6 factor inputs — reliability is staff_show_rate() (20260928110100), never the stored column — and this section''s own booking (status and, since 20260930110000, cause). Workers only: candidates, rejected applicants, leavers and removed workers have no row (20260930110000). Gates: wrong_role, male_only / female_only / gender_not_recorded (a section with a required_gender, ADR-0078), do_not_return, blocked, self_cancelled, booked_elsewhere (confirmed or worked, 2 h different-venue gap — 20260930110000), rtw_expired (20260924130100), hours_limit (RULE-20), and — only with p_escalation — outside_radius (§3.4 same-day escalation, 20260927140100). Scoring itself is packages/domain/scoring.ts.';

revoke execute on function public.auto_assign_candidates(uuid, boolean) from public, anon;
grant  execute on function public.auto_assign_candidates(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3 · set_staff_gender — the office records it on /staff/:id
--
-- M or F, HMRC's two values and the column's own CHECK
-- (staff_gender_m_or_f); null clears it. A Back Office login that is not
-- read-only. Refused on a removed worker: §1.7 has already wiped it. The
-- audit row names the worker and that it changed, not the value — every
-- office role reads audit_log, and a GDPR removal must not leave the
-- answer behind in it.
-- ---------------------------------------------------------------------
create or replace function public.set_staff_gender(p_staff uuid, p_gender text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_gender  text := nullif(upper(btrim(coalesce(p_gender, ''))), '');
  v_removed timestamptz;
begin
  perform assert_office_caller();
  perform assert_not_read_only();

  v_gender := case v_gender when 'MALE' then 'M' when 'FEMALE' then 'F' else v_gender end;
  if v_gender is not null and v_gender not in ('M', 'F') then
    raise exception 'gender_m_or_f' using errcode = 'P0001';
  end if;

  select s.removed_at into v_removed from staff s where s.id = p_staff for update;
  if not found then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if v_removed is not null then
    raise exception 'staff_removed' using errcode = 'P0001';
  end if;

  update staff set gender = v_gender where id = p_staff;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'staff.gender_set', 'staff', p_staff,
          jsonb_build_object('staffId', p_staff::text));

  return jsonb_build_object('staffId', p_staff::text, 'gender', v_gender);
end $$;

comment on function public.set_staff_gender(uuid, text) is
  'ADR-0078: the office records (or, with null, clears) a worker''s gender — M or F, the HMRC New Starter values — on /staff/:id. Read by auto_assign_candidates() for a role section with a required_gender. Office logins that are not read-only; refused on a removed worker; audited without the value.';

revoke all on function public.set_staff_gender(uuid, text) from public, anon;
grant execute on function public.set_staff_gender(uuid, text) to authenticated, service_role;
