-- =====================================================================
-- Migration 20260930120000 · §1.5 a criminal declaration is never
--                            edited (audit 25.09 D29)
--
-- admin_all on criminal_declarations is FOR ALL, so an admin session
-- could PATCH what a worker declared, or DELETE it. A declaration is the
-- worker's statement at a point in time; the office reviews it, and it
-- never rewrites it. A trigger now refuses:
--
--   · UPDATE of staff_id, declared_at, source, answer, details or
--     conviction_date — EXCEPT the §1.7 scrub: once the worker's row is
--     `removed`, details / conviction_date may be set to NULL
--     (remove_worker does exactly that) and to nothing else;
--   · DELETE — EXCEPT when the worker's staff row is already gone, i.e.
--     the `on delete cascade` from a deleted staff row. Nothing in the
--     product deletes a staff row; a GDPR removal anonymises it (§1.7).
--
-- The review fields (review_status, reviewed_by, reviewed_at,
-- review_note) and `superseded` (Reset to candidate, §2.12) stay
-- writable: they are the office's half of the row, not the worker's.
--
-- Who READS a declaration is settled elsewhere: 20260928110500 dropped
-- the worker's direct policy, and every worker-facing read is a definer
-- RPC that withholds the details (ADR-0031). This migration adds only
-- the write rule. ADR-0039. pgTAP 671.
-- =====================================================================

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
              detail = 'A criminal declaration is history. It is reviewed, superseded by a reset, or scrubbed by a GDPR removal, never deleted.';
    end if;
    return old;
  end if;

  if new.staff_id    is distinct from old.staff_id
     or new.declared_at is distinct from old.declared_at
     or new.source      is distinct from old.source
     or new.answer      is distinct from old.answer then
    raise exception 'declaration_never_edited'
      using errcode = 'P0001',
            detail = 'What the worker declared, and when, is never edited.';
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
              detail = 'The details and conviction date the worker declared are never edited; a GDPR removal may only clear them.';
    end if;
  end if;

  return new;
end $$;

comment on function public.criminal_declarations_never_edited() is
  '§1.5 trigger: refuses UPDATE of staff_id / declared_at / source / answer, refuses UPDATE of details / conviction_date except clearing them on a removed worker (§1.7), and refuses DELETE except the cascade from a deleted staff row. Review fields and `superseded` stay writable. ADR-0039.';

revoke execute on function public.criminal_declarations_never_edited() from public, anon, authenticated;

drop trigger if exists criminal_declarations_never_edited on public.criminal_declarations;
create trigger criminal_declarations_never_edited
  before update or delete on public.criminal_declarations
  for each row execute function public.criminal_declarations_never_edited();
