-- =====================================================================
-- The booking state machine in the database (Scope §3.6) and one
-- vocabulary for `bookings.cancel_cause` — docs/14 §4 B2 and B3.
--
-- B2. CLAUDE.md: "Every state change = one function in
-- packages/domain/state.ts + a DB function; illegal transitions are
-- rejected in the DB too." The staff machine has had its half since
-- 20260921180312 (staff_transitions + assert_staff_transition). Bookings
-- had neither: state.ts modelled four of the seven enum values, and a
-- direct `update bookings set status = …` — from psql, a server action, a
-- job — could move a booking anywhere, `worked` back to `invited` included.
--
-- The seven states and ten edges, with the § that creates each, are in
-- packages/domain/src/bookingState.vectors.json. That file is the single
-- source both sides are held to: the Vitest suite compares it with
-- BOOKING_TRANSITIONS, and 490_booking_state_machine.sql compares it with
-- booking_transitions() below and drives every one of the 49 status pairs
-- through the trigger.
--
--   invited   → confirmed | cancelled | closed
--   applied   → confirmed | cancelled | closed
--   confirmed → worked | turned_away | cancelled
--   closed    → applied
--   worked, turned_away, cancelled: terminal
--
-- The edges are a set-returning SQL function rather than a table: they are
-- reference data that changes only with a migration, and a function has no
-- rows to protect, so there is no RLS surface to add to 001/020/030/040.
--
-- The trigger guards UPDATE only. INSERT is where a booking is born, and
-- the scope has two births — invite_worker writes `invited`, apply_to_shift
-- writes `applied` — but the pgTAP suite and the seed build history by
-- inserting finished rows (a `worked` booking from 2025 with its check
-- log), which is not a transition and is not what B2 is about.
--
-- B3. `cancel_cause` had three vocabularies:
--   the column comment (0001_init): withdraw / cutoff / self_cancel / gdpr /
--     blocked / event_cancelled / left
--   the domain (state.ts CANCEL_REASONS): office_withdraw, ready_cutoff,
--     self_cancel, overlap_auto_withdraw, event_cancelled,
--     compliance_block, gdpr
--   the UI (office Withdraw): 'withdraw' — while the Staff App's
--     "You've been removed from this shift" screen matched only
--     'office_withdraw', so it never showed.
-- The one kept is named after the scope's own triggers and is what the SQL
-- write paths already emit, so no function body changes:
--   → cancelled: office_withdraw (§3.3/§3.6), ready_cutoff (§3.5),
--     self_cancel (RULE-04), overlap_auto_withdraw (§3.4), event_cancelled
--     (§3.3), blocked / left / gdpr (§4.3·§9.6·§10.7 / §10.6 / §1.7) and
--     their `_invite` halves (block_worker's invitation-or-application
--     release, kept apart so E8 lists only confirmed shifts)
--   → closed:    slot_taken (§3.4), declined (§10.4),
--     withdrawn_by_worker (§10.4)
-- `compliance_block` is dropped for `blocked`: a manual block (§9.6) and a
-- conviction under review (§10.7) release through the same cascade, and
-- neither is a compliance failure.
--
-- The check ties each cause to the one status it belongs to; a live
-- booking carries none.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The edges.
-- ---------------------------------------------------------------------
create or replace function public.booking_transitions()
returns table (from_status booking_status, to_status booking_status)
language sql
immutable
set search_path = public, extensions
as $$
  select f::booking_status, t::booking_status
    from (values
      ('invited',   'confirmed'),   -- §3.6 Accept
      ('invited',   'cancelled'),   -- §3.6 Withdraw/GDPR, §3.4 overlap, §4.3 cascade, §3.3
      ('invited',   'closed'),      -- §3.4 slot taken, §10.4 Decline
      ('applied',   'confirmed'),   -- §10.4 / N10 application taken forward
      ('applied',   'cancelled'),   -- §3.3 event cancelled, §4.3·§10.6·§1.7 cascade
      ('applied',   'closed'),      -- §10.4 withdrawn by the worker, N10c role filled
      ('closed',    'applied'),     -- §10.4 apply again on Radar
      ('confirmed', 'worked'),      -- §3.6 [shift + checklog]
      ('confirmed', 'turned_away'), -- RULE-15 strict buffer turn-away
      ('confirmed', 'cancelled')    -- §3.6 Withdraw/cutoff/GDPR/self-cancel, §3.3, §4.3
    ) as e(f, t)
$$;

comment on function public.booking_transitions() is
  'The §3.6 booking state machine as data: every legal status change. Mirrors BOOKING_TRANSITIONS in packages/domain/src/state.ts; both are held to bookingState.vectors.json (490_booking_state_machine.sql, state.test.ts).';

create or replace function public.booking_transition_allowed(p_from booking_status, p_to booking_status)
returns boolean
language sql
immutable
set search_path = public, extensions
as $$
  -- Staying put is not a transition: attempt_check_in re-stamping `worked`
  -- or a cascade re-cancelling must not raise.
  select p_from = p_to
      or exists (select 1 from booking_transitions() t
                  where t.from_status = p_from and t.to_status = p_to)
$$;

create or replace function public.assert_booking_transition(p_from booking_status, p_to booking_status)
returns void
language plpgsql
immutable
set search_path = public, extensions
as $$
begin
  if not booking_transition_allowed(p_from, p_to) then
    raise exception 'illegal_booking_transition: % -> %', p_from, p_to
      using errcode = 'P0001',
            hint = 'Scope §3.6. The legal edges are listed by booking_transitions().';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2 · The guard. BEFORE, so a refused change never reaches the rota guard
-- or any AFTER trigger; WHEN, so an update that leaves status alone (a
-- reconfirm, a day-before stamp) costs nothing.
-- ---------------------------------------------------------------------
create or replace function public.bookings_state_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  perform assert_booking_transition(old.status, new.status);
  return new;
end $$;

drop trigger if exists bookings_state_guard on bookings;
create trigger bookings_state_guard
  before update of status on bookings
  for each row
  when (old.status is distinct from new.status)
  execute function bookings_state_guard();

comment on function public.bookings_state_guard() is
  'Refuses any bookings.status change that is not an edge of booking_transitions() (Scope §3.6, CLAUDE.md). The DB half of assertBookingTransition() in packages/domain/src/state.ts.';

-- A trigger function is never called directly; the other three are pure
-- and harmless, and a screen may ask them before offering a button.
revoke execute on function public.bookings_state_guard() from public, anon, authenticated;
revoke execute on function public.booking_transitions() from public, anon;
revoke execute on function public.booking_transition_allowed(booking_status, booking_status) from public, anon;
revoke execute on function public.assert_booking_transition(booking_status, booking_status) from public, anon;
grant execute on function public.booking_transitions() to authenticated, service_role;
grant execute on function public.booking_transition_allowed(booking_status, booking_status) to authenticated, service_role;
grant execute on function public.assert_booking_transition(booking_status, booking_status) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3 · cancel_cause: migrate the rows, then constrain the column.
-- ---------------------------------------------------------------------
update bookings set cancel_cause = case cancel_cause
                                     when 'withdraw'         then 'office_withdraw'
                                     when 'cutoff'           then 'ready_cutoff'
                                     when 'compliance_block' then 'blocked'
                                   end
 where cancel_cause in ('withdraw', 'cutoff', 'compliance_block');

-- A cause on a booking that is still live (or worked) describes nothing:
-- every writer sets the cause in the same statement that sets the status,
-- and apply_to_shift clears it on revival. Nothing reads one there.
update bookings set cancel_cause = null
 where cancel_cause is not null
   and status not in ('cancelled', 'closed');

-- Anything left over is a value no known writer produces. Mapping it by
-- guesswork would rewrite history, so the migration stops and names it.
do $$
declare v_bad text;
begin
  select string_agg(distinct format('%s/%s', status, cancel_cause), ', ') into v_bad
    from bookings
   where cancel_cause is not null
     and not (
       (status = 'cancelled' and cancel_cause in (
          'office_withdraw', 'ready_cutoff', 'self_cancel', 'overlap_auto_withdraw',
          'event_cancelled', 'blocked', 'blocked_invite', 'left', 'left_invite',
          'gdpr', 'gdpr_invite'))
       or (status = 'closed' and cancel_cause in ('slot_taken', 'declined', 'withdrawn_by_worker')));
  if v_bad is not null then
    raise exception 'bookings.cancel_cause holds values outside the §3.6 vocabulary: %', v_bad
      using hint = 'Map them in this migration before applying it (docs/14 §4 B3).';
  end if;
end $$;

alter table bookings drop constraint if exists bookings_cancel_cause_check;
alter table bookings add constraint bookings_cancel_cause_check check (
  cancel_cause is null
  or (status = 'cancelled' and cancel_cause in (
        'office_withdraw', 'ready_cutoff', 'self_cancel', 'overlap_auto_withdraw',
        'event_cancelled', 'blocked', 'blocked_invite', 'left', 'left_invite',
        'gdpr', 'gdpr_invite'))
  or (status = 'closed' and cancel_cause in ('slot_taken', 'declined', 'withdrawn_by_worker'))
);

comment on column bookings.cancel_cause is
  'Why the booking left the live states (Scope §3.6). cancelled: office_withdraw · ready_cutoff · self_cancel · overlap_auto_withdraw · event_cancelled · blocked · blocked_invite · left · left_invite · gdpr · gdpr_invite. closed: slot_taken · declined · withdrawn_by_worker. Null while live. CANCEL_CAUSES in packages/domain/src/state.ts; bookings_cancel_cause_check.';
