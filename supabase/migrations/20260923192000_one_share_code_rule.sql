-- =====================================================================
-- One share-code rule (§2.5, corrected 31.07.2026)
--
-- The wizard (20260923120000) and the Documents hub (20260923150000) were
-- built in parallel and each wrote a share-code check: the wizard's
-- is_valid_share_code() requires the leading W §2.5 gives; the hub's
-- inline regex took any nine letters and digits. A re-upload now goes
-- through the same function as onboarding. Only those two lines differ
-- from 20260923150000; replacing the function keeps its grant.
-- =====================================================================

create or replace function public.submit_document_upload(
  p_doc_type   text,
  p_file_path  text default null,
  p_share_code text default null,
  p_staff      uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_me     uuid := staff_caller(p_staff);
  s        staff;
  v_type   doc_type;
  v_folder text;
  v_code   text;
  v_check  record;
  v_mime   text;
  v_size   bigint;
  v_doc    uuid;
begin
  if v_me is null then
    raise exception 'not_a_worker' using errcode = '42501';
  end if;
  select * into s from staff where id = v_me for update;
  if s.removed_at is not null
     or s.status not in ('compliant', 'blocked')
     or (s.status = 'blocked' and s.block_kind = 'manual') then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible');
  end if;

  if p_doc_type is null
     or not exists (select 1 from unnest(enum_range(null::doc_type)) t where t::text = p_doc_type) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_doc_type');
  end if;
  v_type := p_doc_type::doc_type;

  -- The completion letter has its own RPC, because the requirement makes
  -- the worker state its form and course completion date (§2.1).
  if v_type = 'university_completion_letter' then
    return jsonb_build_object('ok', false, 'reason', 'use_completion_letter');
  end if;

  if not exists (select 1 from current_compliance_docs(v_me) c where c.doc_type = v_type)
     and not (v_type::text = any(coalesce(onboarding_documents_missing(v_me), '{}'::text[])))
     and not (v_type = 'share_code_report'
              and s.rtw_branch is not null and s.rtw_branch <> 'uk_irish') then
    return jsonb_build_object('ok', false, 'reason', 'not_required');
  end if;

  if exists (select 1 from compliance_docs d
              where d.staff_id = v_me and d.doc_type = v_type and d.review_status = 'pending') then
    return jsonb_build_object('ok', false, 'reason', 'already_pending');
  end if;

  if v_type = 'share_code_report' then
    -- A share code is typed (§2.5): nine letters and digits starting with
    -- W, shown by gov.uk in threes — the wizard's is_valid_share_code(). The office fetches the report against it; a file
    -- is optional here.
    v_code := normalise_share_code(p_share_code);
    if not is_valid_share_code(v_code) then
      return jsonb_build_object('ok', false, 'reason', 'share_code_invalid');
    end if;
  elsif p_file_path is null then
    return jsonb_build_object('ok', false, 'reason', 'file_required');
  end if;

  if p_file_path is not null then
    v_folder := replace(v_type::text, '_', '-');
    select * into v_check from evidence_upload_problem(v_me, v_folder, p_file_path);
    if v_check.problem is not null then
      return jsonb_build_object('ok', false, 'reason', v_check.problem);
    end if;
    v_mime := v_check.mime;
    v_size := v_check.size_bytes;
    -- One object, one row. A replayed path would put the same scan in
    -- front of the office twice under two ids.
    if exists (select 1 from compliance_docs d where d.file_path = p_file_path) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_path');
    end if;
  end if;

  insert into compliance_docs (staff_id, doc_type, file_path, review_status,
                               share_code, mime_type, size_bytes)
  values (v_me, v_type, p_file_path, 'pending',
          v_code, v_mime, v_size)
  returning id into v_doc;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'document.uploaded', 'compliance_docs', v_doc,
          jsonb_strip_nulls(jsonb_build_object(
            'staffId',  v_me,
            'docType',  v_type::text,
            'filePath', p_file_path,
            'source',   'staff_app')));

  return jsonb_build_object('ok', true, 'documentId', v_doc::text, 'status', 'pending');
end $$;
