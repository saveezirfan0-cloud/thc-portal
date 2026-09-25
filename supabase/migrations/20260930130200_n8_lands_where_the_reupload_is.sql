-- =====================================================================
-- Migration 20260930130200 · N8 lands where the Re-upload is (audit D42;
-- §2.3, §4.1, §8 N8, §10.1)
--
-- N8 "Document rejected — [reason]. Re-upload." carried the register's
-- one deep link, /documents. A CANDIDATE has no Documents hub — the app
-- is locked to onboarding until they are compliant (§10.1) — so a
-- rejected candidate tapped the push onto a locked page, with nowhere to
-- re-upload. A WORKER's re-upload is on /documents.
--
-- The payload now says which: `link` is /onboarding for a candidate
-- (interview_requested … contract) and /documents for everyone else, and
-- the register (packages/notifications, N8) accepts exactly those two.
-- `documentId` is the item the push is about — the document, or the
-- declaration for a rejected onboarding Yes — and the push is tagged by
-- it, so a second rejection of the same document replaces the first on
-- the lock screen while two different documents stay two notifications.
-- The copy is §8's, unchanged.
--
-- The two functions that queue N8 are restated from their latest
-- definitions with only the payload changed:
--   compliance_reject_document_as()   20260928100000 (the office's Reject
--                                     and the automated gov.uk check's)
--   compliance_reject_declaration()   20260923100000
-- The onboarding screen's reject_document() / reject_declaration() wrap
-- these (20260923200000), so every N8 goes through here.
-- =====================================================================

-- Where a rejected item is re-uploaded, for the staff member as they are
-- now. Candidates re-upload in the onboarding wizard; everyone else on the
-- Documents hub.
create or replace function public.n8_link(p_status staff_status)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select case when p_status in ('interview_requested', 'interview_completed',
                                'documents', 'quiz', 'contract')
              then '/onboarding' else '/documents' end
$$;

comment on function public.n8_link(staff_status) is
  'N8''s deep link (D42): /onboarding for a candidate, whose app is locked to the wizard, /documents for a worker. Mirrors the deepLinkOptions of N8 in packages/notifications (templates.ts).';

revoke execute on function public.n8_link(staff_status) from public, anon;
grant  execute on function public.n8_link(staff_status) to authenticated, service_role;

create or replace function public.compliance_reject_document_as(
  p_reviewer uuid,
  p_doc      uuid,
  p_reason   text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reviewer uuid := p_reviewer;
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

  -- As on Verify: a person's decision answers a check waiting on them.
  if v_reviewer is not null then
    update rtw_checks
       set reviewed_at = now(), reviewed_by = v_reviewer
     where compliance_doc_id = d.id and status = 'needs_review' and reviewed_at is null;
  end if;

  insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
  values ('N8:doc:' || d.id, 'push', 'N8', d.staff_id,
          jsonb_build_object('reason', v_reason,
                             'document', doc_label(d.doc_type),
                             'documentId', d.id::text,
                             'link', n8_link(s.status)))
  on conflict (key) do nothing;

  return jsonb_build_object('rejected', true, 'documentId', d.id::text);
end $$;

comment on function public.compliance_reject_document_as(uuid, uuid, text) is
  'The body of §4.1 Reject with the reviewer passed in (NULL = the automated gov.uk check). Mandatory reason, the document → rejected, N8 keyed per document, landing on /onboarding for a candidate and /documents for a worker (D42). Internal (ADR-0025).';

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

  -- In employment: no push, by design (§10.7). At onboarding a Yes
  -- follows the document mechanic, N8 included, landing in the wizard.
  if c.source = 'onboarding' then
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    values ('N8:declaration:' || c.id, 'push', 'N8', c.staff_id,
            jsonb_build_object('reason', v_reason,
                               'document', 'Criminal Record declaration',
                               'documentId', c.id::text,
                               'link', n8_link((select s.status from staff s where s.id = c.staff_id))))
    on conflict (key) do nothing;
  end if;

  return jsonb_build_object('rejected', true, 'declarationId', c.id::text);
end $$;

comment on function public.compliance_reject_declaration(uuid, text) is
  '§10.7 Reject, reason mandatory: the block converts to a manual block carrying the reason. No push for an in-employment declaration — the office calls the worker; an onboarding Yes gets N8, landing in the wizard (D42).';
