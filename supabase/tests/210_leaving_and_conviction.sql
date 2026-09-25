-- =====================================================================
-- 210 · Leaving (§10.6) and the in-employment conviction (§10.7)
--   request_p45(), declare_conviction(), the review trigger, and the
--   staff state machine in SQL
--   from 20260921180312_leaving_and_conviction.sql
--
-- Both sections are the §4.3 cascade with a different reason in front and
-- a different email behind, so what this file is really for is the places
-- they DIFFER from it and from each other:
--
--   * a leaver lands in `inactive`, not `blocked`, and carries a leaving
--     date — a different terminal status through the same cascade
--   * a worker who is checked in cannot leave at all, which is a rule and
--     not a greyed-out button
--   * E9 must never carry the declaration text, which is the most
--     sensitive personal data the platform holds
--   * Verify and Reject on a declaration do opposite things, and only one
--     of them notifies the worker
--
-- Every case pins a fixed instant so the arithmetic is readable.
-- =====================================================================
begin;
select plan(40);
\set now '2026-09-21 12:00:00+01'
\ir _shared/fixtures.psql

\set leaver  'c0000000-0000-4000-8000-000000000001'
\set onshift 'c0000000-0000-4000-8000-000000000002'
\set declar  'c0000000-0000-4000-8000-000000000003'
\set rejectd 'c0000000-0000-4000-8000-000000000004'

-- The fixtures' own bookings are pushed out of reach: this file counts
-- what its own cascades released, and a fixture booking caught by one
-- would be indistinguishable from a bug.
update shift_requirements set starts_at = :'now'::timestamptz + interval '90 days',
                              ends_at   = :'now'::timestamptz + interval '91 days';

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch,
                   employee_id, ni_number) values
  (:'leaver', 'Leaver','One',  'lv1@rls.test','+447700900201', date '1995-01-01','compliant','uk_irish', 90101,'QQ123456C'),
  (:'onshift','OnShift','Two', 'lv2@rls.test','+447700900202', date '1995-01-01','compliant','uk_irish', 90102,'QQ222222C'),
  (:'declar', 'Declare','Three','lv3@rls.test','+447700900203', date '1995-01-01','compliant','uk_irish', 90103,'QQ333333C'),
  (:'rejectd','Reject','Four', 'lv4@rls.test','+447700900204', date '1995-01-01','compliant','uk_irish', 90104,'QQ444444C');

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  ('8d000000-0000-4000-8000-000000000001', :'clienta', :'venue_id', 'The Savoy',
   '1 Strand, London', st_setsrid(st_makepoint(-0.1200, 51.5100), 4326)::geography, 150,
   'Autumn Gala', date '2026-10-05', false, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  -- two in the future, one under way right now, one already worked
  ('8e000000-0000-4000-8000-000000000001','8d000000-0000-4000-8000-000000000001',:'role_id','2026-10-05 18:00+00','2026-10-06 02:00+00',4,0,30,15,1),
  ('8e000000-0000-4000-8000-000000000002','8d000000-0000-4000-8000-000000000001',:'role_id','2026-10-07 18:00+00','2026-10-08 02:00+00',4,0,30,15,1),
  ('8e000000-0000-4000-8000-000000000003','8d000000-0000-4000-8000-000000000001',:'role_id','2026-09-21 09:00+00','2026-09-21 23:00+00',4,0,30,15,1),
  ('8e000000-0000-4000-8000-000000000004','8d000000-0000-4000-8000-000000000001',:'role_id','2026-09-01 09:00+00','2026-09-01 17:00+00',4,0,30,15,1);

insert into bookings (id, shift_id, staff_id, status, source) values
  ('8f000000-0000-4000-8000-000000000001','8e000000-0000-4000-8000-000000000001',:'leaver','confirmed','auto'),
  ('8f000000-0000-4000-8000-000000000002','8e000000-0000-4000-8000-000000000002',:'leaver','invited','auto'),
  ('8f000000-0000-4000-8000-000000000003','8e000000-0000-4000-8000-000000000003',:'leaver','confirmed','auto'),
  ('8f000000-0000-4000-8000-000000000004','8e000000-0000-4000-8000-000000000004',:'leaver','worked','auto'),
  ('8f000000-0000-4000-8000-000000000005','8e000000-0000-4000-8000-000000000003',:'onshift','confirmed','auto'),
  ('8f000000-0000-4000-8000-000000000006','8e000000-0000-4000-8000-000000000001',:'declar','confirmed','auto'),
  ('8f000000-0000-4000-8000-000000000007','8e000000-0000-4000-8000-000000000001',:'rejectd','confirmed','auto');

insert into check_logs (booking_id, outcome, attempted_at, check_in_at)
values ('8f000000-0000-4000-8000-000000000005','checked_in','2026-09-21 09:00+00','2026-09-21 09:00+00');

-- ---------------------------------------------------------------------
-- §10.6 · Request my P45.
-- ---------------------------------------------------------------------
create temporary table t_p45 as
  select request_p45(:'leaver', 'Moving away', :'now'::timestamptz) as r;

select is((select r->>'status' from t_p45), 'inactive',
  '§10.6 step 1: the leaver lands in `inactive`, which is the same cascade to a different terminal status');
select is((select status::text from staff where id = :'leaver'), 'inactive',
  'and the row says so');
select is((select leave_reason from staff where id = :'leaver'), 'Moving away',
  'the reason they gave is recorded on the profile (§1.5)');
select is((select left_at from staff where id = :'leaver'), :'now'::timestamptz,
  'with the leaving date');
select is((select r->>'released' from t_p45), '1',
  '§10.6 step 2: the one future confirmed booking is released, and the slot reopens for auto-assign');
select is((select r->>'withdrawn' from t_p45), '1',
  '§10.6 step 4: the open invitation is withdrawn, so nothing of theirs is left on a manager''s event board');
select is((select status::text from bookings where id = '8f000000-0000-4000-8000-000000000003'), 'confirmed',
  '§10.6 step 3: a shift already under way is NOT touched — leaving can never disturb the pay or the timesheet for work being done');
select is((select status::text from bookings where id = '8f000000-0000-4000-8000-000000000004'), 'worked',
  'nor is a shift already worked, which is a pay record');
select is((select cancel_cause from bookings where id = '8f000000-0000-4000-8000-000000000001'), 'left',
  'the cause distinguishes leaving from a block, which 0001_init reserved the word for');
select is((select cancel_cause from bookings where id = '8f000000-0000-4000-8000-000000000002'), 'left_invite',
  'and a WITHDRAWN invitation is marked apart from a RELEASED allocation — they are the same statement but not the same fact, and §10.6 step 6 only wants the second in E8');

-- §10.6: leaving is not erasure. "The profile, its documents and its
-- history remain intact and visible to the office, because they are
-- employment records THC has to keep."
select is((select count(*)::int from compliance_docs where staff_id = :'leaver'), 0,
  'the leaver had no documents to begin with, so this is only meaningful alongside the next two');
select isnt((select first_name from staff where id = :'leaver'), 'Deleted account',
  'leaving does not anonymise the profile — that is Remove (§1.7), a separate and irreversible action');
select is((select count(*)::int from bookings where staff_id = :'leaver'), 4,
  'and the whole booking history is still there, cancelled rows included');

-- ---------------------------------------------------------------------
-- E8, and the operational hole §10.6 wants the office to see at once.
-- ---------------------------------------------------------------------
select is(
  (select payload->>'employeeId' from notification_outbox where key like 'E8:staff:' || :'leaver' || ':%'),
  '90101', 'E8 names the Employee ID §8 puts in its subject line');
select is(
  (select payload->>'niNumber' from notification_outbox where key like 'E8:staff:' || :'leaver' || ':%'),
  'QQ123456C', 'and the NI number, so payroll can action the P45 without opening the profile');
select is(
  (select payload->>'lastShiftDate' from notification_outbox where key like 'E8:staff:' || :'leaver' || ':%'),
  '01 Sep 2026', 'and the date of their last completed shift');
select is(
  (select payload->>'releasedShifts' from notification_outbox where key like 'E8:staff:' || :'leaver' || ':%'),
  'Autumn Gala · RLS Fixture Client A · The Savoy · RLS Fixture Role · 05 Oct 2026 19:00',
  '§10.6 step 6: the shifts the event actually LOST, with event, client, venue, role and date. The 07 Oct invitation was withdrawn in the same sweep and is deliberately absent — nobody had accepted it, so no slot opened up');
select is(
  (select channel::text || '/' || array_to_string(recipient_emails, ',')
     from notification_outbox where key like 'E8:staff:' || :'leaver' || ':%'),
  'email/admin@thehospitalitycompany.co.uk', 'sent to the office immediately, not batched (§8)');
-- The key carries the instant, not just the worker. §2.12 supports leaving
-- twice on one record (that is what Reset to candidate is for), and a key
-- of 'E8:staff:<id>' meant the second request hit the unique index and the
-- "immediately, not batched" email silently never left the queue.
select ok(
  (select key ~ ('^E8:staff:' || :'leaver' || ':[0-9]+$')
     from notification_outbox where template = 'E8'),
  'and its key is per LEAVING, not per worker, so a returning worker who leaves again is not silently dropped');

-- "A worker who is checked in cannot submit the request at all: the
-- action is disabled for the duration of that shift." A greyed-out button
-- is not a rule, so the rule is here.
select throws_ok(
  format('select request_p45(%L, null, %L::timestamptz)', :'onshift', :'now'),
  'on_shift',
  '§10.6 step 3: a worker who is checked in cannot leave until they have checked out');

-- ---------------------------------------------------------------------
-- §10.7 · Declaring a criminal conviction while working.
-- ---------------------------------------------------------------------
create temporary table t_dec as
  select declare_conviction(:'declar', 'Caution received 01.09.2026', date '2026-09-01',
                            :'now'::timestamptz) as r;

select is((select status::text || '/' || block_kind::text from staff where id = :'declar'),
  'blocked/conviction_review',
  '§10.7 step 2: the worker is suspended immediately, exactly as an expired document suspends them (§4.3)');
select is((select block_reason from staff where id = :'declar'),
  'Criminal conviction declared — under review',
  'with the internal block reason §10.7 gives word for word');
select is((select r->>'released' from t_dec), '1',
  '§10.7 step 3: every future booking is released and goes back into auto-assign for a replacement');
select is((select count(*)::int from criminal_declarations where staff_id = :'declar' and source = 'in_employment'), 1,
  '§10.7 step 1: the declaration is ADDED to the history — nothing already on the profile is altered');
select is((select review_status::text from criminal_declarations where staff_id = :'declar' and source = 'in_employment'),
  'pending', 'and waits for Compliance → Needs review');

-- The one thing about E9 that matters more than the rest of it.
select ok(
  (select payload::text not like '%Caution received%'
     from notification_outbox
      where key = 'E9:declaration:' || (select id from criminal_declarations
                                         where staff_id = :'declar' and source = 'in_employment')),
  '§10.7 step 6: E9 does NOT carry the declaration text — those details are read in the Back Office, where access is role-controlled');
select is(
  (select payload->>'releasedShifts' from notification_outbox
     where key = 'E9:declaration:' || (select id from criminal_declarations
                                        where staff_id = :'declar' and source = 'in_employment')),
  'Autumn Gala · RLS Fixture Client A · The Savoy · RLS Fixture Role · 05 Oct 2026 19:00',
  'it carries the operational hole instead, so the office sees it the moment it learns of the declaration');

-- Verify → the ordinary full re-check, then N15.
update criminal_declarations set review_status = 'verified', reviewed_at = :'now'::timestamptz
 where staff_id = :'declar' and source = 'in_employment';
select is((select status::text || '/' || coalesce(block_kind::text, 'none') from staff where id = :'declar'),
  'compliant/none',
  '§10.7 Verify: the block lifts through the ordinary full compliance re-check (§4.3), not by a separate unblock');
select is(
  (select count(*)::int from notification_outbox
    where key = 'N15:declaration:' || (select id from criminal_declarations
                                        where staff_id = :'declar' and source = 'in_employment')), 1,
  'and the worker gets N15 — their shifts are open again');
select is((select status::text from bookings where id = '8f000000-0000-4000-8000-000000000006'), 'cancelled',
  'bookings released in the meantime are not restored — they may already have gone to someone else');

-- Reject → the block stands and hardens, and nobody is pushed anything.
select declare_conviction(:'rejectd', 'A different matter', null, :'now'::timestamptz);
update criminal_declarations set review_status = 'rejected', reviewed_at = :'now'::timestamptz,
                                 review_note = 'Not accepted — see file'
 where staff_id = :'rejectd';
select is((select status::text || '/' || block_kind::text || '/' || block_reason from staff where id = :'rejectd'),
  'blocked/manual/Not accepted — see file',
  '§10.7 Reject: the block STANDS and converts to a manual block with the manager''s reason, so only a manager can ever lift it');
select is(
  (select count(*)::int from notification_outbox
    where key = 'N15:declaration:' || (select id from criminal_declarations
                                        where staff_id = :'rejectd'))::int, 0,
  'and the worker is not told the reason through the app — the office contacts them, because this is a conversation rather than a push notification');
select is(unblock_if_compliant(:'rejectd', date '2026-09-21'), false,
  'the converted manual block is not the automatic path''s to lift, even though the profile is otherwise clean');

-- The half of that sentence the first version of this file never tested,
-- and the half that was broken: §10.7 says the manual block is lifted
-- "only by a manager" — which means a manager CAN. compliance_blockers
-- used to emit conviction_unreviewed for any Yes not `verified`, which is
-- permanently true of a REJECTED one, so unblock_worker refused for ever
-- and the only exits were re-onboarding or GDPR removal.
select is((unblock_worker(:'rejectd', date '2026-09-21'))->>'unblocked', 'true',
  '§10.7/§9.6: a manager CAN lift the converted block — a rejected declaration has been decided, and the manual block is what carries it');
select is((select status::text from staff where id = :'rejectd'), 'compliant',
  'and the worker comes back, which is the whole point of the block being a manager''s to lift');

-- While a declaration still awaiting a decision must keep blocking, which
-- is what §4.3 actually asks for.
select is(
  (declare_conviction(:'declar', 'A second, still pending', null,
                      :'now'::timestamptz + interval '1 hour'))->>'status',
  'blocked', 'a fresh declaration blocks again');
select is((unblock_worker(:'declar', date '2026-09-21'))->>'blockers', '["conviction_unreviewed"]',
  'and a PENDING declaration still refuses the unblock — §4.3''s rule is about a declaration nobody has decided yet');

-- ---------------------------------------------------------------------
-- §2.12 on the ROW, for the stopped states (20260926110800). The RPCs
-- always asserted; a plain update did not, so inactive → compliant,
-- removed → compliant and removed → blocked went through unasserted.
-- "There is no 'reactivate' that puts a leaver straight back to
-- compliant", and removed is irreversible.
-- ---------------------------------------------------------------------
select throws_ok(
  format($$ update staff set status = 'compliant' where id = %L $$, :'leaver'),
  'P0001', 'illegal_staff_transition: inactive -> compliant',
  '§2.12: a leaver cannot be put straight back to compliant on the row — Reset to candidate is the only way out of inactive');
update staff set status = 'removed', removed_at = now() where id = :'leaver';
select throws_ok(
  format($$ update staff set status = 'compliant' where id = %L $$, :'leaver'),
  'P0001', 'illegal_staff_transition: removed -> compliant',
  '§1.7: removed is irreversible — not compliant again');
select throws_ok(
  format($$ update staff set status = 'blocked' where id = %L $$, :'leaver'),
  'P0001', 'illegal_staff_transition: removed -> blocked',
  'and not blocked either: a removed worker has nothing left to block');

select * from finish();
rollback;
