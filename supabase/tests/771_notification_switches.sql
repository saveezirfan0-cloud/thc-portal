-- =====================================================================
-- 771 · Notification switches (ADR-0083)
--   20261002113000_notification_switches.sql
--
--   1. BG08 ships switched off; every other code is on.
--   2. A due outbox row whose code is off is settled by the claim — failed,
--      with the reason, no attempt spent — and never handed to the drain.
--      A row not yet due is left alone; a code that is on still sends.
--   3. BG-08 does not run while BG08 is off, and catches up when it is on.
--   4. Only a JSON false switches a code off.
--   5. Who may call the check.
-- =====================================================================
begin;
select plan(16);
\ir _shared/fixtures.psql

-- Keep the shared fixture row, and anything seed.sql queued, out of every
-- claim below, so the counts see only this file's rows.
update notification_outbox set send_after = now() + interval '1 day'
 where sent_at is null and failed_at is null;

-- ---------------------------------------------------------------------
-- 1 · What ships
-- ---------------------------------------------------------------------
select is((select value from settings where key = 'notification_switches'),
  '{"BG08": false}'::jsonb, 'the weekly payroll email ships switched off');
select ok(not notification_switched_on('BG08'), 'BG08 reads as off');
select ok(notification_switched_on('N5'), 'a code that is not listed is on');

-- ---------------------------------------------------------------------
-- 2 · The claim settles a switched-off row instead of sending it
-- ---------------------------------------------------------------------
update settings set value = '{"BG08": false, "N5": false}'::jsonb
 where key = 'notification_switches';

insert into notification_outbox (key, channel, template, recipient_staff_id, send_after) values
  ('T771-N5:invite:1',   'push', 'N5',  :'staffa', now() - interval '1 minute'),
  ('T771-N5:invite:2',   'push', 'N5',  :'staffa', now() + interval '1 hour'),
  ('T771-N12:booking:3', 'push', 'N12', :'staffa', now() - interval '1 minute');

create temporary table t_claim as select key from claim_outbox_batch(50);

select is((select array_agg(key order by key) from t_claim), array['T771-N12:booking:3'],
  'the drain is handed only the row whose code is on');
select isnt((select failed_at from notification_outbox where key = 'T771-N5:invite:1'), null,
  'the due row whose code is off is settled, not left queued');
select is((select error from notification_outbox where key = 'T771-N5:invite:1'),
  'Not sent: switched off in Settings', 'and says why');
select is((select attempts from notification_outbox where key = 'T771-N5:invite:1'), 0,
  'no attempt is spent on it');
select is((select sent_at from notification_outbox where key = 'T771-N5:invite:1'), null,
  'and it was never sent');
select ok((select failed_at is null and sent_at is null from notification_outbox
            where key = 'T771-N5:invite:2'),
  'a row not yet due is judged when it falls due, so switching back on in time lets it go');

update settings set value = '{"BG08": false}'::jsonb where key = 'notification_switches';
update notification_outbox set send_after = now() - interval '1 minute' where key = 'T771-N5:invite:2';
select is((select count(*)::int from claim_outbox_batch(50) where key = 'T771-N5:invite:2'), 1,
  'switched back on, the waiting row is claimed as usual');
select is((select count(*)::int from claim_outbox_batch(50) where key = 'T771-N5:invite:1'), 0,
  'and the one settled while it was off stays settled — no backlog goes out at once');

-- ---------------------------------------------------------------------
-- 3 · BG-08 does not stamp a week while BG08 is off
-- ---------------------------------------------------------------------
select ok(not finance_reports_due('2025-03-10 09:00+00'),
  'Monday 09:00 UK: not due while BG08 is off, so nothing is stamped into payroll_export_lines');
update settings set value = '{}'::jsonb where key = 'notification_switches';
select ok(finance_reports_due('2025-03-12 15:00+00'),
  'switched on mid-week, the missed Monday is caught up');

-- ---------------------------------------------------------------------
-- 4 · Only a JSON false switches a code off
-- ---------------------------------------------------------------------
update settings set value = '["BG08"]'::jsonb where key = 'notification_switches';
select ok(notification_switched_on('BG08'), 'a malformed value leaves every code on');

-- ---------------------------------------------------------------------
-- 5 · Who may call it
-- ---------------------------------------------------------------------
select ok(has_function_privilege('service_role', 'public.notification_switched_on(text)', 'execute'),
  'the jobs can read a switch');
select ok(not has_function_privilege('anon', 'public.notification_switched_on(text)', 'execute')
      and not has_function_privilege('authenticated', 'public.notification_switched_on(text)', 'execute'),
  'nobody else calls it directly — /settings reads the settings row under its own policy');

select * from finish();
rollback;
