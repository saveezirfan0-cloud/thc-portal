-- =====================================================================
-- The event board (§3.3) — the screen the auto-assign engine has never had
--
-- The engine, the rounds and the pool have existed since
-- 20260921141500_auto_assign.sql. auto_assign_candidates() was written to
-- serve both it and this screen: "one row per worker who qualifies for the
-- ROLE in general, `gate` null for everyone in the pool and naming the bar
-- for everyone else". So the pool needs nothing new here — this migration
-- adds the board's own reads and the four manager actions §3.3 puts on it.
--
-- What is deliberately NOT here:
--
--   · No second "Get back". §3.3 says pressing Get back on the roster and
--     pressing Resolve on the same entry in the §9.5 violation log are the
--     same act, and resolve_violation() already reclassifies a no_show to
--     late with the minutes measured from the press. A second
--     implementation is how the two surfaces come to disagree, and the
--     mandatory note is part of what they agree on.
--   · No Confirm. §3.3: "The WORKER confirms, in the app — the manager has
--     no Confirm button, only Withdraw."
--   · No invite function. invite_worker() already takes p_source, and the
--     board passes 'manual'.
-- =====================================================================

create index if not exists bookings_shift_status_idx on bookings (shift_id, status);
create index if not exists violations_booking_type_idx on violations (booking_id, type);

-- ---------------------------------------------------------------------
-- event_board_v — the header (§3.3)
--
-- The window is the DERIVED one (§3.2): min start to max end across the
-- role sections. The status is event_status()'s, which is computed from
-- that window except for Cancelled, which is the only stored one.
--
-- Break and buffer policy are on the row because §3.3 asks for them by
-- name: "The event page header also shows the client's Break policy and
-- Buffer policy as read-only checkmarks (§3.2), so both stay visible
-- after creation, not only while building the event." They are the
-- EVENT's copies, not the client's live ones — an event keeps the policy
-- it was built with (§3.2), and showing the client's current setting here
-- would misdescribe what this event will actually bill.
-- ---------------------------------------------------------------------
create or replace view event_board_v with (security_invoker = true) as
select
  e.id,
  e.title,
  e.event_date,
  e.client_id,
  c.name                                                     as client_name,
  c.staff_contact_point,
  e.venue_id,
  e.venue_name,
  e.venue_address,
  e.geofence_radius_m,
  e.po_number,
  e.onsite_contact,
  e.notes,
  e.auto_assign,
  e.pays_breaks,
  e.pays_buffer,
  e.cancelled_at,
  e.cancel_reason,
  p.full_name                                                as cancelled_by_name,
  e.payroll_exported_at,
  w.starts_at,
  w.ends_at,
  event_status(e.*, w.starts_at, w.ends_at)                  as status,
  (select count(*) from shift_requirements s where s.event_id = e.id)::int as section_count
from events e
join clients c on c.id = e.client_id
join event_windows w on w.event_id = e.id
left join profiles p on p.id = e.cancelled_by;

comment on view event_board_v is
  'The §3.3 event board header: the event with its client, venue, derived window (§3.2), computed status and the break and buffer policies AS BUILT — an event keeps the policy it was created with, so the client''s current setting would misdescribe what this one bills.';

-- ---------------------------------------------------------------------
-- event_board_sections_v — one row per role section (§3.3)
--
-- "N confirmed · M invited · K open of H (+buffer)", and the counts are
-- the part worth being careful about.
--
--   · `confirmed` counts ONLY confirmed bookings. Not invited, not
--     applied. §3.2 and §3.3 both say so, and it is the single most
--     repeated mistake in this codebase's rules.
--   · `open` is headcount − confirmed, never (headcount + buffer) −
--     confirmed. The buffer is an over-invitation allowance, not a slot to
--     be filled: a role is full at headcount and the board must not ask a
--     manager to fill seats that do not exist.
--   · A worked or closed booking still occupies its slot — the shift
--     happened. Counting only `confirmed` would empty the board the
--     moment an event finished.
-- ---------------------------------------------------------------------
create or replace view event_board_sections_v with (security_invoker = true) as
select
  s.id,
  s.event_id,
  s.role_id,
  r.name                                                     as role_name,
  s.starts_at,
  s.ends_at,
  s.headcount,
  s.buffer,
  s.charge_rate,
  s.pay_rate,
  final_rate(s.pay_rate)                                     as final_pay_rate,
  s.dress_code,
  s.auto_assign,
  s.allocation_per_hour,
  coalesce(b.confirmed, 0)                                   as confirmed,
  coalesce(b.invited, 0)                                     as invited,
  coalesce(b.applied, 0)                                     as applied,
  greatest(s.headcount - coalesce(b.confirmed, 0), 0)        as open_slots,
  coalesce(b.no_shows, 0)                                    as no_shows
from shift_requirements s
join roles r on r.id = s.role_id
left join lateral (
  select
    count(*) filter (where bk.status in ('confirmed', 'worked', 'closed'))::int as confirmed,
    count(*) filter (where bk.status = 'invited')::int                          as invited,
    count(*) filter (where bk.status = 'applied')::int                          as applied,
    count(*) filter (
      where exists (select 1 from violations v
                     where v.booking_id = bk.id and v.type = 'no_show' and not v.resolved)
    )::int                                                                      as no_shows
  from bookings bk where bk.shift_id = s.id
) b on true;

comment on view event_board_sections_v is
  'The §3.3 role-section header: fill counted from CONFIRMED bookings only (never invited), open = headcount - confirmed (never headcount + buffer, because the buffer is an over-invitation allowance and not a slot), and worked/closed bookings still holding their slot so a finished event does not read as empty.';

-- ---------------------------------------------------------------------
-- event_board_roster_v — Confirmed and Invited (§3.3)
--
-- One row per booking on the event. §3.3 is explicit that a no-show is
-- NOT a separate list: "a no-show worker stays listed inside Confirmed,
-- marked with a 'No show' status badge and a 'Get back' action, rather
-- than moving to a different list … so the manager immediately sees who
-- needs replacing". So `no_show` is a flag on the row and the screen
-- groups by `status`, never by it.
--
-- `no_show_violation` is carried because Get back IS resolve_violation()
-- on that row — the screen needs the id to call it, and having it here
-- means the board cannot invent a second way to reclassify.
--
-- Names come through staff_directory_v, so §1.7's anonymisation applies
-- to a roster too: a removed worker's past shift keeps its row and loses
-- their name.
-- ---------------------------------------------------------------------
create or replace view event_board_roster_v with (security_invoker = true) as
select
  b.id                                                       as booking_id,
  s.event_id,
  b.shift_id,
  s.role_id,
  r.name                                                     as role_name,
  d.id                                                       as staff_id,
  d.display_name,
  d.employee_id,
  d.photo_path,
  d.rating,
  d.reliability,
  b.status,
  b.source,
  b.created_at                                               as invited_at,
  b.confirmed_at,
  b.day_before_confirmed_at,
  b.on_day_confirmed_at,
  b.reconfirm_required,
  b.reconfirm_reason,
  b.applied_at,
  b.self_cancelled,
  b.cancel_cause,
  -- Wave 1 is "qualified at this client AND this role" (RULE-17), which is
  -- the same predicate auto_assign_candidates uses — repeated here rather
  -- than joined because the roster is read for bookings that already
  -- exist, where the candidate function has nothing to say.
  exists (select 1 from client_qualifications q
           where q.staff_id = b.staff_id and q.client_id = e.client_id
             and q.role_id = s.role_id and not q.do_not_return)  as qualified_here,
  (select v.id from violations v
    where v.booking_id = b.id and v.type = 'no_show' and not v.resolved
    order by v.detected_at desc limit 1)                     as no_show_violation,
  exists (select 1 from violations v
           where v.booking_id = b.id and v.type = 'no_show' and not v.resolved) as no_show,
  e.payroll_exported_at
from bookings b
join shift_requirements s on s.id = b.shift_id
join events e on e.id = s.event_id
join roles r on r.id = s.role_id
join staff_directory_v d on d.id = b.staff_id;

comment on view event_board_roster_v is
  'The §3.3 Confirmed and Invited lists. A no-show is a FLAG on a confirmed row, never a separate list (§3.3), and carries the violation id because Get back is resolve_violation() — the same act as Resolve in the §9.5 log. Names come through staff_directory_v so §1.7 applies to a roster too.';

-- =====================================================================
-- The manager's actions (§3.3)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Withdraw — the only roster action the manager has besides No-show
-- (§3.3: "the manager has no Confirm button, only Withdraw").
--
-- It cancels the booking rather than deleting it. `bookings` is unique on
-- (shift, staff), so the row is also what stops the same worker being
-- re-invited by a later auto-assign round to a slot the office
-- deliberately took back — §3.5 already relies on that for the 12:00
-- cutoff, and withdrawing is the same shape of decision.
--
-- A worked booking cannot be withdrawn. The shift happened; the record of
-- it is payroll's, and RULE-06 does not correct an export retroactively.
-- ---------------------------------------------------------------------
create or replace function public.withdraw_booking(
  p_booking uuid,
  p_reason  text default null,
  p_now     timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  b  bookings;
  sr shift_requirements;
begin
  -- Strict, like resolve_violation(): these three are manager actions with
  -- no job caller, so unlike invite_worker() there is no round or tick that
  -- legitimately arrives without a session.
  if current_app_role() is distinct from 'admin' then
    raise exception 'admins_only' using errcode = '42501';
  end if;

  select * into b from bookings where id = p_booking for update;
  if b.id is null then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  if b.status in ('worked', 'closed') then
    raise exception 'A worked shift cannot be withdrawn — the record of it belongs to payroll (RULE-06)'
      using errcode = 'P0001';
  end if;
  if b.cancelled_at is not null then
    return jsonb_build_object('withdrawn', false, 'reason', 'already_cancelled');
  end if;

  select * into sr from shift_requirements where id = b.shift_id;

  update bookings
     set status = 'cancelled',
         cancelled_at = p_now,
         -- The two halves of the cascade stay legible on the row: a
         -- withdrawn INVITATION is not a slot the event lost.
         cancel_cause = case when b.status = 'confirmed' then 'withdraw' else 'withdraw_invite' end
   where id = p_booking;

  -- N10b tells the worker their shift was released. An invitation nobody
  -- accepted needs no push: nothing was promised to withdraw.
  if b.status = 'confirmed' then
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    values ('N10b:withdraw:' || p_booking::text, 'push', 'N10b', b.staff_id,
            jsonb_build_object('bookingId', p_booking::text))
    on conflict (key) do nothing;
  end if;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (p_now, auth.uid(), 'withdraw_booking', 'booking', p_booking,
          jsonb_build_object('staffId', b.staff_id::text,
                             'shiftId', b.shift_id::text,
                             'wasStatus', b.status::text,
                             'reason', nullif(btrim(p_reason), '')));

  return jsonb_build_object('withdrawn', true, 'wasStatus', b.status::text);
end $$;

comment on function public.withdraw_booking(uuid, text, timestamptz) is
  '§3.3 Withdraw: the office takes a worker off a shift. Cancels rather than deletes, so the (shift, staff) row still stops a later round re-offering the slot to the same person. A worked booking is refused — RULE-06 does not correct an export retroactively.';

revoke execute on function public.withdraw_booking(uuid, text, timestamptz) from public, anon;

-- ---------------------------------------------------------------------
-- Manual No-show (§3.3).
--
-- "The manual button becomes available the moment the shift starts and
-- stays available for 2 weeks after the shift ends — so a no-show can
-- still be recorded during the following week's pay-and-bill run."
--
-- Both ends of that window are enforced here, not only in the screen: a
-- no-show recorded before the shift started is a prediction, and one
-- recorded a month later has no pay-and-bill run left to affect.
--
-- The payroll warning is RETURNED, not raised. §3.3 is explicit that
-- recording a no-show on an already-exported shift is allowed and simply
-- does not reverse the payment — "the late No-show only affects the
-- worker's show-rate" — so the function does the work and hands the
-- screen the sentence to show.
-- ---------------------------------------------------------------------
create or replace function public.mark_no_show(
  p_booking uuid,
  p_now     timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  b          bookings;
  sr         shift_requirements;
  ev         events;
  v_id       uuid;
  v_exported boolean;
begin
  -- Strict, like resolve_violation(): these three are manager actions with
  -- no job caller, so unlike invite_worker() there is no round or tick that
  -- legitimately arrives without a session.
  if current_app_role() is distinct from 'admin' then
    raise exception 'admins_only' using errcode = '42501';
  end if;

  select * into b from bookings where id = p_booking for update;
  if b.id is null then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  select * into sr from shift_requirements where id = b.shift_id;
  select * into ev from events where id = sr.event_id;

  if b.status not in ('confirmed', 'worked') then
    raise exception 'Only a confirmed worker can be marked No-show (§3.3)'
      using errcode = 'P0001';
  end if;
  if p_now < sr.starts_at then
    raise exception 'The No-show button opens when the shift starts (§3.3)'
      using errcode = 'P0001';
  end if;
  if p_now > sr.ends_at + interval '14 days' then
    raise exception 'A No-show can be recorded for two weeks after the shift ends (§3.3)'
      using errcode = 'P0001';
  end if;

  v_exported := ev.payroll_exported_at is not null;

  select id into v_id from violations
   where booking_id = p_booking and type = 'no_show' and not resolved
   limit 1;

  if v_id is null then
    insert into violations (staff_id, booking_id, type, detected_at)
    values (b.staff_id, p_booking, 'no_show', p_now)
    returning id into v_id;
  end if;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (p_now, auth.uid(), 'mark_no_show', 'booking', p_booking,
          jsonb_build_object('staffId', b.staff_id::text,
                             'violationId', v_id::text,
                             'payrollExported', v_exported));

  return jsonb_build_object(
    'violationId', v_id::text,
    -- RULE-06 / §3.3: the money correction happens in THC's own finance
    -- process, outside the app, and the office has to be told so plainly.
    'payrollExported', v_exported,
    'messageKey', case when v_exported then 'no_show_payroll_already_exported' else 'no_show' end);
end $$;

comment on function public.mark_no_show(uuid, timestamptz) is
  '§3.3 manual No-show. Open from the shift start until two weeks after it ends, both enforced here. Returns payrollExported rather than refusing: §3.3 allows a late No-show and says plainly that it does not reverse the payment — the screen shows that sentence.';

revoke execute on function public.mark_no_show(uuid, timestamptz) from public, anon;

-- ---------------------------------------------------------------------
-- The per-role and per-event Auto-Assign switches (§3.3, §3.4).
--
-- Two levels, and the role level is not merely a copy: §3.4 runs a role
-- section only when BOTH are on, so turning the event off stops every
-- role without losing which roles the manager had already excluded.
-- ---------------------------------------------------------------------
create or replace function public.set_section_auto_assign(p_shift uuid, p_on boolean)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
begin
  update shift_requirements set auto_assign = p_on where id = p_shift;
  if not found then
    raise exception 'shift_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('shiftId', p_shift::text, 'autoAssign', p_on);
end $$;

create or replace function public.set_event_auto_assign(p_event uuid, p_on boolean)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
begin
  update events set auto_assign = p_on where id = p_event;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('eventId', p_event::text, 'autoAssign', p_on);
end $$;

comment on function public.set_event_auto_assign(uuid, boolean) is
  '§3.3 the event-level Auto-Assign switch. A role section runs only when both its own switch and this one are on (§3.4), so turning the event off does not lose which roles the manager had already excluded.';

-- ---------------------------------------------------------------------
-- Cancel event (§3.3, §3.6).
--
-- "The manager must give a reason (free text, same pattern as manual
-- Block, §9.6)." The event is marked, never deleted — it stays in the
-- list and the calendar greyed out, for record-keeping.
--
-- N12 reaches every confirmed and invited worker AND anyone with an open
-- Radar application: §3.3 calls that out specifically (confirmed
-- 08.09.2026), because a self-applicant has been waiting on an answer and
-- silence is the wrong one.
-- ---------------------------------------------------------------------
create or replace function public.cancel_event(
  p_event  uuid,
  p_reason text,
  p_now    timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  ev        events;
  v_told    int := 0;
  v_cancelled int := 0;
begin
  -- Strict, like resolve_violation(): these three are manager actions with
  -- no job caller, so unlike invite_worker() there is no round or tick that
  -- legitimately arrives without a session.
  if current_app_role() is distinct from 'admin' then
    raise exception 'admins_only' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Cancelling an event needs a reason (§3.3)' using errcode = 'P0001';
  end if;

  select * into ev from events where id = p_event for update;
  if ev.id is null then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;
  if ev.cancelled_at is not null then
    return jsonb_build_object('cancelled', false, 'reason', 'already_cancelled');
  end if;

  update events
     set cancelled_at = p_now,
         cancel_reason = btrim(p_reason),
         cancelled_by = auth.uid()
   where id = p_event;

  -- N12 first, off the bookings as they still stand: confirmed, invited
  -- and open Radar applications alike.
  with told as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select 'N12:event:' || p_event::text || ':' || b.staff_id::text,
           'push', 'N12', b.staff_id,
           jsonb_build_object('eventId', p_event::text, 'title', ev.title)
      from bookings b
      join shift_requirements s on s.id = b.shift_id
     where s.event_id = p_event
       and b.status in ('confirmed', 'invited', 'applied')
       and b.cancelled_at is null
    on conflict (key) do nothing
    returning 1
  ) select count(*)::int into v_told from told;

  with gone as (
    update bookings b
       set status = 'cancelled', cancelled_at = p_now, cancel_cause = 'event_cancelled'
      from shift_requirements s
     where s.id = b.shift_id
       and s.event_id = p_event
       and b.status in ('confirmed', 'invited', 'applied')
       and b.cancelled_at is null
    returning 1
  ) select count(*)::int into v_cancelled from gone;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (p_now, auth.uid(), 'cancel_event', 'event', p_event,
          jsonb_build_object('reason', btrim(p_reason),
                             'bookingsCancelled', v_cancelled,
                             'workersNotified', v_told));

  return jsonb_build_object(
    'cancelled', true,
    'bookingsCancelled', v_cancelled,
    'workersNotified', v_told);
end $$;

comment on function public.cancel_event(uuid, text, timestamptz) is
  '§3.3 Cancel event. Reason mandatory, the event marked rather than deleted (it stays greyed out in the list and calendar for record-keeping), every confirmed, invited AND open Radar application cancelled, and N12 sent to all three — §3.3 names the self-applicants specifically.';

revoke execute on function public.cancel_event(uuid, text, timestamptz) from public, anon;
