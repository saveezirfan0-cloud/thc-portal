-- =====================================================================
-- 361 · The University Completion Letter and the 48-hour opt-out
--       (docs/scope/university-completion-letter-requirement.pdf)
--
-- Every one of the seven acceptance criteria in the requirement's §6 is
-- asserted here against the real write paths — the worker's upload RPC,
-- the office's approval, accept_invite, invite_worker and a direct write
-- to bookings — and each assertion's description starts with its number,
-- so `grep AC1` finds the proof. The rule-level twins are in
-- packages/domain/src/__tests__/completionLetter.test.ts.
--
--   AC1  no approved letter → never more than 20 h in a term week
--   AC2  upload alone changes nothing; approval does
--   AC3  approval → 48 h from the completion date
--   AC4  above 48 only with a valid, un-cancelled opt-out, 18+
--   AC5  cancelling re-imposes 48 after the notice period
--   AC6  never rostered beyond the recorded visa expiry
--   AC7  every document and decision auditable and exportable
--
-- Plus the §7 edge cases, the retention rule, the right-to-work alerts
-- and the two follow-ups (term_letter_applies, reset_to_candidate).
--
-- Dates are relative to today: the functions under test use now(). W is
-- the Monday two weeks out, a plain term week for a student with no
-- holiday ranges on file.
-- =====================================================================
begin;
select plan(118);
\ir _shared/fixtures.psql

select cap_week_start(current_date) + 14 as w \gset

\set stu_uid  'c7a00000-0000-4000-8000-000000000001'
\set grad_uid 'c7a00000-0000-4000-8000-000000000002'
\set exp_uid  'c7a00000-0000-4000-8000-000000000003'
\set stu2_uid 'c7a00000-0000-4000-8000-000000000004'

\set stu   'c7000000-0000-4000-8000-000000000001'
\set grad  'c7000000-0000-4000-8000-000000000002'
\set expw  'c7000000-0000-4000-8000-000000000003'
\set stu2  'c7000000-0000-4000-8000-000000000004'
\set cand  'c7000000-0000-4000-8000-000000000005'
\set nodob 'c7000000-0000-4000-8000-000000000006'
\set alert 'c7000000-0000-4000-8000-000000000007'
\set ev    'c7100000-0000-4000-8000-000000000001'

insert into auth.users (id, email) values
  (:'stu_uid', 'stu@cl.test'), (:'grad_uid', 'grad@cl.test'),
  (:'exp_uid', 'exp@cl.test'), (:'stu2_uid', 'stu2@cl.test');
insert into profiles (id, role, full_name) values
  (:'stu_uid', 'staff', 'Amara Student'), (:'grad_uid', 'staff', 'Isla Graduate'),
  (:'exp_uid', 'staff', 'Evan Expiring'), (:'stu2_uid', 'staff', 'Sam Second');

insert into staff (id, user_id, employee_id, first_name, last_name, email, phone, dob, status,
                   rtw_branch, right_to_work_until, home_location, contract_signed_at) values
  (:'stu',  :'stu_uid',  97001, 'Amara', 'Student',  'stu@cl.test',  '+447700970001', date '2001-04-11',
   'compliant', 'international_student', :'w'::date + 400,
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, now() - interval '300 days'),
  (:'grad', :'grad_uid', 97002, 'Isla',  'Graduate', 'grad@cl.test', '+447700970002', date '1999-02-02',
   'compliant', 'international_student', :'w'::date + 400,
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, now() - interval '300 days'),
  (:'expw', :'exp_uid',  97003, 'Evan',  'Expiring', 'exp@cl.test',  '+447700970003', date '1998-03-03',
   'compliant', 'work_visa', :'w'::date + 2,
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, now() - interval '300 days'),
  (:'stu2', :'stu2_uid', 97004, 'Sam',   'Second',   'stu2@cl.test', '+447700970004', date '2002-05-05',
   'compliant', 'international_student', :'w'::date + 3,
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, now() - interval '300 days'),
  (:'cand', null, null, 'Cara', 'Candidate', 'cand@cl.test', '+447700970005', date '2003-06-06',
   'documents', 'international_student', :'w'::date + 400, null, null),
  (:'nodob', null, 97006, 'Nadia', 'NoDob', 'nodob@cl.test', '+447700970006', date '1990-01-01',
   'compliant', 'uk_irish', null, null, now() - interval '30 days'),
  (:'alert', null, 97007, 'Alex', 'Alert', 'alert@cl.test', '+447700970007', date '1990-07-07',
   'compliant', 'work_visa', current_date + 20, null, now() - interval '30 days');

insert into staff_roles (staff_id, role_id)
select id, :'role_id' from staff where id in (:'stu', :'grad', :'expw', :'stu2');

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer)
values (:'ev', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
        st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Cap Week', :'w'::date, true, true);

-- Shifts in week W, in UK time. `sh(n, from, to)` would be nicer; psql
-- has no functions, so each is spelled out.
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour)
select id::uuid, :'ev', :'role_id',
       ((:'w'::date + d) + s) at time zone 'Europe/London',
       ((:'w'::date + d) + s + len) at time zone 'Europe/London',
       10, 0, 20, 12, 10
  from (values
    -- the student, AC1
    ('c7200000-0000-4000-8000-0000000000a1', 0, time '09:00', interval '8 hours'),
    ('c7200000-0000-4000-8000-0000000000a2', 1, time '09:00', interval '8 hours'),
    ('c7200000-0000-4000-8000-0000000000a3', 2, time '09:00', interval '8 hours'),
    ('c7200000-0000-4000-8000-0000000000a4', 3, time '09:00', interval '4 hours'),
    ('c7200000-0000-4000-8000-0000000000a5', 4, time '09:00', interval '5 hours'),
    -- the graduate, AC4 — 16 + 16 + 12 = 44, then 8 more
    ('c7200000-0000-4000-8000-0000000000b1', 0, time '06:00', interval '16 hours'),
    ('c7200000-0000-4000-8000-0000000000b2', 1, time '06:00', interval '16 hours'),
    ('c7200000-0000-4000-8000-0000000000b3', 2, time '06:00', interval '12 hours'),
    ('c7200000-0000-4000-8000-0000000000b4', 3, time '09:00', interval '8 hours'),
    -- the visa that ends on Wednesday (W+2), AC6
    ('c7200000-0000-4000-8000-0000000000c1', 2, time '09:00', interval '8 hours'),
    ('c7200000-0000-4000-8000-0000000000c2', 3, time '09:00', interval '8 hours'),
    ('c7200000-0000-4000-8000-0000000000c3', 2, time '23:00', interval '4 hours')
  ) as t(id, d, s, len);

-- Uploaded objects, as Storage records them after the Staff App's server
-- code has put them in the private bucket.
insert into storage.objects (bucket_id, name, metadata) values
  ('documents', :'stu'  || '/completion-letter/l1.pdf',  '{"mimetype":"application/pdf","size":482113}'),
  ('documents', :'stu'  || '/completion-letter/big.pdf', '{"mimetype":"application/pdf","size":10485761}'),
  ('documents', :'stu'  || '/completion-letter/g.png',   '{"mimetype":"image/gif","size":2000}'),
  ('documents', :'stu2' || '/completion-letter/l2.jpg',  '{"mimetype":"image/jpeg","size":90000}'),
  ('documents', :'stu2' || '/completion-letter/l3.png',  '{"mimetype":"image/png","size":90000}'),
  ('documents', :'cand' || '/completion-letter/c1.pdf',  '{"mimetype":"application/pdf","size":1000}'),
  ('documents', :'grad' || '/wtr-optout/signed.pdf',     '{"mimetype":"application/pdf","size":1000}');

-- =====================================================================
-- AC1 · a Student-visa worker with no approved letter, through the UI
-- =====================================================================
select is((weekly_cap_for(:'stu', :'w'::date)).cap_hours, 20,
  'AC1: a student with no approved completion letter is on 20 h in a term week');

-- 16 hours confirmed in week W.
insert into bookings (shift_id, staff_id, status, source, confirmed_at) values
  ('c7200000-0000-4000-8000-0000000000a1', :'stu', 'confirmed', 'auto', now()),
  ('c7200000-0000-4000-8000-0000000000a2', :'stu', 'confirmed', 'auto', now());

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);
select is(invite_worker('c7200000-0000-4000-8000-0000000000a3', :'stu', 'manual') ->> 'reason', 'hours_limit',
  'AC1: the office cannot invite her to an 8 h shift that would make 24 h (invite_worker)');
select is((select gate from auto_assign_candidates('c7200000-0000-4000-8000-0000000000a3') where staff_id = :'stu'),
  'hours_limit', 'AC1: auto-assign gates her out of that shift''s pool');

-- An invitation that got through before the hours did (sent earlier,
-- accepted now): the worker's Accept is refused live.
insert into bookings (id, shift_id, staff_id, status, source)
values ('c7300000-0000-4000-8000-000000000001', 'c7200000-0000-4000-8000-0000000000a3', :'stu', 'invited', 'auto');
select set_config('request.jwt.claims', json_build_object('sub', :'stu_uid')::text, true);
select is(accept_invite('c7300000-0000-4000-8000-000000000001') ->> 'reason', 'hours_limit',
  'AC1: the worker''s Accept in the Staff App is refused at 24 h');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);

-- The office writing the booking directly — the path no RPC guards.
select throws_ok($$ update bookings set status = 'confirmed', confirmed_at = now()
                     where id = 'c7300000-0000-4000-8000-000000000001' $$,
  'P0001', 'rota_guard_visa_cap',
  'AC1: even a direct write to bookings cannot confirm her past 20 h — the database refuses it');
update settings set value = '"warn"' where key = 'rota_guard_mode';
select throws_ok($$ update bookings set status = 'confirmed', confirmed_at = now()
                     where id = 'c7300000-0000-4000-8000-000000000001' $$,
  'P0001', 'rota_guard_visa_cap',
  'AC1: and the warn setting does not relax it — the Student visa limit is never configurable');
select is(invite_worker('c7200000-0000-4000-8000-0000000000a3', :'stu', 'manual') ->> 'reason', 'hours_limit',
  'AC1: and in warn mode the office''s invite is still gated on the visa limit');
update settings set value = '"block"' where key = 'rota_guard_mode';
select throws_ok($$ insert into bookings (shift_id, staff_id, status, source, confirmed_at)
                   values ('c7200000-0000-4000-8000-0000000000a5', 'c7000000-0000-4000-8000-000000000001',
                           'confirmed', 'manual', now()) $$,
  'P0001', 'rota_guard_visa_cap',
  'AC1: nor can a confirmed booking be inserted directly (16 + 5 = 21 h)');

-- Up to exactly 20 is fine.
insert into bookings (id, shift_id, staff_id, status, source)
values ('c7300000-0000-4000-8000-000000000002', 'c7200000-0000-4000-8000-0000000000a4', :'stu', 'invited', 'auto');
select set_config('request.jwt.claims', json_build_object('sub', :'stu_uid')::text, true);
select is(accept_invite('c7300000-0000-4000-8000-000000000002') ->> 'ok', 'true',
  'AC1: a 4 h shift that takes her to exactly 20 h is accepted');
select is(weekly_booked_hours(:'stu', :'w'::date), 20::numeric, 'AC1: she is at 20 h, not over');

-- =====================================================================
-- §2.1 Upload — submit_completion_letter(), the worker's RPC
-- =====================================================================
select is(submit_completion_letter(:'stu' || '/completion-letter/l1.pdf', :'w'::date + 2, 'poster') ->> 'reason',
  'invalid_form', '§2.1: the form must be one of the three acceptable ones');
select is(submit_completion_letter(:'stu' || '/completion-letter/l1.pdf', null, 'letter') ->> 'reason',
  'completion_date_required', '§2.1: the worker must enter the completion date on the document');
select is(submit_completion_letter(:'stu' || '/completion-letter/nothere.pdf', :'w'::date + 2, 'letter') ->> 'reason',
  'file_not_found', '§2.1: the file has to actually be in Storage');
select is(submit_completion_letter(:'stu' || '/completion-letter/big.pdf', :'w'::date + 2, 'letter') ->> 'reason',
  'file_too_large', '§2.1: 10 MB is the ceiling, read from what Storage recorded');
select is(submit_completion_letter(:'stu' || '/completion-letter/g.png', :'w'::date + 2, 'letter') ->> 'reason',
  'unsupported_file_type', '§2.1: PDF, JPG or PNG — by recorded content type, not by the name');
select is(submit_completion_letter(:'stu2' || '/completion-letter/l2.jpg', :'w'::date + 2, 'letter') ->> 'reason',
  'invalid_path', '§2.1: a worker cannot attach a file from somebody else''s folder');
select is(submit_completion_letter(:'stu' || '/passport/l1.pdf', :'w'::date + 2, 'letter') ->> 'reason',
  'invalid_path', '§2.1: and only from their completion-letter folder');

-- =====================================================================
-- AC2 · the upload changes nothing
-- =====================================================================
select is(submit_completion_letter(:'stu' || '/completion-letter/l1.pdf', :'w'::date + 2, 'transcript',
                                   'Queen Mary University of London') ->> 'ok', 'true',
  '§2.1: a completers transcript is accepted as the completion letter');
select is((select review_status::text from compliance_docs
            where staff_id = :'stu' and doc_type = 'university_completion_letter'), 'pending',
  'AC2: the upload lands in pending review');
select is((weekly_cap_for(:'stu', :'w'::date + 7)).cap_hours, 20,
  'AC2: uploading a completion letter alone does not change the cap (the week after the date on it is still 20 h)');
select is((select graduated_at from staff where id = :'stu'), null,
  'AC2: the upload writes nothing the cap reads — graduated_at is untouched');
select is((select course_completion_date from staff where id = :'stu'), null,
  'AC2: nor course_completion_date: the date the worker typed is evidence, not effect');
select is((select completion_date_claimed from compliance_docs
            where staff_id = :'stu' and doc_type = 'university_completion_letter'), :'w'::date + 2,
  '§2.1: the date the worker entered is kept as their claim');
select is((select mime_type || ' ' || size_bytes from compliance_docs
            where staff_id = :'stu' and doc_type = 'university_completion_letter'),
  'application/pdf 482113', '§4: what was uploaded is recorded as Storage recorded it');
select is(submit_completion_letter(:'stu' || '/completion-letter/l1.pdf', :'w'::date + 2, 'letter') ->> 'reason',
  'already_pending', 'one letter with the office at a time');
select is((select count(*)::int from notification_outbox where template = 'CL1' and recipient_staff_id = :'stu'), 1,
  '§5: the worker is told the upload was received (CL1)');
select is((select count(*)::int from notification_outbox where template = 'CL4'
            and payload ->> 'name' = 'Amara Student'), 1,
  '§5: the office is told a document is awaiting review (CL4)');
select is((select count(*)::int from compliance_blockers(:'stu')), 0,
  'a pending completion letter is not a compliance blocker: it can only ever raise the cap');
select is((select item_type from compliance_review_queue_v
            where staff_id = :'stu'), 'university_completion_letter',
  '§2.2: it is in Compliance → Needs review');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);
select is((select count(*)::int from compliance_review_queue_v where staff_id = :'stu'), 1,
  '(the office sees it there)');

-- Not a student: refused.
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid')::text, true);
select is(submit_completion_letter(:'staffa' || '/completion-letter/x.pdf', :'w'::date, 'letter') ->> 'reason',
  'not_student_visa', '§2.1: the upload is for Student / Tier 4 workers only');
select set_config('request.jwt.claims', '', true);
select throws_ok(format('select submit_completion_letter(%L, %L, %L)', :'stu' || '/completion-letter/l1.pdf',
                        :'w'::date + 2, 'letter'),
  '42501', 'not_a_worker', 'nobody signed in cannot upload for anyone');

-- =====================================================================
-- AC3 · approval → 48 from the completion date
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'stu_uid')::text, true);
select throws_ok(format('select approve_completion_letter(%L, %L, %L)',
                        (select id from compliance_docs where staff_id = :'stu' and doc_type = 'university_completion_letter'),
                        :'w'::date + 2, :'w'::date + 400),
  '42501', 'not_authorised', '§2.2: a worker cannot approve their own letter');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);
select throws_ok(format('select approve_completion_letter(%L, %L, null)',
                        (select id from compliance_docs where staff_id = :'stu' and doc_type = 'university_completion_letter'),
                        :'w'::date + 2),
  'P0001', 'visa_expiry_required', '§2.2: the reviewer must confirm the visa expiry');
select throws_ok(format('select compliance_verify_document(%L)',
                        (select id from compliance_docs where staff_id = :'stu' and doc_type = 'university_completion_letter')),
  'P0001', 'use_approve_completion_letter', '§2.2: the plain Verify is not enough for this document');
select throws_ok(format($$ update compliance_docs set review_status = 'verified', completion_date = %L
                            where id = %L $$,
                        :'w'::date + 2,
                        (select id from compliance_docs where staff_id = :'stu' and doc_type = 'university_completion_letter')),
  'P0001', 'completion_letter_needs_approval',
  '§2.2: nor can any other path verify it without the reviewer confirming the visa expiry — a generic Verify, a direct write');

-- The reviewer reads a LATER expiry off the letter than the gov.uk check
-- recorded. The earlier one stands.
select is(approve_completion_letter(
            (select id from compliance_docs where staff_id = :'stu' and doc_type = 'university_completion_letter'),
            :'w'::date + 2, :'w'::date + 999) ->> 'effectiveFrom',
  (:'w'::date + 7)::text,
  'AC3: approval takes effect from the first whole week after the completion date');
select is((weekly_cap_for(:'stu', :'w'::date)).cap_hours, 20,
  'AC3: the week the course completes in (it straddles the date) is still 20 h');
select is((weekly_cap_for(:'stu', :'w'::date + 7)).cap_hours, 48,
  'AC3: on approval the cap becomes 48 hours/week from the completion date');
select is((weekly_cap_for(:'stu', :'w'::date + 7)).band::text, 'graduated_48',
  'AC3: labelled as the completion letter''s band');
select is((weekly_cap_for(:'stu', current_date)).cap_hours, 20,
  '§7: a completion date in the future lifts nothing yet — this week is still 20 h');
select is((select right_to_work_until from staff where id = :'stu'), :'w'::date + 400,
  '§2.2: a reviewer cannot extend the right to work past the gov.uk check: the earlier expiry stands');
select is((select course_completion_date from staff where id = :'stu'), :'w'::date + 2,
  'AC3: the reviewer-confirmed completion date is what the cap reads');
select is((select payload ->> 'variant' || '|' || (payload ->> 'limit') || '|' || (payload ->> 'date')
             from notification_outbox where template = 'CL2' and recipient_staff_id = :'stu'),
  'dated|48|' || to_char(:'w'::date + 7, 'DD Mon YYYY'),
  '§5: the worker is told the new cap and its effective date (CL2)');
select is((select reviewed_by from compliance_docs where staff_id = :'stu' and doc_type = 'university_completion_letter'),
  :'admin_uid'::uuid, '§4: the reviewer''s identity is on the document');

-- §4.2 / B6b follow-up: the term-letter ladder follows the COMPLETION date.
select is(term_letter_applies(:'stu', current_date), true,
  '§4.2: a verified letter with a future completion date keeps the term-letter ladder running');
select is(term_letter_applies(:'stu', :'w'::date + 3), false,
  '§4.2: from the completion date on, the term letter no longer applies');

-- =====================================================================
-- §7 · a visa that ends before the release would start
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'stu2_uid')::text, true);
select is(submit_completion_letter(:'stu2' || '/completion-letter/l2.jpg', :'w'::date + 2, 'university_email') ->> 'ok',
  'true', '§2.1: an official university email is accepted as the completion letter');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);
select is(approve_completion_letter(
            (select id from compliance_docs where staff_id = :'stu2' and doc_type = 'university_completion_letter'),
            :'w'::date + 2, :'w'::date + 3) ->> 'releaseBlockedByVisa', 'true',
  '§7: the visa ends (W+3) before the release starts (W+7) — the expiry takes precedence');
select is((select payload ->> 'variant' from notification_outbox where template = 'CL2' and recipient_staff_id = :'stu2'),
  'visa_first', '§7: and the worker is told so, rather than promised 48 hours they cannot work');
select is((weekly_cap_for(:'stu2', :'w'::date + 7)).cap_hours, 0,
  '§7: the week after the visa, the cap is 0 — expiry outranks the completion letter');

-- =====================================================================
-- §2.2 Reject → N8 → re-upload
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'stu2_uid')::text, true);
select is(submit_completion_letter(:'stu2' || '/completion-letter/l3.png', :'w'::date + 60, 'letter') ->> 'ok',
  'true', 'a second letter can be uploaded once the first is decided');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);
select lives_ok(format('select compliance_reject_document(%L, %L)',
  (select id from compliance_docs where staff_id = :'stu2' and doc_type = 'university_completion_letter'
      and review_status = 'pending'),
  'The award date is not visible — upload the full letter'),
  '§2.2: the reviewer rejects it with a reason');
select is((select payload ->> 'reason' from notification_outbox where template = 'N8' and recipient_staff_id = :'stu2'),
  'The award date is not visible — upload the full letter',
  '§5: the worker is told the reason (N8, with Re-upload)');
select is((select course_completion_date from staff where id = :'stu2'), :'w'::date + 2,
  '§7: rejecting a later letter leaves the approved one exactly where it was');
select is((select count(*)::int from compliance_blockers(:'stu2')), 0,
  'a rejected completion letter is not a blocker either');

-- =====================================================================
-- AC4 · above 48 only with a valid opt-out, 18+
-- =====================================================================
update staff set graduated_at = current_date - 30, course_completion_date = current_date - 60
 where id = :'grad';
insert into bookings (shift_id, staff_id, status, source, confirmed_at) values
  ('c7200000-0000-4000-8000-0000000000b1', :'grad', 'confirmed', 'auto', now()),
  ('c7200000-0000-4000-8000-0000000000b2', :'grad', 'confirmed', 'auto', now()),
  ('c7200000-0000-4000-8000-0000000000b3', :'grad', 'confirmed', 'auto', now());
select is((weekly_cap_for(:'grad', :'w'::date)).cap_hours, 48, 'AC4: a graduate with no opt-out is on 48 h');
select is(weekly_booked_hours(:'grad', :'w'::date), 44::numeric, 'AC4: 44 h are booked');

insert into bookings (id, shift_id, staff_id, status, source)
values ('c7300000-0000-4000-8000-000000000004', 'c7200000-0000-4000-8000-0000000000b4', :'grad', 'invited', 'auto');
select set_config('request.jwt.claims', json_build_object('sub', :'grad_uid')::text, true);
select is(accept_invite('c7300000-0000-4000-8000-000000000004') ->> 'reason', 'hours_limit',
  'AC4: Accept is refused at 52 h with no opt-out on file');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);
select throws_ok($$ update bookings set status = 'confirmed' where id = 'c7300000-0000-4000-8000-000000000004' $$,
  'P0001', 'rota_guard_wtr_cap', 'AC4: and a direct write is refused too, in the default block mode');

-- §4 "warn (or block, configurable)": the Working Time 48 is the one
-- limit THC may choose to be warned about instead.
update settings set value = '"warn"' where key = 'rota_guard_mode';
select lives_ok($$ update bookings set status = 'confirmed' where id = 'c7300000-0000-4000-8000-000000000004' $$,
  '§4: in warn mode a Working Time 48 breach is let through…');
select is((select count(*)::int from audit_log where action = 'rota_guard.warned'
            and entity_id = 'c7300000-0000-4000-8000-000000000004'), 1,
  '§4: …and recorded as a warning for the office');
select is((select band from rota_guard_warnings_v where booking_id = 'c7300000-0000-4000-8000-000000000004'),
  'graduated_48', '§4: on the warnings list, with the band it breached');
update settings set value = '"block"' where key = 'rota_guard_mode';
update bookings set status = 'invited', confirmed_at = null where id = 'c7300000-0000-4000-8000-000000000004';

-- Signing the opt-out.
select set_config('request.jwt.claims', json_build_object('sub', :'grad_uid')::text, true);
select is(sign_wtr_optout(:'grad' || '/wtr-optout/signed.pdf', 7) ->> 'ok', 'true',
  '§2.4: the graduate signs the 48-hour opt-out, with a signed copy');
select is((weekly_cap_for(:'grad', :'w'::date)).cap_hours, null,
  'AC4: with a valid opt-out the ceiling is gone');
select is(accept_invite('c7300000-0000-4000-8000-000000000004') ->> 'ok', 'true',
  'AC4: and rostering above 48 hours is possible');
select is(sign_wtr_optout() ->> 'reason', 'already_signed', 'signing twice is refused');
select is((select count(*)::int from notification_outbox where template = 'CL6'
            and payload ->> 'name' = 'Isla Graduate'), 1,
  '§5: the office is told the opt-out was signed (CL6)');

-- The opt-out lifts nothing for a student in term.
select set_config('request.jwt.claims', json_build_object('sub', :'stu_uid')::text, true);
select is(sign_wtr_optout() ->> 'ok', 'true', '§2.4: a student may record an opt-out too…');
select is((weekly_cap_for(:'stu', :'w'::date)).cap_hours, 20,
  'AC1/AC4: …and it does not lift the Student visa term-time limit');

-- 18+, with an age on file.
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);
-- age_18 and dob_present_unless_removed stop an under-18 or dateless row
-- ever being written; the guards in sign_wtr_optout() are the second
-- line, so the first is set aside here (inside this transaction only) to
-- reach them.
alter table staff drop constraint age_18;
alter table staff drop constraint dob_present_unless_removed;
update staff set dob = null where id = :'nodob';
select is(sign_wtr_optout(null, 7, :'nodob') ->> 'reason', 'age_unknown',
  'AC4: no date of birth on file, no opt-out — an age that was never checked cannot be relied on');
update staff set dob = current_date - interval '17 years' where id = :'nodob';
select is(sign_wtr_optout(null, 7, :'nodob') ->> 'reason', 'under_18',
  'AC4: an under-18 cannot opt out');
select is((weekly_cap(false, 'none', false, true, :'w'::date, false, null, null, null,
                      cap_under_18((current_date - interval '17 years')::date, :'w'::date))).cap_hours, 48,
  'AC4: and an opt-out tick recorded against an under-18 lifts nothing');
select is(sign_wtr_optout(null, 3, :'grad') ->> 'reason', 'invalid_notice_period',
  '§2.4: a notice period under 7 days is refused');

-- =====================================================================
-- AC5 · cancelling → 48 after the notice period
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'grad_uid')::text, true);
select is(cancel_wtr_optout() ->> 'effectiveFrom', ((now() at time zone 'Europe/London')::date + 7)::text,
  'AC5: notice is given; the ceiling returns at the end of the 7-day notice period');
select is((weekly_cap_for(:'grad', current_date)).cap_hours, null,
  'AC5: this week is inside the notice period, still no ceiling');
select is((weekly_cap_for(:'grad', :'w'::date)).cap_hours, 48,
  'AC5: cancelling an opt-out re-imposes the 48-hour cap after the notice period');
select matches((select payload ->> 'overCapWeeks' from notification_outbox where template = 'CL7'
                 and payload ->> 'name' = 'Isla Graduate'),
  to_char(:'w'::date, 'DD Mon YYYY') || ' \(52\.0 h\)',
  '§5: the office is told, with the week already booked over the returning 48 (CL7)');
select is(cancel_wtr_optout() ->> 'reason', 'no_active_optout', 'cancelling twice is refused');

-- =====================================================================
-- AC6 · never beyond the visa expiry
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);
insert into bookings (id, shift_id, staff_id, status, source) values
  ('c7300000-0000-4000-8000-000000000006', 'c7200000-0000-4000-8000-0000000000c2', :'expw', 'invited', 'auto'),
  ('c7300000-0000-4000-8000-000000000007', 'c7200000-0000-4000-8000-0000000000c3', :'expw', 'invited', 'auto');
select set_config('request.jwt.claims', json_build_object('sub', :'exp_uid')::text, true);
select is(accept_invite('c7300000-0000-4000-8000-000000000006') ->> 'reason', 'hours_limit',
  'AC6: a shift the day after the recorded visa expiry cannot be accepted');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);
update settings set value = '"warn"' where key = 'rota_guard_mode';
select throws_ok($$ update bookings set status = 'confirmed' where id = 'c7300000-0000-4000-8000-000000000006' $$,
  'P0001', 'rota_guard_rtw_expired',
  'AC6: no worker can be rostered beyond their recorded visa expiry — not by a direct write, not in warn mode');
select throws_ok($$ update bookings set status = 'confirmed' where id = 'c7300000-0000-4000-8000-000000000007' $$,
  'P0001', 'rota_guard_rtw_expired',
  'AC6: a shift starting on the last valid day and ending after midnight is past the expiry too');
update settings set value = '"block"' where key = 'rota_guard_mode';
select is(invite_worker('c7200000-0000-4000-8000-0000000000c1', :'expw', 'manual') ->> 'invited', 'true',
  'AC6: the last valid day itself is still workable (the expiry is inclusive)');
select is(invite_worker('c7200000-0000-4000-8000-0000000000c3', :'expw', 'manual') ->> 'reason', 'hours_limit',
  'AC6: the office cannot invite them to the overnight shift either');

-- §7 · the switch to a Graduate or Skilled Worker visa.
select is(record_right_to_work_change(:'stu2', 'work_visa', :'w'::date + 700, 'W99887766') ->> 'studentLogicEnded',
  'true', '§7: a new right-to-work check (Graduate visa) is recorded mid-employment');
select is((weekly_cap_for(:'stu2', :'w'::date)).band::text, 'standard_48',
  '§7: the student caps no longer apply, the Working Time 48 still does');
select is(term_letter_applies(:'stu2', current_date), false,
  '§7: and nobody chases them for a term letter any more');
select is(can_roster_staff(:'stu2', :'w'::date + 600), true,
  '§7: the new visa''s expiry is the one the rota stops at');

-- =====================================================================
-- AC7 · auditable and exportable
-- =====================================================================
select bag_eq(
  $$ select event from compliance_evidence_audit_v
      where staff_id = 'c7000000-0000-4000-8000-000000000001' and record_type = 'completion_letter' $$,
  $$ values ('uploaded'::text), ('approved') $$,
  'AC7: the letter''s upload and its approval are each an audit row');
select is((select actor_name from compliance_evidence_audit_v
            where staff_id = :'stu' and event = 'uploaded'), 'Amara Student',
  'AC7: who uploaded it');
select is((select actor_name || ' · ' || completion_date || ' · ' || visa_expiry
             from compliance_evidence_audit_v where staff_id = :'stu' and event = 'approved'),
  'Gisela M. · ' || (:'w'::date + 2) || ' · ' || (:'w'::date + 999),
  'AC7: who approved it, the completion date and the visa expiry they confirmed');
select isnt((select uploaded_at from compliance_evidence_audit_v where staff_id = :'stu' and event = 'approved'), null,
  'AC7: with the upload timestamp carried on the decision row');
select is((select reason from compliance_evidence_audit_v where staff_id = :'stu2' and event = 'rejected'),
  'The award date is not visible — upload the full letter', 'AC7: the rejection reason');
select bag_eq(
  $$ select event from compliance_evidence_audit_v
      where staff_id = 'c7000000-0000-4000-8000-000000000002' and record_type = 'wtr_optout' $$,
  $$ values ('signed'::text), ('cancelled') $$,
  'AC7: the opt-out being signed and cancelled is in the same export');
select is((select notice_days || ' · ' || effective_from from compliance_evidence_audit_v
            where staff_id = :'grad' and event = 'cancelled'),
  '7 · ' || ((now() at time zone 'Europe/London')::date + 7),
  'AC7: with the notice period and the date the ceiling returned');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);
select cmp_ok((select count(*)::int from compliance_evidence_audit_v where staff_id = :'stu'), '>=', 2,
  'AC7: the office reads the export');
select throws_ok($$ insert into audit_log (action, entity) values ('completion_letter.approved', 'compliance_doc') $$,
  '42501', null, 'AC7: the office cannot forge an audit row…');
with u as (update audit_log set data = '{}' where action like 'completion\_letter.%' returning 1)
  select is((select count(*)::int from u), 0, 'AC7: …nor rewrite one');
select set_config('request.jwt.claims', json_build_object('sub', :'stu_uid')::text, true);
select is((select count(*)::int from compliance_evidence_audit_v), 0,
  'AC7: a worker does not read the audit export, not even their own rows');
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid')::text, true);
select is((select count(*)::int from compliance_evidence_audit_v), 0, 'AC7: nor does a client');
select is((select count(*)::int from student_visa_v), 0, '§4 reporting is the office''s: a client sees no student');
reset role;

-- =====================================================================
-- §4 Reporting — student_visa_v
-- =====================================================================
select is((select completion_letter_status || ' · ' || course_completion_date || ' · ' || weekly_cap_hours
             from student_visa_v where id = :'stu'),
  'verified · ' || (:'w'::date + 2) || ' · 20',
  '§4: the student view shows evidence status, the completion date and the cap in force today');
select is((select rtw_days_left from student_visa_v where id = :'stu'),
  (:'w'::date + 400) - (now() at time zone 'Europe/London')::date,
  '§4: and the visa expiry, as days left');
select is((select count(*)::int from student_visa_v where id = :'stu2'), 0,
  '§7: a worker who switched to a Graduate visa has left the student view');

-- =====================================================================
-- §4 Retention — employment + 2 years, its own rule (ADR-0012)
-- =====================================================================
select set_config('request.jwt.claims', '', true);
select is((remove_worker(:'stu') ->> 'documentsHeld')::int, 1,
  '§4: removing an employed worker HOLDS their completion letter rather than deleting it');
select is((select retain_until from compliance_docs where staff_id = :'stu' and doc_type = 'university_completion_letter'),
  ((now() at time zone 'Europe/London')::date + interval '2 years')::date,
  '§4: until two years after employment ended');
select is((select count(*)::int from storage_deletions where path = :'stu' || '/completion-letter/l1.pdf'), 0,
  '§4: and its file is not queued for deletion');
select is((select course_completion_date from staff where id = :'stu'), null,
  '§1.7: everything else is wiped, the new staff columns included');

select is((rtw_daily(now() + interval '1 year') ->> 'retentionPurged')::int, 0,
  '§4: a year on, the letter is still held');
select is((rtw_daily(now() + interval '2 years 1 day') ->> 'retentionPurged')::int, 1,
  '§4: once the two years have run, the daily job purges it');
select is((select count(*)::int from storage_deletions where path = :'stu' || '/completion-letter/l1.pdf'), 1,
  '§4: and queues its file for deletion');
select is((select count(*)::int from compliance_evidence_audit_v where staff_id = :'stu' and event = 'purged'), 1,
  'AC7: the purge itself is on the audit trail');

-- A candidate who was never employed has nothing to retain against.
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);
insert into compliance_docs (staff_id, doc_type, file_path, review_status)
values (:'cand', 'university_completion_letter', :'cand' || '/completion-letter/c1.pdf', 'pending');
select set_config('request.jwt.claims', '', true);
select is((remove_worker(:'cand') ->> 'documentsHeld')::int, 0,
  '§4: a candidate never employed has no employment to retain against — their letter is wiped as before');

-- =====================================================================
-- §2.3 right-to-work alerts, and the reset follow-up
-- =====================================================================
select cmp_ok((rtw_daily() ->> 'rtwAlerts')::int, '>=', 1, '§2.3: the daily job alerts the office ahead of expiry');
select is((select count(*)::int from notification_outbox
            where key = 'CL5:staff:' || :'alert' || ':' || (current_date + 20) || ':30'), 1,
  '§2.3: 20 days out is the 30-day rung (CL5), keyed on the expiry date');
select is((rtw_daily() ->> 'rtwAlerts')::int, 0, '§2.3: and a second run the same day sends nothing new');

update staff set status = 'blocked', block_kind = 'manual', block_reason = 'x' where id = :'grad';
select lives_ok(format('select reset_to_candidate(%L, %L)', :'grad', 'Returning next term'), 'reset to candidate');
select is((select row(course_completion_date, wtr_optout, wtr_optout_cancelled_from, wtr_optout_signed_at)::text
             from staff where id = :'grad'), '(,f,,)',
  'B6b follow-up: a reset clears the completion date and the opt-out with the evidence they rested on');

select * from finish();
rollback;
