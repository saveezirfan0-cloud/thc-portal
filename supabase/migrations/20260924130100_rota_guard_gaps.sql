-- =====================================================================
-- The rota guard's four gaps (docs/14 §4, ADR-0019)
--
-- 20260923100200 built the guard; four holes were recorded against it.
--
-- 1 · A `closed` booking was counted as committed hours.
--     weekly_booked_hours() (0008) counted confirmed, worked AND closed.
--     Every write of `closed` in the schema is a booking that never became
--     work: an invitation the worker declined (20260922140000), one they
--     withdrew, or one that lost the slot to somebody else (auto-assign,
--     accept_invite) — and each of those stamps cancelled_at and
--     cancel_cause. So a worker who declined three 8-hour invitations was
--     "20 h booked" to the guard, the Radar and the directory. The booking
--     state machine is being formalised in parallel (packages/domain
--     state.ts); this reads the statuses as they are written today and
--     counts `closed` only where it carries no cancellation stamp — i.e.
--     never, for any row written today, but correctly if `closed` is ever
--     used for a finished shift. confirmed and worked are unchanged.
--
-- 2 · One statement confirming several bookings for one worker read a
--     stale total. The guard was a BEFORE ROW trigger, and SQL run from a
--     row trigger does not see rows the same statement has already
--     changed — so confirming two 12-hour shifts in one UPDATE asked
--     "0 + 12 ≤ 20?" twice and let 24 hours through. It is now an AFTER
--     ROW trigger: those fire once the statement's changes are all in
--     place, so each row sees every other booking the statement
--     confirmed. A refusal still aborts the statement that caused it, with
--     the same `rota_guard_<reason>` error.
--
--     Because an AFTER trigger sees the booking it is judging already
--     counted, the verdict now sums the week EXCLUDING the shift under
--     judgement (weekly_booked_hours_except) and adds the shift's hours
--     once. Before a booking counts — every gate caller: auto-assign,
--     invite_worker, accept_invite, the Radar — that is the same number it
--     always was.
--
-- 3 · Changing a shift's times did not re-check the confirmed workers.
--     A new constraint trigger on shift_requirements, deferred to COMMIT,
--     re-runs the verdict for every confirmed booking on a section whose
--     start or end moved and which has not ended. When the move makes a
--     worker's position worse, `block` refuses the transaction (naming the
--     worker in DETAIL) and `warn` lets it through and writes the same
--     rota_guard.warned audit row the booking trigger writes. Which one is
--     decided exactly as for a new booking: the right-to-work stop and a
--     Student visa band always block; only a Working Time 48 follows
--     rota_guard_mode. Section 4 says why it is deferred and why it
--     judges the change rather than the world.
--
-- 4 · Auto-assign labelled an expired right to work `hours_limit`.
--     auto_assign_candidates() now says `rtw_expired` when the gate that
--     fired is the right-to-work stop (the same test rota_guard_verdict()
--     makes: the shift's start AND end day must be inside it). One
--     consequence to know about: staff_open_shifts() returns a section
--     gated `hours_limit` as a muted "Limit reached" card and drops every
--     other gate, so a shift past the worker's right to work now drops off
--     their Radar instead of claiming they are over their hours — applying
--     would be refused either way.
--
-- Forward-only; nothing here edits an earlier migration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · Which bookings are committed hours
-- ---------------------------------------------------------------------
create or replace function public.booking_counts_toward_cap(
  p_status booking_status, p_cancelled_at timestamptz, p_cancel_cause text)
returns boolean
language sql
immutable
set search_path = public, extensions
as $$
  select p_status in ('confirmed', 'worked')
      or (p_status = 'closed' and p_cancelled_at is null and p_cancel_cause is null)
$$;

comment on function public.booking_counts_toward_cap(booking_status, timestamptz, text) is
  'RULE-20: does this booking commit the worker''s hours? confirmed and worked do; invited and applied are not commitments; cancelled and turned_away are not work; a `closed` row stamped with a cancellation (declined, withdrawn, slot taken) never became work (20260924130100).';

create or replace function public.weekly_booked_hours(p_staff uuid, p_date date)
returns numeric
language sql
stable
set search_path = public, extensions
as $$
  select coalesce(sum(extract(epoch from (sr.ends_at - sr.starts_at)) / 3600.0), 0)::numeric
  from bookings b
  join shift_requirements sr on sr.id = b.shift_id
  where b.staff_id = p_staff
    and booking_counts_toward_cap(b.status, b.cancelled_at, b.cancel_cause)
    and (sr.starts_at at time zone 'Europe/London')::date
        between cap_week_start(p_date) and cap_week_start(p_date) + 6
$$;

comment on function public.weekly_booked_hours(uuid, date) is
  'RULE-20: hours committed in the Mon-Sun week containing p_date, from the scheduled role-section window (RULE-18), by the week the shift STARTS in (Europe/London). Counts what booking_counts_toward_cap() says is committed — never a declined, withdrawn or slot-taken `closed` row (20260924130100).';

create or replace function public.weekly_booked_hours_except(p_staff uuid, p_date date, p_shift uuid)
returns numeric
language sql
stable
set search_path = public, extensions
as $$
  select coalesce(sum(extract(epoch from (sr.ends_at - sr.starts_at)) / 3600.0), 0)::numeric
  from bookings b
  join shift_requirements sr on sr.id = b.shift_id
  where b.staff_id = p_staff
    and b.shift_id is distinct from p_shift
    and booking_counts_toward_cap(b.status, b.cancelled_at, b.cancel_cause)
    and (sr.starts_at at time zone 'Europe/London')::date
        between cap_week_start(p_date) and cap_week_start(p_date) + 6
$$;

comment on function public.weekly_booked_hours_except(uuid, date, uuid) is
  'weekly_booked_hours() without the one section being judged, so the rota guard gives the same answer before a booking counts (the gate) and after (the AFTER trigger, a shift time change).';

-- ---------------------------------------------------------------------
-- 2 · The verdict sums the week without the shift it is judging
--
-- Otherwise byte-for-byte 20260923100200.
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
             weekly_booked_hours_except(p_staff, (sr.starts_at at time zone 'Europe/London')::date,
                                        sr.id)                                          as booked,
             rota_guard_mode()                                                          as mode
    ) x
    cross join lateral weekly_cap_for(p_staff, x.starts_on) c
    cross join lateral rota_guard_decide(
      can_roster_staff(p_staff, x.starts_on) and can_roster_staff(p_staff, x.ends_on),
      c.cap_hours, c.band, x.booked, x.hours, x.mode) g
   where sr.id = p_shift
$$;

comment on function public.rota_guard_verdict(uuid, uuid) is
  'The rota guard for one worker on one shift: verdict (ok / warn / block), reason (rtw_expired / visa_cap / wtr_cap), and the numbers behind it — bookedHours is the rest of the week, without this shift. Null for a shift or worker the caller cannot see.';

-- The same verdict for a section at times it does not (or no longer)
-- carry: what the shift-time trigger needs to compare before with after.
-- The rest of the week is read as it stands.
create or replace function public.rota_guard_verdict_at(
  p_staff uuid, p_shift uuid, p_starts timestamptz, p_ends timestamptz)
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
    from (
      select (p_starts at time zone 'Europe/London')::date                          as starts_on,
             ((p_ends - interval '1 second') at time zone 'Europe/London')::date    as ends_on,
             round((extract(epoch from (p_ends - p_starts)) / 3600.0)::numeric, 2)  as hours,
             weekly_booked_hours_except(p_staff, (p_starts at time zone 'Europe/London')::date,
                                        p_shift)                                    as booked,
             rota_guard_mode()                                                      as mode
    ) x
    cross join lateral weekly_cap_for(p_staff, x.starts_on) c
    cross join lateral rota_guard_decide(
      can_roster_staff(p_staff, x.starts_on) and can_roster_staff(p_staff, x.ends_on),
      c.cap_hours, c.band, x.booked, x.hours, x.mode) g
$$;

comment on function public.rota_guard_verdict_at(uuid, uuid, timestamptz, timestamptz) is
  'rota_guard_verdict() for the section p_shift as if it ran p_starts → p_ends. Used by shift_times_rota_guard() to tell a change that CREATES a breach from one that merely leaves an existing one where it was.';

revoke execute on function public.rota_guard_verdict_at(uuid, uuid, timestamptz, timestamptz) from public, anon;

-- ---------------------------------------------------------------------
-- 3 · The booking backstop, as an AFTER trigger
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
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'confirmed'
     and old.shift_id = new.shift_id and old.staff_id = new.staff_id then
    return null;
  end if;

  select sr.ends_at into v_ends from shift_requirements sr where sr.id = new.shift_id;
  if v_ends is null or v_ends <= now() then
    return null;
  end if;

  v := rota_guard_verdict(new.staff_id, new.shift_id);
  if v is null then
    return null;
  end if;

  if v ->> 'verdict' = 'block' then
    raise exception 'rota_guard_%', v ->> 'reason'
      using errcode = 'P0001',
            detail = v::text,
            hint = rota_guard_hint(v ->> 'reason');
  elsif v ->> 'verdict' = 'warn' then
    insert into audit_log (at, actor, action, entity, entity_id, data)
    values (now(), auth.uid(), 'rota_guard.warned', 'booking', new.id,
            v || jsonb_build_object('staffId', new.staff_id, 'shiftId', new.shift_id));
  end if;

  return null;
end $$;

create or replace function public.rota_guard_hint(p_reason text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select case p_reason
           when 'rtw_expired' then 'The shift is past the worker''s right-to-work expiry. This is never configurable.'
           when 'visa_cap' then 'The shift takes the worker over their Student visa weekly limit. This is never configurable.'
           else 'The shift takes the worker over the 48-hour Working Time limit and no opt-out is in force. Settings → Rota guard decides whether this blocks or warns.' end
$$;

drop trigger if exists bookings_rota_guard on bookings;
create trigger bookings_rota_guard
  after insert or update of status, shift_id, staff_id on bookings
  for each row execute function bookings_rota_guard();

-- ---------------------------------------------------------------------
-- 4 · A shift whose times move re-checks the workers already on it
--
-- Judged at COMMIT (a deferred constraint trigger), on the section's
-- times as they stand then. Deferred because moving a shift is often one
-- step of an edit: the office moves the section and takes a worker off it
-- in the same transaction, or moves every section of an event together —
-- the guard must judge where the rota ends up, not the half-edited state
-- between two statements.
--
-- Judged against the change, not the world: a confirmed worker who was
-- already past the guard before the move (a booking made in warn mode, a
-- right to work that ran out overnight before compliance_daily reached
-- them) does not freeze every edit to the section. The move is refused —
-- or warned about — only when it makes that worker's position worse: a
-- verdict or reason the old times did not have, or more hours on a
-- section that already breached.
-- ---------------------------------------------------------------------
create or replace function public.shift_times_rota_guard()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  cur   record;
  b     record;
  v     jsonb;
  v_old jsonb;
begin
  -- The row as it stands at commit, not as this event left it.
  select sr.id, sr.starts_at, sr.ends_at into cur from shift_requirements sr where sr.id = new.id;
  if cur.id is null then
    return null;
  end if;
  if cur.starts_at is not distinct from old.starts_at
     and cur.ends_at is not distinct from old.ends_at then
    return null;
  end if;
  if cur.ends_at <= now() then
    return null;
  end if;

  for b in
    select bk.id, bk.staff_id
      from bookings bk
     where bk.shift_id = cur.id
       and bk.status = 'confirmed'
     order by bk.id
  loop
    v := rota_guard_verdict_at(b.staff_id, cur.id, cur.starts_at, cur.ends_at);
    continue when v is null or v ->> 'verdict' = 'ok';

    v_old := rota_guard_verdict_at(b.staff_id, cur.id, old.starts_at, old.ends_at);
    continue when v_old ->> 'verdict' = v ->> 'verdict'
              and v_old ->> 'reason' = v ->> 'reason'
              and (v ->> 'shiftHours')::numeric <= (v_old ->> 'shiftHours')::numeric
              and (v ->> 'bookedHours')::numeric <= (v_old ->> 'bookedHours')::numeric;

    if v ->> 'verdict' = 'block' then
      raise exception 'rota_guard_%', v ->> 'reason'
        using errcode = 'P0001',
              detail = (v || jsonb_build_object('staffId', b.staff_id, 'shiftId', cur.id,
                                                'bookingId', b.id, 'change', 'shift_times'))::text,
              hint = 'Changing this shift''s times would put a confirmed worker past the guard. '
                     || rota_guard_hint(v ->> 'reason');
    else
      insert into audit_log (at, actor, action, entity, entity_id, data)
      values (now(), auth.uid(), 'rota_guard.warned', 'booking', b.id,
              v || jsonb_build_object('staffId', b.staff_id, 'shiftId', cur.id,
                                      'change', 'shift_times'));
    end if;
  end loop;

  return null;
end $$;

comment on function public.shift_times_rota_guard() is
  'Completion letter requirement §4 for a shift that moves: at commit, re-runs the rota guard for every confirmed worker on the section. A move that makes a worker''s position worse is refused on block (DETAIL names the worker) and recorded as rota_guard.warned on warn. The right-to-work stop and Student visa bands always block (20260924130100).';

drop trigger if exists shift_times_rota_guard on shift_requirements;
create constraint trigger shift_times_rota_guard
  after update of starts_at, ends_at on shift_requirements
  deferrable initially deferred
  for each row execute function shift_times_rota_guard();

revoke execute on function public.bookings_rota_guard() from public, anon, authenticated;
revoke execute on function public.shift_times_rota_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5 · Auto-assign names an expired right to work as itself
--
-- Byte-for-byte 20260921141500 (with 20260922183014's pinned search_path)
-- but for the RULE-20 branch of the gate.
-- ---------------------------------------------------------------------
create or replace function auto_assign_candidates(p_shift uuid)
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
  gap as (select booked_elsewhere_gap_minutes() as mins)
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
      else null
    end as gate,
    exists (select 1 from client_qualifications cq
             where cq.staff_id = s.id and cq.client_id = sec.client_id
               and cq.role_id = sec.role_id and not cq.do_not_return) as qualified,
    (select b.status::text from bookings b
      where b.shift_id = sec.shift_id and b.staff_id = s.id) as booking_status,
    coalesce(s.reliability, 90)::numeric,
    coalesce(s.rating, 4.0)::numeric,
    coalesce(st_distance(s.home_location, sec.venue_location) / 1000.0, 9999)::numeric,
    (select count(*) from bookings b join shift_requirements sr3 on sr3.id = b.shift_id
      where b.staff_id = s.id and b.status = 'confirmed' and sr3.starts_at > now())::int,
    (select count(*) from bookings b
       join shift_requirements sr4 on sr4.id = b.shift_id
       join events ev4 on ev4.id = sr4.event_id
      where b.staff_id = s.id and b.status = 'worked' and ev4.venue_id = sec.venue_id)::int
  from staff s cross join sec cross join gap
  where s.removed_at is null and s.left_at is null
$$;
comment on function auto_assign_candidates(uuid) is
  'The §3.3/§3.4 pool for one role section, computed fresh: gate, wave and the five §6 factor inputs. Gates: wrong_role, do_not_return, blocked, self_cancelled, booked_elsewhere, rtw_expired (the shift is past the worker''s right to work — 20260924130100), hours_limit (RULE-20). Scoring itself is packages/domain/scoring.ts.';
