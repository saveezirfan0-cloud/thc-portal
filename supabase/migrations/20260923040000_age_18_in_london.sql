-- =====================================================================
-- The age_18 check constraint asked the session what day it was (§1.8)
--
-- 0001_init.sql wrote it as:
--
--     constraint age_18 check (dob <= (current_date - interval '18 years'))
--
-- `current_date` is the CALLER'S timezone, not London's, so the answer to
-- "is this applicant 18?" depended on who was asking and from where. That
-- is the one thing §1.8 does not allow: rules are evaluated in
-- Europe/London, whatever zone the reader is in.
--
-- This is not theoretical, and the repository already knew it one layer
-- up. 120_apply.sql asserts that submit_application() must never contain
-- `current_date`, with the reason written next to the assertion:
--
--     'and never from current_date, which is UTC on Supabase and refuses
--      an applicant on their eighteenth birthday'
--
-- The function was fixed. The constraint underneath it was not, so the
-- function computed the right answer and the table then refused the row.
--
-- The live failure mode: PostgREST sessions run in UTC on Supabase, and
-- London is UTC+1 from late March to late October. For the hour between
-- 23:00 and midnight UTC on a BST day, London is already on the next date
-- — so an applicant whose eighteenth birthday is today in London is
-- refused by the constraint for that hour. One hour a day, half the year,
-- and the applicant sees a failed submission with nothing to act on.
--
-- CI found it from the other direction on 23.09: 120_apply.sql's dateline
-- pair deliberately calls from Pacific/Niue (UTC-11), which puts
-- `current_date` a whole day behind London whenever the build runs before
-- 11:00 UTC. Every previous build had run in the afternoon. The test was
-- right and the schema was wrong.
--
-- Not made immutable, because it cannot be: an age test against "today"
-- is time-dependent by nature, and Postgres allows it here for the same
-- reason it allowed `current_date`. What changes is WHOSE today.
-- =====================================================================

alter table staff drop constraint age_18;

alter table staff
  add constraint age_18
  check (dob <= ((now() at time zone 'Europe/London')::date - interval '18 years'));

comment on constraint age_18 on staff is
  'Under-18s cannot be staff (§2.1). The reference date is London''s, never the caller''s session date: `current_date` is UTC on Supabase and refuses an applicant on their eighteenth birthday for the hour before midnight UTC while London is on BST (§1.8).';
