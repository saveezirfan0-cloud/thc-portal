-- =====================================================================
-- Compliance → Needs review and Radar (§4.1–4.3, §10.7)
--
-- What this adds
-- --------------
-- 20260921170411 built the document clock and wrote, in its own header,
-- the gap this closes: "nothing yet SETS staff.graduated_at or copies a
-- verified letter's term_dates onto the worker. That is the verify action
-- in Compliance → Needs review (§4.1)". Nothing verified or rejected a
-- document at all — compliance_docs_verified() was a trigger waiting for
-- an UPDATE nobody issued.
--
--   compliance_verify_document()     Verify, for every document type
--                                    except the completion letter, which
--                                    has its own approval (20260923100100)
--                                    because the requirement makes the
--                                    reviewer confirm two dates on it
--   compliance_reject_document()     Reject with a mandatory reason → push
--                                    N8 with Re-upload (§4.1, §2.3). Every
--                                    type, the completion letter included.
--   compliance_verify_declaration()  §10.7 Verify on a Yes declaration
--   compliance_reject_declaration()  §10.7 Reject, reason mandatory
--   compliance_review_queue_v        the Needs review tab
--   compliance_radar_v               the Radar tab
--
-- Why the `compliance_` prefix. The onboarding branch (B5,
-- 20260923110000_onboarding_pipeline.sql) defines verify_document(),
-- reject_document(), verify_declaration() and reject_declaration() for the
-- candidate profile, and sorts AFTER this file. Same names here would
-- either be silently replaced or — verify_document() has the same argument
-- types with a different fourth parameter name — make that migration fail
-- with "cannot change name of input parameter". The two sets write the
-- same columns, the same N8 keys and fire the same row triggers, so a
-- document verified from either screen gets the same §4.3 re-check; these
-- add what the Compliance queue needs on top (an already-expired document
-- refused, a share code's right-to-work date copied, the unblock
-- reported).
--
-- The re-check is NOT written here. §4.3: "Verifying any document
-- automatically re-checks the person's FULL compliance status". That is
-- compliance_docs_verified() → unblock_if_compliant() → compliance_blockers(),
-- which fires on the row whatever path verified it. compliance_verify_document()
-- only reports the outcome, it does not decide it, so there is exactly one
-- place that can unblock a worker on a document.
--
-- Every write here is Back Office only. The functions are security
-- definer (they touch staff, the outbox and the audit log, none of which
-- the office writes directly) and each checks current_app_role() = admin
-- itself, because the reviewer's identity is part of the record: a
-- verification with no reviewer is not a verification (§1.8 audit stamp,
-- completion letter requirement §4).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The full re-check, with one document taken out of it.
--
-- The Official University Completion Letter is OPTIONAL evidence (§4.5,
-- "Optional document, International student branch") and it carries no
-- expiry. What it changes is the weekly cap — and only once approved. A
-- pending or rejected one therefore says nothing about whether the worker
-- is compliant: their cap simply stays where it was (requirement §2.1,
-- acceptance criterion 2).
--
-- Without this, the latest completion letter being `pending` or `rejected`
-- reads as `document_unverified:university_completion_letter`, and a
-- worker blocked on an expired passport who re-uploads the passport AND a
-- completion letter stays blocked after the passport is verified — held
-- off every shift by a document that could only ever have raised their
-- hours. Worse, a REJECTED letter is the latest row of its type until the
-- worker uploads another, so they would stay blocked indefinitely.
--
-- Everything else is exactly 20260921192246's version.
-- ---------------------------------------------------------------------
create or replace function public.compliance_blockers(p_staff uuid, p_on date default current_date)
returns table (reason text)
language sql
stable
set search_path = public, extensions
as $$
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
   where c.answer and c.review_status = 'pending'
$$;

comment on function public.compliance_blockers(uuid, date) is
  '§4.3 full compliance re-check, as reasons. Empty = compliant. A declaration still PENDING blocks; a rejected one does not (§10.7 makes the manual block carry it). The optional completion letter is never a blocker: it changes the cap, not compliance (20260923100000).';

-- ---------------------------------------------------------------------
-- 2 · The office's identity, for every review below.
-- ---------------------------------------------------------------------
create or replace function public.assert_reviewer()
returns uuid
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if auth.uid() is null or current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

comment on function public.assert_reviewer() is
  'The signed-in admin reviewing a document or declaration, or 42501. A review with no reviewer is not a review: the identity is part of the audit record (§1.8, completion letter requirement §4).';

-- ---------------------------------------------------------------------
-- 3 · Verify (§4.1, §4.3).
--
-- Only a PENDING document is verified. A superseded one is the record of
-- a previous period (§2.12) and never satisfies the current check; a
-- rejected one has been decided and the worker re-uploads.
--
-- An already-expired document is refused rather than verified: §4.2 says
-- so of the term letter in as many words ("an already-expired letter is
-- not accepted"), and the same holds for anything with a date on it —
-- verifying it would unblock a worker onto a document compliance_daily
-- blocks again at 05:00.
--
-- What a verified document copies onto the worker, BEFORE the status
-- flips, because the flip fires the §4.3 re-check and that check reads
-- the worker's row:
--   · term letter        → staff.term_dates (RULE-20 reads the holiday
--                          ranges from the worker, never the document)
--   · share code report  → staff.right_to_work_until and share_code (§2.5,
--                          §4.4 "right-to-work-until from gov.uk")
-- ---------------------------------------------------------------------
create or replace function public.compliance_verify_document(
  p_doc                 uuid,
  p_expiry              date        default null,
  p_term_dates          daterange[] default null,
  p_right_to_work_until date        default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reviewer uuid := assert_reviewer();
  d          compliance_docs;
  s          staff;
  v_today    date := (now() at time zone 'Europe/London')::date;
  v_expires  date;
  v_blockers text[];
begin
  select * into d from compliance_docs where id = p_doc for update;
  if d.id is null then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if d.doc_type = 'university_completion_letter' then
    -- The requirement (§2.2) makes the reviewer confirm the completion
    -- date and the visa expiry on this one, so it is approved through the
    -- function that asks for both.
    raise exception 'use_approve_completion_letter' using errcode = 'P0001';
  end if;
  if d.review_status <> 'pending' then
    raise exception 'not_pending: %', d.review_status using errcode = 'P0001';
  end if;

  select * into s from staff where id = d.staff_id for update;
  if s.status in ('rejected', 'removed') or s.removed_at is not null then
    -- §4.1: their outstanding documents "no longer need review".
    raise exception 'not_reviewable: %', s.status using errcode = 'P0001';
  end if;
  if p_term_dates is not null and exists (
       select 1 from unnest(p_term_dates) r where isempty(r) or lower_inf(r) or upper_inf(r)) then
    raise exception 'term_dates_invalid' using errcode = '22023';
  end if;

  v_expires := doc_expires_on(d.doc_type,
                              coalesce(p_expiry, d.expiry_date),
                              coalesce(p_right_to_work_until, d.right_to_work_until),
                              s.right_to_work_until,
                              d.uploaded_at);
  if v_expires is not null and v_expires <= v_today then
    raise exception 'already_expired: %', v_expires using errcode = 'P0001';
  end if;

  if d.doc_type = 'university_term_dates_letter' then
    update staff set term_dates = coalesce(p_term_dates, d.term_dates, '{}')
     where id = s.id;
  elsif d.doc_type = 'share_code_report' then
    update staff
       set right_to_work_until = coalesce(p_right_to_work_until, d.right_to_work_until,
                                          right_to_work_until),
           share_code = coalesce(d.share_code, share_code)
     where id = s.id;
  end if;

  -- The flip. compliance_docs_verified() fires on it and runs the §4.3
  -- full re-check; nothing here second-guesses that.
  update compliance_docs
     set review_status = 'verified',
         reviewed_by = v_reviewer,
         reviewed_at = now(),
         expiry_date = coalesce(p_expiry, expiry_date),
         term_dates = coalesce(p_term_dates, term_dates),
         right_to_work_until = coalesce(p_right_to_work_until, right_to_work_until)
   where id = d.id;

  select array_agg(reason order by reason) into v_blockers
    from compliance_blockers(s.id, v_today);

  return jsonb_build_object(
    'verified', true,
    'documentId', d.id::text,
    'wasStatus', s.status::text,
    'status', (select status::text from staff where id = s.id),
    'unblocked', s.status = 'blocked'
                 and (select status from staff where id = s.id) = 'compliant',
    'blockers', coalesce(to_jsonb(v_blockers), '[]'::jsonb));
end $$;

comment on function public.compliance_verify_document(uuid, date, daterange[], date) is
  '§4.1 Verify. Pending documents only; an already-expired one is refused (§4.2). Copies a term letter''s holiday ranges and a share code''s right-to-work date onto the worker, then flips the status, which fires the §4.3 full re-check. Reports what is still outstanding. Not for the completion letter: approve_completion_letter().';

-- ---------------------------------------------------------------------
-- 4 · Reject (§4.1, §2.3, §8 N8).
--
-- "Reject asks for a reason → push N8 with a Re-upload button". The
-- reason goes to the worker word for word, so it is required and trimmed.
-- One key per document: a document is rejected once, and a re-upload is
-- a new row that can be rejected in its own right.
--
-- Rejection changes nothing else on the profile (the wireframe's note),
-- which includes the cap: a rejected completion letter leaves the worker
-- exactly where they were (requirement §2.1, §7 "reject flow with
-- re-upload").
-- ---------------------------------------------------------------------
create or replace function public.compliance_reject_document(
  p_doc    uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reviewer uuid := assert_reviewer();
  d          compliance_docs;
  s          staff;
  v_reason   text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  select * into d from compliance_docs where id = p_doc for update;
  if d.id is null then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if d.review_status <> 'pending' then
    raise exception 'not_pending: %', d.review_status using errcode = 'P0001';
  end if;

  select * into s from staff where id = d.staff_id;
  if s.status in ('rejected', 'removed') or s.removed_at is not null then
    raise exception 'not_reviewable: %', s.status using errcode = 'P0001';
  end if;

  update compliance_docs
     set review_status = 'rejected',
         rejection_reason = v_reason,
         reviewed_by = v_reviewer,
         reviewed_at = now()
   where id = d.id;

  insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
  values ('N8:doc:' || d.id, 'push', 'N8', d.staff_id,
          jsonb_build_object('reason', v_reason,
                             'document', doc_label(d.doc_type),
                             'documentId', d.id::text))
  on conflict (key) do nothing;

  return jsonb_build_object('rejected', true, 'documentId', d.id::text);
end $$;

comment on function public.compliance_reject_document(uuid, text) is
  '§4.1 Reject: mandatory reason, the document → rejected, push N8 "Document rejected — <reason>. Re-upload." keyed per document. Nothing else on the profile changes.';

-- ---------------------------------------------------------------------
-- 5 · A Yes criminal declaration, reviewed (§10.7, §4.3).
--
-- The outcomes are already wired on the row by
-- criminal_declaration_reviewed() (20260921192246): Verify → the ordinary
-- full re-check and N15; Reject → the block converts to a manual one with
-- the manager's reason. These two functions are the office's door onto
-- that trigger, with the reviewer stamped and the reason required.
--
-- A No is auto-verified on submission and never reaches here (§2.10); a
-- superseded declaration is a previous period's (§2.12).
-- ---------------------------------------------------------------------
create or replace function public.compliance_verify_declaration(
  p_declaration uuid,
  p_note        text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reviewer uuid := assert_reviewer();
  c          criminal_declarations;
  v_was      staff_status;
  v_now      staff_status;
begin
  select * into c from criminal_declarations where id = p_declaration for update;
  if c.id is null then
    raise exception 'declaration_not_found' using errcode = 'P0002';
  end if;
  if not c.answer or c.superseded or c.review_status <> 'pending' then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;
  select status into v_was from staff where id = c.staff_id;
  if v_was in ('rejected', 'removed') then
    raise exception 'not_reviewable: %', v_was using errcode = 'P0001';
  end if;

  update criminal_declarations
     set review_status = 'verified',
         reviewed_by = v_reviewer,
         reviewed_at = now(),
         review_note = nullif(trim(coalesce(p_note, '')), '')
   where id = c.id;

  select status into v_now from staff where id = c.staff_id;
  return jsonb_build_object(
    'verified', true,
    'declarationId', c.id::text,
    'unblocked', v_was = 'blocked' and v_now = 'compliant',
    'status', v_now::text);
end $$;

create or replace function public.compliance_reject_declaration(
  p_declaration uuid,
  p_reason      text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reviewer uuid := assert_reviewer();
  c          criminal_declarations;
  v_reason   text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  select * into c from criminal_declarations where id = p_declaration for update;
  if c.id is null then
    raise exception 'declaration_not_found' using errcode = 'P0002';
  end if;
  if not c.answer or c.superseded or c.review_status <> 'pending' then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;

  update criminal_declarations
     set review_status = 'rejected',
         reviewed_by = v_reviewer,
         reviewed_at = now(),
         review_note = v_reason
   where id = c.id;

  -- In employment: no push, by design — §10.7 "the office contacts them
  -- directly, because this is a conversation rather than a push
  -- notification". At onboarding a Yes follows the document mechanic
  -- (§2.3, §2.10), N8 included; the same key the onboarding screen's
  -- reject_declaration() writes (20260923110000), so the two doors onto
  -- one declaration can never both send.
  if c.source = 'onboarding' then
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    values ('N8:declaration:' || c.id, 'push', 'N8', c.staff_id,
            jsonb_build_object('reason', v_reason, 'document', 'Criminal Record declaration'))
    on conflict (key) do nothing;
  end if;

  return jsonb_build_object('rejected', true, 'declarationId', c.id::text);
end $$;

comment on function public.compliance_verify_declaration(uuid, text) is
  '§10.7 Verify on a pending Yes declaration: the reviewer is stamped and criminal_declaration_reviewed() runs the §4.3 re-check and N15.';
comment on function public.compliance_reject_declaration(uuid, text) is
  '§10.7 Reject, reason mandatory: the block converts to a manual block carrying the reason. No push — the office calls the worker.';

-- ---------------------------------------------------------------------
-- 6 · The Needs review tab (§4.1).
--
-- "Every profile with a document — or a Criminal Record declaration
-- answered Yes (onboarding or in-employment, §10.7) — in the under-review
-- state lands here, candidates and staff alike." Rejected candidates and
-- Removed workers drop out; a No never appears; references never queue.
--
-- One row per ITEM, not per person: the wireframe lists Hana K. three
-- times, once per thing waiting on the office, because each has its own
-- Verify and Reject.
--
-- Declaration details are in this view. It is security_invoker and
-- criminal_declarations carries admin_all plus the worker's own row only,
-- so the details reach the office and nobody else (§10.7 "visible only to
-- Admin users in the Back Office").
-- ---------------------------------------------------------------------
create or replace view compliance_review_queue_v with (security_invoker = true) as
select
  'document'::text                                           as kind,
  d.id                                                       as item_id,
  s.id                                                       as staff_id,
  s.first_name || ' ' || s.last_name                         as display_name,
  s.employee_id,
  s.status,
  s.status in ('interview_requested', 'interview_completed', 'documents', 'quiz', 'contract')
                                                             as is_candidate,
  s.block_kind,
  s.block_reason,
  s.rtw_branch,
  s.photo_path,
  d.doc_type::text                                           as item_type,
  doc_label(d.doc_type)                                      as item_label,
  d.uploaded_at                                              as submitted_at,
  d.file_path,
  d.ai_confidence,
  d.needs_manual_review,
  d.expiry_date,
  d.term_dates,
  d.right_to_work_until                                      as doc_right_to_work_until,
  d.share_code,
  d.awarding_institution,
  -- A document the worker has had rejected, or had verified and is now
  -- replacing, is a re-upload: the wireframe badges it, because the
  -- office reads a second attempt differently from a first.
  exists (select 1 from compliance_docs p
           where p.staff_id = d.staff_id and p.doc_type = d.doc_type and p.id <> d.id
             and p.review_status in ('verified', 'rejected')
             and p.uploaded_at <= d.uploaded_at)             as is_reupload,
  (select p.rejection_reason from compliance_docs p
    where p.staff_id = d.staff_id and p.doc_type = d.doc_type and p.id <> d.id
      and p.review_status = 'rejected' and p.uploaded_at <= d.uploaded_at
    order by p.uploaded_at desc limit 1)                     as previous_rejection,
  null::text                                                 as declaration_source,
  null::text                                                 as declaration_details,
  null::date                                                 as conviction_date,
  s.right_to_work_until                                      as staff_right_to_work_until
from compliance_docs d
join staff s on s.id = d.staff_id
where d.review_status = 'pending'
  and s.status not in ('rejected', 'removed')
  and s.removed_at is null
union all
select
  'declaration'::text,
  c.id,
  s.id,
  s.first_name || ' ' || s.last_name,
  s.employee_id,
  s.status,
  s.status in ('interview_requested', 'interview_completed', 'documents', 'quiz', 'contract'),
  s.block_kind,
  s.block_reason,
  s.rtw_branch,
  s.photo_path,
  'criminal_declaration'::text,
  'Criminal Record declaration'::text,
  c.declared_at,
  null::text,
  null::numeric,
  false,
  null::date,
  null::daterange[],
  null::date,
  null::text,
  null::text,
  false,
  null::text,
  c.source::text,
  c.details,
  c.conviction_date,
  s.right_to_work_until
from criminal_declarations c
join staff s on s.id = c.staff_id
where c.answer
  and c.review_status = 'pending'
  and not c.superseded
  and s.status not in ('rejected', 'removed')
  and s.removed_at is null;

comment on view compliance_review_queue_v is
  '§4.1 Needs review: every pending document and every pending Yes criminal declaration (onboarding or in-employment), candidates and staff alike, excluding Rejected and Removed profiles. A No is auto-verified and never appears. security_invoker: admin_all is the only policy that reaches another worker''s documents or declarations.';

-- ---------------------------------------------------------------------
-- 7 · The Radar tab (§4.1, §4.2).
--
-- Exactly the set compliance_daily() judges — live workers, the last
-- VERIFIED document of each type, its effective expiry, and the term
-- letter left out for a worker it no longer applies to — so the Radar can
-- never show "expired · blocking" for something the job does not block,
-- or miss something it does.
--
-- The reminders column reads the outbox rows the ladder itself wrote
-- (keys N1..N4:doc:<id>), rather than inferring them from dates: a rung
-- the job missed shows as missing.
-- ---------------------------------------------------------------------
create or replace view compliance_radar_v with (security_invoker = true) as
with today as (select (now() at time zone 'Europe/London')::date as d)
select
  s.id                                                       as staff_id,
  s.first_name || ' ' || s.last_name                         as display_name,
  s.employee_id,
  s.rtw_branch,
  s.status,
  s.block_kind,
  s.photo_path,
  v.doc_id,
  v.doc_type::text                                           as doc_type,
  doc_label(v.doc_type)                                      as doc_label,
  v.expires_on,
  (v.expires_on - today.d)                                   as days_left,
  case when v.expires_on <= today.d then 'expired'
       when v.expires_on - today.d <= 30 then 'expiring'
       else 'valid' end                                      as state,
  (select coalesce(o.sent_at, o.send_after) from notification_outbox o
    where o.key = 'N1:doc:' || v.doc_id)                     as n1_at,
  (select coalesce(o.sent_at, o.send_after) from notification_outbox o
    where o.key = 'N2:doc:' || v.doc_id)                     as n2_at,
  (select coalesce(o.sent_at, o.send_after) from notification_outbox o
    where o.key = 'N3:doc:' || v.doc_id)                     as n3_at,
  (select coalesce(o.sent_at, o.send_after) from notification_outbox o
    where o.key = 'N4:doc:' || v.doc_id)                     as n4_at,
  exists (select 1 from compliance_docs p
           where p.staff_id = s.id and p.doc_type = v.doc_type
             and p.review_status = 'pending')                as replacement_in_review
from staff s
cross join today
cross join lateral current_verified_docs(s.id) v
where s.status in ('compliant', 'blocked')
  and s.left_at is null
  and s.removed_at is null
  and v.expires_on is not null
  and (v.doc_type <> 'university_term_dates_letter' or term_letter_applies(s.id, today.d));

comment on view compliance_radar_v is
  '§4.1 Radar: every dated, verified document on a live worker, with days left, expired/expiring/valid and the N1–N4 rungs actually queued. The same set compliance_daily() blocks on, so the screen and the job cannot disagree.';

-- ---------------------------------------------------------------------
-- 8 · Privileges.
--
-- The four review functions are called by the Back Office with the
-- manager's own session, so the reviewer's identity is the session's:
-- EXECUTE to authenticated, and assert_reviewer() refuses anyone who is
-- not an admin. anon is closed by name (docs/14 O7).
-- ---------------------------------------------------------------------
revoke execute on function public.assert_reviewer() from public, anon;
revoke execute on function public.compliance_verify_document(uuid, date, daterange[], date) from public, anon;
revoke execute on function public.compliance_reject_document(uuid, text) from public, anon;
revoke execute on function public.compliance_verify_declaration(uuid, text) from public, anon;
revoke execute on function public.compliance_reject_declaration(uuid, text) from public, anon;

grant execute on function public.assert_reviewer() to authenticated, service_role;
grant execute on function public.compliance_verify_document(uuid, date, daterange[], date) to authenticated, service_role;
grant execute on function public.compliance_reject_document(uuid, text) to authenticated, service_role;
grant execute on function public.compliance_verify_declaration(uuid, text) to authenticated, service_role;
grant execute on function public.compliance_reject_declaration(uuid, text) to authenticated, service_role;

revoke all on compliance_review_queue_v from public, anon;
revoke all on compliance_radar_v from public, anon;
grant select on compliance_review_queue_v to authenticated, service_role;
grant select on compliance_radar_v to authenticated, service_role;
