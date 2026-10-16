-- =====================================================================
-- 848 · OC1 carries the interview's public link (20261016120000)
--
--   A. Who can reach the reader.
--   B. What counts as a link: one https URL, set as a JSON string.
--   C. The job puts it in the OC1 payload, and only then; nothing else
--      about the row changes.
-- =====================================================================
begin;
select plan(16);
\ir _shared/fixtures.psql

\set c_one '84800000-0000-4000-8000-000000000001'
\set t0    '2026-09-01 11:00+01'

insert into staff (id, user_id, first_name, last_name, email, phone, dob, status) values
  (:'c_one', null, 'Una', 'One', 'una@oc1l.test', '+447700984801', date '2001-03-01', 'interview_requested');
update staff set stage_entered_at = :'t0', onboarding_started_at = :'t0', willo_invited_at = :'t0'
 where id::text like '84800000-%';

-- A · who can reach it
select ok(not has_function_privilege('authenticated', 'willo_interview_public_url()', 'execute')
      and not has_function_privilege('anon', 'willo_interview_public_url()', 'execute'),
  'no session can read the setting through the helper');

-- B · what counts as a link
delete from settings where key = 'willo_interview_public_url';
select is(willo_interview_public_url(), null, 'no row: no link');

insert into settings (key, value) values ('willo_interview_public_url', 'null'::jsonb);
select is(willo_interview_public_url(), null, 'a JSON null: no link');

update settings set value = '"https://app.willo.video/i/abc123"'::jsonb where key = 'willo_interview_public_url';
select is(willo_interview_public_url(), 'https://app.willo.video/i/abc123', 'one https URL is the link');

update settings set value = '"http://app.willo.video/i/abc123"'::jsonb where key = 'willo_interview_public_url';
select is(willo_interview_public_url(), null, 'http is not');

update settings set value = '"https://app.willo.video/i/abc 123"'::jsonb where key = 'willo_interview_public_url';
select is(willo_interview_public_url(), null, 'a space in it is not');

update settings set value = '"https://evil@app.willo.video/i/abc123"'::jsonb where key = 'willo_interview_public_url';
select is(willo_interview_public_url(), null, 'a user@ in it is not');

update settings set value = to_jsonb('https://app.willo.video/' || repeat('a', 500))
 where key = 'willo_interview_public_url';
select is(willo_interview_public_url(), null, 'over 500 characters is not');

update settings set value = '"https://app.willo.video/i/a\"b"'::jsonb where key = 'willo_interview_public_url';
select is(willo_interview_public_url(), null, 'a quote in it is not (the email would draw no button)');

update settings set value = '"HTTPS://app.willo.video/i/abc123"'::jsonb where key = 'willo_interview_public_url';
select is(willo_interview_public_url(), null, 'upper-case HTTPS is not: it is stored as typed');

update settings set value = to_jsonb('https://app.willo.video/' || repeat('a', 500 - length('https://app.willo.video/')))
 where key = 'willo_interview_public_url';
select is(length(willo_interview_public_url()), 500, 'exactly 500 characters is a link');

update settings set value = '42'::jsonb where key = 'willo_interview_public_url';
select is(willo_interview_public_url(), null, 'a number is not');

-- C · the payload
delete from settings where key = 'willo_interview_public_url';
select onboarding_chasers('2026-09-02 12:00+01');
select ok(not (select payload ? 'interviewLink' from notification_outbox
                where key like 'OC1:staff:' || :'c_one' || ':%:1'),
  'with no link set the payload is as it was');

insert into settings (key, value) values ('willo_interview_public_url', '"https://app.willo.video/i/abc123"'::jsonb);
select onboarding_chasers('2026-09-03 12:00+01');
select is((select payload ->> 'interviewLink' from notification_outbox
            where key like 'OC1:staff:' || :'c_one' || ':%:2'),
  'https://app.willo.video/i/abc123', 'the next reminder carries the link');
select is((select payload ->> 'variant' from notification_outbox
            where key like 'OC1:staff:' || :'c_one' || ':%:2'),
  'second', 'the wording and rung are the same as without it');
select is((select payload ->> 'interviewLink' from notification_outbox
            where key like 'OC1:staff:' || :'c_one' || ':%:1'),
  null, 'a reminder already queued is not rewritten');

select * from finish();
rollback;
