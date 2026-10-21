-- =====================================================================
-- Migration 20261022170300 · criminal declarations: decided only through
--                            the functions, no free text in the log, and
--                            a reversal lifts only the hold it can prove
--                            (ADR-0180, QA review of ab61e6d7)
--
-- 1 · B1 · No direct write. 0001 gave the office `admin_all` FOR ALL on
--     criminal_declarations and Supabase grants authenticated table DML,
--     so any office session — not only a named criminal-records reviewer —
--     could PATCH review_status and have the triggers unblock a worker and
--     push N15. Nothing in the apps writes the table (grep apps/ packages/
--     supabase/functions/: reads only); every write is a definer function,
--     which runs as the owner. So the office reads (`admin_read`) and
--     writes nothing; INSERT / UPDATE / DELETE / TRUNCATE are revoked from
--     anon and authenticated. The service role and migrations keep theirs.
--
-- 2 · B2 · The declaration.rejection_reversed audit row carried the note
--     and the rejection's reason — review-note text — which /activity
--     prints and exports and remove_worker() does not scrub. It now carries
--     who and when only; the texts stay on the row, which a removal clears.
--     The other rows this ADR writes (details_requested, updated, the
--     /users permission) never carried free text. The removal trigger also
--     strips any such key from a declaration's audit rows, belt and braces.
--
-- 3 · B3 · A reversal lifted any manual block whose reason matched the
--     rejection's words, whatever its source — so an onboarding rejection
--     on a worker with a manager's own block of the same words lifted that
--     block and turned it into a false "under review". Now:
--       · criminal_declaration_reviewed() (restated from 20260921192246)
--         stamps `rejection_hold_at` on the declaration when its rejection
--         actually turns the review block into a manual one;
--       · the reversal lifts only an in-employment rejection's hold, only
--         if that stamp is there, the block is still manual with that
--         reason, and no block / unblock / reset is in the audit log since;
--       · it never makes the block conviction_review: what can still hold
--         the worker is a document (an automatic block), and the flip's
--         ordinary re-check (unblock_if_compliant, N15) lifts it otherwise.
--
-- 4 · Ask for more details refuses a person who cannot answer from the app
--     (cannot_answer_from_app): a manual hold, a candidate past documents,
--     a leaver. The office calls them.
-- 5 · update_my_declaration() sends E9 for every in-employment update, not
--     only a compliant worker's: the office hears of the answer.
-- 6 · /users: a switched-off login cannot be named (login_disabled), and a
--     login demoted to viewer loses the permission (audited) — so the
--     "nobody named" fallback to owners is never held up by someone who
--     cannot decide.
--
-- Restated from their latest bodies (20261022170100, 20261022170200,
-- 20260921192246) with only the changes above. pgTAP 915.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · B1 · the office reads; the functions write
-- ---------------------------------------------------------------------
drop policy if exists admin_all on public.criminal_declarations;
create policy admin_read on public.criminal_declarations
  for select to authenticated
  using ((select current_app_role()) = 'admin'::app_role);

revoke insert, update, delete, truncate on table public.criminal_declarations
  from public, anon, authenticated;

comment on table public.criminal_declarations is
  'History, never edited (§1.5). The office READS it (admin_read); every write is a security definer function — onboarding_submit_documents, declare_conviction, update_my_declaration, the compliance_* review functions, reset_to_candidate, remove_worker — so who may decide a declaration is decided in one place (ADR-0180, 20261022170300). A worker reads through definer RPCs only (ADR-0031).';

-- ---------------------------------------------------------------------
-- 2 · B3 · which block a rejection made
-- ---------------------------------------------------------------------
alter table public.criminal_declarations
  add column if not exists rejection_hold_at timestamptz;

comment on column public.criminal_declarations.rejection_hold_at is
  'ADR-0180 (20261022170300): when this in-employment rejection turned the worker''s conviction-review block into a manual hold (criminal_declaration_reviewed). A reversal lifts a manual block only with this stamp, and only if nobody has blocked, unblocked or reset the worker since.';

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
    update staff
       set block_kind = 'manual',
           block_reason = coalesce(nullif(new.review_note, ''),
                                   'Declared conviction not accepted')
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
-- 3 · the guard, restated from 20261022170100 with rejection_hold_at
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

  -- 20261022170300: the marker that THIS rejection made the manual hold,
  -- written once, by criminal_declaration_reviewed(), on a rejected row.
  if new.rejection_hold_at is distinct from old.rejection_hold_at
     and not (old.rejection_hold_at is null and new.rejection_hold_at is not null
              and new.review_status = 'rejected') then
    raise exception 'declaration_never_edited'
      using errcode = 'P0001',
            detail = 'Which block a rejection made is recorded once, when it makes it.';
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
revoke execute on function public.criminal_declarations_never_edited() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4 · B2 · the removal also strips free text from declaration audit rows
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
  end if;
  return null;
end $$;
revoke execute on function public.staff_scrub_declaration_texts_on_removal() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5 · Ask for more details, restated from 20261022170100: only someone
--     who can answer from the app
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
  v_block    block_kind;
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
  select status, block_kind into v_status, v_block from staff where id = c.staff_id for update;
  if v_status in ('rejected', 'removed') then
    raise exception 'not_reviewable: %', v_status using errcode = 'P0001';
  end if;
  -- 20261022170300: never send a request the person cannot answer from
  -- the app (a manual hold, a candidate past the documents stage, a
  -- leaver): the office calls them instead.
  if not declaration_update_allowed(v_status, v_block, true, 'details_requested') then
    raise exception 'cannot_answer_from_app: %', v_status using errcode = 'P0001';
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

-- ---------------------------------------------------------------------
-- 6 · Reverse rejection, restated from 20261022170100: B2 and B3
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
  v_hold := coalesce(nullif(c.review_note, ''), 'Declared conviction not accepted');
  if c.source = 'in_employment'
     and c.rejection_hold_at is not null
     and s.status = 'blocked' and s.block_kind = 'manual'
     and s.block_reason is not distinct from v_hold
     and not exists (select 1 from audit_log a
                      where a.entity_id = s.id
                        and a.action in ('block_manual', 'unblock', 'reset_to_candidate')
                        and a.at >= c.rejection_hold_at) then
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
-- 7 · Update your declaration, restated from 20261022170100: E9 for
--     every in-employment update
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
  end if;
  -- 20261022170300: the office hears of a worker's updated declaration as
  -- of any declaration from the app — E9, without the text, naming what was
  -- released ("(none)" for a worker already paused). A candidate's goes to
  -- Needs review only, as their first one did.
  if v_source = 'in_employment' then
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

-- ---------------------------------------------------------------------
-- 8 · /users, restated from 20261022170200: not a switched-off login
-- ---------------------------------------------------------------------
create or replace function public.admin_set_criminal_records_reviewer(
  p_user uuid,
  p_on   boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_target profiles;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if not office_can('users') then
    raise exception 'not_permitted' using errcode = '42501', detail = 'users';
  end if;
  if p_on is null then
    raise exception 'value_required' using errcode = 'P0001';
  end if;
  select * into v_target from profiles where id = p_user for update;
  if v_target.id is null then
    raise exception 'unknown_account' using errcode = 'P0001';
  end if;
  if v_target.role <> 'admin' then
    raise exception 'not_office_login' using errcode = 'P0001';
  end if;
  if p_on and exists (select 1 from auth.users u
                       where u.id = p_user and u.banned_until > now()) then
    -- 20261022170300: a switched-off login decides nothing either.
    raise exception 'login_disabled' using errcode = 'P0001';
  end if;
  if p_on and v_target.office_role = 'viewer' then
    -- A viewer changes nothing (ADR-0060), so naming one would name nobody.
    raise exception 'viewer_cannot_review' using errcode = 'P0001';
  end if;
  if v_target.reviews_criminal_records = p_on then
    return jsonb_build_object('userId', p_user, 'reviewsCriminalRecords', p_on, 'changed', false);
  end if;

  update profiles set reviews_criminal_records = p_on, updated_at = now() where id = p_user;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (v_actor,
          case when p_on then 'account.criminal_records_granted'
               else 'account.criminal_records_revoked' end,
          'account', p_user,
          jsonb_build_object('from', v_target.reviews_criminal_records, 'to', p_on,
                             'officeRole', v_target.office_role::text));

  return jsonb_build_object('userId', p_user, 'reviewsCriminalRecords', p_on, 'changed', true);
end $$;

-- A login demoted to viewer changes nothing (ADR-0060), so it stops
-- deciding criminal declarations too — recorded like any other change.
create or replace function public.profiles_viewer_drops_criminal_records()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.office_role = 'viewer' and old.office_role is distinct from 'viewer'
     and new.reviews_criminal_records then
    new.reviews_criminal_records := false;
    insert into audit_log (actor, action, entity, entity_id, data)
    values (auth.uid(), 'account.criminal_records_revoked', 'account', new.id,
            jsonb_build_object('from', true, 'to', false, 'officeRole', 'viewer',
                               'because', 'became_viewer'));
  end if;
  return new;
end $$;
comment on function public.profiles_viewer_drops_criminal_records() is
  'ADR-0180 (20261022170300): a Back Office login demoted to viewer loses "Can review criminal records", audited as account.criminal_records_revoked.';
revoke execute on function public.profiles_viewer_drops_criminal_records() from public, anon, authenticated;

drop trigger if exists profiles_viewer_drops_criminal_records on public.profiles;
create trigger profiles_viewer_drops_criminal_records
  before update of office_role on public.profiles
  for each row execute function public.profiles_viewer_drops_criminal_records();
