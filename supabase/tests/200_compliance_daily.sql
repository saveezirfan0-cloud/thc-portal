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
select plan(50);
\set now  '2026-09-21 05:02:00+01'
\ir _shared/fixtures.psql
\set s1   'd0000000-0000-4000-8000-000000000001'
\set s2   'd0000000-0000-4000-8000-000000000002'
\set s3   'd0000000-0000-4000-8000-000000000003'
\set s4   'd0000000-0000-4000-8000-000000000004'
\set s5   'd0000000-0000-4000-8000-000000000005'
\set s6   'd0000000-0000-4000-8000-000000000006'
\set s7   'd0000000-0000-4000-8000-000000000007'
\set s8   'd0000000-0000-4000-8000-000000000008'
\set s9   'd0000000-0000-4000-8000-000000000009'
\set stu  'd0000000-0000-4000-8000-00000000000a'
\set opt  'd0000000-0000-4000-8000-00000000000b'

-- ---------------------------------------------------------------------
-- Everything already in the database is pushed out of this file's way.
--
-- `supabase test db` runs against a database that supabase/seed.sql has
-- already populated, and the seed is not inert here: it carries a
-- deliberately EXPIRED verified passport (current_date - 19) on a blocked
-- worker and a verified term letter on a student, both of which
-- compliance_daily is entitled to act on. Any assertion below that counts
-- rather than naming a row therefore sees them, and the file passes or
-- fails on what somebody else put in the seed.
--
-- _shared/fixtures.psql says this in its own header — "all assertions
-- address fixture rows by their fixed UUIDs, never by global counts" —
-- and the sweep's return value is a set of counts, so the way to honour
-- it is to make the counts true by emptying the world first. Every
-- statement here is inside the test transaction and is rolled back.
--
--   expiry_date / right_to_work_until  null  → never due
--   uploaded_at                        now   → a seeded term letter dies
--                                              on 31 December, months out
--   term_dates                         empty → no seeded student's cap
--                                              band moves under the N14
--                                              assertions
-- ---------------------------------------------------------------------
update compliance_docs set expiry_date = null, right_to_work_until = null,
                           uploaded_at = :'now'::timestamptz;
update staff set right_to_work_until = null, term_dates = '{}';

-- The fixtures' own people are pushed out of this file's way too: their
-- documents carry no expiry, so the ladder never sees them, but their
-- bookings would be caught by a cascade if one ever reached them.
insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch, term_dates) values
  (:'s1','Ladder','One',  'l1@rls.test','+447700900101', date '1995-01-01','compliant','uk_irish', '{}'),
  (:'s2','Ladder','Two',  'l2@rls.test','+447700900102', date '1995-01-01','compliant','uk_irish', '{}'),
  (:'s3','Ladder','Three','l3@rls.test','+447700900103', date '1995-01-01','compliant','uk_irish', '{}'),
  (:'s4','Ladder','Four', 'l4@rls.test','+447700900104', date '1995-01-01','compliant','uk_irish', '{}'),
  (:'s5','Ladder','Five', 'l5@rls.test','+447700900105', date '1995-01-01','compliant','international_student', '{}'),
  (:'s6','Ladder','Six',  'l6@rls.test','+447700900106', date '1995-01-01','compliant','work_visa', '{}'),
  (:'s7','Ladder','Seven','l7@rls.test','+447700900109', date '1995-01-01','compliant','work_visa', '{}'),
  (:'s9','Ladder','Nine', 'l9@rls.test','+447700900110', date '1995-01-01','compliant','uk_irish',  '{}'),
  -- Summer holiday through Sunday 27 September; term restarts Monday the
  -- 28th. The week is the unit (§4.4), so the band turns on the Monday,
  -- not on the day the range ends.
  (:'stu','Student','Term','st@rls.test','+447700900107', date '1995-01-01','compliant','international_student',
   '{"[2026-06-15,2026-09-28)","[2026-12-12,2027-01-11)"}'),
  (:'opt','Optout','Worker','op@rls.test','+447700900108', date '1995-01-01','compliant','uk_irish', '{}');

-- s7's gov.uk date lives on the worker, as §2.5 and the seed both put it.
update staff set right_to_work_until = date '2026-09-26' where id = :'s7';

-- s8 graduated in June. §4.5: the term letter stops driving their cap and
-- stops generating expiry reminders.
insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch,
                   term_dates, graduated_at) values
  (:'s8','Graduate','Eight','l8@rls.test','+447700900111', date '1995-01-01','compliant',
   'international_student', '{"[2026-06-15,2026-09-28)"}', date '2026-06-30');

insert into compliance_docs (id, staff_id, doc_type, review_status, expiry_date,
                             right_to_work_until, term_dates, uploaded_at) values
  ('e0000000-0000-4000-8000-000000000001', :'s1','passport','verified', date '2026-10-11', null, null, '2026-01-01'),
  ('e0000000-0000-4000-8000-000000000002', :'s2','passport','verified', date '2026-10-01', null, null, '2026-01-01'),
  ('e0000000-0000-4000-8000-000000000003', :'s3','passport','verified', date '2026-09-24', null, null, '2026-01-01'),
  ('e0000000-0000-4000-8000-000000000004', :'s4','passport','verified', date '2026-09-20', null, null, '2026-01-01'),
  -- A term letter whose printed dates run to June 2027 AND whose own
  -- Christmas range crosses into January — the shape almost every real
  -- letter has. §4.2 says none of that is the expiry: the letter dies on
  -- 31 December, and the ladder has not opened yet.
  ('e0000000-0000-4000-8000-000000000005', :'s5','university_term_dates_letter','verified',
   date '2027-06-30', null, '{"[2026-06-15,2026-09-20)","[2026-12-12,2027-01-11)"}', '2026-02-01'),
  -- The share code report reminds off right_to_work_until, not its own
  -- expiry_date. s6 carries that date on the DOCUMENT; s7 carries it only
  -- on the staff row, which is where the gov.uk check writes it (§2.5) and
  -- what supabase/seed.sql actually does — a ladder that reads only the
  -- document column never fires for a single real worker.
  ('e0000000-0000-4000-8000-000000000006', :'s6','share_code_report','verified',
   date '2030-01-01', date '2026-09-26', null, '2026-01-01'),
  ('e0000000-0000-4000-8000-000000000007', :'s7','share_code_report','verified',
   date '2030-01-01', null, null, '2026-01-01'),
  -- s8 graduated in June, so this letter is not theirs to renew (§4.2).
  ('e0000000-0000-4000-8000-000000000008', :'s8','university_term_dates_letter','verified',
   null, null, null, '2025-02-01'),
  -- s9's passport expired yesterday, and this morning they uploaded
  -- something nobody has looked at yet.
  ('e0000000-0000-4000-8000-000000000009', :'s9','passport','verified',
   date '2026-09-20', null, null, '2026-01-01'),
  ('e0000000-0000-4000-8000-00000000000c', :'s9','passport','pending',
   date '2031-01-01', null, null, '2026-09-21');

-- s4 holds one future confirmed shift, one open invitation and one worked
-- shift in the past. The cascade must take the first two and leave the third.
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  ('7d000000-0000-4000-8000-000000000001', :'clienta', :'venue_id', 'RLS Fixture Venue',
   '1 Test Street, London', st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Expiry Cascade', date '2026-10-01', false, true);
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
select is((select counts->>'n3' from t_first), '3',
  'and the final warning to the three inside a week — one on a passport and two on a share code, one of which is dated on the worker rather than on the document');
select is(
  (select payload->>'document' from notification_outbox where key = 'N1:doc:e0000000-0000-4000-8000-000000000001'),
  'Passport', 'the copy names the document the way the worker does, not the way the enum does');
select is(
  (select payload->>'date' from notification_outbox where key = 'N1:doc:e0000000-0000-4000-8000-000000000001'),
  '11 Oct 2026', 'N1 carries the expiry date its copy substitutes, written the way §1.8 writes a date and not as an ISO string');
select ok(
  exists (select 1 from notification_outbox where key = 'N3:doc:e0000000-0000-4000-8000-000000000006'),
  '§4.4: the share code report reminds off right_to_work_until — its own expiry_date is in 2030');

-- ---------------------------------------------------------------------
-- §4.2's term-letter rule, which is the one the scope spells out twice.
-- ---------------------------------------------------------------------
select is(
  (select expires_on from current_verified_docs(:'s5') where doc_type = 'university_term_dates_letter'),
  date '2026-12-31',
  'a term letter expires on 31 December whatever it prints — not the graduation date, and not the January its own Christmas range runs into');
select is(
  doc_expires_on('university_term_dates_letter', null, null, null, '2026-12-05'::timestamptz),
  date '2027-12-31',
  'the one exception (ADR-0011): a letter uploaded inside the ladder window runs to the FOLLOWING 31 December, because the ladder opens on 1 December precisely to make the student upload it');
select is(
  (select count(*)::int from notification_outbox where recipient_staff_id = :'s5'), 0,
  'and its ladder opens in December, not a month before the last printed vacation date, which §4.2 rejects by name');

-- ---------------------------------------------------------------------
-- Three ways the ladder silently picks the wrong worker, or no worker.
-- None of these is a rule the scope adds; each is a rule it states that a
-- straightforward implementation misses.
-- ---------------------------------------------------------------------
select ok(
  exists (select 1 from notification_outbox where key = 'N3:doc:e0000000-0000-4000-8000-000000000007'),
  '§2.5: the gov.uk date lives on the WORKER, so a ladder that only reads the document column never fires for a real worker at all');

select is(
  (select count(*)::int from notification_outbox where recipient_staff_id = :'s8'), 0,
  '§4.2: "a student who has finished their course should not be chased for next year''s term letter at all" — a graduate gets no rung of it');
select is(
  (select count(*)::int from staff where id = :'s8' and status = 'blocked'), 0,
  'and is not auto-blocked on 31 December over a document §4.5 says no longer applies to them, losing every future shift they hold');
select is(
  (select string_agg(reason, ',') from compliance_blockers(:'s8', date '2026-12-31')), null,
  'their expired term letter is not a compliance blocker either, on the day it dies or after');

select ok(
  exists (select 1 from notification_outbox where key = 'N4:doc:e0000000-0000-4000-8000-000000000009'),
  'a pending upload does not hide the expired document underneath it: expiry is measured off the last thing the office VERIFIED');
select is(
  (select status::text from staff where id = :'s9'), 'blocked',
  '§4.3 says the block happens "by itself, with no manager involved" — uploading a blank page the day before must not buy another week of shifts');

-- ---------------------------------------------------------------------
-- BG-05 · the block, and the §4.3 cascade.
-- ---------------------------------------------------------------------
select is((select counts->>'n4' from t_first), '2', 'BG-05 tells both workers whose document is dead');
select is((select counts->>'blocked' from t_first), '2', 'and blocks exactly them');
select is((select status::text || '/' || block_kind::text from staff where id = :'s4'),
  'blocked/auto_document', '§4.3 step 1: the worker is blocked, and the kind records that nobody pressed anything');
select is((select status::text || '/' || cancel_cause from bookings where id = '7f000000-0000-4000-8000-000000000001'),
  'cancelled/blocked', '§4.3 step 2: the future confirmed allocation is released, so the section is short again and auto-assign refills it');
select is((select status::text || '/' || cancel_cause from bookings where id = '7f000000-0000-4000-8000-000000000002'),
  'cancelled/blocked', '§4.3 step 3: the open invitation is withdrawn and disappears from their app');
select is((select status::text from bookings where id = '7f000000-0000-4000-8000-000000000003'),
  'worked', 'a shift already worked is a pay record and is never touched');
select is(
  (select count(distinct staff_id)::int from bookings
    where cancel_cause = 'blocked' and staff_id <> :'s4'), 0,
  'and nobody else anywhere loses a booking to this sweep — not the fixtures'' people, not the seed''s');

-- ---------------------------------------------------------------------
-- The property the whole file exists for: this job runs every day.
-- ---------------------------------------------------------------------
create temporary table t_second as select compliance_daily(:'now'::timestamptz) as counts;
select is(
  (select counts from t_second),
  '{"n1": 0, "n2": 0, "n3": 0, "n4": 0, "n14": 0, "blocked": 0}'::jsonb,
  'a second run on the same day does nothing at all: every rung and the block are idempotent');
select is((select count(*)::int from notification_outbox where key like 'N_:doc:%'), 7,
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
  '{"band": "term time", "date": "13 Dec 2026", "limit": "20", "variant": "dated"}'::jsonb,
  'N14 carries the limit, the band in words, and the Sunday it holds until — the week of 7 December straddles, so the 20 h band runs two days past the day the holiday range opens');

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
    -- inside the holiday: it ends when term restarts on Monday the 28th
    cap_band_until('{"[2026-06-15,2026-09-28)","[2026-12-12,2027-01-11)"}'::daterange[], date '2026-09-21'),
    -- in term: the next holiday OPENS on Saturday 12 December, so the week
    -- of the 7th straddles and stays at 20 h — the 48 h band does not
    -- begin until Monday the 14th, and the answer is the Sunday before it
    cap_band_until('{"[2026-12-12,2027-01-11)"}'::daterange[],                            date '2026-11-30'),
    -- term restarts on a THURSDAY: that week straddles, so the 48 h band
    -- ended on the Sunday before it, not on the Wednesday
    cap_band_until('{"[2026-06-15,2026-10-01)"}'::daterange[],                            date '2026-09-14'),
    -- nothing on the calendar moves this worker's band
    cap_band_until('{}'::daterange[],                                                     date '2026-09-28')
  ],
  array[date '2026-09-27', date '2026-12-13', date '2026-09-27', null],
  'the answer is always a SUNDAY: §4.4 gives the whole Mon-Sun week the lower cap, so a band never changes mid-week and naming the raw range endpoint promises hours the worker may not work');

-- The opt-out is a band change too, and it has no end date to name.
update staff set wtr_optout = true where id = :'opt';
create temporary table t_opt as select compliance_daily('2026-09-30 05:02:00+01'::timestamptz) as counts;
select is(
  (select payload->>'variant' from notification_outbox where template = 'N14' and recipient_staff_id = :'opt'),
  'uncapped',
  'signing the 48-hour opt-out removes the ceiling, and N14 takes the half that says so — reusing §8''s sentence would read "your weekly limit is now no hours", which is the opposite of what happened');
select ok(
  (select payload->>'date' is null from notification_outbox where template = 'N14' and recipient_staff_id = :'opt'),
  'and names no date, because nothing on the calendar ends that band — the sender drops the clause');

-- ---------------------------------------------------------------------
-- §8's N14 copy, as the worker receives it.
--
-- `render` in packages/notifications leaves an unmatched placeholder in
-- the string, so a band with no end date and one body carrying "until
-- {date}" sends the literal "{date}" to a worker. The register holds two
-- halves; this asserts the row names the right one and carries words
-- rather than enum labels.
-- ---------------------------------------------------------------------
select is(
  (select payload->>'variant' from notification_outbox where template = 'N14' and recipient_staff_id = :'stu'),
  'dated', 'a student whose band ends on a known Sunday gets the half that names a date');
select is(
  (select payload->>'date' is null from notification_outbox where template = 'N14' and recipient_staff_id = :'opt'),
  true, 'and a worker whose band has no end date gets a row with no date on it at all');
select ok(
  (select payload->>'band' not like '%\_%' from notification_outbox where template = 'N14' and recipient_staff_id = :'stu'),
  'the band reaches the worker as words, not as the cap_band enum label');

-- ---------------------------------------------------------------------
-- The property the bands exist for, which nothing above actually showed:
-- a day the job does not run must not cost a worker a rung.
--
-- s3's passport dies on 24 September. The one-month rung is due around the
-- 25th of August and the two-week rung around the 10th of September. Run
-- the first, skip the second entirely, then run four days late.
--
-- Last in the file because it winds the clock BACK three weeks, which
-- moves the student of the N14 section above out of term again. That is
-- an artefact of time travel in one transaction, not a rule.
-- ---------------------------------------------------------------------
delete from notification_outbox where key like 'N_:doc:e0000000-0000-4000-8000-000000000003';
create temporary table t_early as select compliance_daily('2026-08-30 05:02:00+01'::timestamptz) as counts;
select ok(
  exists (select 1 from notification_outbox where key = 'N1:doc:e0000000-0000-4000-8000-000000000003'),
  'the one-month rung goes out 25 days before the expiry');

-- 10 September never happens. 14 September is 10 days out — inside the
-- two-week band but four days past the day an equality would have fired.
create temporary table t_late as select compliance_daily('2026-09-14 05:02:00+01'::timestamptz) as counts;
select ok(
  exists (select 1 from notification_outbox where key = 'N2:doc:e0000000-0000-4000-8000-000000000003'),
  'and a run four days late still sends the two-week rung: "expiry minus 14 equals today" would have skipped it silently and blocked a worker who was warned twice instead of three times');

-- ---------------------------------------------------------------------
-- A missed 05:00 must not defer a §4.3 block by a day.
--
-- The rungs heal on their own because they are bands. The block does not:
-- a deploy or a cold start across the five-minute window would leave a
-- worker checking in on an expired right to work until tomorrow morning.
-- ---------------------------------------------------------------------
select is(compliance_daily_due('2026-09-21 05:02:00+01'::timestamptz), true,
  'the sweep is due inside the 05:00 UK window');
select is(compliance_daily_due('2026-09-21 14:00:00+01'::timestamptz), true,
  'and still due at two in the afternoon, because nothing has run today');
insert into job_runs (job, started_at, finished_at, ok)
values ('compliance-daily', '2026-09-21 05:02+01', '2026-09-21 05:03+01', true);
select is(compliance_daily_due('2026-09-21 14:00:00+01'::timestamptz), false,
  'once today''s sweep has succeeded it is not due again — this is the gate that keeps a */5 entry from running 288 times');
insert into job_runs (job, started_at, finished_at, ok)
values ('compliance-daily', '2026-09-22 05:02+01', '2026-09-22 05:03+01', false);
select is(compliance_daily_due('2026-09-22 14:00:00+01'::timestamptz), true,
  'a run that FAILED does not count as today''s: the next tick picks it back up rather than waiting for tomorrow');

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
