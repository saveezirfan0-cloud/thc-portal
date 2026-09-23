-- =====================================================================
-- The rota guard (completion letter requirement §4, acceptance criteria
-- 1, 4 and 6)
--
-- "Rota/scheduling engine must warn (or block, configurable) when a shift
-- assignment would breach the worker's current cap."
--
-- What is configurable, and what is not
-- -------------------------------------
-- The requirement's own §3 table has three kinds of limit, and only one of
-- them is THC's to relax:
--
--   · Right to work expired / not valid for the shift   → ALWAYS block
--     ("0 — block from rota · Hard stop"; acceptance criterion 6).
--   · The Student visa condition, 20 h (10 h below degree) in term
--                                                        → ALWAYS block.
--     It is an immigration condition, the exposure is a civil penalty for
--     illegal working, and acceptance criterion 1 says "cannot be
--     rostered", not "is warned".
--   · The Working Time 48 h (no opt-out on file)         → the setting.
--     `rota_guard_mode` = 'block' (default, and the requirement's own
--     §2.3 reading: "treat 48 hours/week as the hard cap unless an opt-out
--     is on file") or 'warn': the assignment goes ahead and the breach is
--     recorded in audit_log for the office (rota_guard.warned).
--
-- Where it is enforced
-- --------------------
-- Twice, deliberately:
--
--   1. weekly_cap_would_breach() — the gate auto-assign, invite_worker,
--      accept_invite and the Radar already call — now asks
--      rota_guard_verdict(), so the paths that exist return their usual
--      `hours_limit` refusal and nothing about them changes in block mode.
--   2. A BEFORE trigger on bookings, on the transition INTO `confirmed`.
--      That is what "rostered" means (weekly_booked_hours counts confirmed
--      work), and a trigger is the only thing that holds for a path that
--      does not call the gate: the office writing bookings directly under
--      admin_all, the approve-a-Radar-application screen B3 has not built
--      yet, a bulk fix in psql. "Cannot be rostered past 20 h through the
--      UI" has to mean through ANY UI, including the next one.
--
-- The shift's END decides the right-to-work stop, not its start: a shift
-- starting at 23:00 on the last valid day and ending at 03:00 is three
-- hours worked past the expiry (can_roster() is inclusive of the day).
--
-- A past shift is not rostering, so the trigger ignores a confirmation on
-- a shift that has already ended (history, corrections).
-- =====================================================================

insert into settings (key, value) values ('rota_guard_mode', '"block"')
on conflict (key) do nothing;

create or replace function public.rota_guard_mode()
returns text
language sql
stable
security definer
set search_path = public, extensions
as $$
  -- Anything other than an explicit 'warn' is 'block': a deleted or
  -- mistyped setting must fail closed.
  select case when (select s.value #>> '{}' from settings s where s.key = 'rota_guard_mode') = 'warn'
              then 'warn' else 'block' end
$$;

comment on function public.rota_guard_mode() is
  'The configurable half of the rota guard: warn or block on a Working Time 48 h breach. Anything but an explicit ''warn'' reads as block. Never applies to a Student visa limit or a right-to-work expiry.';

-- ---------------------------------------------------------------------
-- The decision, as a pure function of six facts. Held to
-- packages/domain/src/rotaGuard.vectors.json case for case, against
-- rotaGuardVerdict() in packages/domain/src/rotaGuard.ts.
-- ---------------------------------------------------------------------
create or replace function public.rota_guard_decide(
  p_can_roster  boolean,
  p_cap_hours   int,
  p_band        cap_band,
  p_booked      numeric,
  p_shift_hours numeric,
  p_mode        text
) returns table (verdict text, reason text)
language sql
immutable
set search_path = public, extensions
as $$
  with f as (
    select not coalesce(p_can_roster, false)                              as rtw_stop,
           p_cap_hours is not null
             and p_shift_hours > greatest(0::numeric, p_cap_hours - coalesce(p_booked, 0))
                                                                          as over,
           p_band in ('student_term_20', 'student_term_10', 'visa_expired_0') as visa_band
  )
  select case when f.rtw_stop then 'block'
              when not f.over then 'ok'
              when f.visa_band then 'block'
              when p_mode = 'warn' then 'warn'
              else 'block' end,
         case when f.rtw_stop then 'rtw_expired'
              when not f.over then null
              when f.visa_band then 'visa_cap'
              else 'wtr_cap' end
    from f
$$;

comment on function public.rota_guard_decide(boolean, int, cap_band, numeric, numeric, text) is
  'The rota guard decision: right-to-work stop → block; within the cap → ok; over a Student visa band → block; over a Working Time 48 → the configured mode. Mirrors rotaGuardVerdict() in packages/domain/src/rotaGuard.ts, held to rotaGuard.vectors.json.';

-- ---------------------------------------------------------------------
-- The decision for a real worker and shift. Invoker rights, like the rest
-- of the cap family: what the caller cannot see, it gets no verdict for.
-- ---------------------------------------------------------------------
create or replace function public.rota_guard_verdict(p_staff uuid, p_shift uuid)
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  select jsonb_build_object(
           'verdict',     g.verdict,
           'reason',      g.reason,
           'capHours',    c.cap_hours,
           'band',        c.band::text,
           'bookedHours', x.booked,
           'shiftHours',  x.hours,
           'shiftDate',   x.starts_on,
           'mode',        x.mode)
    from shift_requirements sr
    cross join lateral (
      select (sr.starts_at at time zone 'Europe/London')::date                          as starts_on,
             ((sr.ends_at - interval '1 second') at time zone 'Europe/London')::date    as ends_on,
             round((extract(epoch from (sr.ends_at - sr.starts_at)) / 3600.0)::numeric, 2) as hours,
             weekly_booked_hours(p_staff, (sr.starts_at at time zone 'Europe/London')::date) as booked,
             rota_guard_mode()                                                          as mode
    ) x
    cross join lateral weekly_cap_for(p_staff, x.starts_on) c
    cross join lateral rota_guard_decide(
      can_roster_staff(p_staff, x.starts_on) and can_roster_staff(p_staff, x.ends_on),
      c.cap_hours, c.band, x.booked, x.hours, x.mode) g
   where sr.id = p_shift
$$;

comment on function public.rota_guard_verdict(uuid, uuid) is
  'The rota guard for one worker on one shift: verdict (ok / warn / block), reason (rtw_expired / visa_cap / wtr_cap), and the numbers behind it. Null for a shift or worker the caller cannot see.';

-- ---------------------------------------------------------------------
-- The existing gate, answered by the guard.
--
-- In block mode this is exactly the question 20260922093100 answered —
-- over the weekly cap, or past the right to work — with the one tightening
-- above (the shift's end must also be inside the right to work). In warn
-- mode a Working Time 48 breach stops being a gate, which is what "warn"
-- means for the engine; every visa limit and every expiry still is.
-- ---------------------------------------------------------------------
create or replace function public.weekly_cap_would_breach(p_staff uuid, p_shift uuid)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select coalesce((rota_guard_verdict(p_staff, p_shift) ->> 'verdict') = 'block', false)
$$;

comment on function public.weekly_cap_would_breach(uuid, uuid) is
  'RULE-20 hard gate for auto-assign, invite_worker, accept_invite and the Radar (§3.4): rota_guard_verdict() says block — a right-to-work stop, a Student visa band exceeded, or a Working Time 48 exceeded while rota_guard_mode is block.';

-- ---------------------------------------------------------------------
-- The backstop: nothing becomes `confirmed` past the guard.
-- ---------------------------------------------------------------------
create or replace function public.bookings_rota_guard()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ends timestamptz;
  v      jsonb;
begin
  if new.status is distinct from 'confirmed' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'confirmed'
     and old.shift_id = new.shift_id and old.staff_id = new.staff_id then
    return new;
  end if;

  select sr.ends_at into v_ends from shift_requirements sr where sr.id = new.shift_id;
  if v_ends is null or v_ends <= now() then
    return new;
  end if;

  v := rota_guard_verdict(new.staff_id, new.shift_id);
  if v is null then
    return new;
  end if;

  if v ->> 'verdict' = 'block' then
    raise exception 'rota_guard_%', v ->> 'reason'
      using errcode = 'P0001',
            detail = v::text,
            hint = case v ->> 'reason'
                     when 'rtw_expired' then 'The shift is past the worker''s right-to-work expiry. This is never configurable.'
                     when 'visa_cap' then 'The shift takes the worker over their Student visa weekly limit. This is never configurable.'
                     else 'The shift takes the worker over the 48-hour Working Time limit and no opt-out is in force. Settings → Rota guard decides whether this blocks or warns.' end;
  elsif v ->> 'verdict' = 'warn' then
    insert into audit_log (at, actor, action, entity, entity_id, data)
    values (now(), auth.uid(), 'rota_guard.warned', 'booking', new.id,
            v || jsonb_build_object('staffId', new.staff_id, 'shiftId', new.shift_id));
  end if;

  return new;
end $$;

drop trigger if exists bookings_rota_guard on bookings;
create trigger bookings_rota_guard
  before insert or update of status, shift_id, staff_id on bookings
  for each row execute function bookings_rota_guard();

-- ---------------------------------------------------------------------
-- What the office reads when the mode is warn.
-- ---------------------------------------------------------------------
create or replace view rota_guard_warnings_v with (security_invoker = true) as
select
  a.id,
  a.at,
  a.entity_id                                     as booking_id,
  (a.data ->> 'staffId')::uuid                    as staff_id,
  case when s.removed_at is not null then deleted_account_label(s.employee_id)
       else s.first_name || ' ' || s.last_name end as worker,
  s.employee_id,
  e.title                                         as event_title,
  sr.starts_at,
  sr.ends_at,
  (a.data ->> 'capHours')::int                    as cap_hours,
  a.data ->> 'band'                               as band,
  (a.data ->> 'bookedHours')::numeric             as booked_hours,
  (a.data ->> 'shiftHours')::numeric              as shift_hours
from audit_log a
left join staff s               on s.id = (a.data ->> 'staffId')::uuid
left join shift_requirements sr on sr.id = (a.data ->> 'shiftId')::uuid
left join events e              on e.id = sr.event_id
where a.action = 'rota_guard.warned';

comment on view rota_guard_warnings_v is
  'Working Time 48 h breaches the rota guard let through because rota_guard_mode is warn (completion letter requirement §4). Empty in block mode. Reads audit_log, admin-read.';

revoke execute on function public.bookings_rota_guard() from public, anon, authenticated;
revoke execute on function public.rota_guard_mode() from public, anon;
grant  execute on function public.rota_guard_mode() to authenticated, service_role;
revoke all on rota_guard_warnings_v from public, anon;
grant select on rota_guard_warnings_v to authenticated, service_role;
