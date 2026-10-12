-- =====================================================================
-- Migration 20261012121600 · a staff row is created, linked and removed
--                            only through its RPCs (§1.7, §2.1, §2.7)
--
-- Follow-up to 20261012120100 (payroll_id, status). admin_all on `staff`
-- (0001) still let any Back Office session, through PostgREST:
--
--   · PATCH removed_at — mark a worker removed (they leave every pool and
--     screen) WITHOUT remove_worker()'s §1.7 scrub: name, contacts, NI,
--     documents, bank, login and the Storage queue all stayed; or clear
--     removed_at and bring an anonymised row back;
--   · PATCH user_id — re-point a worker's record at another login (their
--     own, say) without link_staff_account()'s checks, or unlink one;
--   · POST a staff row — a person who never applied (submit_application,
--     §2.1) or was never invited;
--   · DELETE a staff row — a hard delete §1.7 forbids: removal anonymises
--     and keeps history rows, it never deletes the person.
--
-- Every legitimate writer is SECURITY DEFINER (pg_proc scan, 12.10):
-- submit_application() is the only function that inserts into staff
-- (reached from /apply's submit_application_as_caller and the invite-list
-- path, service role); remove_worker() and block_worker() are the only
-- writers of removed_at; link_staff_account() and remove_worker() the
-- only writers of user_id. No app or package writes `staff` directly
-- (grep apps/ packages/ supabase/functions: reads only), and the seed and
-- e2e fixtures write as the table owner.
--
-- The names, contacts and other fields remove_worker() anonymises are
-- NOT guarded here: they are ordinary profile fields the office corrects,
-- and refusing them would refuse the office's edits along with it.
--
-- staff_write_rpc_only — an invoker trigger function, the staff_dob_guard
-- pattern — raises 42501 for an API session (current_user anon or
-- authenticated):
--
--   INSERT                        staff_insert_rpc_only
--   UPDATE of removed_at/user_id  staff_removal_rpc_only / staff_login_rpc_only
--   DELETE                        staff_delete_refused
--
-- Named to fire after staff_payroll_id_guard and staff_status_rpc_only,
-- so an insert carrying a Payroll ID or a later status still answers with
-- their messages (787). 802_staff_rows_only_through_rpcs pins it.
-- =====================================================================

create or replace function public.staff_write_rpc_only()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    raise exception 'staff_insert_rpc_only' using errcode = '42501',
      hint = '§2.1: a person enters through /apply (submit_application) or the invite list, never a direct insert.';
  elsif tg_op = 'DELETE' then
    raise exception 'staff_delete_refused' using errcode = '42501',
      hint = '§1.7: a worker is removed with remove_worker(), which anonymises and keeps history; a staff row is never deleted.';
  end if;

  if new.removed_at is distinct from old.removed_at then
    raise exception 'staff_removal_rpc_only' using errcode = '42501',
      hint = '§1.7: Remove from system is remove_worker() (the GDPR scrub), never a direct update.';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'staff_login_rpc_only' using errcode = '42501',
      hint = '§2.7: a login is linked by link_staff_account() (Accept, Resend) and unlinked by remove_worker().';
  end if;
  return new;
end $$;

comment on function public.staff_write_rpc_only() is
  '20261012121600: refuses, from any API session (anon, authenticated), an INSERT into staff, a DELETE from it, and a change to staff.removed_at or staff.user_id (42501). submit_application, remove_worker, block_worker and link_staff_account (definers) and the service role are the writers. A trigger function: not an RPC.';

revoke execute on function public.staff_write_rpc_only() from public, anon, authenticated;

drop trigger if exists staff_write_rpc_only on staff;
create trigger staff_write_rpc_only
  before insert or delete or update of removed_at, user_id on staff
  for each row execute function public.staff_write_rpc_only();
