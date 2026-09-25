-- =====================================================================
-- Migration 20260929140000 · §10.1 / §10.7 the manager's note on a
--                            criminal declaration is internal, and §1.5
--                            a declaration is never edited
--
-- 1 · The note (audit 25.09 D8, verified live)
-- -------------------------------------------
-- criminal_declarations has carried a whole-row worker SELECT policy since
-- 0001 (staff_self_decl, restated in 20260921123503). Row-level, with no
-- column restriction, so
--
--     GET /rest/v1/criminal_declarations?select=review_note,reviewed_by
--
-- signed in as the worker returned the manager's reason for rejecting
-- their declaration and the id of the manager who wrote it. §10.1 and
-- §10.7 say that reason is internal and is never shown to the worker; the
-- Staff App never selects it, but the application is not the boundary.
--
-- The fix is 20260923090000's (staff.block_reason) and 20260923220000's
-- (staff.rejection_reason), one table over:
--
--   a. `authenticated` and `anon` lose the table-wide SELECT and get it
--      back on every column EXCEPT review_note and reviewed_by. A column
--      privilege is checked before RLS and applies to `select *`, to a
--      named column and to a column named only in a WHERE clause.
--   b. The office — the same Postgres role as the worker — reads the
--      declarations through an owner-rights view whose body carries the
--      admin gate (ADR-0004): criminal_declarations_office_v. Its column
--      list is the table's, so /onboarding/:id changes one table name.
--   c. staff_self_decl stays exactly as it is: it decides WHICH rows the
--      worker sees, and nothing a policy can say decides which columns.
--
-- Every other reader of review_note is a security definer function
-- (compliance_*, onboarding_*_declaration, the criminal_declaration_reviewed
-- trigger reading NEW), which runs with owner rights and is unaffected.
--
-- 2 · Never edited (§1.5 "CriminalDeclaration — history, never edited";
--     audit D29)
-- ---------------------------------------------------------------------
-- admin_all is FOR ALL, so an admin session could PATCH what a worker
-- declared, or DELETE it. A declaration is the worker's statement at a
-- point in time; the office reviews it, and it never rewrites it. A
-- trigger now refuses:
--
--   · UPDATE of staff_id, declared_at, source, answer, details or
--     conviction_date — EXCEPT the §1.7 scrub: once the worker's row is
--     `removed`, details / conviction_date / review_note may be set to
--     NULL (remove_worker does exactly that) and to nothing else;
--   · DELETE — EXCEPT when the worker's staff row is already gone, i.e.
--     the `on delete cascade` from a deleted staff row. Nothing in the
--     product deletes a staff row; a GDPR removal anonymises it (§1.7).
--
-- The review fields (review_status, reviewed_by, reviewed_at,
-- review_note) and `superseded` (Reset to candidate, §2.12) stay
-- writable: they are the office's half of the row, not the worker's.
--
-- Scope refs: §1.5, §1.7, §10.1, §10.7, §2.12; ADR-0004.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1a · The base-table privilege, from the catalogue (every column but two)
-- ---------------------------------------------------------------------
revoke select on table public.criminal_declarations from public, anon, authenticated;

do $$
declare
  v_columns text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
    into v_columns
    from pg_attribute a
   where a.attrelid = 'public.criminal_declarations'::regclass
     and a.attnum > 0
     and not a.attisdropped
     and a.attname not in ('review_note', 'reviewed_by');

  execute format('grant select (%s) on table public.criminal_declarations to anon, authenticated', v_columns);
end $$;

comment on column public.criminal_declarations.review_note is
  'The manager''s note on the review — for a rejection, the reason (§10.7). §10.1/§10.7: internal, never shown to the worker. Neither anon nor authenticated holds SELECT on this column (20260929140000); the office reads it through the owner-rights criminal_declarations_office_v.';
comment on column public.criminal_declarations.reviewed_by is
  'The manager who reviewed the declaration. Not selectable by anon/authenticated (20260929140000); read through criminal_declarations_office_v.';

-- ---------------------------------------------------------------------
-- 1b · The office's route back to the two columns (ADR-0004)
-- ---------------------------------------------------------------------
create or replace view public.criminal_declarations_office_v with (security_barrier = true) as
select
  c.id,
  c.staff_id,
  c.declared_at,
  c.source,
  c.answer,
  c.details,
  c.conviction_date,
  c.review_status,
  c.reviewed_by,
  c.reviewed_at,
  c.review_note,
  c.superseded
from public.criminal_declarations c
where current_app_role() = 'admin';

comment on view public.criminal_declarations_office_v is
  '§1.5/§10.7: every criminal declaration with the review note and reviewer, for the office only. Owner rights + `current_app_role() = ''admin''` in the body (ADR-0004), because a column privilege is held by a role and admin and worker are both `authenticated`. The worker reads their own rows off the table without review_note / reviewed_by (§10.1: never shown to the worker).';

revoke all on table public.criminal_declarations_office_v from public, anon, authenticated;
grant select on table public.criminal_declarations_office_v to authenticated;

-- ---------------------------------------------------------------------
-- 2 · Never edited, never deleted
-- ---------------------------------------------------------------------
create or replace function public.criminal_declarations_never_edited()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_status staff_status;
  v_exists boolean;
begin
  select true, s.status into v_exists, v_status
    from staff s where s.id = old.staff_id;

  if tg_op = 'DELETE' then
    -- The only delete allowed is the cascade from a deleted staff row:
    -- by the time the cascade runs, the parent is gone.
    if coalesce(v_exists, false) then
      raise exception 'declaration_never_deleted'
        using errcode = 'P0001',
              detail = '§1.5: a criminal declaration is history. It is reviewed, superseded by a reset, or scrubbed by a GDPR removal — never deleted.';
    end if;
    return old;
  end if;

  if new.staff_id    is distinct from old.staff_id
     or new.declared_at is distinct from old.declared_at
     or new.source      is distinct from old.source
     or new.answer      is distinct from old.answer then
    raise exception 'declaration_never_edited'
      using errcode = 'P0001',
            detail = '§1.5: what the worker declared, and when, is never edited.';
  end if;

  if new.details is distinct from old.details
     or new.conviction_date is distinct from old.conviction_date then
    -- §1.7: remove_worker() anonymises the row first, then nulls the
    -- content. Nulling on a removed worker is the one edit there is.
    if v_status is distinct from 'removed'
       or new.details is not null
       or new.conviction_date is not null then
      raise exception 'declaration_never_edited'
        using errcode = 'P0001',
              detail = '§1.5: the details and conviction date the worker declared are never edited; a GDPR removal (§1.7) may only clear them.';
    end if;
  end if;

  return new;
end $$;

comment on function public.criminal_declarations_never_edited() is
  '§1.5 trigger: refuses UPDATE of staff_id / declared_at / source / answer, refuses UPDATE of details / conviction_date except clearing them on a removed worker (§1.7), and refuses DELETE except the cascade from a deleted staff row. Review fields and `superseded` stay writable.';

revoke execute on function public.criminal_declarations_never_edited() from public, anon, authenticated;

drop trigger if exists criminal_declarations_never_edited on public.criminal_declarations;
create trigger criminal_declarations_never_edited
  before update or delete on public.criminal_declarations
  for each row execute function public.criminal_declarations_never_edited();
