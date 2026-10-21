-- =====================================================================
-- Migration 20261022170400 · block fields only through the functions, a
--                            rejection hold lifted only by a reviewer,
--                            and no rejection text left behind
--                            (ADR-0180, security re-review of 7923e994)
--
-- H1 · staff.block_kind / block_reason were writable by any office session
--      (admin_all FOR ALL on staff + the table UPDATE grant; the 787
--      guard covers status only). PATCH {block_kind:'auto_document'} on a
--      worker held for a rejected conviction, and the next document
--      verification unblocked them through unblock_if_compliant — with no
--      audit row. Now an API session (anon, authenticated) may not change
--      either column: staff_block_rpc_only, an invoker trigger like
--      staff_status_rpc_only. Nothing in apps/, packages/ or
--      supabase/functions/ writes them; the seed and the e2e helpers run
--      as the owner, the definers as the owner too.
--
--      And unblock_worker() — the profile's Unblock, service key with the
--      manager as p_actor — lifted a rejection's manual hold for anyone.
--      It now refuses (criminal_records_reviewer_only) unless the actor may
--      decide criminal declarations: the hold is the declaration's verdict,
--      and Reverse rejection is the reviewer's door to it.
--
-- H2 · An in-employment Reject copied its review note into
--      staff.block_reason, from where unblock_worker() / block_worker_manually()
--      copy it into audit rows that remove_worker() keeps. The hold now
--      carries the fixed words "Declared conviction not accepted"; the
--      removal trigger also strips `reason` from the worker's unblock
--      audit rows (which copy a block's reason). A block_manual row keeps
--      the manager's own reason, as ADR-0039 and 670 have it.
--
-- Low · criminal_declarations: revoke ALL from anon and authenticated,
--      grant SELECT back to authenticated (admin_read decides the rows).
--      declare_my_conviction() refuses `update_instead` while the latest
--      declaration is waiting on the worker's answer, pointing at Update
--      your declaration rather than adding a second, unrelated row.
--
-- Restated from their latest bodies: criminal_declaration_reviewed,
-- staff_scrub_declaration_texts_on_removal and
-- compliance_reverse_declaration_rejection (20261022170300),
-- unblock_worker (20260927160400), declare_my_conviction (20260923150000).
-- pgTAP 915.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · H1 · the block columns, only through the functions
-- ---------------------------------------------------------------------
create or replace function public.staff_block_rpc_only()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if current_user in ('anon', 'authenticated')
     and ((tg_op = 'INSERT' and (new.block_kind is not null or new.block_reason is not null))
       or (tg_op = 'UPDATE' and (new.block_kind is distinct from old.block_kind
                                 or new.block_reason is distinct from old.block_reason))) then
    raise exception 'staff_block_rpc_only' using errcode = '42501',
      hint = '§9.6 / ADR-0180: a block is set and lifted by its own audited function (block_worker_manually, unblock_worker, the compliance and declaration reviews).';
  end if;
  return new;
end $$;
comment on function public.staff_block_rpc_only() is
  '20261022170400 (ADR-0180): refuses a change to staff.block_kind or staff.block_reason (or an insert carrying one) from an API session (anon, authenticated) with 42501. Invoker on purpose, like staff_status_rpc_only: inside a definer current_user is the owner. A trigger function: not an RPC.';
revoke execute on function public.staff_block_rpc_only() from public, anon, authenticated;

-- Named to sort after staff_status_rpc_only (same timing, alphabetical):
-- a PATCH that also changes the status still answers staff_status_rpc_only
-- first, as 787 expects.
drop trigger if exists staff_status_rpc_only_block_fields on public.staff;
create trigger staff_status_rpc_only_block_fields
  before insert or update of block_kind, block_reason on public.staff
  for each row execute function public.staff_block_rpc_only();

-- ---------------------------------------------------------------------
-- 2 · The hold a rejection makes, named once
-- ---------------------------------------------------------------------
create or replace function public.declaration_hold_reason()
returns text
language sql
immutable
set search_path = public, extensions
as $$ select 'Declared conviction not accepted'::text $$;
comment on function public.declaration_hold_reason() is
  'ADR-0180 (20261022170400): the block reason an in-employment Reject gives the manual hold it makes — fixed words, never the reviewer''s note.';
revoke execute on function public.declaration_hold_reason() from public, anon, authenticated;
grant execute on function public.declaration_hold_reason() to service_role;

-- The declaration whose rejection still holds this worker, or NULL: an
-- in-employment rejection that made the hold (rejection_hold_at), the
-- latest one, the worker still blocked manual with the hold's words —
-- either the fixed words or, for a hold made before 20261022170400, the
-- rejection's note — and nobody has blocked, unblocked or reset them since.
create or replace function public.declaration_rejection_hold(p_staff uuid)
returns uuid
language sql
stable
security definer
set search_path = public, extensions
as $$
  select c.id
    from staff s
    join lateral (
      select d.* from criminal_declarations d
       where d.staff_id = s.id and not d.superseded
       order by d.declared_at desc, d.id desc
       limit 1) c on true
   where s.id = p_staff
     and s.status = 'blocked' and s.block_kind = 'manual'
     and c.source = 'in_employment'
     and c.review_status = 'rejected'
     and c.rejection_hold_at is not null
     and (s.block_reason = declaration_hold_reason()
          or s.block_reason is not distinct from nullif(c.review_note, ''))
     and not exists (select 1 from audit_log a
                      where a.entity_id = s.id
                        and a.action in ('block_manual', 'unblock', 'reset_to_candidate')
                        and a.at >= c.rejection_hold_at)
$$;
comment on function public.declaration_rejection_hold(uuid) is
  'ADR-0180 (20261022170400): the declaration whose in-employment rejection made the worker''s current manual hold, or NULL. One rule for Reverse rejection (which lifts it) and unblock_worker (which leaves it to a criminal-records reviewer).';
revoke execute on function public.declaration_rejection_hold(uuid) from public, anon, authenticated;
grant execute on function public.declaration_rejection_hold(uuid) to service_role;

-- can_review_criminal_records() for a named actor: unblock_worker runs on
-- the service key, so the caller is the p_actor the Back Office passes,
-- not auth.uid(). The same rule, read off profiles and auth.users.
create or replace function public.can_review_criminal_records_as(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.office_role in ('owner', 'manager', 'scheduler')
           and (u.banned_until is null or u.banned_until <= now())
           and (p.reviews_criminal_records
                or (p.office_role = 'owner'
                    and not exists (
                      select 1 from profiles h join auth.users hu on hu.id = h.id
                       where h.role = 'admin'
                         and h.reviews_criminal_records
                         and h.office_role in ('owner', 'manager', 'scheduler')
                         and (hu.banned_until is null or hu.banned_until <= now()))))
      from profiles p join auth.users u on u.id = p.id
     where p.id = p_user and p.role = 'admin'), false)
$$;
comment on function public.can_review_criminal_records_as(uuid) is
  'ADR-0180 (20261022170400): can_review_criminal_records() for a named Back Office login — for the service-key paths that carry the manager as p_actor (unblock_worker). Not an RPC.';
revoke execute on function public.can_review_criminal_records_as(uuid) from public, anon, authenticated;
grant execute on function public.can_review_criminal_records_as(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 3 · H2 · the rejection's hold carries the fixed words
-- ---------------------------------------------------------------------
create or replace function public.criminal_declaration_reviewed()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_now timestamptz := coalesce(new.reviewed_at, now());
  v_held int;
begin
  if new.review_status = old.review_status or new.source <> 'in_employment' then
    return new;
  end if;

  if new.review_status = 'verified' and new.answer then
    if unblock_if_compliant(new.staff_id, (v_now at time zone 'Europe/London')::date) then
      insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
      values ('N15:declaration:' || new.id, 'push', 'N15', new.staff_id, '{}'::jsonb)
      on conflict (key) do nothing;
    end if;

  elsif new.review_status = 'rejected' and new.answer then
    -- 20261022170400: the fixed words, never the reviewer's note. The note
    -- is the office's own text about a conviction, and a block reason is
    -- copied into the unblock audit row and shown on the profile; it stays
    -- on the declaration, which a GDPR removal clears (H2).
    update staff
       set block_kind = 'manual',
           block_reason = declaration_hold_reason()
     where id = new.staff_id
       and status = 'blocked'
       -- Only the block THIS declaration caused. A worker blocked on an
       -- expired document keeps that block, and keeps the automatic
       -- unblock that goes with it.
       and block_kind = 'conviction_review';
    get diagnostics v_held = row_count;
    -- 20261022170300: the proof a reversal needs that this hold is ours.
    if v_held > 0 then
      update criminal_declarations set rejection_hold_at = v_now where id = new.id;
    end if;
  end if;

  return new;
end $$;
revoke execute on function public.criminal_declaration_reviewed() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4 · H2 · the removal strips a block's reason from the worker's rows;
--     Reverse rejection reads the hold through the shared rule
-- ---------------------------------------------------------------------
create or replace function public.staff_scrub_declaration_texts_on_removal()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.removed_at is not null and old.removed_at is null and new.status = 'removed' then
    update criminal_declarations
       set worker_message = null, reversed_rejection_reason = null
     where staff_id = new.id
       and (worker_message is not null or reversed_rejection_reason is not null);
    -- 20261022170300, belt and braces: no declaration audit row carries
    -- free text any more, but any that ever did loses it here, with the
    -- person (remove_worker()'s own scrub keeps a manager's reason).
    update audit_log l
       set data = l.data - array['note', 'rejectionReason', 'reason', 'message', 'details',
                                 'workerMessage', 'reversalNote']
     where l.entity = 'criminal_declaration'
       and l.data ->> 'staffId' = new.id::text
       and l.data ?| array['note', 'rejectionReason', 'reason', 'message', 'details',
                           'workerMessage', 'reversalNote'];
    -- 20261022170400 (H2): an Unblock row copies the block's reason, and
    -- before this migration a rejection copied its note into that — what
    -- the office wrote about a conviction. The worker's unblock rows lose
    -- it. A block_manual row keeps the manager's own reason: that is the
    -- office's record of why they acted (ADR-0039, pinned by 670).
    update audit_log l
       set data = l.data - 'reason'
     where l.entity = 'staff'
       and l.entity_id = new.id
       and l.action = 'unblock'
       and l.data ? 'reason';
  end if;
  return null;
end $$;

create or replace function public.compliance_reverse_declaration_rejection(
  p_declaration uuid,
  p_note        text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reviewer uuid := assert_reviewer();
  c          criminal_declarations;
  s          staff;
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
  v_lifts    boolean := false;
  v_remains  boolean;
  v_now      staff_status;
begin
  if not office_can('write') then
    raise exception 'read_only' using errcode = '42501';
  end if;
  -- Only the office users named to decide criminal declarations (owners
  -- while nobody is named) — 20261022170200.
  perform assert_criminal_records_reviewer();
  if v_note is null then
    raise exception 'note_required' using errcode = 'P0001';
  end if;
  if char_length(v_note) > 1000 then
    raise exception 'note_too_long' using errcode = 'P0001';
  end if;

  select * into c from criminal_declarations where id = p_declaration for update;
  if c.id is null then
    raise exception 'declaration_not_found' using errcode = 'P0002';
  end if;
  if not c.answer or c.superseded or c.review_status <> 'rejected' then
    raise exception 'not_rejected: %',
      case when c.superseded then 'superseded' else c.review_status::text end
      using errcode = 'P0001';
  end if;
  select * into s from staff where id = c.staff_id for update;
  if s.status in ('rejected', 'removed') then
    raise exception 'not_reviewable: %', s.status using errcode = 'P0001';
  end if;

  -- 20261022170300: lift a manual hold only when it is provably the one
  -- THIS rejection made. Only an in-employment rejection makes one
  -- (criminal_declaration_reviewed() turns the review block into it and
  -- stamps rejection_hold_at); it must still be the block on the worker —
  -- manual, with that reason — and nobody may have blocked, unblocked or
  -- reset them since (block_manual / unblock / reset_to_candidate in the
  -- audit log). A manager's own manual block, whatever its words, stays.
  -- 20261022170400: one rule for "this is the rejection's own hold",
  -- shared with unblock_worker() (declaration_rejection_hold()).
  if declaration_rejection_hold(s.id) = c.id then
    v_lifts := true;
    -- Never back to "under review": nothing is. What may still hold them
    -- is a document, which is an automatic block; the flip below runs the
    -- ordinary re-check (unblock_if_compliant, N15) and lifts it when
    -- nothing does.
    update staff set block_kind = 'auto_document', block_reason = null where id = s.id;
  end if;

  -- The flip: criminal_declaration_reviewed() re-checks and sends N15 in
  -- employment; onboarding_evidence_changed() advances a candidate.
  update criminal_declarations
     set review_status = 'verified',
         reviewed_by = v_reviewer,
         reviewed_at = now(),
         review_note = v_note,
         reversed_at = now(),
         reversed_rejection_reason = c.review_note
   where id = c.id;

  -- No free text: the note and the rejection's reason are on the row (and
  -- go with a GDPR removal); the log is read and exported (§10.7).
  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), v_reviewer, 'declaration.rejection_reversed', 'criminal_declaration', c.id,
          jsonb_build_object('staffId', c.staff_id::text,
                             'source', c.source::text,
                             'rejectedBy', c.reviewed_by::text,
                             'rejectedAt', c.reviewed_at,
                             'reversedBy', v_reviewer::text,
                             'reversedAt', now(),
                             'liftedHold', v_lifts));

  select status into v_now from staff where id = s.id;
  v_remains := v_lifts and v_now = 'blocked';
  return jsonb_build_object(
    'reversed', true,
    'declarationId', c.id::text,
    'staffId', s.id::text,
    'source', c.source::text,
    'wasStatus', s.status::text,
    'status', v_now::text,
    'liftedHold', v_lifts,
    'stillBlockedFor', case when v_remains then 'documents' end,
    'unblocked', s.status = 'blocked' and v_now = 'compliant',
    'advanced', s.status = 'documents' and v_now = 'quiz',
    'blockers', coalesce((select to_jsonb(array_agg(b.reason order by b.reason))
                            from compliance_blockers(s.id, (now() at time zone 'Europe/London')::date) b),
                         '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- 5 · H1 · Unblock, restated from 20260927160400: a rejection's hold is
--     a criminal-records reviewer's to lift
-- ---------------------------------------------------------------------
create or replace function public.unblock_worker(
  p_staff uuid,
  p_on    date default current_date,
  p_actor uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v staff;
  v_reasons text[];
begin
  select * into v from staff where id = p_staff for update;
  if v.id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if v.status <> 'blocked' then
    raise exception 'not_blocked' using errcode = 'P0001';
  end if;

  -- 20261022170400 (ADR-0180): the hold a rejected declaration put on
  -- them is that declaration's verdict. Only someone who may decide
  -- criminal declarations lifts it — and Reverse rejection is the door.
  if declaration_rejection_hold(p_staff) is not null
     and not can_review_criminal_records_as(coalesce(p_actor, auth.uid())) then
    raise exception 'criminal_records_reviewer_only' using errcode = '42501',
      detail = 'Only office users allowed to review criminal records can lift this — use Reverse rejection.';
  end if;

  select array_agg(reason order by reason) into v_reasons
    from compliance_blockers(p_staff, p_on);

  if v_reasons is not null then
    return jsonb_build_object('unblocked', false, 'blockers', to_jsonb(v_reasons));
  end if;

  perform assert_staff_transition(v.status, 'compliant'::staff_status);
  update staff set status = 'compliant', block_kind = null, block_reason = null
   where id = p_staff;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), coalesce(p_actor, auth.uid()), 'unblock', 'staff', p_staff,
          jsonb_build_object('blockKind', v.block_kind::text,
                             'reason', v.block_reason,
                             'checkedOn', p_on));
  return jsonb_build_object('unblocked', true, 'blockers', '[]'::jsonb);
end $$;
comment on function public.unblock_worker(uuid, date, uuid) is
  '§9.6 Unblock: the full compliance re-check first, then compliant. Since 20261022170400 a manual hold made by a rejected criminal declaration is lifted only for an actor who may decide criminal declarations (criminal_records_reviewer_only otherwise) — Reverse rejection is the reviewer''s door to it (ADR-0180). p_actor is the manager who pressed it (the service key carries no sub).';

-- ---------------------------------------------------------------------
-- 6 · Low · declare_my_conviction(), restated from 20260923150000: while
--     the office waits for the worker's answer, the answer is the update
-- ---------------------------------------------------------------------
create or replace function public.declare_my_conviction(
  p_details         text,
  p_conviction_date date default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v       staff;
  v_text  text := btrim(coalesce(p_details, ''));
  v_today date := (now() at time zone 'Europe/London')::date;
begin
  select * into v from staff where user_id = auth.uid();
  if v.id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if v.removed_at is not null
     or v.status not in ('compliant', 'blocked')
     or (v.status = 'blocked' and v.block_kind = 'manual') then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible');
  end if;
  -- 20261022170400 (ADR-0180): the office asked about the latest one —
  -- answer it with Update your declaration, which supersedes it.
  if exists (select 1 from (select c.review_status from criminal_declarations c
                             where c.staff_id = v.id and not c.superseded
                             order by c.declared_at desc, c.id desc limit 1) l
              where l.review_status = 'details_requested') then
    return jsonb_build_object('ok', false, 'reason', 'update_instead');
  end if;
  if v_text = '' then
    return jsonb_build_object('ok', false, 'reason', 'details_required');
  end if;
  if length(v_text) > 4000 then
    return jsonb_build_object('ok', false, 'reason', 'details_too_long');
  end if;
  if p_conviction_date is not null and p_conviction_date > v_today then
    return jsonb_build_object('ok', false, 'reason', 'conviction_date_in_future');
  end if;

  return jsonb_build_object('ok', true)
         || declare_conviction(v.id, v_text, p_conviction_date, now());
end $$;

-- ---------------------------------------------------------------------
-- 7 · Low · criminal_declarations: SELECT is the only grant left
-- ---------------------------------------------------------------------
revoke all on table public.criminal_declarations from public, anon, authenticated;
grant select on table public.criminal_declarations to authenticated;
