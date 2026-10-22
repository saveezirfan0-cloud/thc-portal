-- =====================================================================
-- Migration 20261024110000 · "Left early" vs "Completed early" (ADR-0185)
--
-- A check-out before the scheduled end raised `left_early`, and a
-- `left_early` blocked RULE-14's four-hour floor for good — for the worker
-- who walked off AND for the one the client sent home. The system could not
-- tell them apart because nothing recorded whether the job was finished.
--
-- Now a `left_early` violation can be RELEASED: the client or the site
-- manager confirmed the job was complete and the worker was told to go. A
-- released one is "Completed early" — the floor applies, pay and charge are
-- the four hours, and it does not count against the worker. An unreleased
-- one is priced exactly as before (to the check-out, no floor): pending
-- while the release window is open (24 h from the violation, a setting),
-- "Left early" once it has closed. Nothing is withdrawn at the window's end
-- — only the client / site-manager sign-off stops being accepted; the office
-- can still override with a note.
--
-- GPS exit without a check-out is case 1 by default. When BG-09 would raise
-- "No check-out" for a booking that has a mid-shift geofence exit, the shift
-- is instead closed at the last on-site fix with a Left early (no floor);
-- the office overrides it with the same release action.
--
--   0 · violations.released_*          who released the worker, how, why
--   1 · settings                       left_early_release_window_h = 24
--   2 · left_early_state()             pending | left_early | completed_early
--   3 · payable_shifts_v, check_out(),
--       staff_shift_detail()           the floor is blocked by an UNRELEASED
--                                      left_early only
--   4 · release_early_finish()         the office records the sign-off
--   5 · settle_geofence_exit()         BEFORE INSERT on violations: the
--                                      GPS-exit-without-check-out default
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0 · The release
-- ---------------------------------------------------------------------
alter table violations
  add column if not exists released_at      timestamptz,
  add column if not exists released_by      uuid references profiles(id),
  add column if not exists release_source   text,
  add column if not exists release_contact  text,
  add column if not exists release_note     text;

alter table violations
  drop constraint if exists violations_release_shape;
alter table violations
  add constraint violations_release_shape check (
    (released_at is null and released_by is null and release_source is null
       and release_contact is null and release_note is null)
    or (type = 'left_early'
        and released_at is not null
        and release_source in ('client', 'site_manager', 'office_override')
        and btrim(coalesce(release_note, '')) <> '')
  );

comment on column violations.released_at is
  'ADR-0185. Set on a left_early when the client or site manager confirmed the job was complete and the worker was released (or the office overrode a walk-off). A released left_early is "Completed early": RULE-14''s floor applies and it does not count against the worker. Null = still Left early (or pending sign-off).';
comment on column violations.release_source is
  'client | site_manager (inside the release window, needs release_contact) | office_override (any time).';

-- ---------------------------------------------------------------------
-- 1 · The window
-- ---------------------------------------------------------------------
insert into settings (key, value)
values ('left_early_release_window_h', '24')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2 · The state, derived — nothing needs a job to flip it
-- ---------------------------------------------------------------------
create or replace function left_early_state(
  p_released_at timestamptz,
  p_detected_at timestamptz,
  p_now         timestamptz default now()
) returns text
language sql stable
set search_path = public, extensions
as $$
  select case
    when p_released_at is not null then 'completed_early'
    when p_now < p_detected_at
                 + make_interval(hours => coalesce(
                     (select (value #>> '{}')::int from settings
                       where key = 'left_early_release_window_h'), 24))
      then 'pending'
    else 'left_early'
  end
$$;

comment on function left_early_state(timestamptz, timestamptz, timestamptz) is
  'ADR-0185: completed_early once released; pending while the release window is open; left_early after. Pay treats pending and left_early alike (no floor) — only a release changes the money.';

grant execute on function left_early_state(timestamptz, timestamptz, timestamptz)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3 · The floor is blocked by an UNRELEASED left_early only
-- ---------------------------------------------------------------------
do $$
declare
  v_def text;
  v_n   int;
begin
  -- payable_shifts_v: the spine of payroll and the invoice (client charge).
  v_def := pg_get_viewdef('public.payable_shifts_v'::regclass);
  v_n := (length(v_def) - length(replace(v_def, 'v.type = ''left_early''::violation_type', '')))
         / length('v.type = ''left_early''::violation_type');
  if v_n <> 1 then
    raise exception '20261024110000: payable_shifts_v - expected one left_early test, found %', v_n;
  end if;
  v_def := replace(v_def, 'v.type = ''left_early''::violation_type',
                          'v.type = ''left_early''::violation_type AND v.released_at IS NULL');
  execute 'create or replace view public.payable_shifts_v with (security_invoker = true) as '
          || rtrim(v_def, ';');

  -- check_out(): the pay it returns to the worker's screen.
  v_def := pg_get_functiondef('public.check_out(uuid,double precision,double precision,double precision)'::regprocedure);
  v_n := (length(v_def) - length(replace(v_def,
          'exists (select 1 from violations where booking_id = b.id and type = ''left_early''),', '')))
         / length('exists (select 1 from violations where booking_id = b.id and type = ''left_early''),');
  if v_n <> 1 then
    raise exception '20261024110000: check_out - expected one pay-side left_early test, found %', v_n;
  end if;
  v_def := replace(v_def,
    'exists (select 1 from violations where booking_id = b.id and type = ''left_early''),',
    'exists (select 1 from violations where booking_id = b.id and type = ''left_early'' and released_at is null),');
  execute v_def;

  -- staff_shift_detail(): "left_early" is the floor blocker the app prices with.
  v_def := pg_get_functiondef('public.staff_shift_detail(uuid)'::regprocedure);
  v_n := (length(v_def) - length(replace(v_def,
          'where v.booking_id = b.id and v.type = ''left_early'')', '')))
         / length('where v.booking_id = b.id and v.type = ''left_early'')');
  if v_n <> 1 then
    raise exception '20261024110000: staff_shift_detail - expected one left_early test, found %', v_n;
  end if;
  v_def := replace(v_def,
    'where v.booking_id = b.id and v.type = ''left_early'')',
    'where v.booking_id = b.id and v.type = ''left_early'' and v.released_at is null)');
  execute v_def;
end $$;

-- ---------------------------------------------------------------------
-- 4 · The office records the sign-off
-- ---------------------------------------------------------------------
create or replace function release_early_finish(
  p_violation uuid,
  p_source    text,
  p_contact   text,
  p_note      text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v          violations;
  v_now      timestamptz := now();
  v_window   int;
  v_exported boolean;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'admins_only' using errcode = '42501';
  end if;
  if p_source not in ('client', 'site_manager', 'office_override') then
    raise exception 'invalid_release_source' using errcode = 'P0001';
  end if;
  if p_note is null or btrim(p_note) = '' then
    raise exception 'note_required' using errcode = 'P0001';
  end if;
  if p_source in ('client', 'site_manager') and btrim(coalesce(p_contact, '')) = '' then
    raise exception 'release_contact_required' using errcode = 'P0001';
  end if;

  select * into v from violations where id = p_violation for update;
  if v.id is null then raise exception 'violation_not_found' using errcode = 'P0002'; end if;
  if v.type <> 'left_early' then
    raise exception 'not_left_early' using errcode = 'P0001';
  end if;
  if v.released_at is not null then
    return jsonb_build_object('decision', 'already_released', 'messageKey', 'already_released');
  end if;

  -- The client / site manager's word counts inside the window; afterwards
  -- the shift has defaulted to a walk-off and only the office overrides it.
  v_window := coalesce((select (value #>> '{}')::int from settings
                         where key = 'left_early_release_window_h'), 24);
  if p_source in ('client', 'site_manager')
     and v_now >= v.detected_at + make_interval(hours => v_window) then
    raise exception 'release_window_closed' using errcode = 'P0001';
  end if;

  v_exported := booking_payroll_exported(v.booking_id);

  update violations
     set released_at     = v_now,
         released_by     = auth.uid(),
         release_source  = p_source,
         release_contact = nullif(btrim(coalesce(p_contact, '')), ''),
         release_note    = btrim(p_note),
         resolved        = true,
         resolved_by     = coalesce(resolved_by, auth.uid()),
         resolved_at     = coalesce(resolved_at, v_now),
         resolution_note = coalesce(resolution_note, 'Completed early: ' || btrim(p_note))
   where id = v.id;

  return jsonb_build_object(
    'decision', 'released',
    'state', 'completed_early',
    -- RULE-06: an export already sent is never corrected; the screen warns.
    'payrollExported', v_exported,
    'messageKey', case when v_exported then 'released_payroll_already_exported' else 'released' end,
    'pay', (select pay from payable_shifts_v where booking_id = v.booking_id));
end $$;

comment on function release_early_finish(uuid, text, text, text) is
  'ADR-0185. The office records that the client / site manager confirmed the job complete and released the worker: the left_early becomes Completed early, RULE-14''s four-hour floor applies to pay and charge, and the entry is closed. client / site_manager need a contact and the release window open (24 h, settings); office_override works any time. Never touches an export already sent — the caller shows the RULE-06 warning.';

revoke execute on function release_early_finish(uuid, text, text, text) from public, anon;
grant  execute on function release_early_finish(uuid, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5 · GPS exit without a check-out: case 1 unless the office overrides
-- ---------------------------------------------------------------------
-- BG-09 (and check_out()'s locked press) insert `no_checkout`. For a worker
-- who left the geofence mid-shift and never checked out, that would park the
-- shift until a manager types a finish — and resolving it would hand back the
-- four-hour floor. Instead the shift closes at the last on-site fix and a
-- Left early takes the place of the No check-out (no floor). A stale-fix
-- review (a finish is already recorded) is not touched.
create or replace function settle_geofence_exit()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  cl check_logs;
begin
  select * into cl from check_logs
   where booking_id = new.booking_id and check_in_at is not null
   order by check_in_at limit 1 for update;

  if cl.id is null
     or cl.check_out_at is not null
     or cl.manager_finish_at is not null
     or cl.last_on_site_at is null
     or cl.last_on_site_at <= cl.check_in_at
     or not exists (select 1 from violations v
                     where v.booking_id = new.booking_id
                       and v.type = 'left_geofence'
                       and v.detected_at >= cl.check_in_at) then
    return new;
  end if;

  update check_logs
     set check_out_at = cl.last_on_site_at,
         manager_finish_at = cl.last_on_site_at,
         check_out_on_site = false
   where id = cl.id;

  insert into violations (staff_id, booking_id, type, detected_at)
  values (new.staff_id, new.booking_id, 'left_early', new.detected_at)
  on conflict do nothing;

  return null;   -- no "No check-out": the GPS exit is the finish
end $$;

revoke execute on function settle_geofence_exit() from public, anon, authenticated;

drop trigger if exists violations_settle_geofence_exit on violations;
create trigger violations_settle_geofence_exit
  before insert on violations
  for each row when (new.type = 'no_checkout')
  execute function settle_geofence_exit();

comment on function settle_geofence_exit() is
  'ADR-0185. A No check-out for a booking with a mid-shift geofence exit becomes: shift closed at the last on-site fix + a Left early (no four-hour floor). The office overrides with release_early_finish(). Returns NULL, so the No check-out row is never written.';
