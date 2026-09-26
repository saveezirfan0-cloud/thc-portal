-- =====================================================================
-- 701 · The staff additions — machines, builders and CHECKs
--   20260930200100_staff_additions_schema.sql · docs/19 · ADR-0042 … 0045
--
--   A. profile_change_requests (ADR-0044): profile_change_transitions() is
--      changeRequest.vectors.json edge for edge; the guard drives every one
--      of the 16 status pairs on a real row; the proposed values are fixed;
--      the name and decision CHECKs agree with the vectors.
--   B. shift_offers (ADR-0045): shift_offer_transitions() and
--      shift_offer_mode_transitions() are shiftOffer.vectors.json; all 25
--      status pairs and all 9 mode pairs through the guard; the booking,
--      worker and target are fixed; one open offer per booking.
--   C. staff_unavailability (ADR-0042): unavailability_range() and
--      staff_unavailable() against availability.vectors.json — UK
--      midnights, the 23 h and 25 h days, overnight windows, weekly copies
--      that keep their wall-clock time, the half-open overlap — and the
--      table's CHECKs against the validation cases.
--   D. bookings: cancel_cause 'handed_over' and booking_source 'offer'
--      (490 holds the whole vocabulary through bookingState.vectors.json).
-- =====================================================================
begin;
select plan(59);
\ir _shared/fixtures.psql
\ir _shared/change_request_vectors.psql
\ir _shared/shift_offer_vectors.psql
\ir _shared/availability_vectors.psql

-- =====================================================================
-- A · profile_change_requests
-- =====================================================================
select set_eq(
  $$ select from_status, to_status from profile_change_transitions() $$,
  $$ select from_status, to_status from change_request_edge_vectors $$,
  'A: profile_change_transitions() is changeRequest.vectors.json edge for edge');

select is((select count(*)::int from profile_change_transitions()), :change_request_edge_count,
  format('A: and has exactly its %s edges', :change_request_edge_count));

select set_eq(
  $$ select (regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g'))[1]
       from pg_constraint c where c.conname = 'profile_change_requests_status' $$,
  $$ select status from change_request_status_vectors $$,
  'A: the status CHECK allows exactly the statuses of the vectors');

create function pg_temp.cr_move(p_staff uuid, p_from text, p_to text)
returns text language plpgsql as $$
declare v_id uuid;
begin
  delete from profile_change_requests where staff_id = p_staff;
  insert into profile_change_requests (staff_id, kind, proposed_photo_path)
  values (p_staff, 'photo', p_staff::text || '/move.jpg') returning id into v_id;
  if p_from <> 'pending' then
    update profile_change_requests
       set status = p_from, decision_reason = case when p_from = 'rejected' then 'setup' end
     where id = v_id;
  end if;
  begin
    update profile_change_requests
       set status = p_to,
           decision_reason = case when p_to = 'rejected' then 'moved' else decision_reason end
     where id = v_id;
    return 'allowed';
  exception when sqlstate 'P0001' then
    if sqlerrm = format('illegal_change_request_transition: %s -> %s', p_from, p_to) then
      return 'refused';
    end if;
    return 'error: ' || sqlerrm;
  end;
end $$;

select results_eq(
  format($$ select f.status, t.status, pg_temp.cr_move(%L, f.status, t.status)
              from change_request_status_vectors f cross join change_request_status_vectors t
             order by 1, 2 $$, :'staffb'),
  $$ select f.status, t.status,
            case when f.status = t.status
                   or exists (select 1 from change_request_edge_vectors e
                               where e.from_status = f.status and e.to_status = t.status)
                 then 'allowed' else 'refused' end
       from change_request_status_vectors f cross join change_request_status_vectors t
      order by 1, 2 $$,
  'A: profile_change_requests_state_guard takes every edge and refuses every other pair, by name (16 pairs)');
delete from profile_change_requests where staff_id = :'staffb';

select throws_ok(
  format($$ insert into profile_change_requests (staff_id, kind, status, proposed_photo_path, decided_at)
            values (%L, 'photo', 'approved', %L, now()) $$, :'staffb', :'staffb' || '/x.jpg'),
  'P0001', 'illegal_change_request_transition: (new) -> approved',
  'A: a request is born pending — nothing inserts one already decided');

\set pcr_name '65110000-0000-4000-8000-000000000001'
\set pcr_photo '65110000-0000-4000-8000-000000000002'
insert into profile_change_requests (id, staff_id, kind, proposed_first_name, proposed_last_name, evidence_path, worker_note)
values (:'pcr_name', :'staffb', 'name', 'Tomas', 'Bravo-Lee', :'staffb' || '/change-requests/ev.pdf', 'Married');

select is((select decided_at from profile_change_requests where id = :'pcr_name'), null::timestamptz,
  'A: a pending request has no decided_at');

select lives_ok(
  format($$ insert into profile_change_requests (id, staff_id, kind, proposed_photo_path)
            values (%L, %L, 'photo', %L) $$, :'pcr_photo', :'staffb', :'staffb' || '/new.jpg'),
  'A: a pending name and a pending photo may coexist');

select throws_ok(
  format($$ insert into profile_change_requests (staff_id, kind, proposed_photo_path)
            values (%L, 'photo', %L) $$, :'staffb', :'staffb' || '/newer.jpg'),
  '23505', null,
  'A: but not two pending of one kind (profile_change_requests_one_pending)');

select throws_ok(
  format($$ update profile_change_requests set proposed_last_name = 'Someone' where id = %L $$, :'pcr_name'),
  'P0001', 'change_request_immutable',
  'A: the proposed name is fixed once asked — the office approves exactly what was asked');

select throws_ok(
  format($$ update profile_change_requests set proposed_photo_path = %L where id = %L $$,
         :'staffb' || '/other.jpg', :'pcr_photo'),
  'P0001', 'change_request_immutable',
  'A: so is the proposed photo');

select throws_ok(
  format($$ update profile_change_requests set kind = 'photo' where id = %L $$, :'pcr_name'),
  'P0001', 'change_request_immutable',
  'A: and the kind');

select throws_ok(
  format($$ update profile_change_requests set applied_at = now() where id = %L $$, :'pcr_name'),
  '23514', null,
  'A: only an approved request can have been applied');

select throws_ok(
  format($$ update profile_change_requests set status = 'rejected' where id = %L $$, :'pcr_name'),
  '23514', null,
  'A: a rejection without a reason is refused — the worker is shown it');

update profile_change_requests set status = 'approved', applied_at = now(),
       previous_value = jsonb_build_object('firstName', 'Tom', 'lastName', 'Bravo')
 where id = :'pcr_name';
select isnt((select decided_at from profile_change_requests where id = :'pcr_name'), null::timestamptz,
  'A: leaving pending stamps decided_at');

select throws_ok(
  format($$ update profile_change_requests set status = 'withdrawn' where id = %L $$, :'pcr_name'),
  'P0001', 'illegal_change_request_transition: approved -> withdrawn',
  'A: a decided request is terminal — "Request again" is a new row');

-- Shape CHECKs: a name needs evidence (Q13); paths are the worker's own.
select throws_ok(
  format($$ insert into profile_change_requests (staff_id, kind, proposed_first_name, proposed_last_name)
            values (%L, 'name', 'Tomas', 'Lee') $$, :'staffa'),
  '23514', null, 'A: a name request without its evidence is refused (Q13)');
select throws_ok(
  format($$ insert into profile_change_requests (staff_id, kind, proposed_photo_path)
            values (%L, 'photo', %L) $$, :'staffa', :'staffb' || '/new.jpg'),
  '23514', null, 'A: a photo path in another worker''s folder is refused');
select throws_ok(
  format($$ insert into profile_change_requests (staff_id, kind, proposed_photo_path)
            values (%L, 'photo', %L) $$, :'staffa', :'staffa' || '/../' || :'staffb' || '/new.jpg'),
  '23514', null, 'A: and so is one that climbs out of it');
select throws_ok(
  format($$ insert into profile_change_requests (staff_id, kind, proposed_first_name, proposed_last_name, evidence_path)
            values (%L, 'name', 'Tomas', 'Lee', %L) $$, :'staffa', :'staffa' || '/passport.pdf'),
  '23514', null, 'A: name evidence lives under <staff_id>/change-requests/');
select throws_ok(
  format($$ insert into profile_change_requests (staff_id, kind, proposed_photo_path, proposed_first_name)
            values (%L, 'photo', %L, 'Tomas') $$, :'staffa', :'staffa' || '/new.jpg'),
  '23514', null, 'A: a photo request carries no names');

-- The name and decision CHECKs against the vectors.
create function pg_temp.name_ok(p_staff uuid, p_first text, p_last text)
returns boolean language plpgsql as $$
begin
  delete from profile_change_requests where staff_id = p_staff;
  begin
    insert into profile_change_requests (staff_id, kind, proposed_first_name, proposed_last_name, evidence_path)
    values (p_staff, 'name', btrim(p_first), btrim(p_last), p_staff::text || '/change-requests/e.pdf');
    return true;
  exception when check_violation then
    return false;
  end;
end $$;

-- 'unchanged' is the RPC's refusal (it needs the name on file); the
-- table stores any 1–100-character trimmed name.
select is_empty(
  format($$ select name from change_request_name_vectors
             where pg_temp.name_ok(%L, first_name, last_name)
                <> (refusal is null or refusal = 'unchanged') $$, :'staffa'),
  'A: the name CHECKs agree with validateNameChange() on every case (trimmed, 1–100)');

create function pg_temp.decision_ok(p_staff uuid, p_approve boolean, p_reason text)
returns boolean language plpgsql as $$
declare v_id uuid;
begin
  delete from profile_change_requests where staff_id = p_staff;
  insert into profile_change_requests (staff_id, kind, proposed_photo_path)
  values (p_staff, 'photo', p_staff::text || '/d.jpg') returning id into v_id;
  begin
    update profile_change_requests
       set status = case when p_approve then 'approved' else 'rejected' end,
           decision_reason = p_reason
     where id = v_id;
    return true;
  exception when check_violation then
    return false;
  end;
end $$;

select is_empty(
  format($$ select name from change_request_decision_vectors
             where pg_temp.decision_ok(%L, approve, reason) <> (refusal is null) $$, :'staffa'),
  'A: the decision CHECKs agree with validateDecision(): reason required on reject, at most 300');
delete from profile_change_requests where staff_id in (:'staffa', :'staffb');

-- =====================================================================
-- B · shift_offers
-- =====================================================================
select set_eq(
  $$ select from_status, to_status from shift_offer_transitions() $$,
  $$ select from_status, to_status from shift_offer_edge_vectors $$,
  'B: shift_offer_transitions() is shiftOffer.vectors.json edge for edge');

select is((select count(*)::int from shift_offer_transitions()), :shift_offer_edge_count,
  format('B: and has exactly its %s edges', :shift_offer_edge_count));

select set_eq(
  $$ select from_mode, to_mode from shift_offer_mode_transitions() $$,
  $$ select from_mode, to_mode from shift_offer_mode_edge_vectors $$,
  'B: shift_offer_mode_transitions() is the vectors'' one mode edge: office → pool');

select set_eq(
  $$ select (regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g'))[1]
       from pg_constraint c where c.conname = 'shift_offers_status' $$,
  $$ select status from shift_offer_status_vectors $$,
  'B: the status CHECK allows exactly the statuses of the vectors');

select set_eq(
  $$ select (regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g'))[1]
       from pg_constraint c where c.conname = 'shift_offers_mode' $$,
  $$ select mode from shift_offer_mode_vectors $$,
  'B: the mode CHECK allows exactly the modes of the vectors');

create function pg_temp.so_move(p_booking uuid, p_taker_booking uuid, p_taker uuid, p_from text, p_to text)
returns text language plpgsql as $$
declare v_id uuid;
begin
  delete from shift_offers where booking_id = p_booking;
  insert into shift_offers (booking_id, expires_at) values (p_booking, now() + interval '1 day')
  returning id into v_id;
  if p_from <> 'open' then
    update shift_offers
       set status = p_from,
           taken_by_booking_id = case when p_from = 'taken' then p_taker_booking end,
           taken_by_staff_id   = case when p_from = 'taken' then p_taker end
     where id = v_id;
  end if;
  begin
    update shift_offers
       set status = p_to,
           taken_by_booking_id = case when p_to = 'taken' then p_taker_booking else taken_by_booking_id end,
           taken_by_staff_id   = case when p_to = 'taken' then p_taker else taken_by_staff_id end
     where id = v_id;
    return 'allowed';
  exception when sqlstate 'P0001' then
    if sqlerrm = format('illegal_shift_offer_transition: %s -> %s', p_from, p_to) then
      return 'refused';
    end if;
    return 'error: ' || sqlerrm;
  end;
end $$;

select results_eq(
  format($$ select f.status, t.status, pg_temp.so_move(%L, %L, %L, f.status, t.status)
              from shift_offer_status_vectors f cross join shift_offer_status_vectors t
             order by 1, 2 $$, :'booking_b', :'booking_a', :'staffa'),
  $$ select f.status, t.status,
            case when f.status = t.status
                   or exists (select 1 from shift_offer_edge_vectors e
                               where e.from_status = f.status and e.to_status = t.status)
                 then 'allowed' else 'refused' end
       from shift_offer_status_vectors f cross join shift_offer_status_vectors t
      order by 1, 2 $$,
  'B: shift_offers_state_guard takes every edge and refuses every other pair, by name (25 pairs)');
delete from shift_offers where booking_id = :'booking_b';

create function pg_temp.mode_move(p_booking uuid, p_target uuid, p_from text, p_to text)
returns text language plpgsql as $$
declare v_id uuid;
begin
  delete from shift_offers where booking_id = p_booking;
  insert into shift_offers (booking_id, mode, target_staff_id, expires_at)
  values (p_booking, p_from, case when p_from = 'direct' then p_target end, now() + interval '1 day')
  returning id into v_id;
  begin
    update shift_offers set mode = p_to where id = v_id;
    return 'allowed';
  exception when sqlstate 'P0001' then
    if sqlerrm = format('illegal_shift_offer_mode: %s -> %s', p_from, p_to) then
      return 'refused';
    end if;
    return 'error: ' || sqlerrm;
  end;
end $$;

select results_eq(
  format($$ select f.mode, t.mode, pg_temp.mode_move(%L, %L, f.mode, t.mode)
              from shift_offer_mode_vectors f cross join shift_offer_mode_vectors t
             order by 1, 2 $$, :'booking_b', :'staffa'),
  $$ select f.mode, t.mode,
            case when f.mode = t.mode
                   or exists (select 1 from shift_offer_mode_edge_vectors e
                               where e.from_mode = f.mode and e.to_mode = t.mode)
                 then 'allowed' else 'refused' end
       from shift_offer_mode_vectors f cross join shift_offer_mode_vectors t
      order by 1, 2 $$,
  'B: while open, the only mode change is office → pool (9 pairs)');
delete from shift_offers where booking_id = :'booking_b';

\set so1 '65120000-0000-4000-8000-000000000001'
insert into shift_offers (id, booking_id, mode, expires_at, note)
values (:'so1', :'booking_b', 'office', now() + interval '1 day', 'Family emergency');

select results_eq(
  format($$ select shift_id, offered_by_staff_id from shift_offers where id = %L $$, :'so1'),
  format($$ values (%L::uuid, %L::uuid) $$, :'shift_b', :'staffb'),
  'B: the section and the offering worker are filled from the booking');

select throws_ok(
  format($$ insert into shift_offers (booking_id, expires_at) values (%L, now() + interval '1 day') $$, :'booking_b'),
  '23505', null,
  'B: one open offer per booking (shift_offers_one_open_per_booking)');

select throws_ok(
  format($$ update shift_offers set booking_id = %L where id = %L $$, :'booking_a', :'so1'),
  'P0001', 'shift_offer_immutable',
  'B: an offer''s booking never changes');

select throws_ok(
  format($$ update shift_offers set status = 'taken', taken_by_booking_id = %L,
                                 taken_by_staff_id = %L where id = %L $$,
         :'booking_a', :'staffb', :'so1'),
  '23514', null,
  'B: the offerer can never be the taker (shift_offers_not_own)');

select throws_ok(
  format($$ update shift_offers set status = 'taken' where id = %L $$, :'so1'),
  '23514', null,
  'B: taken names the taker and the taker''s booking');

update shift_offers set status = 'cancelled', closed_reason = 'Covered by hand' where id = :'so1';
select isnt((select closed_at from shift_offers where id = :'so1'), null::timestamptz,
  'B: leaving open stamps closed_at');

select throws_ok(
  format($$ update shift_offers set mode = 'pool' where id = %L $$, :'so1'),
  'P0001', 'illegal_shift_offer_mode: office -> pool',
  'B: a closed cover request cannot be opened to the pool');

select lives_ok(
  format($$ insert into shift_offers (booking_id, expires_at) values (%L, now() + interval '1 day') $$, :'booking_b'),
  'B: once the first is closed the booking may be offered again');

select throws_ok(
  format($$ insert into shift_offers (booking_id, offered_by_staff_id, expires_at)
            values (%L, %L, now() + interval '1 day') $$, :'booking_a', :'staffb'),
  'P0001', 'shift_offer_booking_mismatch',
  'B: an offer names the booking''s own worker, nobody else');

select throws_ok(
  format($$ insert into shift_offers (booking_id, status, expires_at, closed_at)
            values (%L, 'lapsed', now() + interval '1 day', now()) $$, :'booking_a'),
  'P0001', 'illegal_shift_offer_transition: (new) -> lapsed',
  'B: an offer is born open');

select throws_ok(
  format($$ insert into shift_offers (booking_id, mode, expires_at) values (%L, 'direct', now() + interval '1 day') $$,
         :'booking_a'),
  '23514', null,
  'B: a direct offer names its colleague (shift_offers_target)');
delete from shift_offers where booking_id in (:'booking_a', :'booking_b');

-- =====================================================================
-- C · staff_unavailability
-- =====================================================================
create function pg_temp.range_error(p_from_date date, p_to_date date, p_from time, p_to time)
returns text language plpgsql as $$
begin
  perform unavailability_range(p_from_date, p_to_date, p_from, p_to);
  return null;
exception when sqlstate '22023' then
  return sqlerrm;
end $$;

select is((select count(*)::int from availability_range_vectors), :availability_range_count,
  format('C: all %s range cases loaded from availability.vectors.json', :availability_range_count));

select is_empty(
  $$ select name from availability_range_vectors
      where error is null
        and unavailability_range(from_date, to_date, from_time, to_time)
            is distinct from tstzrange(lower_at, upper_at, '[)') $$,
  'C: unavailability_range() builds every range of the vectors — UK midnights, overnight windows, ranges');

select is_empty(
  $$ select name from availability_range_vectors
      where error is null
        and extract(epoch from upper(unavailability_range(from_date, to_date, from_time, to_time))
                             - lower(unavailability_range(from_date, to_date, from_time, to_time))) / 3600
            <> hours $$,
  'C: and each is as long as the vectors say — 23 h on 29 Mar, 25 h on 25 Oct, 168 h for seven days');

select is_empty(
  $$ select name from availability_range_vectors
      where error is not null
        and pg_temp.range_error(from_date, to_date, from_time, to_time) is distinct from error $$,
  'C: from == to, one time alone and to before from raise bad_window (22023)');

create function pg_temp.overlaps(p_staff uuid, p_from_date date, p_to_date date, p_from time, p_to time,
                                 p_starts timestamptz, p_ends timestamptz)
returns boolean language plpgsql as $$
declare v boolean;
begin
  delete from staff_unavailability where staff_id = p_staff;
  insert into staff_unavailability (staff_id, period, all_day)
  values (p_staff, unavailability_range(p_from_date, p_to_date, p_from, p_to), p_from is null);
  v := staff_unavailable(p_staff, p_starts, p_ends);
  delete from staff_unavailability where staff_id = p_staff;
  return v;
end $$;

select is((select count(*)::int from availability_overlap_vectors), :availability_overlap_count,
  format('C: all %s overlap cases loaded', :availability_overlap_count));

select is_empty(
  format($$ select name from availability_overlap_vectors
             where pg_temp.overlaps(%L, from_date, to_date, from_time, to_time,
                                    section_starts, section_ends) <> expect_overlap $$, :'staffb'),
  'C: staff_unavailable() agrees with overlapsSection(): half-open against the ROLE section (RULE-18)');

select is_empty(
  $$ select name || '#' || week from availability_weekly_vectors
      where unavailability_range(from_date + 7 * week, coalesce(to_date, from_date) + 7 * week,
                                 from_time, to_time)
            is distinct from tstzrange(lower_at, upper_at, '[)') $$,
  'C: a weekly copy built from its own UK date keeps 18:00 UK across 25 Oct (expandWeekly)');

-- The table's CHECKs against the validation cases that are about shape:
-- ok is storable, too_long is refused. in_past / too_far / too_many need
-- the clock and the worker's other rows, and are the RPC's (705).
create function pg_temp.entry_ok(p_staff uuid, p_input jsonb)
returns boolean language plpgsql as $$
begin
  delete from staff_unavailability where staff_id = p_staff;
  begin
    insert into staff_unavailability (staff_id, period, all_day)
    values (p_staff,
            unavailability_range((p_input ->> 'fromDate')::date, (p_input ->> 'toDate')::date,
                                 (p_input ->> 'fromTime')::time, (p_input ->> 'toTime')::time),
            p_input ->> 'fromTime' is null);
    return true;
  exception when check_violation then
    return false;
  end;
end $$;

select is_empty(
  format($$ select name from availability_validation_vectors
             where (expect is null or expect = 'too_long')
               and pg_temp.entry_ok(%L, input) <> (expect is null) $$, :'staffb'),
  'C: 31 UK days is storable (across the autumn change too); 32 is refused by the CHECK');
delete from staff_unavailability where staff_id = :'staffb';

select throws_ok(
  format($$ insert into staff_unavailability (staff_id, period) values (%L, 'empty'::tstzrange) $$, :'staffb'),
  '23514', null, 'C: an empty range is refused');
select throws_ok(
  format($$ insert into staff_unavailability (staff_id, period) values (%L, tstzrange(now(), null)) $$, :'staffb'),
  '23514', null, 'C: an open-ended range is refused');
select throws_ok(
  format($$ insert into staff_unavailability (staff_id, period)
            values (%L, tstzrange(now(), now() + interval '1 hour', '(]')) $$, :'staffb'),
  '23514', null, 'C: a range that is not [start, end) is refused');
select throws_ok(
  format($$ insert into staff_unavailability (staff_id, period, all_day)
            values (%L, unavailability_range(current_date + 3, null, '09:00', '13:00'), true) $$, :'staffb'),
  '23514', null, 'C: an all-day entry runs UK midnight to UK midnight');

select is(staff_unavailable(:'staffb', now() + interval '2 hours', now() + interval '1 hour'), false,
  'C: staff_unavailable() answers false for a window that ends before it starts');

-- =====================================================================
-- D · bookings: 'handed_over' and 'offer'
-- =====================================================================
select ok('offer' = any (enum_range(null::booking_source)::text[]),
  'D: booking_source carries offer (20260930200000)');

select lives_ok(
  format($$ update bookings set status = 'cancelled', cancelled_at = now(),
                                 cancel_cause = 'handed_over', self_cancelled = true
             where id = %L $$, :'booking_b'),
  'D: a confirmed booking is handed over: cancelled / handed_over, self_cancelled (ADR-0045)');

select throws_ok(
  format($$ insert into bookings (shift_id, staff_id, status, source, cancelled_at, cancel_cause)
            values (%L, %L, 'closed', 'manual', now(), 'handed_over') $$, :'shift_b', :'staffa'),
  '23514', null,
  'D: handed_over is a cancelled cause, never a closed one');

select lives_ok(
  format($$ insert into bookings (shift_id, staff_id, status, source, confirmed_at)
            values (%L, %L, 'confirmed', 'offer', now()) $$, :'shift_b', :'staffa'),
  'D: the taker''s booking is written with source offer');

-- main's D33 (20260930110100) classifies who may reopen an ended row; a
-- completed hand-over is 'never', like the self-cancel it stands for, and
-- the SQL and bookingReopenableBy() (reopen.ts) agree (20260930200100 0b).
select is(booking_reopenable_by('cancelled', 'handed_over'), 'never',
  'D: a handed-over row is never reopened (booking_reopenable_by, ADR-0045)');
select is(booking_reopenable_by('cancelled', 'self_cancel'), 'never',
  'D: and the self-cancel it mirrors still reads never (main''s body kept)');

select * from finish();
rollback;
