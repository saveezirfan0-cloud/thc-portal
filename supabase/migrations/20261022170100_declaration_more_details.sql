-- =====================================================================
-- Migration 20261022170100 · Ask for more details, Update your
--                            declaration, Reverse rejection (ADR-0180)
--
-- What the office could do with a pending Yes declaration was Verify or
-- Reject (§4.1, §10.7). Two things were missing, and the office asked
-- for both (21.10.2026):
--
--   1. A way to ASK. Reject was the only way to say "this is not enough",
--      and a rejected declaration could not be answered: at onboarding
--      the wizard was already submitted (onboarding_submit_documents
--      raises already_submitted) and the paused screen showed only
--      "Rejected"; in employment declare_my_conviction refuses a manual
--      hold. The candidate was stuck behind conviction_rejected, the
--      worker behind a block only a manager could lift.
--
--   2. A way to change their mind. Both review RPCs refuse anything that
--      is not pending (not_pending), which is right for Verify and Reject
--      and left nothing for "we have spoken to them and they can work".
--
-- So, one table, four functions and a guard:
--
--   criminal_declarations   + worker_message          what the office wrote FOR the
--                                                     worker when it asked (the only
--                                                     review text they ever see)
--                           + replaces_declaration_id the declaration this one answers
--                           + reversed_at / reversed_rejection_reason
--                                                     a reversed rejection: when, and the
--                                                     reason it had (the review fields
--                                                     become the reversal's — who, when,
--                                                     the note — so every screen that
--                                                     reads "Verified by …" stays true)
--
--   compliance_request_declaration_details(id, message)   office · pending → details_requested,
--                                                         DR1 push to the worker
--   compliance_reverse_declaration_rejection(id, note)    office · rejected → verified, audited;
--                                                         lifts only the hold the rejection made
--   my_declaration_update()                               worker · what the office asked, and
--                                                         whether they may answer
--   update_my_declaration(details, date)                  worker · a NEW pending declaration;
--                                                         the old one superseded, never edited
--
--   declaration_review_transitions()   the edges, held equal to packages/domain
--                                      (DECLARATION_REVIEW_TRANSITIONS)
--   criminal_declarations_never_edited()  restated from 20260930120000: also refuses
--                                      any other status change, and writes to the new
--                                      columns except by the step that owns them
--   compliance_blockers()              restated from 20261020150200 (plpgsql around
--                                      20261012110000's body): a declaration waiting
--                                      on the worker's answer blocks as a pending one
--                                      does — so neither the quiz gate nor the
--                                      automatic unblock lets them through meanwhile
--   staff_declarations_v               restated from 20261008110000, columns appended
--   notification_priorities()          restated from 20261022100000 with DR1
--
-- Unchanged on purpose: compliance_verify_declaration and
-- compliance_reject_declaration still refuse anything not pending; the
-- reversal is its own function and only from rejected. N8 for a rejected
-- onboarding Yes still lands on /onboarding, which now shows the update
-- form at the top. A rejection IN EMPLOYMENT is still a manual hold with
-- nothing in the app behind it (§10.1 case 2): the office asks for more
-- details instead when it wants an answer from the app.
--
-- pgTAP 915_declaration_more_details.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · Columns
-- ---------------------------------------------------------------------
alter table public.criminal_declarations
  add column if not exists worker_message text,
  add column if not exists replaces_declaration_id uuid
    references public.criminal_declarations(id) on delete cascade,
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_rejection_reason text;

alter table public.criminal_declarations
  add constraint criminal_declarations_worker_message_length
    check (worker_message is null or char_length(worker_message) <= 1000);

create index if not exists criminal_declarations_replaces_idx
  on public.criminal_declarations (replaces_declaration_id)
  where replaces_declaration_id is not null;

comment on column public.criminal_declarations.worker_message is
  'ADR-0180: the office''s message to the worker when it asked for more details (review_status details_requested). The one piece of the review the worker reads — through my_declaration_update() and the DR1 push. Never the review_note.';
comment on column public.criminal_declarations.replaces_declaration_id is
  'ADR-0180: the declaration this one answers (more details requested, or rejected at onboarding). That one is superseded, never edited.';
comment on column public.criminal_declarations.reversed_at is
  'ADR-0180: when a rejection was reversed (rejected → verified). reviewed_by / reviewed_at / review_note are then the reversal''s: who reversed it, when, and the note ("Reviewed by …, cleared to work").';
comment on column public.criminal_declarations.reversed_rejection_reason is
  'ADR-0180: the reason the reversed rejection had (its review_note), kept on the row; who rejected and when are in the audit log (declaration.rejection_reversed). Office-only.';

-- The review_status enum is shared; a document is never sent back.
alter table public.compliance_docs
  add constraint compliance_docs_review_status_not_details_requested
    check (review_status <> 'details_requested');

-- ---------------------------------------------------------------------
-- 2 · The edges (packages/domain DECLARATION_REVIEW_TRANSITIONS)
-- ---------------------------------------------------------------------
create or replace function public.declaration_review_transitions()
returns table (from_status text, to_status text)
language sql immutable set search_path = public, extensions as $$
  select * from (values ('pending', 'verified'), ('pending', 'rejected'),
                        ('pending', 'details_requested'),
                        ('rejected', 'verified')) v(from_status, to_status)
$$;
comment on function public.declaration_review_transitions() is
  'ADR-0180: the legal review_status changes of a criminal declaration. criminal_declarations_never_edited() refuses every other; packages/domain/src/state.ts DECLARATION_REVIEW_TRANSITIONS lists the same pairs (declaration.test.ts reads this file).';
revoke execute on function public.declaration_review_transitions() from public, anon, authenticated;
grant execute on function public.declaration_review_transitions() to service_role;

-- ---------------------------------------------------------------------
-- 3 · The guard, restated from 20260930120000
--
-- Everything it refused it still refuses, in the same order and with the
-- same errors (671). Added:
--   · replaces_declaration_id is set on insert and never changed;
--   · a review_status change outside declaration_review_transitions()
--     raises illegal_declaration_transition — whoever makes it, the
--     admin_all policy and the table owner included;
--   · details_requested needs the message; rejected → verified needs the
--     reversal stamp and a note, so neither can be a bare PATCH;
--   · worker_message is written once, by the request, and the reversal
--     columns once, by the reversal; a GDPR removal may clear the two
--     texts, as it clears the details.
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
              detail = 'A criminal declaration is history. It is reviewed, superseded by a reset, or scrubbed by a GDPR removal, never deleted.';
    end if;
    return old;
  end if;

  if new.staff_id    is distinct from old.staff_id
     or new.declared_at is distinct from old.declared_at
     or new.source      is distinct from old.source
     or new.answer      is distinct from old.answer
     or new.replaces_declaration_id is distinct from old.replaces_declaration_id then
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

  -- ADR-0180: the review moves only along its edges.
  if new.review_status is distinct from old.review_status then
    if not exists (select 1 from declaration_review_transitions() t
                    where t.from_status = old.review_status::text
                      and t.to_status = new.review_status::text) then
      raise exception 'illegal_declaration_transition'
        using errcode = 'P0001',
              detail = old.review_status::text || ' → ' || new.review_status::text;
    end if;
    if new.review_status = 'details_requested'
       and nullif(btrim(coalesce(new.worker_message, '')), '') is null then
      raise exception 'message_required'
        using errcode = 'P0001',
              detail = 'Asking for more details needs the message the worker is sent.';
    end if;
    if old.review_status = 'rejected'
       and (new.reversed_at is null
            or nullif(btrim(coalesce(new.review_note, '')), '') is null) then
      raise exception 'reversal_note_required'
        using errcode = 'P0001',
              detail = 'A rejection is reversed with a note, through compliance_reverse_declaration_rejection().';
    end if;
  end if;

  if new.worker_message is distinct from old.worker_message
     and not (old.review_status = 'pending' and new.review_status = 'details_requested'
              and old.worker_message is null)
     and not (v_status = 'removed' and new.worker_message is null) then
    raise exception 'declaration_never_edited'
      using errcode = 'P0001',
            detail = 'The message to the worker is written once, with the request for more details.';
  end if;

  if new.reversed_at is distinct from old.reversed_at
     and not (old.review_status = 'rejected' and new.review_status = 'verified'
              and old.reversed_at is null) then
    raise exception 'declaration_never_edited'
      using errcode = 'P0001',
            detail = 'A reversal is recorded once, when the rejection is reversed.';
  end if;
  if new.reversed_rejection_reason is distinct from old.reversed_rejection_reason
     and not (old.review_status = 'rejected' and new.review_status = 'verified'
              and old.reversed_at is null)
     and not (v_status = 'removed' and new.reversed_rejection_reason is null) then
    raise exception 'declaration_never_edited'
      using errcode = 'P0001',
            detail = 'A reversal is recorded once, when the rejection is reversed.';
  end if;

  return new;
end $$;

comment on function public.criminal_declarations_never_edited() is
  '§1.5 trigger: refuses UPDATE of staff_id / declared_at / source / answer / replaces_declaration_id, refuses UPDATE of details / conviction_date except clearing them on a removed worker (§1.7), and refuses DELETE except the cascade from a deleted staff row. ADR-0180: a review_status change outside declaration_review_transitions() (illegal_declaration_transition), details_requested without the message, a reversal without its stamp and note, and any other write to worker_message or the reversal columns. Review fields and `superseded` stay writable. ADR-0039, ADR-0180.';

revoke execute on function public.criminal_declarations_never_edited() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4 · §1.7: the two new texts go with the rest of the person.
--
-- remove_worker() (20261001205000) clears details, conviction_date and
-- review_note. The message the office wrote to the worker and a reversed
-- rejection's reason can name the same conviction, so they are cleared in the
-- same transaction — by a trigger on the removal itself rather than a
-- fifth restatement of remove_worker().
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
  end if;
  return null;
end $$;
comment on function public.staff_scrub_declaration_texts_on_removal() is
  'ADR-0180, §1.7: on a GDPR removal, clears the office''s message to the worker and a reversed rejection''s reason on their declarations (remove_worker() clears the details, date and review note).';
revoke execute on function public.staff_scrub_declaration_texts_on_removal() from public, anon, authenticated;

drop trigger if exists staff_scrub_declaration_texts_on_removal on public.staff;
create trigger staff_scrub_declaration_texts_on_removal
  after update of removed_at on public.staff
  for each row execute function public.staff_scrub_declaration_texts_on_removal();

-- ---------------------------------------------------------------------
-- 5 · compliance_blockers(), restated from 20261020150200
--
-- The same body (20261012110000's, in plpgsql so the plan is kept for the
-- session, ADR-0166), with one change: the latest declaration blocks
-- while it is pending OR waiting on the worker's answer. Without it a
-- candidate whose declaration was sent back would pass the quiz gate,
-- and compliance_daily would lift a worker's conviction-review block, on
-- a declaration nobody has accepted. The reason is the same
-- `conviction_unreviewed`: every screen that reads it already says
-- "under review", and the worker's answer is reviewed like any other.
-- ---------------------------------------------------------------------
create or replace function public.compliance_blockers(p_staff uuid, p_on date default current_date)
returns table (reason text)
language plpgsql
stable
set search_path = public, extensions
as $$
begin
  -- 20261020150200: the SQL body as it was, in plpgsql so its plan is
  -- kept for the session instead of rebuilt on every call (ADR-0166).
  -- 20261022170100: details_requested blocks as pending does (ADR-0180).
  return query
  select 'document_expired:' || d.doc_type::text
    from current_verified_docs(p_staff) d
   where d.expires_on is not null
     and d.expires_on <= p_on
     and (d.doc_type <> 'university_term_dates_letter'
          or term_letter_applies(p_staff, p_on))
  union all
  select 'document_unverified:' || d.doc_type::text
    from current_compliance_docs(p_staff) d
   where d.status <> 'verified'
     and d.doc_type <> 'university_completion_letter'
     and (d.doc_type <> 'university_term_dates_letter'
          or term_letter_applies(p_staff, p_on))
  union all
  select 'conviction_unreviewed'
    from (
      select c.answer, c.review_status
        from criminal_declarations c
       where c.staff_id = p_staff
         and not c.superseded
       order by c.declared_at desc, c.id desc
       limit 1
    ) c
   where c.answer and c.review_status in ('pending', 'details_requested');
end
$$;
comment on function public.compliance_blockers(uuid, date) is
  '§4.3 full compliance re-check, as reasons. Empty = compliant. A declaration still PENDING blocks, and so does one sent back for more details until the worker''s answer is verified (ADR-0180); a rejected one does not (§10.7 makes the manual block carry it). The optional completion letter is never a blocker (20260923100000). An unverified University Term Dates Letter is no blocker once term_letter_applies() is false — a verified completion letter whose course has completed (ADR-0112, 20261012110000). plpgsql around the same SQL body, so the plan is kept for the session (ADR-0166).';

-- ---------------------------------------------------------------------
-- 6 · Where the worker answers: the paused onboarding screen for a
--     candidate, the declaration form under Documents for a worker.
--     Mirrors DR1's deepLinkOptions (packages/notifications).
-- ---------------------------------------------------------------------
create or replace function public.declaration_update_link(p_status staff_status)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select case when p_status in ('interview_requested', 'interview_completed',
                                'documents', 'quiz', 'contract')
              then '/onboarding' else '/documents/declare' end
$$;
comment on function public.declaration_update_link(staff_status) is
  'ADR-0180: DR1''s deep link — /onboarding for a candidate, /documents/declare for a worker. Mirrors the deepLinkOptions of DR1 in packages/notifications (templates.ts).';
revoke execute on function public.declaration_update_link(staff_status) from public, anon, authenticated;
grant execute on function public.declaration_update_link(staff_status) to service_role;

-- ---------------------------------------------------------------------
-- 7 · Office · Ask for more details
--
-- A third outcome of a PENDING Yes, beside Verify and Reject, on the same
-- reviewer rule (assert_reviewer: an admin with a profile behind them)
-- and the office's write permission (a viewer reads and changes nothing,
-- ADR-0060). The declaration is closed as details_requested; nothing else
-- changes — in employment the conviction-review block stays exactly as
-- it is while the worker answers (compliance_blockers above keeps it).
-- The worker is pushed DR1 with the message, once per declaration.
-- ---------------------------------------------------------------------
create or replace function public.compliance_request_declaration_details(
  p_declaration uuid,
  p_message     text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reviewer uuid := assert_reviewer();
  c          criminal_declarations;
  v_status   staff_status;
  v_message  text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if not office_can('write') then
    raise exception 'read_only' using errcode = '42501';
  end if;
  -- Only the office users named to decide criminal declarations (owners
  -- while nobody is named) — 20261022170200.
  perform assert_criminal_records_reviewer();
  if v_message is null then
    raise exception 'message_required' using errcode = 'P0001';
  end if;
  if char_length(v_message) > 1000 then
    raise exception 'message_too_long' using errcode = 'P0001';
  end if;

  select * into c from criminal_declarations where id = p_declaration for update;
  if c.id is null then
    raise exception 'declaration_not_found' using errcode = 'P0002';
  end if;
  if not c.answer or c.superseded or c.review_status <> 'pending' then
    raise exception 'not_pending: %',
      case when c.superseded then 'superseded' else c.review_status::text end
      using errcode = 'P0001';
  end if;
  select status into v_status from staff where id = c.staff_id for update;
  if v_status in ('rejected', 'removed') then
    raise exception 'not_reviewable: %', v_status using errcode = 'P0001';
  end if;

  update criminal_declarations
     set review_status = 'details_requested',
         reviewed_by = v_reviewer,
         reviewed_at = now(),
         worker_message = v_message
   where id = c.id;

  insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
  values ('DR1:declaration:' || c.id, 'push', 'DR1', c.staff_id,
          jsonb_build_object('message', v_message,
                             'declarationId', c.id::text,
                             'link', declaration_update_link(v_status)))
  on conflict (key) do nothing;

  -- The message itself is on the row; the log says who asked, and when.
  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), v_reviewer, 'declaration.details_requested', 'criminal_declaration', c.id,
          jsonb_build_object('staffId', c.staff_id::text, 'source', c.source::text));

  return jsonb_build_object(
    'requested', true,
    'declarationId', c.id::text,
    'staffId', c.staff_id::text,
    'source', c.source::text,
    'status', 'details_requested');
end $$;
comment on function public.compliance_request_declaration_details(uuid, text) is
  'ADR-0180 Ask for more details on a pending Yes declaration: message mandatory (it is what the worker reads), closes it as details_requested, pushes DR1 keyed DR1:declaration:<id>, audited. The worker answers with update_my_declaration(); a conviction-review block stays meanwhile.';

revoke execute on function public.compliance_request_declaration_details(uuid, text) from public, anon;
grant execute on function public.compliance_request_declaration_details(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 8 · Office · Reverse rejection
--
-- Only from rejected, only the latest (a superseded one has been
-- answered), only for the office roles that may unblock (owner, manager,
-- scheduler — office_can('write'); a viewer is read-only). The review
-- fields become the reversal's (who, when, the note), so "Verified by …"
-- is true on every screen; the rejection's reason stays on the row
-- (reversed_rejection_reason) and the audit log keeps who rejected it and
-- when.
--
-- Onboarding: the flip to verified clears conviction_rejected and fires
-- onboarding_evidence_changed() → onboarding_advance_if_ready(), so a
-- candidate with nothing else outstanding moves on to the quiz (E12).
--
-- A worker (either source — staff may carry a rejected onboarding Yes):
-- Reject turned an in-employment review block into a manual one carrying
-- the rejection's reason (criminal_declaration_reviewed). If that block is
-- still the one on the worker — manual, with that exact reason — it goes
-- back to being the review's block, and the flip runs
-- the ordinary re-check: unblocked and N15 if nothing else is wrong, or
-- left blocked on what is (and N15 when that lifts, compliance_docs_
-- verified). Any other manual block is a manager's own, and stays.
-- ---------------------------------------------------------------------
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
  v_hold     text;
  v_lifts    boolean := false;
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

  -- The reason criminal_declaration_reviewed() gave the block it made.
  v_hold := coalesce(nullif(c.review_note, ''), 'Declared conviction not accepted');
  if s.status = 'blocked' and s.block_kind = 'manual'
     and s.block_reason is not distinct from v_hold then
    v_lifts := true;
    update staff
       set block_kind = 'conviction_review',
           block_reason = 'Criminal conviction declared — under review'
     where id = s.id;
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

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), v_reviewer, 'declaration.rejection_reversed', 'criminal_declaration', c.id,
          jsonb_build_object('staffId', c.staff_id::text,
                             'source', c.source::text,
                             'note', v_note,
                             'rejectedBy', c.reviewed_by::text,
                             'rejectedAt', c.reviewed_at,
                             'rejectionReason', c.review_note,
                             'liftedHold', v_lifts));

  select status into v_now from staff where id = s.id;
  return jsonb_build_object(
    'reversed', true,
    'declarationId', c.id::text,
    'staffId', s.id::text,
    'source', c.source::text,
    'wasStatus', s.status::text,
    'status', v_now::text,
    'liftedHold', v_lifts,
    'unblocked', s.status = 'blocked' and v_now = 'compliant',
    'advanced', s.status = 'documents' and v_now = 'quiz',
    'blockers', coalesce((select to_jsonb(array_agg(b.reason order by b.reason))
                            from compliance_blockers(s.id, (now() at time zone 'Europe/London')::date) b),
                         '[]'::jsonb));
end $$;
comment on function public.compliance_reverse_declaration_rejection(uuid, text) is
  'ADR-0180 Reverse rejection on the latest rejected Yes declaration: note mandatory, office roles that may write (not a viewer), audited with the rejection it reverses. rejected → verified; onboarding advances by itself; in employment lifts only the manual block the rejection made, then the ordinary re-check (N15 if unblocked).';

revoke execute on function public.compliance_reverse_declaration_rejection(uuid, text) from public, anon;
grant execute on function public.compliance_reverse_declaration_rejection(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 9 · Worker · what the office asked, and whether they may answer
--
-- The worker reads declarations through definer RPCs only (ADR-0031):
-- this one returns the latest declaration's status and, when the office
-- asked for more details, the message written FOR them. Never the
-- details they typed, never the conviction date, never review_note.
-- `canUpdate` is update_my_declaration()'s own rule, so the button and
-- the door agree (packages/domain canUpdateDeclaration mirrors it).
--
-- Who may answer is decided by where the person is NOW, whichever source
-- the declaration had (a worker who is already staff may carry an
-- onboarding declaration that was rejected):
--   · a candidate at the documents stage;
--   · a compliant worker — their answer pauses their shifts, as any
--     declaration from the app does (§10.7), and the form says so;
--   · a worker locked to Documents (blocked for a document or for the
--     review itself), whose block simply stays.
-- Never a manual hold (§10.1 case 2): nothing behind it is the worker's
-- to do, and in employment that is what a Reject makes.
-- ---------------------------------------------------------------------
create or replace function public.declaration_update_allowed(
  p_status staff_status,
  p_block  block_kind,
  p_answer boolean,
  p_review review_status
) returns boolean
language sql
immutable
set search_path = public, extensions
as $$
  select coalesce(p_answer, false)
     and p_review in ('details_requested', 'rejected')
     and (p_status in ('documents', 'compliant')
          or (p_status = 'blocked' and p_block in ('conviction_review', 'auto_document')))
$$;
comment on function public.declaration_update_allowed(staff_status, block_kind, boolean, review_status) is
  'ADR-0180: may this person send an updated declaration? Their latest Yes was sent back for more details or rejected, and they are a candidate at the documents stage, a compliant worker, or a worker locked to Documents (blocked for a document or the review). Never a manual hold. Mirrors canUpdateDeclaration() in packages/domain.';
revoke execute on function public.declaration_update_allowed(staff_status, block_kind, boolean, review_status) from public, anon, authenticated;
grant execute on function public.declaration_update_allowed(staff_status, block_kind, boolean, review_status) to service_role;

create or replace function public.my_declaration_update()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  s    staff;
  c    criminal_declarations;
begin
  if v_id is null then
    return null;
  end if;
  select * into s from staff where id = v_id;
  select * into c from criminal_declarations
   where staff_id = v_id and not superseded
   order by declared_at desc, id desc
   limit 1;
  if c.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'declarationId', c.id::text,
    'source',        c.source::text,
    'answer',        c.answer,
    'status',        c.review_status::text,
    'message',       case when c.review_status = 'details_requested' then c.worker_message end,
    'askedAt',       case when c.review_status = 'details_requested' then c.reviewed_at end,
    'canUpdate',     declaration_update_allowed(s.status, s.block_kind, c.answer, c.review_status),
    -- A compliant worker's answer pauses their shifts (§10.7): the form says so first.
    'pausesShifts',  s.status = 'compliant');
end $$;
comment on function public.my_declaration_update() is
  'ADR-0180: the caller''s latest criminal declaration as the worker may see it — status, the office''s message when it asked for more details, whether "Update your declaration" is open, and whether sending it pauses their shifts. Never the details, the conviction date or the review note (ADR-0031).';

revoke execute on function public.my_declaration_update() from public, anon;
grant execute on function public.my_declaration_update() to authenticated;

-- ---------------------------------------------------------------------
-- 10 · Worker · Update your declaration
--
-- A NEW declaration, pending review, and the old row superseded — never
-- edited (§1.5). Its source is where the person is now: `onboarding` for
-- a candidate (the onboarding screen reads those), `in_employment` for a
-- worker. It reappears in Needs review; a candidate's gate now waits on it
-- instead of conviction_rejected.
--
-- A worker already locked to Documents keeps the block they have. A
-- COMPLIANT worker is paused exactly as §10.7 pauses anyone declaring from
-- the app: blocked "Criminal conviction declared — under review", future
-- bookings released, invitations and applications withdrawn, and E9 to
-- the office without the text, naming what was released — the same
-- cascade as declare_conviction(), keyed on the new declaration. Verify
-- then lifts it through the ordinary re-check, with N15.
--
-- The same validation as the original: details required and at most
-- 4,000 characters, the date optional and not in the future.
-- ---------------------------------------------------------------------
create or replace function public.update_my_declaration(
  p_details         text,
  p_conviction_date date default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id      uuid := staff_caller();
  s         staff;
  c         criminal_declarations;
  v_text    text := btrim(coalesce(p_details, ''));
  v_today   date := (now() at time zone 'Europe/London')::date;
  v_now     timestamptz := now();
  v_source  declaration_source;
  v_new     uuid;
  v_cascade jsonb := '{}'::jsonb;
begin
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  select * into s from staff where id = v_id for update;
  select * into c from criminal_declarations
   where staff_id = v_id and not superseded
   order by declared_at desc, id desc
   limit 1
   for update;

  if s.removed_at is not null or c.id is null
     or not declaration_update_allowed(s.status, s.block_kind, c.answer, c.review_status) then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible');
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

  v_source := case when s.status = 'documents' then 'onboarding' else 'in_employment' end;

  update criminal_declarations set superseded = true where id = c.id;

  insert into criminal_declarations (staff_id, declared_at, source, answer, details,
                                     conviction_date, review_status, replaces_declaration_id)
  values (s.id, clock_timestamp(), v_source, true, v_text, p_conviction_date, 'pending', c.id)
  returning id into v_new;

  if s.status = 'compliant' then
    v_cascade := block_worker(s.id, 'conviction_review',
                              'Criminal conviction declared — under review', v_now);
    insert into notification_outbox (key, channel, template, recipient_emails, payload)
    values ('E9:declaration:' || v_new, 'email', 'E9',
            array['admin@thehospitalitycompany.co.uk'],
            jsonb_build_object(
              'name',       s.first_name || ' ' || s.last_name,
              'employeeId', coalesce(s.employee_id::text, '(not yet issued)'),
              'declaredAt', to_char(v_now at time zone 'Europe/London', 'DD Mon YYYY HH24:MI'),
              'releasedShifts', released_shift_lines(s.id, 'blocked', v_now)))
    on conflict (key) do nothing;
  end if;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (v_now, auth.uid(), 'declaration.updated', 'criminal_declaration', v_new,
          jsonb_build_object('staffId', s.id::text,
                             'source', v_source::text,
                             'replaces', c.id::text,
                             'replacedStatus', c.review_status::text,
                             'paused', s.status = 'compliant'));

  return jsonb_build_object('ok', true,
                            'declarationId', v_new::text,
                            'replaces', c.id::text,
                            'paused', s.status = 'compliant',
                            'released', coalesce((v_cascade ->> 'released')::int, 0),
                            'withdrawn', coalesce((v_cascade ->> 'withdrawn')::int, 0));
end $$;
comment on function public.update_my_declaration(text, date) is
  'ADR-0180 Update your declaration, for the worker themselves (takes no staff id): when the office asked for more details or rejected their Yes, whichever its source. Inserts a new pending declaration (onboarding for a candidate, in_employment for a worker, replaces_declaration_id) and supersedes the old one, which is never edited. A compliant worker is paused as §10.7 pauses a declaration (block, release, withdraw, E9 without the text). Same validation as declare_my_conviction().';

revoke execute on function public.update_my_declaration(text, date) from public, anon;
grant execute on function public.update_my_declaration(text, date) to authenticated;

-- ---------------------------------------------------------------------
-- 11 · staff_declarations_v, restated from 20261008110000 with the new
--      columns appended (a create-or-replace view may only add at the
--      end). `previous_*` is the declaration this one answers, so the
--      office reads an update beside the question it answers.
-- ---------------------------------------------------------------------
create or replace view staff_declarations_v with (security_invoker = true) as
select
  c.id,
  c.staff_id,
  c.source,
  c.answer,
  c.details,
  c.conviction_date,
  c.review_status,
  c.declared_at,
  c.reviewed_at,
  c.review_note,
  c.superseded,
  public.reviewer_name(c.reviewed_by)                        as reviewed_by_name,
  -- Appended (20261022170100, ADR-0180).
  c.worker_message,
  c.replaces_declaration_id,
  c.reversed_at,
  c.reversed_rejection_reason,
  p.review_status                                            as previous_status,
  p.worker_message                                           as previous_worker_message
from criminal_declarations c
left join criminal_declarations p on p.id = c.replaces_declaration_id;

comment on view staff_declarations_v is
  'criminal_declarations for the Back Office Documents tab, /onboarding/:id and the Needs review queue, with the reviewer''s name for "Verified by <name> · <stamp>" (20261008110000). ADR-0180: the message the office sent the worker, a reversed rejection (when, and the reason it had — the reviewer and note are the reversal''s) and, on an updated declaration, the status and message of the one it answers. security_invoker: the admin_all policy still decides the rows (a worker or client reads none). No reviewed_by uuid is exposed.';

revoke all on staff_declarations_v from public, anon, authenticated;
grant select on staff_declarations_v to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 12 · notification_priorities(), restated from 20261022100000 with DR1
--      (normal, as N8 and N15). priorityValuesSql() renders these rows.
-- ---------------------------------------------------------------------
create or replace function public.notification_priorities()
returns table (code text, priority smallint)
language sql immutable set search_path = public, extensions as $$
  select v.code, v.priority::smallint from (values
    ('BG08', 1),
    ('CL1', 1),
    ('CL2', 1),
    ('CL3', 1),
    ('CL4', 2),
    ('CL5', 1),
    ('CL6', 1),
    ('CP1', 1),
    ('CP2', 1),
    ('CP3', 1),
    ('CR1', 1),
    ('CR2', 0),
    ('CR3', 1),
    ('D1', 1),
    ('D2', 1),
    ('DR1', 1),
    ('E1', 1),
    ('E10', 0),
    ('E11', 1),
    ('E12', 1),
    ('E2', 1),
    ('E2b', 1),
    ('E3', 1),
    ('E4', 1),
    ('E5', 1),
    ('E5b', 1),
    ('E6', 1),
    ('E7', 1),
    ('E8', 1),
    ('E9', 1),
    ('INV1', 1),
    ('IR1', 2),
    ('N1', 2),
    ('N10', 0),
    ('N10b', 0),
    ('N10c', 0),
    ('N10d', 0),
    ('N10e', 0),
    ('N11', 0),
    ('N11b', 0),
    ('N12', 0),
    ('N13', 0),
    ('N14', 1),
    ('N15', 1),
    ('N2', 2),
    ('N3', 2),
    ('N4', 1),
    ('N5', 0),
    ('N6', 0),
    ('N6b', 0),
    ('N7', 0),
    ('N8', 1),
    ('N9', 0),
    ('N9b', 0),
    ('NS1', 1),
    ('OC1', 2),
    ('OC2', 2),
    ('OC3', 2),
    ('OC4', 2),
    ('OF1', 0),
    ('OF2', 0),
    ('OF3', 0),
    ('OF4', 0),
    ('OF5', 0),
    ('OF6', 0),
    ('OM1', 0),
    ('OM2', 0),
    ('RC1', 1),
    ('RC2', 1),
    ('RC3', 1),
    ('RC4', 1),
    ('RC5', 1)
  ) as v(code, priority)
$$;

comment on function public.notification_priorities() is
  'ADR-0158: the send class of every register code and document email — 0 urgent, 1 normal, 2 bulk. Mirrors SEND_PRIORITY in packages/notifications/src/priority.ts (priorityValuesSql() renders these rows; __tests__/priority.test.ts holds the two equal). INV1 added 20261022100000 (ADR-0176), DR1 20261022170100 (ADR-0180).';

revoke execute on function public.notification_priorities() from public, anon, authenticated;
grant execute on function public.notification_priorities() to service_role;
