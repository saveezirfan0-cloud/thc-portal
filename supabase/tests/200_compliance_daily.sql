-- =====================================================================
-- 200 · The document clock (§7 BG-04/05, §4.2, §4.3, §4.4)
--   compliance_daily(), block_worker(), unblock_if_compliant()
--   from 20260921170411_compliance_daily.sql
--
-- Three properties this file exists to hold, none of which is "the rule
-- fires":
--
--   * It fires ONCE. The job runs daily and the ladder has four rungs; a
--     rung that re-sends turns a reminder into nagging, and a block that
--     re-fires re-cancels bookings the worker has since been re-invited
--     to.
--   * It STOPS. §4.3's own worked example is a worker whose block is
--     cleared on one document while a second is already dead. Verifying
--     the first must not unlock the app.
--   * It never blocks the wrong person. A manual block (§9.6) and a
--     conviction review (§10.7) are a human's decision and are not the
--     automatic unblock's to lift.
--
-- Every case pins a fixed instant, so the arithmetic is readable and
-- nothing here depends on the day the suite runs.
-- =====================================================================
begin;
select plan(34);
\ir _shared/fixtures.psql

\set now  '2026-09-21 05:02:00+01'
\set s1   'd0000000-0000-4000-8000-000000000001'
\set s2   'd0000000-0000-4000-8000-000000000002'
\set s3   'd0000000-0000-4000-8000-000000000003'
\set s4   'd0000000-0000-4000-8000-000000000004'
\set s5   'd0000000-0000-4000-8000-000000000005'
\set s6   'd0000000-0000-4000-8000-000000000006'
\set stu  'd0000000-0000-4000-8000-00000000000a'
\set opt  'd0000000-0000-4000-8000-00000000000b'

-- The fixtures' own people are pushed out of this file's way: their
-- documents carry no expiry, so the ladder never sees them, but their
-- bookings would be caught by a cascade if one ever reached them.
insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch, term_dates) values
  (:'s1','Ladder','One',  'l1@rls.test','+447700900101', date '1995-01-01','compliant','uk_irish', '{}'),
  (:'s2','Ladder','Two',  'l2@rls.test','+447700900102', date '1995-01-01','compliant','uk_irish', '{}'),
  (:'s3','Ladder','Three','l3@rls.test','+447700900103', date '1995-01-01','compliant','uk_irish', '{}'),
  (:'s4','Ladder','Four', 'l4@rls.test','+447700900104', date '1995-01-01','compliant','uk_irish', '{}'),
  (:'s5','Ladder','Five', 'l5@rls.test','+447700900105', date '1995-01-01','compliant','international_student', '{}'),
  (:'s6','Ladder','Six',  'l6@rls.test','+447700900106', date '1995-01-01','compliant','work_visa', '{}'),
  -- Summer holiday through Sunday 27 September; term restarts Monday the
  -- 28th. The week is the unit (§4.4), so the band turns on the Monday,
  -- not on the day the range ends.
  (:'stu','Student','Term','st@rls.test','+447700900107', date '1995-01-01','compliant','international_student',
   '{"[2026-06-15,2026-09-28)","[2026-12-12,2027-01-11)"}'),
  (:'opt','Optout','Worker','op@rls.test','+447700900108', date '1995-01-01','compliant','uk_irish', '{}');

insert into compliance_docs (id, staff_id, doc_type, review_status, expiry_date,
                             right_to_work_until, term_dates, uploaded_at) values
  ('e0000000-0000-4000-8000-000000000001', :'s1','passport','verified', date '2026-10-11', null, null, '2026-01-01'),
  ('e0000000-0000-4000-8000-000000000002', :'s2','passport','verified', date '2026-10-01', null, null, '2026-01-01'),
  ('e0000000-0000-4000-8000-000000000003', :'s3','passport','verified', date '2026-09-24', null, null, '2026-01-01'),
  ('e0000000-0000-4000-8000-000000000004', :'s4','passport','verified', date '2026-09-20', null, null, '2026-01-01'),
  -- a term letter whose printed dates run to June 2027: the letter itself
  -- still dies on 31 December, and the ladder has not opened yet (§4.2).
  ('e0000000-0000-4000-8000-000000000005', :'s5','university_term_dates_letter','verified',
   date '2027-06-30', null, '{"[2026-06-15,2026-09-20)"}', '2026-02-01'),
  -- the share code report reminds off right_to_work_until, not expiry_date
  ('e0000000-0000-4000-8000-000000000006', :'s6','share_code_report','verified',
   date '2030-01-01', date '2026-09-26', null, '2026-01-01');

-- s4 holds one future confirmed shift, one open invitation and one worked
-- shift in the past. The cascade must take the first two and leave the third.
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date) values
  ('7d000000-0000-4000-8000-000000000001', :'clienta', :'venue_id', 'RLS Fixture Venue',
   '1 Test Street, London', st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Expiry Cascade', date '2026-10-01');
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  ('7e000000-0000-4000-8000-000000000001','7d000000-0000-4000-8000-000000000001',:'role_id','2026-10-01 10:00+00','2026-10-01 18:00+00',2,0,30,15,1),
  ('7e000000-0000-4000-8000-000000000002','7d000000-0000-4000-8000-000000000001',:'role_id','2026-10-02 10:00+00','2026-10-02 18:00+00',2,0,30,15,1),
  ('7e000000-0000-4000-8000-000000000003','7d000000-0000-4000-8000-000000000001',:'role_id','2026-09-01 10:00+00','2026-09-01 18:00+00',2,0,30,15,1);
insert into bookings (id, shift_id, staff_id, status, source) values
  ('7f000000-0000-4000-8000-000000000001','7e000000-0000-4000-8000-000000000001',:'s4','confirmed','auto'),
  ('7f000000-0000-4000-8000-000000000002','7e000000-0000-4000-8000-000000000002',:'s4','invited','auto'),
  ('7f000000-0000-4000-8000-000000000003','7e000000-0000-4000-8000-000000000003',:'s4','worked','auto');

create temporary table t_first as select compliance_daily(:'now'::timestamptz) as counts;

-- ---------------------------------------------------------------------
-- BG-04 · the three rungs, each to exactly one person.
--
-- The rungs are bands (30..15, 14..8, 7..1) rather than equalities,
-- because a job that misses one day would otherwise skip a rung outright
-- and block a worker who was warned twice instead of three times.
-- ---------------------------------------------------------------------
select is((select counts->>'n1' from t_first), '1', 'BG-04 sends the one-month reminder to the one worker 20 days out');
select is((select counts->>'n2' from t_first), '1', 'and the two-week reminder to the one worker 10 days out');
select is((select counts->>'n3' from t_first), '2', 'and the final warning to both workers inside a week — one on a passport, one on a share code');
select is(
  (select payload->>'document' from notification_outbox where key = 'N1:doc:e0000000-0000-4000-8000-000000000001'),
  'Passport', 'the copy names the document the way the worker does, not the way the enum does');
select is(
  (select payload->>'date' from notification_outbox where key = 'N1:doc:e0000000-0000-4000-8000-000000000001'),
  '2026-10-11', 'N1 carries the expiry date its copy substitutes');
select ok(
  exists (select 1 from notification_outbox where key = 'N3:doc:e0000000-0000-4000-8000-000000000006'),
  '§4.4: the share code report reminds off right_to_work_until — its own expiry_date is in 2030');

-- ---------------------------------------------------------------------
-- §4.2's term-letter rule, which is the one the scope spells out twice.
-- ---------------------------------------------------------------------
select is(
  (select expires_on from current_compliance_docs(:'s5') where doc_type = 'university_term_dates_letter'),
  date '2026-12-31',
  'a term letter expires on 31 December whatever it prints — the graduation date is explicitly not the expiry');
select is(
  (select count(*)::int from notification_outbox where recipient_staff_id = :'s5'), 0,
  'and its ladder opens in December, not a month before the last printed vacation date, which §4.2 rejects by name');

-- ---------------------------------------------------------------------
-- BG-05 · the block, and the §4.3 cascade.
-- ---------------------------------------------------------------------
select is((select counts->>'n4' from t_first), '1', 'BG-05 tells the one worker whose document is dead');
select is((select counts->>'blocked' from t_first), '1', 'and blocks exactly them');
select is((select status::text || '/' || block_kind::text from staff where id = :'s4'),
  'blocked/auto_document', '§4.3 step 1: the worker is blocked, and the kind records that nobody pressed anything');
select is((select status::text || '/' || cancel_cause from bookings where id = '7f000000-0000-4000-8000-000000000001'),
  'cancelled/blocked', '§4.3 step 2: the future confirmed allocation is released, so the section is short again and auto-assign refills it');
select is((select status::text || '/' || cancel_cause from bookings where id = '7f000000-0000-4000-8000-000000000002'),
  'cancelled/blocked', '§4.3 step 3: the open invitation is withdrawn and disappears from their app');
select is((select status::text from bookings where id = '7f000000-0000-4000-8000-000000000003'),
  'worked', 'a shift already worked is a pay record and is never touched');
select is((select count(*)::int from bookings where staff_id = :'staffa' and status = 'cancelled'), 0,
  'and nobody else loses a booking');

-- ---------------------------------------------------------------------
-- The property the whole file exists for: this job runs every day.
-- ---------------------------------------------------------------------
create temporary table t_second as select compliance_daily(:'now'::timestamptz) as counts;
select is(
  (select counts from t_second),
  '{"n1": 0, "n2": 0, "n3": 0, "n4": 0, "n14": 0, "blocked": 0}'::jsonb,
  'a second run on the same day does nothing at all: every rung and the block are idempotent');
select is((select count(*)::int from notification_outbox where key like 'N_:doc:%'), 5,
  'and no rung sends twice');

-- ---------------------------------------------------------------------
-- §4.3 unblocking, including the example the scope works through.
-- ---------------------------------------------------------------------
update compliance_docs set review_status = 'superseded' where id = 'e0000000-0000-4000-8000-000000000004';
insert into compliance_docs (id, staff_id, doc_type, review_status, expiry_date, uploaded_at)
values ('e0000000-0000-4000-8000-000000000014', :'s4', 'passport', 'pending', date '2031-01-01', '2026-09-21');
select is((select status::text from staff where id = :'s4'), 'blocked',
  'uploading is not enough — the office still has to verify it');

update compliance_docs set review_status = 'verified' where id = 'e0000000-0000-4000-8000-000000000014';
select is((select status::text || '/' || coalesce(block_kind::text, 'none') from staff where id = :'s4'),
  'compliant/none', 'verifying re-checks the FULL status and unblocks automatically — no separate Unblock step (§4.3)');
select is((select status::text from bookings where id = '7f000000-0000-4000-8000-000000000001'), 'cancelled',
  'there is no automatic restoration to the shifts they were removed from — those may already have gone to someone else');

-- §4.3's own example: right to work valid until 30 July, the worker returns
-- in March, is verified on the document that caused the block — and the
-- share code is already dead, so the app stays locked to Documents.
insert into compliance_docs (id, staff_id, doc_type, review_status, right_to_work_until, uploaded_at)
values ('e0000000-0000-4000-8000-000000000015', :'s4', 'share_code_report', 'verified', date '2026-07-30', '2026-01-01');
select is((select string_agg(reason, ',') from compliance_blockers(:'s4', date '2026-09-21')),
  'document_expired:share_code_report',
  'the second dead document is still found: the full re-check is what makes the scope example work');
update staff set status = 'blocked', block_kind = 'auto_document' where id = :'s4';
update compliance_docs set review_status = 'pending'  where id = 'e0000000-0000-4000-8000-000000000014';
update compliance_docs set review_status = 'verified' where id = 'e0000000-0000-4000-8000-000000000014';
select is((select status::text from staff where id = :'s4'), 'blocked',
  'so verifying it again leaves the app locked to Documents rather than fully unblocking');

update staff set status = 'blocked', block_kind = 'manual', block_reason = 'Conduct' where id = :'s1';
select is(unblock_if_compliant(:'s1', date '2026-09-21'), false,
  'a manual block is the manager''s to lift (§9.6) — the automatic path never touches it');

insert into criminal_declarations (staff_id, source, answer, review_status)
values (:'s2', 'in_employment', true, 'pending');
select is((select string_agg(reason, ',') from compliance_blockers(:'s2', date '2026-09-21')),
  'conviction_unreviewed',
  '§4.3: a Criminal Record declaration answered Yes must be verified before anyone is compliant');

-- ---------------------------------------------------------------------
-- §4.4 · N14, which fires once per change and never more.
--
-- The first assessment is deliberately silent. A worker who has not been
-- told anything has not had anything change, and the first run of this
-- job in production must not push N14 at a thousand people.
-- ---------------------------------------------------------------------
select is((select counts->>'n14' from t_first), '0',
  'the first run announces nothing — it records where everyone is');
select is((select band::text from cap_band_notices where staff_id = :'stu'), 'student_holiday_48',
  'a student inside the letter''s holiday range is on the 48 h band (RULE-20)');

-- Monday 28 September: the first week with no holiday day in it.
create temporary table t_band as select compliance_daily('2026-09-28 05:02:00+01'::timestamptz) as counts;
select is((select counts->>'n14' from t_band), '1', 'term restarting moves exactly one worker''s band');
select is(
  (select payload from notification_outbox where template = 'N14' and recipient_staff_id = :'stu'),
  '{"band": "student_term_20", "date": "2026-12-11", "limit": "20"}'::jsonb,
  'N14 carries the limit, the band and the day it holds until — the day before the next holiday opens');

create temporary table t_again as select compliance_daily('2026-09-28 05:03:00+01'::timestamptz) as counts;
select is((select counts->>'n14' from t_again), '0', '"once per change, never more" (§4.4): the same day again says nothing');
create temporary table t_tomorrow as select compliance_daily('2026-09-29 05:02:00+01'::timestamptz) as counts;
select is((select counts->>'n14' from t_tomorrow), '0', 'nor does the next day, with the band unmoved');

-- The four shapes "until [date]" can take. A straddling week is the one
-- worth pinning: §4.4 gives the whole Mon-Sun week the lower cap, so what
-- holds until is the Sunday — naming the day term restarts would be wrong
-- twice, since that day is inside this week and the cap does not move when
-- it arrives.
select is(
  array[
    cap_band_until('{"[2026-06-15,2026-09-28)","[2026-12-12,2027-01-11)"}'::daterange[], date '2026-09-21'),
    cap_band_until('{"[2026-06-15,2026-09-28)","[2026-12-12,2027-01-11)"}'::daterange[], date '2026-09-28'),
    cap_band_until('{"[2026-09-30,2026-10-12)"}'::daterange[],                            date '2026-09-28'),
    cap_band_until('{}'::daterange[],                                                     date '2026-09-28')
  ],
  array[date '2026-09-27', date '2026-12-11', date '2026-10-04', null],
  'holiday runs to the day before term restarts, term to the day before the next holiday opens, a straddling week to its own Sunday, and a worker with no term letter has no date at all');

-- The opt-out is a band change too, and it has no end date to name.
update staff set wtr_optout = true where id = :'opt';
create temporary table t_opt as select compliance_daily('2026-09-30 05:02:00+01'::timestamptz) as counts;
select is(
  (select payload->>'limit' from notification_outbox where template = 'N14' and recipient_staff_id = :'opt'),
  'unlimited',
  'signing the 48-hour opt-out removes the ceiling for a worker with no visa condition, and N14 says so');
select ok(
  (select payload->>'date' is null from notification_outbox where template = 'N14' and recipient_staff_id = :'opt'),
  'and names no date, because nothing on the calendar ends that band — the sender drops the clause');

-- ---------------------------------------------------------------------
-- The write paths are service-role only (docs/14 O7). block_worker alone
-- strips a worker of every future shift they hold.
-- ---------------------------------------------------------------------
select is_empty(
  $$ select p.proname::text || '(' || r.rolname || ')'
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       cross join (values ('anon'), ('authenticated')) as r(rolname)
      where n.nspname = 'public'
        and p.proname in ('compliance_daily', 'block_worker', 'unblock_if_compliant')
        and has_function_privilege(r.rolname, p.oid, 'execute') $$,
  'neither anon nor authenticated can block a worker or run the daily sweep');

select * from finish();
rollback;
