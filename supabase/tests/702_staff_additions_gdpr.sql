-- =====================================================================
-- 702 · GDPR removal reaches the staff additions (§1.7)
--   staff_removed_purge_additions · 20260930200100, restated in
--   20260930205200 (outbox payloads, decline note) · docs/19 §0.7
--
-- remove_worker() is not restated: a trigger after update of removed_at
-- on staff does the additions' half of the erasure.
--
--   A. The trigger: AFTER UPDATE OF removed_at, fires only when removed_at
--      is first set, a definer that is not an RPC.
--   B. After remove_worker(): availability and the emergency contact are
--      gone; change requests are withdrawn and anonymised; the referral
--      code is revoked; referral rows are kept and the removed referrer
--      reads "Deleted account #id"; open offers by or to the worker lapse
--      and their notes go; offer notices are kept.
--   D. (20260930205200) The outbox copies: RC1 / RC3 / RC4 / OF5 (both
--      key shapes) lose their free text, names read "Deleted account
--      #id", unsent rows are failed gdpr_removed and sent ones keep
--      sent_at; the office's free-text decline note becomes 'gdpr'.
--      audit_log is append-only and is not rewritten.
--   C. Nobody else's rows are touched, and a second removal is a no-op.
-- =====================================================================
begin;
select plan(36);
\ir _shared/fixtures.psql

\set app_b      '65200000-0000-4000-8000-0000000000b1'
\set pcr_name   '65210000-0000-4000-8000-000000000001'
\set pcr_photo  '65210000-0000-4000-8000-000000000002'
\set pcr_old    '65210000-0000-4000-8000-000000000003'
\set pcr_b      '65210000-0000-4000-8000-000000000004'
\set off_a      '65220000-0000-4000-8000-000000000001'
\set off_to_a   '65220000-0000-4000-8000-000000000002'
\set off_b      '65220000-0000-4000-8000-000000000003'
\set booking_b2 '65230000-0000-4000-8000-000000000001'
\set decl_a     '65220000-0000-4000-8000-000000000004'
\set decl_a2    '65220000-0000-4000-8000-000000000005'
\set decl_b     '65220000-0000-4000-8000-000000000006'

-- ---------------------------------------------------------------------
-- Staff Alpha (removed below) and Staff Bravo (must be untouched).
-- ---------------------------------------------------------------------
insert into staff_unavailability (staff_id, period, all_day) values
  (:'staffa', unavailability_range(current_date + 10), true),
  (:'staffa', unavailability_range(current_date + 11, null, '18:00', '23:00'), false),
  (:'staffb', unavailability_range(current_date + 12), true);

insert into staff_emergency_contacts (staff_id, name, relationship, phone) values
  (:'staffa', 'Mariana Alpha', 'Parent', '+447700900131'),
  (:'staffb', 'Tom Bravo', 'Sibling', '+447700900132');

-- A pending name change, a rejected photo, an approved (applied) name.
insert into profile_change_requests (id, staff_id, kind, proposed_first_name, proposed_last_name, evidence_path, worker_note) values
  (:'pcr_old',  :'staffa', 'name', 'Stafford', 'Alpha', :'staffa' || '/change-requests/old.pdf', 'Typo on my first name');
update profile_change_requests
   set status = 'approved', applied_at = now(),
       previous_value = jsonb_build_object('firstName', 'Staff', 'lastName', 'Alpha')
 where id = :'pcr_old';
insert into profile_change_requests (id, staff_id, kind, proposed_first_name, proposed_last_name, evidence_path, worker_note) values
  (:'pcr_name', :'staffa', 'name', 'Mariana', 'Alpha-Smith', :'staffa' || '/change-requests/ev.pdf', 'I got married');
insert into profile_change_requests (id, staff_id, kind, proposed_photo_path, worker_note) values
  (:'pcr_photo', :'staffa', 'photo', :'staffa' || '/selfie-2.jpg', 'New haircut');
update profile_change_requests
   set status = 'rejected', decision_reason = 'Mariana, the photo is too dark.'
 where id = :'pcr_photo';
insert into profile_change_requests (id, staff_id, kind, proposed_photo_path) values
  (:'pcr_b', :'staffb', 'photo', :'staffb' || '/selfie-2.jpg');

insert into staff_referral_codes (staff_id, code) values
  (:'staffa', 'ABCDEFGH'),
  (:'staffb', 'HJKMNPQR');

-- Staff Alpha referred Staff Bravo's application, and was referred by Bravo.
insert into applications (id, first_name, last_name, email, phone, dob, age_band, outcome, staff_id, consented_at) values
  (:'app_b', 'Staff', 'Bravo', 'staffb@rls.test', '+447700900012', date '1994-02-02', '31_40', 'returning_applicant', :'staffb', now());
insert into application_referrals (application_id, referrer_staff_id, candidate_staff_id, code) values
  (:'app_b',    :'staffa', :'staffb', 'ABCDEFGH'),
  (:'applic_a', :'staffb', :'staffa', 'HJKMNPQR');

-- Alpha offered booking_a up; Bravo offered booking_b directly to Alpha;
-- Bravo also has a pool offer on a second booking that nothing touches.
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at)
values (:'booking_b2', :'shift_a', :'staffb', 'confirmed', 'manual', now());
-- Earlier cover requests the office declined: two of Alpha's (one with a
-- note that names them, one with the default) and one of Bravo's.
insert into shift_offers (id, booking_id, mode, expires_at, note) values
  (:'decl_a', :'booking_a', 'office', now() + interval '3 days', 'Hospital appointment');
update shift_offers
   set status = 'cancelled', closed_reason = 'Sorry Mariana, we cannot cover your hospital appointment'
 where id = :'decl_a';
insert into shift_offers (id, booking_id, mode, expires_at) values
  (:'decl_a2', :'booking_a', 'office', now() + interval '3 days');
update shift_offers set status = 'cancelled', closed_reason = 'declined by the office' where id = :'decl_a2';
insert into shift_offers (id, booking_id, mode, expires_at) values
  (:'decl_b', :'booking_b2', 'office', now() + interval '3 days');
update shift_offers set status = 'cancelled', closed_reason = 'Bravo is covered by phone' where id = :'decl_b';

insert into shift_offers (id, booking_id, mode, target_staff_id, expires_at, note) values
  (:'off_a',   :'booking_a',  'pool',   null,      now() + interval '3 days', 'Exam that day'),
  (:'off_to_a', :'booking_b',  'direct', :'staffa', now() + interval '3 days', null),
  (:'off_b',    :'booking_b2', 'pool',   null,      now() + interval '3 days', 'Clash');
insert into shift_offer_notices (offer_id, staff_id) values
  (:'off_b', :'staffa'),
  (:'off_a', :'staffb');

-- The outbox copies, as request_profile_change / office_decide_profile_change
-- / queue_offer_notice write them. Alpha: an unsent RC1, a sent RC3 and RC4,
-- a sent OF5 on the offer key and an unsent one on the booking key
-- (20260930205000's shape). Bravo: an unsent RC1 and OF5 that stay as they are.
insert into notification_outbox (key, channel, template, recipient_staff_id, recipient_emails, payload, sent_at) values
  ('RC1:request:' || :'pcr_name', 'email', 'RC1', null, array['admin@thehospitalitycompany.co.uk'],
   jsonb_build_object('name', 'Staff Alpha', 'employeeId', '90001', 'field', 'name',
                      'requestedAt', '01 Oct 2026 10:00', 'current', 'Staff Alpha',
                      'proposed', 'Mariana Alpha-Smith', 'note', 'I got married'), null),
  ('RC3:request:' || :'pcr_photo', 'push', 'RC3', :'staffa', null,
   jsonb_build_object('field', 'photo', 'reason', 'Mariana, the photo is too dark.'), now()),
  ('RC4:request:' || :'pcr_old', 'email', 'RC4', null,
   array['admin@thehospitalitycompany.co.uk', 'thc_payroll@topsourceworldwide.com'],
   jsonb_build_object('name', 'Stafford Alpha', 'employeeId', '90001',
                      'previousName', 'Staff Alpha', 'approvedAt', '01 Oct 2026 10:00'), now()),
  ('OF5:offer:' || :'decl_a', 'email', 'OF5', null, array['admin@thehospitalitycompany.co.uk'],
   jsonb_build_object('offerId', :'decl_a', 'bookingId', :'booking_a', 'event', 'Fixture Event A',
                      'name', 'Staff Alpha', 'employeeId', '90001', 'note', 'Hospital appointment'), now()),
  ('OF5:booking:' || :'booking_a', 'email', 'OF5', null, array['admin@thehospitalitycompany.co.uk'],
   jsonb_build_object('offerId', :'decl_a2', 'bookingId', :'booking_a', 'event', 'Fixture Event A',
                      'name', 'Staff Alpha', 'employeeId', '90001', 'note', 'Exam that day'), null),
  ('RC1:request:' || :'pcr_b', 'email', 'RC1', null, array['admin@thehospitalitycompany.co.uk'],
   jsonb_build_object('name', 'Staff Bravo', 'employeeId', '90002', 'field', 'photo',
                      'requestedAt', '01 Oct 2026 10:00', 'current', 'The current profile photo',
                      'proposed', 'A new photo', 'note', 'New glasses'), null),
  ('OF5:booking:' || :'booking_b2', 'email', 'OF5', null, array['admin@thehospitalitycompany.co.uk'],
   jsonb_build_object('offerId', :'decl_b', 'bookingId', :'booking_b2', 'event', 'Fixture Event A',
                      'name', 'Staff Bravo', 'employeeId', '90002', 'note', 'Clash'), null);

-- =====================================================================
-- A · The trigger
-- =====================================================================
select has_trigger('public', 'staff', 'staff_removed_purge_additions',
  'A: staff carries staff_removed_purge_additions');

select matches(
  (select pg_get_triggerdef(t.oid) from pg_trigger t
    where t.tgrelid = 'public.staff'::regclass and t.tgname = 'staff_removed_purge_additions'),
  'AFTER UPDATE OF removed_at ON public\.staff FOR EACH ROW WHEN \(\(\(old\.removed_at IS NULL\) AND \(new\.removed_at IS NOT NULL\)\)\)',
  'A: it fires after update of removed_at, once — when removed_at is first set');

select ok(
  (select p.prosecdef from pg_proc p where p.oid = 'public.staff_removed_purge_additions()'::regprocedure),
  'A: it is security definer, so it erases the same whoever sets removed_at');

select ok(
  not has_function_privilege('anon', 'public.staff_removed_purge_additions()', 'execute')
  and not has_function_privilege('authenticated', 'public.staff_removed_purge_additions()', 'execute')
  and not has_function_privilege('public', 'public.staff_removed_purge_additions()', 'execute'),
  'A: and it is not an RPC (20260927161000)');

-- =====================================================================
-- B · remove_worker()
-- =====================================================================
select lives_ok(
  format($$ select remove_worker(%L, now(), %L) $$, :'staffa', :'admin_uid'),
  'B: remove_worker() runs, unchanged, with the additions in place');

select is((select count(*)::int from staff_unavailability where staff_id = :'staffa'), 0,
  'B: the removed worker''s availability is deleted');

select is((select count(*)::int from staff_emergency_contacts where staff_id = :'staffa'), 0,
  'B: their emergency contact is deleted (ADR-0044)');

select results_eq(
  format($$ select status, decided_at is not null from profile_change_requests where id = %L $$, :'pcr_name'),
  $$ values ('withdrawn'::text, true) $$,
  'B: the pending name change is withdrawn, and stamped decided');

select results_eq(
  format($$ select proposed_first_name, proposed_last_name, worker_note
              from profile_change_requests where id = %L $$, :'pcr_name'),
  $$ values ('Deleted'::text, 'account'::text, null::text) $$,
  'B: its proposed name is anonymised and the note cleared');

select results_eq(
  format($$ select status, decision_reason, worker_note from profile_change_requests where id = %L $$, :'pcr_photo'),
  $$ values ('rejected'::text, 'Removed under GDPR (§1.7)'::text, null::text) $$,
  'B: a rejected photo stays rejected; the reason the office wrote (which named them) is replaced');

select results_eq(
  format($$ select status, proposed_first_name, previous_value from profile_change_requests where id = %L $$, :'pcr_old'),
  $$ values ('approved'::text, 'Deleted'::text, null::jsonb) $$,
  'B: an approved one keeps its history row, anonymised, with the snapshot of the old name gone');

select is_empty(
  format($$ select id from profile_change_requests
             where staff_id = %L
               and (concat_ws(' ', proposed_first_name, proposed_last_name, worker_note,
                              decision_reason, previous_value::text) ~* 'mariana|stafford|married|haircut|typo') $$,
         :'staffa'),
  'B: no word of what they asked for, or why, survives on any of their requests');

select results_eq(
  format($$ select code, revoked_at is not null from staff_referral_codes where staff_id = %L $$, :'staffa'),
  $$ values ('ABCDEFGH'::text, true) $$,
  'B: their referral code is revoked, not deleted — so it is never reissued to somebody else');

select is((select count(*)::int from application_referrals
            where application_id in (:'app_b', :'applic_a')), 2,
  'B: both referral rows are kept — the one they made and the one made for them');

select is(
  (select case when s.removed_at is null then s.first_name || ' ' || s.last_name
               else deleted_account_label(s.employee_id) end
     from application_referrals r join staff s on s.id = r.referrer_staff_id
    where r.application_id = :'app_b'),
  'Deleted account #90001',
  'B: and the removed referrer reads "Deleted account #90001"');

select results_eq(
  format($$ select id, status, closed_reason from shift_offers where id in (%L, %L) order by id $$,
         :'off_a', :'off_to_a'),
  format($$ values (%L::uuid, 'lapsed'::text, 'gdpr'::text), (%L::uuid, 'lapsed'::text, 'gdpr'::text) $$,
         :'off_a', :'off_to_a'),
  'B: their open offer lapses, and so does a direct offer made to them (closed_reason gdpr)');

select is((select note from shift_offers where id = :'off_a'), null::text,
  'B: the note on their offer is cleared');

select is((select count(*)::int from shift_offer_notices where offer_id in (:'off_a', :'off_b')), 2,
  'B: offer notices are kept — who was pushed what carries no personal data');

-- =====================================================================
-- D · The outbox copies and the decline note (20260930205200)
-- =====================================================================
select results_eq(
  format($$ select payload->>'name', payload ? 'current', payload ? 'proposed', payload ? 'note',
                   payload->>'employeeId', payload->>'field'
              from notification_outbox where key = %L $$, 'RC1:request:' || :'pcr_name'),
  $$ values ('Deleted account #90001'::text, false, false, false, '90001'::text, 'name'::text) $$,
  'D: RC1 loses what they asked for and why; the name reads "Deleted account #90001"');

select results_eq(
  format($$ select sent_at is null, failed_at is not null, error like 'gdpr_removed%%'
              from notification_outbox where key = %L $$, 'RC1:request:' || :'pcr_name'),
  $$ values (true, true, true) $$,
  'D: and, not yet sent, it is failed gdpr_removed — the drain never claims it');

-- RC3 is addressed to the worker, so remove_worker()'s own scrub (main's
-- 20260930120100, which runs after this trigger) matches it too and its
-- stronger treatment stands: a sent row keeps only the fact of the send.
select results_eq(
  format($$ select payload ? 'reason', payload->>'gdprRemoved', payload->>'label',
                   sent_at is not null, failed_at is null, error
              from notification_outbox where key = %L $$, 'RC3:request:' || :'pcr_photo'),
  $$ values (false, 'true'::text, 'Deleted account #90001'::text, true, true, null::text) $$,
  'D: RC3 (to the worker) loses the office''s reason; remove_worker() keeps only the fact of the send, sent_at stays and it is not failed');

select results_eq(
  format($$ select payload->>'name', payload->>'previousName', payload->>'approvedAt',
                   sent_at is not null, failed_at is null
              from notification_outbox where key = %L $$, 'RC4:request:' || :'pcr_old'),
  $$ values ('Deleted account #90001'::text, 'Deleted account #90001'::text,
             '01 Oct 2026 10:00'::text, true, true) $$,
  'D: RC4''s new and previous names both read "Deleted account #90001"; sent history stays sent');

select results_eq(
  format($$ select payload->>'name', payload ? 'note', payload->>'event', payload->>'bookingId',
                   sent_at is not null, failed_at is null
              from notification_outbox where key = %L $$, 'OF5:offer:' || :'decl_a'),
  format($$ values ('Deleted account #90001'::text, false, 'Fixture Event A'::text, %L::text, true, true) $$,
         :'booking_a'),
  'D: OF5 keyed on the offer loses the cover note and the name; the event and ids stay');

-- OF5 on the booking key carries one of the worker's booking ids, so
-- remove_worker() matches it after this trigger has failed it; still
-- unsent, it is deleted — the stronger treatment (20260930120100) stands.
select is_empty(
  format($$ select 1 from notification_outbox where key = %L $$, 'OF5:booking:' || :'booking_a'),
  'D: OF5 keyed on the booking (20260930205000), unsent, is gone — failed here, then deleted by remove_worker()');

select is_empty(
  format($$ select key from notification_outbox
             where key in (%L, %L, %L, %L, %L)
               and payload::text ~* 'mariana|stafford|married|staff alpha|too dark|hospital|exam' $$,
         'RC1:request:' || :'pcr_name', 'RC3:request:' || :'pcr_photo', 'RC4:request:' || :'pcr_old',
         'OF5:offer:' || :'decl_a', 'OF5:booking:' || :'booking_a'),
  'D: no word of theirs, or about them, survives in any of their outbox payloads');

select results_eq(
  format($$ select status, closed_reason from shift_offers where id = %L $$, :'decl_a'),
  $$ values ('cancelled'::text, 'gdpr'::text) $$,
  'D: the office''s free-text decline note on their cover request becomes gdpr; the offer stays cancelled');

select is((select closed_reason from shift_offers where id = :'decl_a2'), 'declined by the office',
  'D: the default decline reason names nobody and is kept');

-- =====================================================================
-- C · Nobody else, and only once
-- =====================================================================
select results_eq(
  format($$ select payload->>'name', payload->>'note', payload->>'proposed', failed_at is null, error
              from notification_outbox where key = %L $$, 'RC1:request:' || :'pcr_b'),
  $$ values ('Staff Bravo'::text, 'New glasses'::text, 'A new photo'::text, true, null::text) $$,
  'C: another worker''s unsent RC1 is untouched and still queued');

select results_eq(
  format($$ select payload->>'name', payload->>'note', failed_at is null
              from notification_outbox where key = %L $$, 'OF5:booking:' || :'booking_b2'),
  $$ values ('Staff Bravo'::text, 'Clash'::text, true) $$,
  'C: and their unsent OF5');

select is((select closed_reason from shift_offers where id = :'decl_b'), 'Bravo is covered by phone',
  'C: and the office''s decline note on their cover request');

select is((select count(*)::int from staff_unavailability where staff_id = :'staffb'), 1,
  'C: another worker''s availability is untouched');

select is((select name from staff_emergency_contacts where staff_id = :'staffb'), 'Tom Bravo',
  'C: and their emergency contact');

select results_eq(
  format($$ select status, proposed_photo_path from profile_change_requests where id = %L $$, :'pcr_b'),
  format($$ values ('pending'::text, %L::text) $$, :'staffb' || '/selfie-2.jpg'),
  'C: and their pending change request');

select results_eq(
  format($$ select status, note, revoked_at from shift_offers o
              left join staff_referral_codes c on c.staff_id = o.offered_by_staff_id
             where o.id = %L $$, :'off_b'),
  $$ values ('open'::text, 'Clash'::text, null::timestamptz) $$,
  'C: and their own open offer and referral code');

select is((remove_worker(:'staffa', now(), :'admin_uid')) ->> 'alreadyRemoved', 'true',
  'C: a second remove_worker() is refused as already removed');

-- A later write of removed_at (the anonymising update does exactly that)
-- does not fire the purge again.
insert into staff_emergency_contacts (staff_id, name, relationship, phone)
values (:'staffa', 'Probe', 'Probe', '+447700900199');
update staff set removed_at = now() where id = :'staffa';
select is((select count(*)::int from staff_emergency_contacts where staff_id = :'staffa'), 1,
  'C: the trigger fires only when removed_at is first set, not on every write of it');

select * from finish();
rollback;
