-- =====================================================================
-- Staff App audit fixes, 27.09 — Radar's week meter and map, and the
-- worker's read path onto criminal_declarations (§10.4, §10.7, ADR-0031)
--
-- Four things, all on the Staff App's side of the database:
--
--   1. staff_week_meter()      the header strip on Radar — "This week
--                              (Mon 14 – Sun 20) · 8 h of 20 h". The app
--                              was reading the soonest open shift's week,
--                              which is not this week for a worker whose
--                              next open shift is next Tuesday. The strip
--                              now asks for the CURRENT Mon–Sun week in
--                              Europe/London, through the same helpers the
--                              per-row figures use (weekly_booked_hours,
--                              weekly_cap_hours), so the strip and the
--                              cards cannot disagree about a cap.
--
--   2. staff_open_shifts()     five columns APPENDED for the detail's map
--                              (wireframes/staff/radar.html, ADR-0005):
--                              the venue pin, its geofence radius and the
--                              worker's home pin. Nothing else moves —
--                              the body is 20260922140000's — so
--                              300_staff_app_screens' column-by-name
--                              assertions hold. Return type changes need
--                              drop + create; the grants are restated.
--
--   3. queue_contact_change() E7's outbox key was 'E7:staff:<id>:<epoch
--                              second>', so a worker who changed their
--                              address and then confirmed a new email
--                              inside the same second had the second E7
--                              swallowed by `on conflict (key) do nothing`.
--                              330's new email assertions found it: the
--                              address E7 and the email E7 are queued in
--                              one transaction there. The key now names
--                              WHAT changed as well, which is what makes
--                              two E7s two events rather than a retry.
--
--   4. staff_self_decl         DROPPED. §10.7: "the details the worker
--                              typed are never displayed back to them on
--                              a shared screen". Every worker-facing read
--                              of a declaration is already a definer RPC
--                              that withholds `details` and
--                              `conviction_date` (staff_documents(),
--                              onboarding_state()), and every worker write
--                              is one too (declare_my_conviction,
--                              onboarding_submit_documents). The one path
--                              left was the row policy from 0001, which
--                              let the same session read the text back
--                              with GET /rest/v1/criminal_declarations?
--                              select=details. A column grant was the
--                              other way to close it and was rejected
--                              (ADR-0031): admin and worker are the same
--                              Postgres role, compliance_review_queue_v is
--                              security_invoker and selects c.details, and
--                              /staff/:id and /onboarding/:id read the
--                              column through the session client — so a
--                              column revoke from `authenticated` takes
--                              the office's Needs review queue down with
--                              it. Removing the WORKER's row policy takes
--                              nothing from the office (admin_all) and
--                              nothing from the app.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The current UK week's figures, for the Radar strip (§10.4)
-- ---------------------------------------------------------------------
create or replace function public.staff_week_meter(p_staff uuid default null)
returns jsonb
language sql stable security definer
set search_path = public, extensions
as $$
  with me as (select staff_caller(p_staff) as id),
       today as (select (now() at time zone 'Europe/London')::date as d)
  select case when me.id is null then null else jsonb_build_object(
    'weekStart',   cap_week_start(t.d),
    'weekEnd',     cap_week_start(t.d) + 6,
    'bookedHours', weekly_booked_hours(me.id, t.d),
    'capHours',    weekly_cap_hours(me.id, t.d),
    'roles',       coalesce((select jsonb_agg(r.name order by r.name)
                               from staff_roles sr join roles r on r.id = sr.role_id
                              where sr.staff_id = me.id), '[]'::jsonb)) end
  from me, today t
$$;

comment on function public.staff_week_meter(uuid) is
  'Radar''s header strip (§10.4, RULE-20): the CURRENT Mon–Sun week in Europe/London — its Monday and Sunday, the hours already confirmed/worked/closed in it, the calculated cap (null = no ceiling) and the worker''s roles. Same helpers as the per-row figures in staff_bookings()/staff_open_shifts().';

revoke execute on function public.staff_week_meter(uuid) from public, anon;
grant  execute on function public.staff_week_meter(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2 · staff_open_shifts(): the map's inputs, appended
-- ---------------------------------------------------------------------
drop function if exists public.staff_open_shifts(uuid);

create function public.staff_open_shifts(p_staff uuid default null)
returns table (
  shift_id        uuid,
  event_id        uuid,
  event_title     text,
  event_date      date,
  role            text,
  starts_at       timestamptz,
  ends_at         timestamptz,
  pay_rate        numeric,
  dress_code      text,
  venue_name      text,
  venue_address   text,
  distance_km     numeric,
  headcount       int,
  buffer          int,
  confirmed_count int,
  qualified       boolean,
  hours_limit     boolean,
  applied_at      timestamptz,
  week_start      date,
  booked_hours    numeric,
  cap_hours       numeric,
  -- Appended 27.09 for the detail's map (ADR-0005): the venue pin and its
  -- geofence, and the worker's home pin (null until an address is pinned).
  venue_lat         double precision,
  venue_lng         double precision,
  geofence_radius_m int,
  home_lat          double precision,
  home_lng          double precision
) language sql stable security definer
set search_path = public, extensions as $$
  with me as (select staff_caller(p_staff) as id)
  select
    sr.id, ev.id, ev.title, ev.event_date, r.name, sr.starts_at, sr.ends_at,
    sr.pay_rate, sr.dress_code, ev.venue_name, ev.venue_address,
    round((st_distance(s.home_location, ev.venue_location) / 1000.0)::numeric, 1),
    sr.headcount, sr.buffer, f.confirmed,
    c.my_qualified,
    coalesce(c.my_gate = 'hours_limit', false),
    (select o.applied_at from bookings o
      where o.shift_id = sr.id and o.staff_id = me.id and o.status = 'applied'),
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
    join shift_requirements sr on sr.starts_at > now()
    join events ev             on ev.id = sr.event_id and ev.cancelled_at is null
    join roles r               on r.id = sr.role_id
    cross join lateral shift_fill(sr.id) f
    -- ONE pass over the section's candidates, answering both questions.
    -- Asking auto_assign_candidates for this worker's row and then calling
    -- radar_wave1_exhausted() scanned every worker in the agency twice per
    -- section, on a phone-facing screen.
    cross join lateral (
      select
        count(*) filter (where a.staff_id = me.id) > 0        as me_present,
        min(a.gate)           filter (where a.staff_id = me.id) as my_gate,
        bool_or(a.qualified)  filter (where a.staff_id = me.id) as my_qualified,
        min(a.booking_status) filter (where a.staff_id = me.id) as my_status,
        -- RULE-17: is anyone qualified at this client and role still
        -- reachable? A worker not in that set waits for it to empty.
        bool_or(a.gate is null and a.qualified and a.booking_status is null) as wave1_alive
      from auto_assign_candidates(sr.id) a
    ) c
  where f.confirmed < sr.headcount
    and c.me_present
    and (c.my_gate is null or c.my_gate = 'hours_limit')
    and (c.my_qualified or not c.wave1_alive)
    -- Already invited or confirmed here: that lives on Invites or My
    -- shifts. `applied` stays, because §10.4 keeps it visible under its own
    -- section until it resolves. `closed` — declined, withdrawn, or a slot
    -- that went to somebody else — is NOT a booking: the row survives only
    -- because (shift_id, staff_id) is unique, and treating it as one is
    -- what silently barred a worker from a shift they declined.
    and (c.my_status is null or c.my_status in ('applied', 'closed'))
  order by c.my_qualified desc,
           round((st_distance(s.home_location, ev.venue_location) / 1000.0)::numeric, 1),
           sr.starts_at
$$;

comment on function public.staff_open_shifts(uuid) is
  'Radar and the Shifts tab''s Open shifts (§10.4): open sections for the worker''s own roles, qualified clients first (RULE-17), closest first, with the RULE-20 cap state per row and, from 27.09, the venue and home pins for the detail''s map (ADR-0005).';

revoke execute on function public.staff_open_shifts(uuid) from public, anon;
grant  execute on function public.staff_open_shifts(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3 · E7's key says what changed (§8, §10.1)
-- ---------------------------------------------------------------------
create or replace function public.queue_contact_change(p_staff uuid, p_what text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare s staff;
begin
  select * into s from staff where id = p_staff;
  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values ('E7:staff:' || p_staff || ':' || replace(p_what, ' ', '_') || ':'
            || extract(epoch from clock_timestamp())::bigint,
          'email', 'E7',
          array['admin@thehospitalitycompany.co.uk', 'thc_payroll@topsourceworldwide.com'],
          jsonb_build_object(
            'name',       s.first_name || ' ' || s.last_name,
            'employeeId', coalesce(s.employee_id::text, '(not yet issued)'),
            'changedAt',  to_char(now() at time zone 'Europe/London', 'DD Mon YYYY HH24:MI'),
            'changed',    p_what))
  on conflict (key) do nothing;
end $$;

comment on function public.queue_contact_change(uuid, text) is
  '§8 E7: queues the office/payroll notice that a worker''s email address or home address changed. Called only by staff_update_contact()/staff_update_contact_geocoded() and staff_sync_email(); the key carries the detail changed so two changes in one second are two sends.';

-- ---------------------------------------------------------------------
-- 4 · The worker's direct read of criminal_declarations goes (§10.7)
--
-- Reads stay where the app already makes them: staff_documents() and
-- onboarding_state() (definer, withhold details/conviction_date);
-- 430:159/299 pin what they omit. The office keeps admin_all. RLS stays
-- enabled, so with no worker policy the table is deny-all for a worker,
-- which 001_rls_guard and 030_rls_staff now assert.
-- ---------------------------------------------------------------------
drop policy if exists staff_self_decl on public.criminal_declarations;

comment on table public.criminal_declarations is
  'Criminal-conviction declarations, onboarding and in-employment (§2.3, §10.7). History, never edited (§1.5). Office reads through admin_all; a worker has NO direct policy since 20260928110500 — every worker-facing read is a definer RPC that withholds details and conviction_date (ADR-0031).';
