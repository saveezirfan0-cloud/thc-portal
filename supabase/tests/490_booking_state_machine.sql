-- =====================================================================
-- 490 · The booking state machine and cancel_cause (Scope §3.6)
--   booking_transitions(), booking_transition_allowed(),
--   assert_booking_transition(), the bookings_state_guard trigger and
--   bookings_cancel_cause_check from 20260924120000_booking_state_machine.sql
--   (docs/14 §4 B2, B3)
--
--   1. The machine, held to packages/domain/src/bookingState.vectors.json —
--      the same file Vitest holds BOOKING_TRANSITIONS to.
--   2. The trigger, driven through every one of the 49 status pairs on a
--      real row: an edge (or staying put) goes through, anything else is
--      refused with illegal_booking_transition.
--   3. The cancel_cause vocabulary: each cause with its one status, never
--      with the other, never on a live booking, and the three retired
--      spellings refused.
--   4. The write paths the office uses straight from a server action.
-- =====================================================================
begin;
select plan(20);
\ir _shared/fixtures.psql
\ir _shared/booking_state_vectors.psql

-- ---------------------------------------------------------------------
-- 1 · The machine against the shared vectors
-- ---------------------------------------------------------------------
select set_eq(
  $$ select unnest(enum_range(null::booking_status))::text $$,
  $$ select status from booking_status_vectors $$,
  format('the vectors name all %s booking_status values the database can hold — not four of them', :booking_status_count));

select is((select count(*)::int from booking_transitions()), :booking_edge_count,
  format('booking_transitions() has exactly the %s edges of bookingState.vectors.json', :booking_edge_count));

select set_eq(
  $$ select from_status::text, to_status::text from booking_transitions() $$,
  $$ select from_status, to_status from booking_edge_vectors $$,
  'booking_transitions() is bookingState.vectors.json edge for edge');

select results_eq(
  $$ select f.status, t.status,
            booking_transition_allowed(f.status::booking_status, t.status::booking_status)
       from booking_status_vectors f cross join booking_status_vectors t
      order by 1, 2 $$,
  $$ select f.status, t.status,
            f.status = t.status
            or exists (select 1 from booking_edge_vectors e
                        where e.from_status = f.status and e.to_status = t.status)
       from booking_status_vectors f cross join booking_status_vectors t
      order by 1, 2 $$,
  'booking_transition_allowed() agrees with the vectors on all 49 pairs: an edge or staying put, nothing else');

select is_empty(
  $$ select from_status::text || '->' || to_status::text from booking_transitions()
      where from_status in ('worked', 'turned_away')
         or (from_status = 'cancelled' and to_status not in ('invited', 'applied')) $$,
  'worked and turned_away are terminal (§3.6: No check-out is a branch of worked, not a state); cancelled leaves only by a reopen to invited/applied, never a self-cancel (20260929110100, ADR-0031)');

-- ---------------------------------------------------------------------
-- 2 · The trigger, on a real row, for every pair
-- ---------------------------------------------------------------------
create function pg_temp.move(p_shift uuid, p_staff uuid, p_from booking_status, p_to booking_status)
returns text language plpgsql as $$
declare v_id uuid;
begin
  delete from bookings where shift_id = p_shift and staff_id = p_staff;
  insert into bookings (shift_id, staff_id, status, source)
  values (p_shift, p_staff, p_from, 'manual') returning id into v_id;
  begin
    update bookings set status = p_to where id = v_id;
    return 'allowed';
  exception when sqlstate 'P0001' then
    if sqlerrm = format('illegal_booking_transition: %s -> %s', p_from, p_to) then
      return 'refused';
    end if;
    return 'error: ' || sqlerrm;
  end;
end $$;

select results_eq(
  format($$ select f.status, t.status,
                   pg_temp.move(%L, %L, f.status::booking_status, t.status::booking_status)
              from booking_status_vectors f cross join booking_status_vectors t
             order by 1, 2 $$, :'shift_a', :'staffb'),
  $$ select f.status, t.status,
            case when f.status = t.status
                   or exists (select 1 from booking_edge_vectors e
                               where e.from_status = f.status and e.to_status = t.status)
                 then 'allowed' else 'refused' end
       from booking_status_vectors f cross join booking_status_vectors t
      order by 1, 2 $$,
  'bookings_state_guard: a direct UPDATE takes every edge and refuses every other pair, by name');
delete from bookings where shift_id = :'shift_a' and staff_id = :'staffb';

select throws_ok(
  format($$ update bookings set status = 'invited' where id = %L $$, :'booking_a'),
  'P0001', 'illegal_booking_transition: confirmed -> invited',
  'a confirmed booking cannot be put back to invited by hand');

update bookings set status = 'worked' where id = :'booking_a';
select throws_ok(
  format($$ update bookings set status = 'cancelled', cancelled_at = now(),
                                 cancel_cause = 'event_cancelled' where id = %L $$, :'booking_a'),
  'P0001', 'illegal_booking_transition: worked -> cancelled',
  'a worked booking is not cancelled after the fact: §3.3 pays the scheduled hours instead');

select lives_ok(
  format($$ update bookings set status = 'worked', reconfirm_required = false where id = %L $$, :'booking_a'),
  'staying in worked is not a transition: attempt_check_in re-stamping the status does not raise');

select lives_ok(
  format($$ update bookings set on_day_confirmed_at = now() where id = %L $$, :'booking_b'),
  'an update that leaves status alone never reaches the guard');

-- ---------------------------------------------------------------------
-- 3 · cancel_cause
-- ---------------------------------------------------------------------
create function pg_temp.cause_ok(p_shift uuid, p_staff uuid, p_status booking_status, p_cause text)
returns boolean language plpgsql as $$
begin
  delete from bookings where shift_id = p_shift and staff_id = p_staff;
  begin
    insert into bookings (shift_id, staff_id, status, source, cancelled_at, cancel_cause)
    values (p_shift, p_staff, p_status, 'manual',
            case when p_status in ('cancelled', 'closed') then now() end, p_cause);
    return true;
  exception when check_violation then
    return false;
  end;
end $$;

select is((select count(*)::int from cancel_cause_vectors), :cancel_cause_count,
  format('all %s causes loaded from bookingState.vectors.json', :cancel_cause_count));

select is_empty(
  format($$ select cause from cancel_cause_vectors
             where not pg_temp.cause_ok(%L, %L, status::booking_status, cause) $$,
         :'shift_a', :'staffb'),
  'every cause of the vocabulary is accepted with its own status');

select is_empty(
  format($$ select cause from cancel_cause_vectors
             where pg_temp.cause_ok(%L, %L,
                     (case status when 'cancelled' then 'closed' else 'cancelled' end)::booking_status,
                     cause) $$,
         :'shift_a', :'staffb'),
  'and refused with the other one: a Decline is not a cancellation, a Withdraw is not a closed offer');

select is_empty(
  format($$ select s.status || '/' || c.cause
              from cancel_cause_vectors c
             cross join (values ('invited'), ('applied'), ('confirmed'), ('worked'), ('turned_away')) s(status)
             where pg_temp.cause_ok(%L, %L, s.status::booking_status, c.cause) $$,
         :'shift_a', :'staffb'),
  'a live, worked or turned-away booking carries no cause at all');

select is_empty(
  format($$ select legacy from legacy_cause_vectors
             where pg_temp.cause_ok(%L, %L, 'cancelled', legacy)
                or pg_temp.cause_ok(%L, %L, 'closed', legacy) $$,
         :'shift_a', :'staffb', :'shift_a', :'staffb'),
  'the retired spellings — withdraw, cutoff, compliance_block — are refused outright');

select ok(pg_temp.cause_ok(:'shift_a', :'staffb', 'cancelled', null),
  'a cancelled row with no recorded cause is still accepted (pre-B3 history, and fixtures that build one)');
delete from bookings where shift_id = :'shift_a' and staff_id = :'staffb';

-- ---------------------------------------------------------------------
-- 4 · The office's direct writes (apps/office/app/events/[id]/actions.ts)
-- ---------------------------------------------------------------------
insert into bookings (id, shift_id, staff_id, status, source)
values ('49049049-0000-4000-8000-000000000001', :'shift_a', :'staffb', 'invited', 'manual');

select throws_ok(
  $$ update bookings set status = 'cancelled', cancelled_at = now(), cancel_cause = 'withdraw'
      where id = '49049049-0000-4000-8000-000000000001' $$,
  '23514', null,
  'Withdraw with the old UI spelling is refused by bookings_cancel_cause_check');

select lives_ok(
  $$ update bookings set status = 'cancelled', cancelled_at = now(), cancel_cause = 'office_withdraw'
      where id = '49049049-0000-4000-8000-000000000001' $$,
  'Withdraw as the office now writes it: invited → cancelled / office_withdraw');

select throws_ok(
  format($$ update bookings set status = 'applied' where id = %L $$, :'booking_b'),
  'P0001', 'illegal_booking_transition: confirmed -> applied',
  'Radar cannot revive a confirmed booking into an application');

select lives_ok(
  format($$ update bookings set status = 'cancelled', cancelled_at = now(),
                                 cancel_cause = 'event_cancelled' where id = %L $$, :'booking_b'),
  'Cancel event as the office writes it: confirmed → cancelled / event_cancelled');

select * from finish();
rollback;
