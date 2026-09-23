-- =====================================================================
-- age_18 reads the UK date, not the session's (§1.8, §2.1)
--
-- 0001's check was `dob <= current_date - 18 years`. current_date is the
-- SESSION's date, so the same date of birth passed or failed depending on
-- the caller's timezone: submit_application() gates on the UK date, then
-- the insert it makes was re-checked against whatever zone the session
-- happened to be in. A session eleven hours behind London (120_apply.sql,
-- 'Dateline West') was refused between 00:00 and 11:00 UTC for someone
-- turning 18 that UK day — the RPC said yes and the table said no.
--
-- NOT VALID: every existing row already passed a check within a day of
-- this one, and a deploy that failed on a validation scan is worth less
-- than the rows it would have re-read. New writes are checked as normal.
-- =====================================================================
alter table staff drop constraint if exists age_18;
alter table staff add constraint age_18
  check (dob <= ((now() at time zone 'Europe/London')::date - interval '18 years')) not valid;
