-- =====================================================================
-- Migration 20261012120200 · §1.7 removal also clears the invite list
--                            (ADR-0107)
--
-- invite_roster (20261008130000) holds a loaded person's email, first and
-- last name and Payroll ID, keyed by email, so /apply can decide their
-- group and Payroll ID. remove_worker() (latest 20261001205000) scrubs
-- every other copy of a person and never touched it: after a GDPR removal
-- the name, address and Payroll ID were still sitting on the list.
-- Security audit 12.10.2026, LOW.
--
-- Fixed the way the other "every copy" scrubs are (staff_removed_purge_
-- additions, staff_removed_scrub_messages): an AFTER UPDATE OF removed_at
-- trigger on staff, so every removal path is covered and remove_worker()
-- does not have to be restated. It fires inside remove_worker()'s
-- `update staff … removed_at = p_now` — the same statement that
-- anonymises the email — so OLD still carries the real address, and the
-- applications rows (anonymised by a later statement) still carry theirs.
-- It deletes the roster rows for:
--
--   · the staff row's email (OLD.email),
--   · every email on the worker's applications,
--   · the worker's Payroll ID (OLD.payroll_id), in case the list was
--     loaded under a different address.
--
-- A roster row is a pre-application invitation, not a history row: there
-- is nothing to keep (§1.7 keeps history rows and issued PDFs only).
-- 788_gdpr_removal_clears_the_invite_roster pins it.
-- =====================================================================

create or replace function public.staff_removed_purge_invite_roster()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  delete from invite_roster r
   where r.email = lower(btrim(old.email))
      or r.email in (select lower(btrim(a.email)) from applications a
                      where a.staff_id = old.id and a.email is not null)
      or (old.payroll_id is not null and r.payroll_id = old.payroll_id);
  return null;
end $$;

comment on function public.staff_removed_purge_invite_roster() is
  '20261012120200 (§1.7, ADR-0107): on removal, deletes the invite_roster rows for the worker''s email, their applications'' emails and their Payroll ID. A trigger function: not an RPC.';

revoke execute on function public.staff_removed_purge_invite_roster() from public, anon, authenticated;

drop trigger if exists staff_removed_purge_invite_roster on staff;
create trigger staff_removed_purge_invite_roster
  after update of removed_at on staff
  for each row
  when (old.removed_at is null and new.removed_at is not null)
  execute function public.staff_removed_purge_invite_roster();
