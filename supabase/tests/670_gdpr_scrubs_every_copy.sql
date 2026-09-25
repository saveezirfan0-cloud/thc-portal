-- =====================================================================
-- 670 · §1.7 GDPR removal reaches every copy of the person (audit D9)
--   remove_worker() from 20260930120100_gdpr_removal_scrubs_the_rest.sql
--
-- 230 asserts the staff row, the evidence sets and the ban; 250 the
-- Storage queue and the applications' names. This file is every OTHER
-- place the same person was written down: the login, the profile, the
-- outbox (E8 carries the NI number), the audit trail, where they stood
-- on shift, the onboarding answers, the application's date of birth, the
-- office's notes — and that the person can come back (D9b).
--
-- Each wiped value has a control row belonging to somebody else that
-- must survive, so an over-eager scrub fails here too.
-- =====================================================================
begin;
select plan(40);
\set now '2026-09-25 12:00:00+01'
\ir _shared/fixtures.psql

\set gdpr     'd6300000-0000-4000-8000-000000000001'
\set gdpr_uid 'd6300000-0000-4000-8000-0000000000aa'
\set ev       'a6300000-0000-4000-8000-000000000001'
\set past     'b6300000-0000-4000-8000-000000000001'
\set future   'b6300000-0000-4000-8000-000000000002'
\set bk_past  'c6300000-0000-4000-8000-000000000001'
\set bk_fut   'c6300000-0000-4000-8000-000000000002'
\set doc      'e6300000-0000-4000-8000-000000000001'
\set decl     'f6300000-0000-4000-8000-000000000001'
\set app      'f6300000-0000-4000-8000-000000000002'

insert into auth.users (id, email, phone, raw_user_meta_data, recovery_token)
values (:'gdpr_uid', 'grace.l@example.com', '+447700906301',
        '{"full_name":"Grace Lindqvist","phone":"+447700906301"}', 'a-live-recovery-token');
insert into auth.identities (provider_id, user_id, identity_data, provider, email)
values (:'gdpr_uid', :'gdpr_uid',
        jsonb_build_object('sub', :'gdpr_uid', 'email', 'grace.l@example.com', 'name', 'Grace Lindqvist'),
        'email', 'grace.l@example.com');
insert into profiles (id, role, full_name) values (:'gdpr_uid', 'staff', 'Grace Lindqvist');

insert into staff (id, user_id, employee_id, first_name, last_name, email, phone, dob, status,
                   rtw_branch, ni_number, gender, home_postcode, home_country, applied_age_band,
                   rejection_reason, rejection_cause)
values (:'gdpr', :'gdpr_uid', 96301, 'Grace', 'Lindqvist', 'grace.l@example.com', '+447700906301',
        date '1997-03-30', 'compliant', 'uk_irish', 'QQ630630C', 'F', 'E3 4AA', 'United Kingdom',
        '25', 'Earlier interview: note that names her', 'manager');

insert into onboarding_progress (staff_id, uk_doc_choice, visa_type, visa_expiry)
values (:'gdpr', 'passport', 'Student', date '2027-09-30'), (:'staffa', 'passport', 'Graduate', date '2028-01-31');

insert into applications (id, first_name, last_name, email, phone, age_band, outcome, staff_id,
                          consented_at, dob, resolution_reason)
values (:'app', 'Grace', 'Lindqvist', 'grace.l@example.com', '+447700906301', '25',
        'returning_applicant', :'gdpr', :'now'::timestamptz, date '1997-03-30',
        'Reset after Grace called the office');

insert into client_qualifications (client_id, role_id, staff_id, note)
values (:'clienta', :'role_id', :'gdpr', 'Grace was brilliant with the VIP table'),
       (:'clientb', :'role_id', :'staffa', 'Control note');

insert into criminal_declarations (id, staff_id, source, answer, details, conviction_date,
                                   review_status, review_note, reviewed_by)
values (:'decl', :'gdpr', 'in_employment', true, 'What she declared', date '2025-01-01',
        'rejected', 'The manager''s reason, about her', :'admin_uid');

insert into compliance_docs (id, staff_id, doc_type, review_status, uploaded_at)
values (:'doc', :'gdpr', 'share_code_report', 'pending', :'now'::timestamptz);
insert into rtw_checks (staff_id, compliance_doc_id) values (:'gdpr', :'doc');

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer)
values (:'ev', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
        st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Scrub Event',
        date '2026-09-01', false, true);
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour)
values (:'past',   :'ev', :'role_id', '2026-09-01 17:00+00', '2026-09-01 23:00+00', 4, 0, 30, 15, 1),
       (:'future', :'ev', :'role_id', '2026-10-10 17:00+00', '2026-10-10 23:00+00', 4, 0, 30, 15, 1);
insert into bookings (id, shift_id, staff_id, status, source)
values (:'bk_past', :'past',   :'gdpr', 'worked',    'auto'),
       (:'bk_fut',  :'future', :'gdpr', 'confirmed', 'auto');
insert into check_logs (booking_id, attempted_at, outcome, location, distance_m, check_in_at, check_out_at)
values (:'bk_past', '2026-09-01 16:58+00', 'checked_in',
        st_setsrid(st_makepoint(-0.1001, 51.5001), 4326)::geography, 12.5,
        '2026-09-01 16:58+00', '2026-09-01 23:02+00');
insert into location_pings (booking_id, at, location, inside_geofence)
values (:'bk_past', '2026-09-01 19:00+00', st_setsrid(st_makepoint(-0.1002, 51.5002), 4326)::geography, true),
       (:'booking_a', '2026-09-01 19:00+00', st_setsrid(st_makepoint(-0.2, 51.6), 4326)::geography, false);

-- The outbox, sent and unsent.
insert into notification_outbox (key, channel, template, recipient_staff_id, recipient_emails, payload, sent_at) values
  ('N6:booking:' || :'bk_fut', 'push', 'N6', :'gdpr', null, '{"title":"Tomorrow"}', null),
  ('E10:booking:' || :'bk_fut', 'email', 'E10', null, array['admin@thehospitalitycompany.co.uk'],
   '{"worker":"Grace Lindqvist"}', null),
  ('E3:staff:' || :'gdpr', 'email', 'E3', :'gdpr', array['grace.l@example.com'],
   '{"name":"Grace Lindqvist","link":"https://x/activate/abc"}', :'now'::timestamptz - interval '30 days'),
  ('E8:staff:' || :'gdpr' || ':1790000000', 'email', 'E8', null, array['admin@thehospitalitycompany.co.uk'],
   '{"name":"Grace Lindqvist","niNumber":"QQ630630C","employeeId":"96301"}', :'now'::timestamptz - interval '1 day'),
  ('X:free:670', 'email', 'E7', null, array['admin@thehospitalitycompany.co.uk'],
   '{"newEmail":"GRACE.L@example.com"}', :'now'::timestamptz - interval '2 days'),
  ('N6:booking:' || :'booking_a', 'push', 'N6', :'staffa', null, '{"title":"Control"}', null);

-- The audit trail.
insert into audit_log (at, actor, action, entity, entity_id, data) values
  (:'now'::timestamptz - interval '9 days', :'gdpr_uid', 'document_uploaded', 'compliance_doc', :'doc',
   '{"actorName":"Grace Lindqvist","fileName":"grace_passport.jpg","docType":"passport"}'),
  (:'now'::timestamptz - interval '8 days', :'admin_uid', 'block_manual', 'staff', :'gdpr',
   '{"name":"Grace Lindqvist","email":"grace.l@example.com","actorName":"Gisela M.","reason":"late twice"}'),
  (:'now'::timestamptz - interval '7 days', :'admin_uid', 'block_manual', 'staff', :'staffa',
   '{"name":"Staff Alpha","reason":"control"}');

create temporary table t_rm as
  select remove_worker(:'gdpr', :'now'::timestamptz, :'admin_uid') as r;

-- ---------------------------------------------------------------------
-- 1. The login no longer holds the person (and still cannot sign in)
-- ---------------------------------------------------------------------
select is((select email from auth.users where id = :'gdpr_uid'),
  'removed-d6300000000040008000000000000001@invalid.example',
  '§1.7 the login''s address is replaced with removed-<id>@invalid.example');
select is((select phone from auth.users where id = :'gdpr_uid'), null, 'its phone is cleared');
select is((select raw_user_meta_data from auth.users where id = :'gdpr_uid'), '{}'::jsonb,
  'and the user metadata (name, phone) is emptied');
select is((select recovery_token from auth.users where id = :'gdpr_uid'), '',
  'an outstanding reset link dies with it');
select ok((select banned_until > :'now'::timestamptz + interval '50 years' from auth.users where id = :'gdpr_uid'),
  'still banned: §1.7 "cannot sign in at all"');
select is((select identity_data::text from auth.identities where user_id = :'gdpr_uid'),
  jsonb_build_object('sub', :'gdpr_uid', 'email', 'removed-d6300000000040008000000000000001@invalid.example')::text,
  'the email identity carries the removed address and nothing else');
select is((select count(*)::int from auth.users where lower(email) = 'grace.l@example.com'), 0,
  'no login anywhere holds the real address any more');
select is((select full_name from profiles where id = :'gdpr_uid'), 'Deleted account #96301',
  'profiles.full_name is the deleted-account label');

-- ---------------------------------------------------------------------
-- 2. The outbox
-- ---------------------------------------------------------------------
select is((select count(*)::int from notification_outbox where key = 'N6:booking:' || :'bk_fut'), 0,
  'an unsent reminder to the removed worker is deleted, not sent to a disabled account');
select is((select count(*)::int from notification_outbox where key = 'E10:booking:' || :'bk_fut'), 0,
  'an unsent office email keyed on their booking is deleted too');
select is((select payload from notification_outbox where key = 'E8:staff:' || :'gdpr' || ':1790000000'),
  '{"label": "Deleted account #96301", "gdprRemoved": true}'::jsonb,
  'E8, which carried the NI number, keeps only the fact that it was sent');
select is((select recipient_emails from notification_outbox where key = 'E8:staff:' || :'gdpr' || ':1790000000'),
  array['admin@thehospitalitycompany.co.uk'],
  'and its office recipient, which is not the worker''s data, is kept');
select is((select recipient_emails from notification_outbox where key = 'E3:staff:' || :'gdpr'),
  array['removed-d6300000000040008000000000000001@invalid.example'],
  'a sent email TO the worker names the removed address, not theirs');
select is((select payload->>'name' from notification_outbox where key = 'E3:staff:' || :'gdpr'), null,
  'and its payload no longer carries their name or the activation link');
select is((select payload from notification_outbox where key = 'X:free:670'),
  '{"label": "Deleted account #96301", "gdprRemoved": true}'::jsonb,
  'a sent row that only mentions their address (any case) is scrubbed as well');
select is((select payload->>'title' from notification_outbox where key = 'N6:booking:' || :'booking_a'), 'Control',
  'somebody else''s unsent reminder is untouched');
select is((select (r->>'outboxDeleted')::int from t_rm), 2, 'the result counts two deleted rows');
select is((select (r->>'outboxScrubbed')::int from t_rm), 3, 'and three scrubbed ones');

-- ---------------------------------------------------------------------
-- 3. The audit trail keeps what happened, not who they were
-- ---------------------------------------------------------------------
select is((select data->>'actorName' from audit_log where action = 'document_uploaded' and entity_id = :'doc'),
  'Deleted account #96301', 'where the worker was the actor, actorName is the label');
select is((select data ? 'fileName' from audit_log where action = 'document_uploaded' and entity_id = :'doc'), false,
  'and the file name they chose is gone');
select is((select data->>'docType' from audit_log where action = 'document_uploaded' and entity_id = :'doc'), 'passport',
  'the non-personal facts of the row stay');
select is((select (data ? 'name') or (data ? 'email') from audit_log
            where action = 'block_manual' and entity_id = :'gdpr'), false,
  'a row ABOUT them loses their name and address');
select is((select data->>'actorName' || ' / ' || (data->>'reason') from audit_log
            where action = 'block_manual' and entity_id = :'gdpr'), 'Gisela M. / late twice',
  'but the manager who acted, and why, are the office''s record and stay');
select is((select data->>'name' from audit_log where action = 'block_manual' and entity_id = :'staffa'), 'Staff Alpha',
  'another worker''s audit row is untouched');

-- ---------------------------------------------------------------------
-- 4. Where they were
-- ---------------------------------------------------------------------
select is((select count(*)::int from location_pings where booking_id = :'bk_past'), 0,
  'their location pings are deleted');
select is((select count(*)::int from location_pings where booking_id = :'booking_a' and at = '2026-09-01 19:00+00'), 1,
  'somebody else''s are not');
select is((select (location is null and distance_m is null)::text from check_logs where booking_id = :'bk_past'), 'true',
  'the check-in fix and its distance are cleared');
select is((select check_in_at::text || ' / ' || check_out_at::text from check_logs where booking_id = :'bk_past'),
  '2026-09-01 16:58:00+00 / 2026-09-01 23:02:00+00',
  'and the check-in and check-out TIMES stay: pay and timesheets reconcile through them (§1.7 keeps history)');

-- ---------------------------------------------------------------------
-- 5. The remaining personal columns
-- ---------------------------------------------------------------------
select is((select count(*)::int from onboarding_progress where staff_id = :'gdpr'), 0,
  'onboarding_progress (visa type, typed visa expiry) goes with the removal (onboarding_on_staff_change)');
select is((select visa_type from onboarding_progress where staff_id = :'staffa'), 'Graduate',
  'another worker''s answers are not');
select is((select dob::text || '/' || coalesce(resolution_reason, '-') from applications where id = :'app'), '1900-01-01/-',
  'applications: the date of birth takes the sentinel (not null) and the resolution note is cleared');
select is((select coalesce(rejection_reason, '-') || '/' || coalesce(rejection_cause, '-') from staff where id = :'gdpr'), '-/-',
  'staff: the rejection reason and cause are cleared');
select is((select coalesce(gender, '-') || '/' || coalesce(home_postcode, '-') || '/' || coalesce(home_country, '-')
                  || '/' || coalesce(applied_age_band, '-') from staff where id = :'gdpr'), '-/-/-/-',
  'staff: gender, postcode, country and the applied age band are cleared');
select is((select note from client_qualifications where staff_id = :'gdpr'), null,
  'client_qualifications.note (the office''s words about them) is cleared');
select is((select note from client_qualifications where staff_id = :'staffa' and client_id = :'clientb'), 'Control note',
  'another worker''s note is not');
select is((select coalesce(details, '-') || '/' || coalesce(conviction_date::text, '-') || '/' || coalesce(review_note, '-')
             from criminal_declarations where id = :'decl'), '-/-/-',
  'the declaration keeps its answer and dates but loses its content and the review note');
select is((select answer::text || '/' || review_status::text from criminal_declarations where id = :'decl'), 'true/rejected',
  'and the history of the answer and its review survives (§1.5)');
select is((select count(*)::int from rtw_checks where staff_id = :'gdpr'), 0,
  'the automated right-to-work checks (the name gov.uk holds) are gone');

-- ---------------------------------------------------------------------
-- 6. D9b: the person can come back
--
-- Before this, the banned login kept the address, so GoTrue matched the
-- returning person's invite to it ("email exists" → magiclink on the old
-- user) and they could never activate. With the address gone the
-- application is a new candidate AND no login holds the address, so
-- provisionStaffLogin's invite creates a fresh one
-- (packages/db/src/__tests__/provision.test.ts covers the TS half).
-- ---------------------------------------------------------------------
set local role service_role;
select submit_application('Grace', 'Lindqvist', 'grace.l@example.com', '+447700906301', date '1997-03-30', true);
reset role;
select is((select outcome::text from applications where email = 'grace.l@example.com' and staff_id <> :'gdpr'),
  'candidate_created', 'the same person re-applying with the same address is a new candidate');
select is((select user_id from staff where email = 'grace.l@example.com'), null,
  'with no login linked, so activation mints a new one rather than the banned one');

select * from finish();
rollback;
