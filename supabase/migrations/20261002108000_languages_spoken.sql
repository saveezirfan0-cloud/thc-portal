-- =====================================================================
-- Migration 20261002108000 · Languages spoken — asked at onboarding, and
--   an event that needs more than English (ADR-0080; THC request 01.10.2026)
--
-- "Please can a 'languages spoken' field also capture what languages the
-- candidate speaks at point of onboarding — can this also be an option at
-- event level — default for English but the option to select other
-- languages if required."
--
--   1 · known_languages() — the one list both columns are checked against,
--       mirrored by LANGUAGES in packages/domain languages.ts (pgTAP 768
--       pins the two together). English first, the rest A → Z. Adding a
--       language is a migration that restates this function.
--   2 · staff.languages — every language the worker speaks, English
--       always among them; null = never asked (everyone onboarded before
--       this, and staff brought across from payroll, ADR-0076). Asked on
--       onboarding step 2 (staff_save_languages, 4 below) and recorded or
--       corrected by the office on /staff/:id (set_staff_languages, 5).
--       Wiped on GDPR removal with the other report fields (7).
--   3 · events.required_languages — default {English}, so every event on
--       file, and every new one nobody changes, reads exactly as before.
--       English is always in it (CHECK): it is the base every THC worker
--       has. Event level, as asked: every role section of the event needs
--       the same speakers. Not under the §3.2 edit lock
--       (event_edit_lock_guard names the columns it freezes, and this is
--       not one): like the Auto-Assign switch it steers who is invited
--       next, not the event as booked.
--   4 · staff_save_languages() — the worker's own write, from step 2.
--   5 · set_staff_languages() — the office's, audited without the value.
--   6 · auto_assign_candidates() — 20261002107000's body with ONE change:
--       two gates straight after the gender gates, on an event that names
--       a language besides English only. A worker must speak EVERY one it
--       names.
--         languages_not_recorded  staff.languages is null — not shown to
--                                 speak it, so not booked; the board lists
--                                 them under Unavailable so the office can
--                                 record it.
--         language_not_spoken     on file, and one of the languages is not
--                                 among them — no row on the board, like
--                                 the other gender (ADR-0079).
--       Every path that books somebody re-reads this pool, so the one
--       change reaches them all: the hourly and first rounds, the 12:05
--       refills, same-day escalation, invite_worker (manual invites too),
--       accept_invite, apply_to_shift, accept_application, Radar
--       (staff_open_shifts) and the shift-offer pushes and takes. Nothing
--       already standing is withdrawn (§3.4).
--   7 · take_offered_shift() — 20261002107000's body with ONE change: the
--       two gates refuse by name instead of folding into not_bookable.
--   8 · staff_wipe_report_fields() — also nulls staff.languages (§1.7).
--
-- §6's five weights are contractual and untouched: this is a gate, not a
-- factor. Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The list
-- ---------------------------------------------------------------------
create or replace function public.known_languages()
returns text[]
language sql immutable parallel safe
set search_path = public
as $$
  select array[
    'English',
    'Albanian',
    'Arabic',
    'Bengali',
    'British Sign Language',
    'Bulgarian',
    'Cantonese',
    'Croatian',
    'Czech',
    'Danish',
    'Dutch',
    'Farsi',
    'Finnish',
    'French',
    'German',
    'Greek',
    'Gujarati',
    'Hebrew',
    'Hindi',
    'Hungarian',
    'Igbo',
    'Italian',
    'Japanese',
    'Korean',
    'Kurdish',
    'Latvian',
    'Lithuanian',
    'Malay',
    'Mandarin',
    'Nepali',
    'Norwegian',
    'Pashto',
    'Polish',
    'Portuguese',
    'Punjabi',
    'Romanian',
    'Russian',
    'Serbian',
    'Sinhala',
    'Slovak',
    'Somali',
    'Spanish',
    'Swahili',
    'Swedish',
    'Tagalog',
    'Tamil',
    'Thai',
    'Turkish',
    'Twi',
    'Ukrainian',
    'Urdu',
    'Vietnamese',
    'Welsh',
    'Yoruba'
  ]::text[]
$$;

comment on function public.known_languages() is
  'ADR-0080: every language staff.languages and events.required_languages may name — English first, then A → Z. Mirrored by LANGUAGES in packages/domain languages.ts.';

grant execute on function public.known_languages() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2 · staff.languages
-- ---------------------------------------------------------------------
alter table staff
  add column if not exists languages text[]
    constraint staff_languages_known check (
      languages is null
      or (languages <@ known_languages() and 'English' = any(languages))
    );

comment on column staff.languages is
  'ADR-0080: every language the worker speaks, English always among them (known_languages()). Given on onboarding step 2 (staff_save_languages) or recorded by the office (set_staff_languages); null = never asked. Read by auto_assign_candidates() for an event whose required_languages name one besides English. Nulled on GDPR removal (staff_wipe_report_fields).';

-- 20260923220000 replaced SELECT on staff with SELECT on a named column
-- list; a column added since needs its own grant (as home_location_stale
-- and visa_weekly_hour_limit did). RLS still decides the rows: a worker
-- reads their own, the office everyone's.
grant select (languages) on table public.staff to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3 · events.required_languages
-- ---------------------------------------------------------------------
alter table events
  add column if not exists required_languages text[] not null default array['English']::text[]
    constraint events_required_languages_known check (
      required_languages <@ known_languages() and 'English' = any(required_languages)
    );

comment on column events.required_languages is
  'ADR-0080: the languages staff on this event must speak. Always includes English, the default and the base every worker has; any other language named here gates auto_assign_candidates() (languages_not_recorded / language_not_spoken), so no automatic round, Radar listing, offer or Accept books someone not shown to speak it. Not under the §3.2 edit lock.';

-- ---------------------------------------------------------------------
-- 4 · staff_save_languages — the worker, on onboarding step 2
--
-- Any worker who is not removed, left or rejected writes their own row,
-- so a later Profile screen can reuse it. Duplicates and order are
-- normalised away; English is added if missing (it is the base, and the
-- step draws it ticked and fixed); anything not on the list is refused.
-- ---------------------------------------------------------------------
create or replace function public.normalise_languages(p_languages text[])
returns text[]
language plpgsql immutable
set search_path = public
as $$
declare
  v_in    text[] := array(select btrim(l) from unnest(coalesce(p_languages, '{}'::text[])) l
                           where btrim(l) <> '');
  v_known text[] := known_languages();
begin
  if not (v_in <@ v_known) then
    raise exception 'unknown_language' using errcode = 'P0001';
  end if;
  -- Kept in known_languages() order: English first, then A → Z.
  return array(select k from unnest(v_known) with ordinality as x(k, n)
                where k = 'English' or k = any(v_in) order by n);
end $$;

comment on function public.normalise_languages(text[]) is
  'ADR-0080: a language list as it is stored — known languages only (unknown_language otherwise), English always in, no duplicates, in known_languages() order.';

revoke all on function public.normalise_languages(text[]) from public, anon;
grant execute on function public.normalise_languages(text[]) to authenticated, service_role;

create or replace function public.staff_save_languages(p_languages text[])
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_me     uuid := staff_caller();
  v_status staff_status;
  v_list   text[];
begin
  if v_me is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  select s.status into v_status from staff s where s.id = v_me for update;
  if v_status = 'removed' then
    raise exception 'account_closed' using errcode = 'P0001';
  end if;
  if v_status in ('inactive', 'rejected') then
    raise exception 'not_editable' using errcode = 'P0001';
  end if;

  v_list := normalise_languages(p_languages);
  update staff set languages = v_list where id = v_me;
  return jsonb_build_object('languages', to_jsonb(v_list));
end $$;

comment on function public.staff_save_languages(text[]) is
  'ADR-0080: the signed-in worker records the languages they speak (onboarding step 2). English always included; unknown_language for anything off known_languages(); account_closed / not_editable for a removed, left or rejected account.';

revoke all on function public.staff_save_languages(text[]) from public, anon;
grant execute on function public.staff_save_languages(text[]) to authenticated;

-- ---------------------------------------------------------------------
-- 5 · set_staff_languages — the office, on /staff/:id
--
-- Any Back Office login that is not read-only. Null clears it (back to
-- "never asked"). Refused on a removed worker. The audit row names the
-- worker, not the languages: every office role reads audit_log, and a
-- GDPR removal must not leave the answer behind in it (as ADR-0079).
-- ---------------------------------------------------------------------
create or replace function public.set_staff_languages(p_staff uuid, p_languages text[])
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_list    text[];
  v_removed timestamptz;
begin
  perform assert_office_caller();
  perform assert_not_read_only();

  v_list := case when p_languages is null then null else normalise_languages(p_languages) end;

  select s.removed_at into v_removed from staff s where s.id = p_staff for update;
  if not found then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if v_removed is not null then
    raise exception 'staff_removed' using errcode = 'P0001';
  end if;

  update staff set languages = v_list where id = p_staff;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'staff.languages_set', 'staff', p_staff,
          jsonb_build_object('staffId', p_staff::text));

  return jsonb_build_object('staffId', p_staff::text, 'languages', to_jsonb(v_list));
end $$;

comment on function public.set_staff_languages(uuid, text[]) is
  'ADR-0080: the office records (or, with null, clears) the languages a worker speaks on /staff/:id. Read by auto_assign_candidates() for an event with required_languages beyond English. Office logins that are not read-only; refused on a removed worker; audited without the value.';

revoke all on function public.set_staff_languages(uuid, text[]) from public, anon;
grant execute on function public.set_staff_languages(uuid, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6 · auto_assign_candidates — 20261002107000's body but for the two
--     gates marked (ADR-0080). Same signature and columns, so every
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
$$;

comment on function public.auto_assign_candidates(uuid, boolean) is
  'The §3.3/§3.4 pool for one role section, computed fresh: gate, wave, the five §6 factor inputs — reliability is staff_show_rate() (20260928110100), never the stored column — and this section''s own booking (status and, since 20260930110000, cause). Workers only: candidates, rejected applicants, leavers and removed workers have no row (20260930110000). Gates: wrong_role, male_only / female_only / gender_not_recorded (a section with a required_gender, ADR-0079), languages_not_recorded / language_not_spoken (an event whose required_languages name one besides English, ADR-0080), do_not_return, blocked, self_cancelled, booked_elsewhere (confirmed or worked, 2 h different-venue gap — 20260930110000), rtw_expired (20260924130100), hours_limit (RULE-20), and — only with p_escalation — outside_radius (§3.4 same-day escalation, 20260927140100). Scoring itself is packages/domain/scoring.ts.';

revoke execute on function public.auto_assign_candidates(uuid, boolean) from public, anon;
grant  execute on function public.auto_assign_candidates(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7 · take_offered_shift — 20261002107000's body but for the two gates
--     passed through by name (ADR-0080). Same signature; grants stand.
-- ---------------------------------------------------------------------
create or replace function public.take_offered_shift(p_offer uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_me        uuid := staff_caller();
  v_status    staff_status;
  o           shift_offers;
  sr          shift_requirements;
  ev          events;
  orig        bookings;
  mine        bookings;
  v_gate      text;
  v_qualified boolean;
  v_direct    boolean;
  v_gap       int := booked_elsewhere_gap_minutes();
  v_taker     uuid;
  v_withdrawn int := 0;
begin
  if v_me is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  select s.status into v_status from staff s where s.id = v_me;
  if v_status = 'removed' then
    raise exception 'account_closed' using errcode = 'P0001';
  end if;
  if v_status in ('inactive', 'rejected') then
    raise exception 'not_editable' using errcode = 'P0001';
  end if;

  -- Unlocked: only to learn the section and the booking. Both are
  -- immutable on an offer (shift_offers_state_guard), so the ids read here
  -- are the ids under the locks below.
  select * into o from shift_offers where id = p_offer;
  if o.id is null then
    -- Unknown and not-open read the same: an id says nothing about anybody.
    return jsonb_build_object('ok', false, 'reason', 'offer_not_open');
  end if;

  -- The same lock invite_worker, accept_invite and accept_application take,
  -- so every path to this slot queues on one row. Then the offerer's
  -- booking BEFORE the offer: every other exit from confirmed holds the
  -- booking and then lapses the offer (bookings_offer_lapse), so taking
  -- them the other way round could deadlock. The offer is re-read under
  -- its own lock, as it is now.
  select * into sr from shift_requirements where id = o.shift_id for update;
  select * into orig from bookings where id = o.booking_id for update;
  select * into o from shift_offers where id = p_offer for update;
  select * into ev from events where id = sr.event_id;
  v_direct := coalesce((select s.value = 'true'::jsonb from settings s
                         where s.key = 'shift_offers_direct_enabled'), false);

  -- takeOffer()'s order (shiftOffer.vectors.json).
  if ev.cancelled_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'event_cancelled');
  end if;
  if o.status <> 'open'
     or o.mode = 'office'
     or (o.mode = 'direct' and not (v_direct and o.target_staff_id = v_me)) then
    return jsonb_build_object('ok', false, 'reason', 'offer_not_open');
  end if;
  if now() >= o.expires_at then
    return jsonb_build_object('ok', false, 'reason', 'offer_expired');
  end if;
  if orig.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'reason', 'original_not_confirmed');
  end if;
  if o.offered_by_staff_id = v_me then
    return jsonb_build_object('ok', false, 'reason', 'own_offer');
  end if;
  if now() >= sr.starts_at then
    return jsonb_build_object('ok', false, 'reason', 'section_started');
  end if;

  -- Every hard gate the pool applies, by name. The calendar is not one of
  -- them for a take (ADR-0043): the worker has changed their mind.
  select c.gate, c.qualified into v_gate, v_qualified
    from auto_assign_candidates(sr.id) c
   where c.staff_id = v_me;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_bookable');
  end if;
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'reason',
      case v_gate
        when 'booked_elsewhere' then 'overlap'
        when 'wrong_role' then v_gate
        -- ADR-0079: a gender-only section, by name (20261002107000).
        when 'male_only' then v_gate
        when 'female_only' then v_gate
        when 'gender_not_recorded' then v_gate
        -- ADR-0080: an event that needs another language, by name.
        when 'language_not_spoken' then v_gate
        when 'languages_not_recorded' then v_gate
        when 'do_not_return' then v_gate
        when 'blocked' then v_gate
        when 'self_cancelled' then v_gate
        when 'rtw_expired' then v_gate
        when 'hours_limit' then v_gate
        else 'not_bookable'
      end);
  end if;

  -- accept_invite()'s own re-reads, kept literally from its latest body
  -- (main's 20260930110000, D2): the overlap with the 2 h different-venue
  -- gap against confirmed OR worked bookings — a shift the worker has
  -- already checked in to is at least as confirmed — then RULE-20 with the
  -- right-to-work stop told apart.
  if exists (
    select 1 from bookings x
      join shift_requirements sr2 on sr2.id = x.shift_id
      join events ev2 on ev2.id = sr2.event_id
     where x.staff_id = v_me and x.status in ('confirmed', 'worked') and x.shift_id <> sr.id
       and booked_elsewhere_conflict(sr.starts_at, sr.ends_at, ev.venue_id,
                                     sr2.starts_at, sr2.ends_at, ev2.venue_id, v_gap) <> 'clear'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'overlap');
  end if;
  if weekly_cap_would_breach(v_me, sr.id) then
    if not (can_roster_staff(v_me, (sr.starts_at at time zone 'Europe/London')::date)
            and can_roster_staff(v_me, ((sr.ends_at - interval '1 second')
                                        at time zone 'Europe/London')::date)) then
      return jsonb_build_object('ok', false, 'reason', 'rtw_expired');
    end if;
    return jsonb_build_object('ok', false, 'reason', 'hours_limit');
  end if;

  select * into mine from bookings where shift_id = sr.id and staff_id = v_me for update;
  if mine.id is not null and mine.status in ('confirmed', 'worked', 'turned_away', 'cancelled') then
    return jsonb_build_object('ok', false, 'reason', 'already_had_booking');
  end if;

  -- RULE-17: qualified at this client and role first, fully — which, with
  -- auto-assign off, offer_wave1_exhausted() counts as done at once.
  if not v_qualified and o.mode = 'pool' and not offer_wave1_exhausted(o.id) then
    return jsonb_build_object('ok', false, 'reason', 'not_yet');
  end if;

  -- The hand-over. The taker is confirmed first, then the offer is taken,
  -- then the original is released — so bookings_offer_lapse finds no open
  -- offer to lapse, and at no point is the slot empty.
  if mine.id is null then
    insert into bookings (shift_id, staff_id, status, source, confirmed_at)
    values (sr.id, v_me, 'confirmed', 'offer', now())
    returning id into v_taker;
  else
    if mine.status = 'closed' then
      -- §3.6: a dead offer comes back through `applied` (closed → applied).
      update bookings
         set status = 'applied', applied_at = coalesce(applied_at, now()),
             cancelled_at = null, cancel_cause = null
       where id = mine.id;
    end if;
    update bookings
       set status = 'confirmed', source = 'offer', confirmed_at = now(),
           cancelled_at = null, cancel_cause = null
     where id = mine.id;
    v_taker := mine.id;
  end if;

  update shift_offers
     set status = 'taken', taken_by_booking_id = v_taker, taken_by_staff_id = v_me,
         closed_reason = 'taken'
   where id = o.id;

  -- RULE-04 / Q15: a completed hand-over bars the offerer from the event.
  update bookings
     set status = 'cancelled', cancelled_at = now(),
         cancel_cause = 'handed_over', self_cancelled = true
   where id = orig.id;

  -- §3.4, as on Accept: the taker's other intersecting invitations go.
  with overlapping as (
    update bookings x set status = 'cancelled', cancelled_at = now(),
                          cancel_cause = 'overlap_auto_withdraw'
      from shift_requirements sr3
     where sr3.id = x.shift_id
       and x.staff_id = v_me and x.status = 'invited' and x.id <> v_taker
       and sr.starts_at < sr3.ends_at and sr3.starts_at < sr.ends_at
    returning x.id
  ) select count(*)::int into v_withdrawn from overlapping;

  perform queue_offer_notice('OF2', o.id);
  perform queue_offer_notice('OF4', o.id);

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'shift_offer.taken', 'shift_offer', o.id,
          jsonb_build_object('shiftId', sr.id,
                             'fromStaffId', o.offered_by_staff_id, 'fromBookingId', orig.id,
                             'toStaffId', v_me, 'toBookingId', v_taker));

  return jsonb_build_object('ok', true, 'bookingId', v_taker, 'withdrawn', v_withdrawn);
end $$;

comment on function public.take_offered_shift(uuid) is
  'ADR-0046: one transaction; locks section → offerer''s booking → offer (the order every other exit from confirmed takes). Caller by staff_caller(): unknown_staff / account_closed / not_editable raise P0001. Refuses, in takeOffer()''s order: event_cancelled › offer_not_open › offer_expired › original_not_confirmed › own_offer › section_started › the pool gate by name (booked_elsewhere → overlap; male_only / female_only / gender_not_recorded by name since 20261002107000, ADR-0079; language_not_spoken / languages_not_recorded by name since 20261002108000, ADR-0080; no row → not_bookable) and accept_invite''s overlap / cap re-reads › already_had_booking › not_yet (RULE-17; none with auto-assign off). Then the taker is confirmed (source offer), the offer taken, the original cancelled / handed_over / self_cancelled, the taker''s overlapping invitations withdrawn, OF2 + OF4 queued. Confirmed count net zero. Never refused for the calendar (ADR-0043).';

revoke execute on function public.take_offered_shift(uuid) from public, anon;
grant  execute on function public.take_offered_shift(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8 · A GDPR removal wipes the languages with the other report fields
-- ---------------------------------------------------------------------
create or replace function public.staff_wipe_report_fields() returns trigger
language plpgsql set search_path = public, extensions as $$
begin
  if new.removed_at is not null and old.removed_at is null then
    new.gender := null;
    new.home_postcode := null;
    new.home_country := null;
    -- ADR-0080.
    new.languages := null;
  end if;
  return new;
end $$;
