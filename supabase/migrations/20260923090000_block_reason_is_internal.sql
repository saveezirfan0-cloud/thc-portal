-- =====================================================================
-- §9.6 / §10.1 · the manager's block reason is internal
--
-- The defect
-- ----------
-- `staff` has carried one worker policy since 0001_init.sql:482:
--
--     create policy staff_self on staff for select using (user_id = auth.uid());
--
-- Row-level, with no column restriction, on a table whose `block_reason`
-- column holds free text a manager typed about the worker. §9.6 and §10.1
-- both say that text is internal and is never shown to the worker. The
-- application honours that — staff_me() deliberately does not select the
-- column (20260922180000:42) and StaffProfile has no field for it — but
-- the application is not the boundary. PostgREST publishes every column
-- the caller's role may select, so
--
--     GET /rest/v1/staff?select=block_reason
--
-- signed in as the worker, with their own anon key, returned the note.
-- Discipline in the query layer was holding this closed. Structure was
-- not.
--
-- Why RLS cannot fix it
-- ---------------------
-- Row level security filters rows. It has no column dimension, and
-- 20260922180000 already says so in prose: "a column-level grant is not a
-- thing RLS can express per policy". Narrowing or dropping `staff_self`
-- changes WHICH ROWS a worker sees, never which columns of them, and the
-- rows it grants are load-bearing: weekly_cap_for() (0008, 20260922093100)
-- reads the worker's own row as the invoker, staff_directory_v is
-- security_invoker and 290 pins that a worker reaches exactly one row
-- through it, and 030_rls_staff asserts eleven self-reads that start here.
-- So `staff_self` stays exactly as it is.
--
-- Why the obvious fix does not work either
-- ----------------------------------------
-- The only mechanism Postgres has for this is a column privilege, and a
-- column privilege is held by a ROLE. Admin and worker are the same
-- Postgres role — both are `authenticated` with a different
-- profiles.role — so taking `block_reason` away from `authenticated`
-- takes it away from the Back Office too. Both office readers are
-- security_invoker and therefore run with the caller's privileges:
--
--   staff_directory_v  20260922091732:62  case when s.removed_at is null
--                                          then s.block_reason end
--   staff_profile_v    20260922094500     select d.*, …
--
-- /staff and /staff/:id print that column today (apps/office/app/staff/
-- data.ts, apps/office/app/staff/[id]/data.ts) and breaking them is not
-- an acceptable price for closing the leak.
--
-- The shape chosen: ADR-0004, applied to a column
-- -----------------------------------------------
-- ADR-0004 is this repo's answer to exactly this problem, and CLAUDE.md
-- states the reason it exists: "a view cannot take back a privilege the
-- base table grants". 0002 and 0005 used it to keep money away from the
-- client role and 0009 used it to take `event_windows` off the open
-- internet — in each case by making the view run with OWNER rights, name
-- its columns, and carry its own gate in its own body, so that the base
-- table's grant is not what decides.
--
-- The same three moves, one column wide:
--
--   1. The base-table grant goes. `authenticated` and `anon` lose SELECT
--      on `staff` as a whole and get it back on every column EXCEPT
--      `block_reason`. That is a privilege, not a policy, so it is
--      checked before RLS and it applies to `select *`, to a named
--      column, and to a column named only in a WHERE clause. There is no
--      query shape that gets round it.
--
--   2. The office's route to the column becomes an owner-rights view,
--      `staff_block_reason_v`. Owner rights mean it is not bound by the
--      privilege in 1; `security_barrier` means a user-supplied function
--      in a WHERE clause cannot be evaluated ahead of the gate; and the
--      gate — `current_app_role() = 'admin'` — lives in the view body,
--      which is the half of ADR-0004 that matters, because the view is
--      granted to `authenticated` and `authenticated` is also every
--      worker and every client.
--
--   3. staff_directory_v reads the reason through that view instead of
--      off the table. Its column list, its column order, its
--      `security_invoker` reloption and §1.7's anonymisation are all
--      unchanged, so student_visa_v, staff_profile_v and
--      clients_qualified_staff_v keep working, 290's structural
--      assertions stay green, and neither office screen needs a line
--      changed.
--
-- What was considered and rejected
-- --------------------------------
--   · Column revoke alone. Closes the worker's route and the admin's
--     together; /staff and /staff/:id would have to stop showing the
--     reason, which §9.6 wants them to show.
--   · Replacing `staff_self` with a narrowed self-view. RLS is row-level:
--     a policy cannot hide a column, and while `staff` keeps a table-wide
--     SELECT grant the worker can always go round any view straight to
--     the table. The view would be decoration over an open door.
--   · Moving `block_reason` to its own admin-only table. Structurally the
--     strongest answer, and the one to take if this column is ever joined
--     by a second internal note. Today it means a data migration plus
--     rewriting nine write sites across seven applied migrations
--     (block_worker, block_worker_manually, unblock_worker,
--     reset_to_candidate, criminal_declaration_reviewed, set_staff_status,
--     remove_worker) — more moving parts, and more risk of a missed write
--     path, than the leak itself carries.
--   · Making staff_directory_v owner-rights. It would work, but it moves
--     §11.1's whole gate for that view off RLS and silently changes what a
--     worker reaches through it (290 pins one row: their own). A bigger
--     blast radius than the defect.
--
-- One deliberate consequence, stated so it is not a surprise: because the
-- table-wide SELECT grant is gone, a column ADDED to `staff` after this
-- migration is not readable by `anon` or `authenticated` until a later
-- migration grants it. `staff` carries date of birth, NI number, home
-- address and the right-to-work branch; failing closed on a new column of
-- that table is the correct default, and the failure is a loud 42501
-- rather than a quiet leak.
--
-- Scope refs: §9.6 (block/unblock, the directory), §10.1 ("the manager's
-- reason for the block is internal and is never shown to the worker"),
-- §1.7 (anonymisation), §1.4 (roles), ADR-0004.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The base-table privilege
--
-- Written against the catalogue rather than as a hand-typed column list.
-- `staff` has grown its columns over three migrations (0001_init,
-- 20260921150000_public_application, 20260922093100_completion_letter_cap)
-- and the statement's meaning is "everything except block_reason": saying
-- that in the query is both shorter and impossible to get wrong by
-- omission, and the guard in section 4 checks the outcome either way.
--
-- service_role is untouched. Edge Functions and the Next.js server
-- routines hold the service key and must keep reading the whole row;
-- none of them selects block_reason today, but the compliance job writes
-- it and gdpr_remove() clears it.
--
-- UPDATE, INSERT and DELETE are untouched as well. RLS already refuses
-- all three for a worker (staff_self is `for select`), 030_rls_staff
-- asserts it, and narrowing the write side here would be a second change
-- riding along with a security fix.
-- ---------------------------------------------------------------------
revoke select on table public.staff from public, anon, authenticated;

do $$
declare
  v_columns text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
    into v_columns
    from pg_attribute a
   where a.attrelid = 'public.staff'::regclass
     and a.attnum > 0
     and not a.attisdropped
     and a.attname <> 'block_reason';

  execute format('grant select (%s) on table public.staff to anon, authenticated', v_columns);
end $$;

comment on column public.staff.block_reason is
  'The manager''s internal reason for a block (§9.6), or the system''s wording for a conviction under review. §10.1: internal, never shown to the worker. Neither anon nor authenticated holds SELECT on this column — admin and worker are the same Postgres role, so the office reads it through the owner-rights staff_block_reason_v (ADR-0004) and nobody reads it off the table.';

-- ---------------------------------------------------------------------
-- 2 · The office's route back to it (ADR-0004)
--
-- Owner rights, so the column privilege above does not apply; the gate is
-- in the body, so the grant to `authenticated` does not decide who sees
-- what. §1.7's suppression for a removed worker is applied HERE, in the
-- same expression that reads the column, so it cannot be lost by a caller
-- forgetting it — the same reasoning staff_directory_v gives for
-- deleted_account_label().
--
-- current_app_role() is `security definer` (0001_init.sql:57) and reads
-- auth.uid(), which resolves from the session JWT regardless of whose
-- rights the surrounding view runs with. An admin session gets the rows;
-- a worker session and a client session get none; an unauthenticated one
-- cannot reach the view at all.
-- ---------------------------------------------------------------------
create or replace view public.staff_block_reason_v with (security_barrier = true) as
select
  s.id                                                    as staff_id,
  case when s.removed_at is null then s.block_reason end  as block_reason
from public.staff s
where current_app_role() = 'admin';

comment on view public.staff_block_reason_v is
  'The §9.6 block reason for the office, and the only route to staff.block_reason for a PostgREST role. Owner rights + `current_app_role() = ''admin''` in the body per ADR-0004, because a column privilege is held by a role and admin and worker are both `authenticated`. §1.7''s suppression for a removed worker is applied in the view, not trusted to the caller. §10.1: the worker never sees this.';

revoke all on table public.staff_block_reason_v from public, anon, authenticated;
grant select on table public.staff_block_reason_v to authenticated;

-- ---------------------------------------------------------------------
-- 3 · staff_directory_v reads it through the view
--
-- `create or replace`, not `drop`: the column names, types and order are
-- identical, so student_visa_v, staff_profile_v and
-- clients_qualified_staff_v keep their stored references and neither
-- office screen's column list moves. The reloption stays
-- security_invoker — `staff`'s own RLS is still what decides which
-- workers a caller sees through this view, and 290 asserts that.
--
-- The join is LEFT and on the primary key, so it is one row or none per
-- worker and cannot change the row count: for an admin the gate passes
-- and block_reason arrives as before; for anyone else the sub-view is
-- empty and the column reads null.
--
-- Everything else below is byte-for-byte 20260922091732, including
-- deleted_account_label() — §1.7's anonymisation is not touched by this
-- migration and must not be.
-- ---------------------------------------------------------------------
create or replace view public.staff_directory_v with (security_invoker = true) as
select
  s.id,
  s.employee_id,
  s.status,
  s.removed_at is not null                                   as removed,
  case
    when s.removed_at is not null then deleted_account_label(s.employee_id)
    else s.first_name || ' ' || s.last_name
  end                                                        as display_name,
  case when s.removed_at is null then s.photo_path end       as photo_path,
  s.rating,
  s.reliability,
  s.block_kind,
  -- The reason for a manual block is internal and is never shown to the
  -- worker (§10.1), but the office sees it first when deciding to
  -- unblock. It is read through staff_block_reason_v rather than off
  -- `s`, because this view runs with the caller's privileges and the
  -- caller — admin or worker, both `authenticated` — no longer holds the
  -- column. The sub-view carries the admin gate and §1.7's suppression.
  br.block_reason                                            as block_reason,
  s.rtw_branch,
  s.right_to_work_until,
  s.graduated_at,
  s.wtr_optout,
  s.left_at,
  case when s.removed_at is null then s.leave_reason end     as leave_reason,
  coalesce(
    (select array_agg(r.name order by r.name)
       from staff_roles sr join roles r on r.id = sr.role_id
      where sr.staff_id = s.id),
    '{}'::text[]
  )                                                          as role_names,
  (select count(*) from violations v
    where v.staff_id = s.id and not v.resolved)::int          as unresolved_violations,
  coalesce(
    (select array_agg(distinct c.name order by c.name)
       from client_qualifications q join clients c on c.id = q.client_id
      where q.staff_id = s.id and q.do_not_return),
    '{}'::text[]
  )                                                          as do_not_return_clients,
  weekly_cap_hours(s.id, (now() at time zone 'Europe/London')::date)   as weekly_cap_hours,
  weekly_cap_band(s.id, (now() at time zone 'Europe/London')::date)    as weekly_cap_band,
  weekly_booked_hours(s.id, (now() at time zone 'Europe/London')::date) as weekly_booked_hours
from staff s
left join staff_block_reason_v br on br.staff_id = s.id;

comment on view public.staff_directory_v is
  'The /staff directory row (§9.6): the worker with their roles, rating, show-rate, unresolved violations, do-not-return clients and their calculated weekly cap for the current Mon-Sun week (RULE-20). display_name applies §1.7''s anonymisation in the view, so no caller can print a removed worker''s real name. security_invoker: staff carries personal data and admin_all is the only policy on it. block_reason comes from the owner-rights staff_block_reason_v (20260923090000), because no PostgREST role holds the column on the table — §10.1, the worker never sees it.';

-- ---------------------------------------------------------------------
-- 4 · The migration checks its own outcome
--
-- A `revoke` that silently did nothing — because the grant came from
-- somewhere this role cannot revoke, the way PostGIS's grants on
-- spatial_ref_sys defeated 20260921123503 — would leave the leak open
-- and the deploy green. 360_block_reason.sql asserts the same facts in
-- CI; this asserts them at the moment the change is applied, on whatever
-- database it is applied to.
-- ---------------------------------------------------------------------
do $$
begin
  if has_column_privilege('authenticated', 'public.staff', 'block_reason', 'select')
     or has_column_privilege('anon', 'public.staff', 'block_reason', 'select') then
    raise exception
      'staff.block_reason is still selectable by a PostgREST role: the revoke did not take (§10.1)';
  end if;

  if not has_column_privilege('authenticated', 'public.staff', 'id', 'select')
     or not has_column_privilege('authenticated', 'public.staff', 'first_name', 'select')
     or not has_column_privilege('anon', 'public.staff', 'id', 'select') then
    raise exception
      'the re-grant did not take: the staff_self read path (0001) and 030_rls_staff need every column but block_reason';
  end if;
end $$;
