-- =====================================================================
-- Leaving (§10.6) and the in-employment conviction declaration (§10.7)
--
-- Both are the §4.3 cascade with a different reason on the front and a
-- different email on the back. 20260921170411 wrote that cascade once,
-- as block_worker(), on the strength of these two sections; this is the
-- migration that collects on it.
--
--   §10.6  worker requests their P45 → inactive, future work released,
--          E8 to the office immediately, naming the shifts it just lost
--   §10.7  worker declares a conviction → blocked with kind
--          conviction_review, future work released, E9 immediately, and
--          the declaration goes to Compliance → Needs review
--
-- Neither produces a P45 or judges a conviction. §10.6 is explicit that
-- "the system does not produce the P45 itself" — this is the trigger and
-- the audit record for THC's payroll process. §10.7's two outcomes are a
-- manager's, and are wired here only so that pressing Verify or Reject
-- does what §10.7 says it does.
--
-- Also here, because both of the above need it and nothing had it: the
-- staff state machine, in SQL. CLAUDE.md asks for every state change to
-- be "one function in packages/domain/state.ts + a DB function; illegal
-- transitions are rejected in the DB too". The TypeScript half has been
-- there since the first commit; this is the half that holds when the
-- caller is psql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- STAFF_TRANSITIONS from packages/domain/src/state.ts, in SQL.
--
-- Deliberately a table, not a case expression: it is data in TypeScript
-- and the two must be read side by side when either changes. The pgTAP
-- test asserts the pair agree edge for edge against the vectors the
-- domain package exports, so a change to one that is not made to the
-- other fails CI rather than diverging quietly.
-- ---------------------------------------------------------------------
create table if not exists staff_transitions (
  from_status staff_status not null,
  to_status   staff_status not null,
  primary key (from_status, to_status)
);
comment on table staff_transitions is
  'The §2.12 staff state machine as data. Mirrors STAFF_TRANSITIONS in packages/domain/src/state.ts; 210_leaving_and_conviction.sql asserts the two agree.';

alter table staff_transitions enable row level security;
drop policy if exists admin_all on staff_transitions;
drop policy if exists staff_transitions_read on staff_transitions;
-- Reference data about the machine itself, carrying nothing about any
-- person — the same shape as venue_types in 0004_rls_gaps, and the same
-- two policies. Readable by any signed-in role so a screen can grey out a
-- button it knows will be refused.
--
-- `current_app_role() is not null` and not `auth.role() is not null`:
-- auth.role() returns the string 'anon' for an anonymous caller, so the
-- second spelling is never null and would publish this to the world.
-- current_app_role() is null without a profile, which is what keeps anon
-- out.
create policy admin_all on staff_transitions for all using (current_app_role() = 'admin');
create policy staff_transitions_read on staff_transitions for select
  using (current_app_role() is not null);

insert into staff_transitions (from_status, to_status) values
  ('interview_requested', 'interview_completed'),
  ('interview_requested', 'rejected'),
  ('interview_requested', 'removed'),
  ('interview_completed', 'documents'),
  ('interview_completed', 'rejected'),
  ('interview_completed', 'removed'),
  ('documents', 'quiz'),
  ('documents', 'rejected'),
  ('documents', 'removed'),
  ('quiz', 'contract'),
  ('quiz', 'rejected'),
  ('quiz', 'removed'),
  ('contract', 'compliant'),
  ('contract', 'rejected'),
  ('contract', 'removed'),
  ('compliant', 'blocked'),
  ('compliant', 'inactive'),
  ('compliant', 'removed'),
  ('blocked', 'compliant'),
  ('blocked', 'inactive'),
  ('blocked', 'interview_requested'),
  ('blocked', 'removed'),
  -- Reset to candidate is the only way out of rejected and inactive (§9.6, §2.12).
  ('rejected', 'interview_requested'),
  ('rejected', 'removed'),
  ('inactive', 'interview_requested'),
  ('inactive', 'removed')
on conflict do nothing;

create or replace function public.staff_transition_allowed(p_from staff_status, p_to staff_status)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  -- Staying put is not a transition and is always fine: block_worker()
  -- re-blocking an already-blocked worker must not raise.
  select p_from = p_to
      or exists (select 1 from staff_transitions t
                  where t.from_status = p_from and t.to_status = p_to)
$$;

create or replace function public.assert_staff_transition(p_from staff_status, p_to staff_status)
returns void
language plpgsql
stable
set search_path = public, extensions
as $$
begin
  if not staff_transition_allowed(p_from, p_to) then
    raise exception 'illegal_staff_transition: % -> %', p_from, p_to
      using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- block_worker() now refuses an illegal landing.
--
-- The cascade is destructive — it cancels every future booking the worker
-- holds — so the check belongs before the first write, not after it. A
-- `removed` worker (§1.7) has nothing left to cancel and must not be
-- dragged back into `blocked` by a job.
-- ---------------------------------------------------------------------
create or replace function public.block_worker(
  p_staff  uuid,
  p_kind   block_kind,
  p_reason text,
  p_now    timestamptz default now(),
  p_status staff_status default 'blocked',
  p_cause  text          default 'blocked'
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_released int := 0;
  v_withdrawn int := 0;
  v_was staff_status;
begin
  select status into v_was from staff where id = p_staff for update;
  if v_was is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if p_status not in ('blocked', 'inactive') then
    raise exception 'block_worker: p_status must be blocked or inactive, got %', p_status
      using errcode = 'P0001';
  end if;
  perform assert_staff_transition(v_was, p_status);

  -- 1 · blocked (or inactive, for the worker who leaves).
  update staff
     set status = p_status,
         block_kind = case when p_status = 'blocked' then p_kind else null end,
         block_reason = case when p_status = 'blocked' then p_reason else null end,
         leave_reason = case when p_status = 'inactive' then p_reason else leave_reason end,
         left_at      = case when p_status = 'inactive' then p_now   else left_at end
   where id = p_staff;

  -- 2 · every future confirmed allocation is released.
  with released as (
    update bookings b
       set status = 'cancelled', cancelled_at = p_now, cancel_cause = p_cause
      from shift_requirements s
     where s.id = b.shift_id
       and b.staff_id = p_staff
       and b.status = 'confirmed'
       and b.cancelled_at is null
       and s.starts_at > p_now
    returning 1
  ) select count(*)::int into v_released from released;

  -- 3 · every open invitation disappears from their app, and any pending
  --     Radar self-application is cancelled (§10.6 step 4).
  with withdrawn as (
    update bookings b
       set status = 'cancelled', cancelled_at = p_now, cancel_cause = p_cause
      from shift_requirements s
     where s.id = b.shift_id
       and b.staff_id = p_staff
       and b.status in ('invited', 'applied')
       and b.cancelled_at is null
       and s.starts_at > p_now
    returning 1
  ) select count(*)::int into v_withdrawn from withdrawn;

  return jsonb_build_object(
    'staffId', p_staff::text,
    'wasStatus', v_was::text,
    'status', p_status::text,
    'kind', p_kind::text,
    'released', v_released,
    'withdrawn', v_withdrawn);
end $$;

-- ---------------------------------------------------------------------
-- The shift list E8 and E9 both carry.
--
-- §10.6: "a list of the future shifts that were just released with the
-- event, client, venue, role and date of each — so whoever picks it up
-- can see instantly whether a big event has just lost someone as well as
-- action the P45." §10.7 wants the same list for the same reason.
--
-- Read AFTER the cascade, off cancel_cause and cancelled_at, so it is the
-- shifts this action released and not every shift the worker ever lost.
-- Dates are UK-formatted here (§1.8) because the office reads them in an
-- email, not in a locale-aware screen.
-- ---------------------------------------------------------------------
create or replace function public.released_shift_lines(p_staff uuid, p_cause text, p_at timestamptz)
returns text
language sql
stable
set search_path = public, extensions
as $$
  select coalesce(
    string_agg(
      e.title || ' · ' || c.name || ' · ' || e.venue_name || ' · ' || r.name
                || ' · ' || to_char(s.starts_at at time zone 'Europe/London', 'DD Mon YYYY HH24:MI'),
      E'\n' order by s.starts_at),
    '(none)')
    from bookings b
    join shift_requirements s on s.id = b.shift_id
    join events e             on e.id = s.event_id
    join clients c            on c.id = e.client_id
    join roles r              on r.id = s.role_id
   where b.staff_id = p_staff
     and b.cancel_cause = p_cause
     and b.cancelled_at = p_at
$$;

-- ---------------------------------------------------------------------
-- §10.6 · Request my P45.
--
-- Three things the scope is emphatic about, all asserted:
--
--   * A shift already under way is NOT touched. "The release applies only
--     to shifts with a start time in the future, so leaving can never
--     disturb the pay or the timesheet for work already being done."
--   * A worker who is CHECKED IN cannot submit at all — the action is
--     disabled for the duration of that shift. The screen greys the
--     button; this refuses it, because a greyed button is not a rule.
--   * Leaving does not anonymise anything. The profile, its documents and
--     its history stay intact and visible to the office, because they are
--     employment records THC has to keep. Erasure is Remove (§1.7), which
--     is a separate and irreversible action.
-- ---------------------------------------------------------------------
create or replace function public.request_p45(
  p_staff  uuid,
  p_reason text        default null,
  p_now    timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v staff;
  v_cascade jsonb;
  v_last date;
begin
  select * into v from staff where id = p_staff;
  if v.id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;

  -- "Available once you've checked out" (§10.6 step 3).
  if exists (
    select 1
      from bookings b
      join shift_requirements s on s.id = b.shift_id
      join check_logs cl        on cl.booking_id = b.id
     where b.staff_id = p_staff
       and b.cancelled_at is null
       and cl.check_in_at is not null
       and cl.check_out_at is null
       and p_now < s.ends_at + interval '4 hours'
  ) then
    raise exception 'on_shift' using errcode = 'P0001';
  end if;

  v_cascade := block_worker(p_staff, null, p_reason, p_now, 'inactive', 'left');

  -- The date of their last completed shift, for the office to check
  -- against payroll before issuing the P45.
  select max(s.ends_at at time zone 'Europe/London')::date into v_last
    from bookings b join shift_requirements s on s.id = b.shift_id
   where b.staff_id = p_staff and b.status = 'worked';

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values ('E8:staff:' || p_staff, 'email', 'E8',
          array['admin@thehospitalitycompany.co.uk'],
          jsonb_build_object(
            'name',          v.first_name || ' ' || v.last_name,
            'employeeId',    coalesce(v.employee_id::text, '(not yet issued)'),
            'niNumber',      coalesce(v.ni_number, '(not on file)'),
            'requestedAt',   to_char(p_now at time zone 'Europe/London', 'DD Mon YYYY HH24:MI'),
            'reason',        coalesce(nullif(p_reason, ''), '(none given)'),
            'lastShiftDate', coalesce(to_char(v_last, 'DD Mon YYYY'), '(none worked)'),
            'releasedShifts', released_shift_lines(p_staff, 'left', p_now)))
  on conflict (key) do nothing;

  return v_cascade || jsonb_build_object('lastShiftDate', v_last);
end $$;

comment on function public.request_p45(uuid, text, timestamptz) is
  '§10.6. Worker → inactive with left_at and the reason, future work released, E8 to the office immediately. Refuses while the worker is checked in. Produces no P45 and anonymises nothing — that is Remove (§1.7).';

-- ---------------------------------------------------------------------
-- §10.7 · Declaring a criminal conviction while working.
--
-- "Nothing already on the profile is altered — this is added to the
-- history", so the declaration is an insert and prior rows are left
-- exactly as they are, superseded flag included.
--
-- E9 deliberately does NOT carry the declaration text. §10.7: "not
-- carrying the declaration text itself … The details are read in the Back
-- Office, where access is role-controlled." The outbox row would
-- otherwise put the most sensitive personal data the platform holds into
-- an email queue.
-- ---------------------------------------------------------------------
create or replace function public.declare_conviction(
  p_staff           uuid,
  p_details         text,
  p_conviction_date date        default null,
  p_now             timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v staff;
  v_declaration uuid;
  v_cascade jsonb;
begin
  select * into v from staff where id = p_staff;
  if v.id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_details), '') = '' then
    raise exception 'details_required' using errcode = 'P0001';
  end if;

  insert into criminal_declarations (staff_id, declared_at, source, answer, details,
                                     conviction_date, review_status)
  values (p_staff, p_now, 'in_employment', true, p_details, p_conviction_date, 'pending')
  returning id into v_declaration;

  v_cascade := block_worker(p_staff, 'conviction_review',
                            'Criminal conviction declared — under review', p_now);

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values ('E9:declaration:' || v_declaration, 'email', 'E9',
          array['admin@thehospitalitycompany.co.uk'],
          jsonb_build_object(
            'name',       v.first_name || ' ' || v.last_name,
            'employeeId', coalesce(v.employee_id::text, '(not yet issued)'),
            'declaredAt', to_char(p_now at time zone 'Europe/London', 'DD Mon YYYY HH24:MI'),
            'releasedShifts', released_shift_lines(p_staff, 'blocked', p_now)))
  on conflict (key) do nothing;

  return v_cascade || jsonb_build_object('declarationId', v_declaration::text);
end $$;

comment on function public.declare_conviction(uuid, text, date, timestamptz) is
  '§10.7. Adds a pending in-employment declaration to the history, suspends the worker exactly as an expired document does (§4.3), and emails E9 — which never carries the declaration text.';

-- ---------------------------------------------------------------------
-- §10.7's two outcomes, on the row the manager decides.
--
--   Verify → the block lifts through the ordinary full compliance
--            re-check (§4.3): compliant only if everything else on the
--            profile is also verified and in date. Push N15. Bookings
--            released in the meantime are not restored.
--   Reject → the block STANDS and converts to a manual block (§9.6) with
--            the manager's reason, so only a manager can ever lift it.
--            The worker is not told the reason through the app; the
--            office contacts them directly, "because this is a
--            conversation rather than a push notification". Hence no
--            notification on this branch at all.
-- ---------------------------------------------------------------------
create or replace function public.criminal_declaration_reviewed()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_now timestamptz := coalesce(new.reviewed_at, now());
begin
  if new.review_status = old.review_status then
    return new;
  end if;

  if new.review_status = 'verified' and new.answer then
    if unblock_if_compliant(new.staff_id, (v_now at time zone 'Europe/London')::date) then
      insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
      values ('N15:declaration:' || new.id, 'push', 'N15', new.staff_id, '{}'::jsonb)
      on conflict (key) do nothing;
    end if;

  elsif new.review_status = 'rejected' and new.answer then
    update staff
       set block_kind = 'manual',
           block_reason = coalesce(nullif(new.review_note, ''),
                                   'Declared conviction not accepted')
     where id = new.staff_id
       and status = 'blocked';
  end if;

  return new;
end $$;

drop trigger if exists criminal_declaration_reviewed on criminal_declarations;
create trigger criminal_declaration_reviewed
  after update of review_status on criminal_declarations
  for each row execute function criminal_declaration_reviewed();

-- ---------------------------------------------------------------------
-- unblock_if_compliant() now lifts a conviction review too.
--
-- 20260921170411 restricted it to `auto_document` deliberately, because
-- nothing could yet create any other automatic block. §10.7 creates one,
-- and says its Verify "lifts through the ordinary full compliance
-- re-check (§4.3)" — so the list of kinds it will lift grows by exactly
-- one. `manual` stays out: §4.3 and §9.6 both say a manager must press
-- Unblock, and that press runs this same check.
-- ---------------------------------------------------------------------
create or replace function public.unblock_if_compliant(p_staff uuid, p_on date default current_date)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v staff;
begin
  select * into v from staff where id = p_staff for update;
  if v.id is null or v.status <> 'blocked'
     or v.block_kind not in ('auto_document', 'conviction_review') then
    return false;
  end if;
  if exists (select 1 from compliance_blockers(p_staff, p_on)) then
    return false;
  end if;
  perform assert_staff_transition(v.status, 'compliant'::staff_status);
  update staff set status = 'compliant', block_kind = null, block_reason = null
   where id = p_staff;
  return true;
end $$;

comment on function public.unblock_if_compliant(uuid, date) is
  '§4.3 automatic unblock. Lifts an auto_document block (§4.3) or an accepted conviction review (§10.7); never a manual block, which §9.6 says a manager must lift.';

-- ---------------------------------------------------------------------
-- Grants. Both entry points are worker-initiated from the Staff App, so
-- unlike the §7 jobs they are reachable by a signed-in user — but only
-- for themselves, which the functions check. Everything else stays shut
-- (docs/14 O7: a revoke from PUBLIC does not take back Supabase's
-- default-privilege grants to anon and authenticated by name).
-- ---------------------------------------------------------------------
revoke execute on function public.request_p45(uuid, text, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.declare_conviction(uuid, text, date, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.criminal_declaration_reviewed()
  from public, anon, authenticated;
revoke execute on function public.released_shift_lines(uuid, text, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.assert_staff_transition(staff_status, staff_status)
  from public, anon;

grant execute on function public.request_p45(uuid, text, timestamptz)              to service_role;
grant execute on function public.declare_conviction(uuid, text, date, timestamptz) to service_role;
grant execute on function public.released_shift_lines(uuid, text, timestamptz)     to service_role;

-- NOT granted to `authenticated` yet, and the reason is the same one
-- 20260921170411 gave for block_worker: the screens do not exist (S4,
-- S6), and a grant with no caller is an open door. Both functions take a
-- staff id and neither checks that it is the CALLER's — they are written
-- for a server action holding the service key, which is how the Staff App
-- reaches every other write path. Whoever builds S4 and S6 either keeps
-- that shape or adds the self-check and the grant together. docs/14 O10.
