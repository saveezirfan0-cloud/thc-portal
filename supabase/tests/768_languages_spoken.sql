-- =====================================================================
-- 768 · Languages spoken — asked at onboarding, needed by an event
--   (ADR-0080) 20261002108000_languages_spoken.sql
--
-- Held here:
--   1. the columns: an event needs English unless told otherwise, and
--      always English; a worker's list is known languages with English in
--      it, or null (never asked); the list matches packages/domain;
--   2. the pool: an English-only event knows nothing of languages; on an
--      event that also needs Spanish a speaker is in it, a worker on file
--      without it is language_not_spoken, a worker never asked is
--      languages_not_recorded; two languages need both;
--   3. order: wrong_role still first, and the event's need sits before
--      blocked, like the gender gates;
--   4. every booking path refuses by the gate's name — automatic and
--      manual invitation, Radar, Accept on an invitation written before
--      the language was added (left live), and a shift-offer take;
--   5. staff_save_languages: the worker's own list, English always in,
--      unknown languages refused, a removed or rejected account refused;
--      audited without the value;
--   6. set_staff_languages: the office records it and the gate lifts, and
--      null clears it back to never asked; a viewer, client and worker
--      are refused; audited without the value;
--   7. GDPR removal wipes it.
-- =====================================================================
begin;
select plan(49);
\ir _shared/fixtures.psql

\set ro      '76850000-0000-4000-8000-000000000001'
\set ro2     '76850000-0000-4000-8000-000000000002'
\set evt     '76850000-0000-4000-8000-00000000000e'
\set evt0    '76850000-0000-4000-8000-00000000000f'
\set sec     '76850000-0000-4000-8000-0000000000a1'
\set plain   '76850000-0000-4000-8000-0000000000a2'
\set spk     '76860000-0000-4000-8000-000000000001'
\set eng     '76860000-0000-4000-8000-000000000002'
\set never   '76860000-0000-4000-8000-000000000003'
\set spk2    '76860000-0000-4000-8000-000000000004'
\set offrole '76860000-0000-4000-8000-000000000005'
\set blk     '76860000-0000-4000-8000-000000000006'
\set gone    '76860000-0000-4000-8000-000000000007'
\set viewer  '76870000-0000-4000-8000-000000000001'
\set eng_uid '76870000-0000-4000-8000-000000000003'
\set offer   '76870000-0000-4000-8000-000000000004'
\set rmv     '76860000-0000-4000-8000-000000000008'
\set rej     '76860000-0000-4000-8000-000000000009'
\set rmv_uid '76870000-0000-4000-8000-000000000005'
\set rej_uid '76870000-0000-4000-8000-000000000006'

insert into auth.users (id, email) values (:'viewer', 'viewer.768@rls.test'), (:'eng_uid', 'eng.768@rls.test');
insert into profiles (id, role, office_role, full_name) values (:'viewer', 'admin', 'viewer', 'Vic Viewer');
insert into profiles (id, role, full_name) values (:'eng_uid', 'staff', 'Emma English');
insert into auth.users (id, email) values (:'rmv_uid', 'rmv.768@rls.test'), (:'rej_uid', 'rej.768@rls.test');
insert into profiles (id, role, full_name) values (:'rmv_uid', 'staff', 'Rex Removed'), (:'rej_uid', 'staff', 'Rita Rejected');

insert into roles (id, name, pay_rate) values
  (:'ro',  'Language Hosts',     14.00),
  (:'ro2', 'Language Elsewhere', 14.00);

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer, auto_assign) values
  (:'evt',  :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Spanish Delegation Dinner', date '2027-02-11', true, true, true),
  (:'evt0', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Ordinary Dinner', date '2027-02-12', true, true, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour, auto_assign) values
  (:'sec',   :'evt',  :'ro', '2027-02-11 17:00+00', '2027-02-11 23:00+00', 6, 0, 30, 15, 6, true),
  (:'plain', :'evt0', :'ro', '2027-02-12 17:00+00', '2027-02-12 23:00+00', 6, 0, 30, 15, 6, true);

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch, languages) values
  (:'spk',     'Sofia', 'Speaker', 's1@lang.test', '+447700976801', date '1995-01-01', 'compliant', 'uk_irish', array['English', 'Spanish']),
  (:'eng',     'Emma',  'English', 'e1@lang.test', '+447700976802', date '1995-01-01', 'compliant', 'uk_irish', array['English']),
  (:'never',   'Nina',  'Never',   'n1@lang.test', '+447700976803', date '1995-01-01', 'compliant', 'uk_irish', null),
  (:'spk2',    'Sam',   'Speaker', 's2@lang.test', '+447700976804', date '1995-01-01', 'compliant', 'uk_irish', array['English', 'French', 'Spanish']),
  (:'offrole', 'Olive', 'Offrole', 'o1@lang.test', '+447700976805', date '1995-01-01', 'compliant', 'uk_irish', array['English']),
  (:'blk',     'Barry', 'Blocked', 'b1@lang.test', '+447700976806', date '1995-01-01', 'blocked',   'uk_irish', array['English', 'Spanish']),
  (:'gone',    'Gary',  'Gone',    'g1@lang.test', '+447700976807', date '1995-01-01', 'compliant', 'uk_irish', array['English', 'Spanish']);

insert into staff_roles (staff_id, role_id)
select id, :'ro' from staff where id in (:'spk', :'eng', :'never', :'spk2', :'blk', :'gone');
insert into staff_roles (staff_id, role_id) values (:'offrole', :'ro2');

-- ---------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------
select is((select required_languages from events where id = :'evt'), array['English']::text[],
  'an event needs English and nothing else unless told');
select throws_ok(format($$ update events set required_languages = array['Spanish'] where id = %L $$, :'evt0'),
  '23514', null, 'English is always among an event''s languages');
select throws_ok(format($$ update events set required_languages = array['English', 'Klingon'] where id = %L $$, :'evt0'),
  '23514', null, 'an event names known languages only');
select throws_ok(format($$ update staff set languages = array['Spanish'] where id = %L $$, :'never'),
  '23514', null, 'a worker''s list always has English in it');
select ok(has_column_privilege('authenticated', 'public.staff', 'languages', 'select'),
  'a signed-in session may read staff.languages (RLS still decides the rows)');
select is((known_languages())[1], 'English', 'the list starts with English');
select is(
  (select array_agg(l order by n) from unnest(known_languages()) with ordinality x(l, n) where n > 1),
  (select array_agg(l order by l collate "C") from unnest(known_languages()) with ordinality x(l, n) where n > 1),
  'and then runs A → Z, as LANGUAGES in packages/domain does');

update events set required_languages = array['English', 'Spanish'] where id = :'evt';

-- ---------------------------------------------------------------------
-- 2. The pool
-- ---------------------------------------------------------------------
select is(
  (select array_agg(gate order by staff_id) from auto_assign_candidates(:'plain')
    where staff_id in (:'spk', :'eng', :'never')),
  array[null, null, null]::text[],
  'an English-only event knows nothing of languages — never asked is not a gate there');

select is((select gate from auto_assign_candidates(:'sec') where staff_id = :'spk'), null,
  'Spanish needed: a Spanish speaker is in the pool');
select is((select gate from auto_assign_candidates(:'sec') where staff_id = :'eng'), 'language_not_spoken',
  'English only on file: language_not_spoken');
select is((select gate from auto_assign_candidates(:'sec') where staff_id = :'never'), 'languages_not_recorded',
  'never asked: languages_not_recorded — not shown to speak it');
select is((select gate from auto_assign_candidates(:'sec', true) where staff_id = :'eng'), 'language_not_spoken',
  'and the escalation pool gates the same');

update events set required_languages = array['English', 'French', 'Spanish'] where id = :'evt';
select is((select gate from auto_assign_candidates(:'sec') where staff_id = :'spk'), 'language_not_spoken',
  'two languages needed: a speaker of one is gated');
select is((select gate from auto_assign_candidates(:'sec') where staff_id = :'spk2'), null,
  'a speaker of both is in the pool');
update events set required_languages = array['English', 'Spanish'] where id = :'evt';

-- ---------------------------------------------------------------------
-- 3. Order
-- ---------------------------------------------------------------------
select is((select gate from auto_assign_candidates(:'sec') where staff_id = :'offrole'), 'wrong_role',
  'wrong_role still comes first');
select is((select gate from auto_assign_candidates(:'sec') where staff_id = :'blk'), 'blocked',
  'a blocked Spanish speaker reads blocked');
update staff set languages = array['English'] where id = :'blk';
select is((select gate from auto_assign_candidates(:'sec') where staff_id = :'blk'), 'language_not_spoken',
  'the event''s need sits before blocked, like the gender gates');

-- ---------------------------------------------------------------------
-- 4. Every booking path
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select ok(exists (select 1 from staff_open_shifts(:'spk') where shift_id = :'sec'),
  'Radar shows the event to a Spanish speaker');
select ok(not exists (select 1 from staff_open_shifts(:'eng') where shift_id = :'sec'),
  'Radar never shows it to someone who does not speak Spanish');
select ok(exists (select 1 from staff_open_shifts(:'eng') where shift_id = :'plain'),
  'while an English-only event is on their Radar');

select is((invite_worker(:'sec', :'eng', 'auto'))->>'reason', 'language_not_spoken',
  'an automatic invitation is refused at the insert');
select is((invite_worker(:'sec', :'eng', 'manual'))->>'reason', 'language_not_spoken',
  'and so is a manager''s own');
select is((invite_worker(:'sec', :'never', 'auto'))->>'reason', 'languages_not_recorded',
  'never asked is refused by name');
select is(apply_to_shift(:'sec', :'eng')->>'reason', 'language_not_spoken',
  'a Radar application is refused by name');
select is((invite_worker(:'sec', :'spk', 'auto'))->>'invited', 'true',
  'a Spanish speaker is invited');

-- Invited while the event needed English only; Spanish added afterwards.
update events set required_languages = array['English'] where id = :'evt';
select is((invite_worker(:'sec', :'eng', 'auto'))->>'invited', 'true',
  'English only: an English speaker is invited');
update events set required_languages = array['English', 'Spanish'] where id = :'evt';
select is(accept_invite((select id from bookings where shift_id = :'sec' and staff_id = :'eng'))->>'reason',
  'language_not_spoken', 'Spanish added afterwards: their Accept is refused by name');
select is((select status::text from bookings where shift_id = :'sec' and staff_id = :'eng'), 'invited',
  'and the invitation is left as it was — never withdrawn');
select is(accept_invite((select id from bookings where shift_id = :'sec' and staff_id = :'spk'))->>'ok',
  'true', 'the Spanish speaker accepts');

-- The office taking a Radar application forward after a language was added.
select is(apply_to_shift(:'plain', :'eng')->>'ok', 'true', 'they apply to an English-only event');
update events set required_languages = array['English', 'Spanish'] where id = :'evt0';
select is(accept_application((select id from bookings where shift_id = :'plain' and staff_id = :'eng'))->>'reason',
  'language_not_spoken', 'Spanish added afterwards: the office''s Accept application is refused by name');
update events set required_languages = array['English'] where id = :'evt0';

-- A shift offered up: a take by someone who does not speak it is refused
-- by name, never as not_bookable.
insert into shift_offers (id, booking_id, mode, expires_at)
select :'offer', id, 'pool', now() + interval '3 days' from bookings where shift_id = :'sec' and staff_id = :'spk';
update staff set user_id = :'eng_uid' where id = :'eng';
select set_config('request.jwt.claims', json_build_object('sub', :'eng_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(take_offered_shift(:'offer'), jsonb_build_object('ok', false, 'reason', 'language_not_spoken'),
  'taking an offer on the event is refused language_not_spoken');

-- ---------------------------------------------------------------------
-- 5. staff_save_languages — the worker's own list
-- ---------------------------------------------------------------------
select is(staff_save_languages(array['Spanish', 'Arabic', 'Spanish', ' French '])->'languages',
  '["English", "Arabic", "French", "Spanish"]'::jsonb,
  'the worker''s own list: English added, duplicates and spaces dropped, in list order');
select throws_ok($$ select staff_save_languages(array['English', 'Klingon']) $$,
  'P0001', 'unknown_language', 'a language not on the list is refused');
reset role;
select is((select languages from staff where id = :'eng'), array['English', 'Arabic', 'French', 'Spanish']::text[],
  'and it is written to their own row');
select is((select gate from auto_assign_candidates(:'sec') where staff_id = :'eng'), null,
  'so the Spanish gate lifts for them');
select is(
  (select data from audit_log where action = 'staff.languages_saved' and entity_id = :'eng'),
  jsonb_build_object('staffId', :'eng'),
  'the worker''s own save is audited, without the value');

-- A removed or rejected account cannot write.
insert into staff (id, user_id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'rmv', :'rmv_uid', 'Rex',  'Removed',  'r1@lang.test', '+447700976808', date '1995-01-01', 'removed',  'uk_irish'),
  (:'rej', :'rej_uid', 'Rita', 'Rejected', 'r2@lang.test', '+447700976809', date '1995-01-01', 'rejected', 'uk_irish');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'rmv_uid', 'role', 'authenticated')::text, true);
select throws_ok($$ select staff_save_languages(array['Spanish']) $$,
  'P0001', 'account_closed', 'a removed account is refused');
select set_config('request.jwt.claims', json_build_object('sub', :'rej_uid', 'role', 'authenticated')::text, true);
select throws_ok($$ select staff_save_languages(array['Spanish']) $$,
  'P0001', 'not_editable', 'a rejected applicant is refused');
reset role;

-- ---------------------------------------------------------------------
-- 6. set_staff_languages — the office
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select is(set_staff_languages(:'never', array['Spanish'])->'languages', '["English", "Spanish"]'::jsonb,
  'the office records it, English included');
select is((select gate from auto_assign_candidates(:'sec') where staff_id = :'never'), null,
  'once recorded, the gate lifts');
select is(set_staff_languages(:'never', null)->'languages', 'null'::jsonb,
  'null clears it back to never asked');
select is((select gate from auto_assign_candidates(:'sec') where staff_id = :'never'), 'languages_not_recorded',
  'and the gate reads languages_not_recorded again');

select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
select throws_ok(format($$ select set_staff_languages(%L, array['Polish']) $$, :'never'),
  '42501', 'read_only', 'a viewer is refused by the write guard');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select throws_ok(format($$ select set_staff_languages(%L, array['Polish']) $$, :'never'),
  '42501', 'not_authorised', 'a client login cannot call it');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select throws_ok(format($$ select set_staff_languages(%L, array['Polish']) $$, :'staffa'),
  '42501', 'not_authorised', 'a worker cannot call the office''s write');
reset role;

select is(
  (select array_agg(distinct data) from audit_log where action = 'staff.languages_set' and entity_id = :'never'),
  array[jsonb_build_object('staffId', :'never')],
  'audited, without the value');

-- ---------------------------------------------------------------------
-- 7. GDPR removal
-- ---------------------------------------------------------------------
update staff set removed_at = now() where id = :'gone';
select is((select languages from staff where id = :'gone'), null,
  'a removal wipes the languages with the other report fields');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select throws_ok(format($$ select set_staff_languages(%L, array['Spanish']) $$, :'gone'),
  'P0001', 'staff_removed', 'and the office cannot write it back');
reset role;

select * from finish();
rollback;
