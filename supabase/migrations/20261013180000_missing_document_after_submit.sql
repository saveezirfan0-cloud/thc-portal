-- =====================================================================
-- A document that became required after "Submit documents" can be
-- uploaded (§2.3, §2.5).
--
-- The office can correct a branch the worker picked wrongly on step 1
-- (record_right_to_work_change — e.g. Work visa → International student,
-- once the gov.uk record shows a term-time limit). The new branch can ask
-- for a document the worker was never asked for: the University Term
-- Dates Letter. The paused documents hub then shows that row as
-- "Missing" with a Re-upload button, but onboarding_attach_document()
-- took a new file after Submit only for a REJECTED document, so the
-- upload was refused with "Only a rejected document can be replaced now"
-- and the worker could go no further: onboarding_quiz_blockers() waits
-- for that very document.
--
-- Now, after Submit, a requirement with no current document takes a file
-- as a rejected one does (§2.3: upload a new one and it returns to
-- review). A document in review or verified still refuses (not_rejected)
-- — nothing stacks on a document the office is reading — and so does a
-- term letter a completion letter already answers (ADR-0112).
-- Otherwise as 20260923200000 §11.
-- =====================================================================

create or replace function public.onboarding_attach_document(
  p_doc_type  text,
  p_path      text,
  p_file_name text,
  p_file_size int,
  p_mime      text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s staff := onboarding_me();
  p onboarding_progress;
  v_type doc_type;
  v_req doc_type[];
  v_current review_status;
  v_expiry date;
  v_id uuid;
  v_check record;
begin
  if s.status <> 'documents' then
    raise exception 'wrong_stage' using errcode = 'P0001';
  end if;
  select * into p from onboarding_progress where staff_id = s.id;
  if p.rtw_at is null or s.rtw_branch is null then
    raise exception 'previous_step' using errcode = 'P0001';
  end if;

  begin
    v_type := p_doc_type::doc_type;
  exception when invalid_text_representation then
    raise exception 'doc_not_for_branch' using errcode = 'P0001';
  end;

  select r.accepts into v_req
    from onboarding_required_docs(s.rtw_branch, p.uk_doc_choice) r
   where v_type = any (r.accepts)
   limit 1;
  if v_req is null then
    -- §2.5 pt 8: exactly the branch's set, nothing further.
    raise exception 'doc_not_for_branch' using errcode = 'P0001';
  end if;

  if p_path is null or p_path not like s.id::text || '/' || v_type::text || '/%' then
    raise exception 'wrong_path' using errcode = 'P0001';
  end if;
  select * into v_check from evidence_upload_problem(s.id, v_type::text, p_path, true);
  if v_check.problem is not null then
    raise exception '%',
      case v_check.problem
        when 'invalid_path' then
          case when lower(coalesce(substring(p_path from '\.([A-Za-z0-9]+)$'), ''))
                    in ('pdf', 'jpg', 'jpeg', 'png', 'heic', 'heif')
               then 'wrong_path' else 'file_type' end
        when 'file_not_found'        then 'wrong_path'
        when 'unsupported_file_type' then 'file_type'
        else v_check.problem            -- file_empty, file_too_large
      end
      using errcode = 'P0001';
  end if;

  -- Where this requirement stands now: the latest current row of any type
  -- that satisfies it.
  select c.status into v_current
    from current_compliance_docs(s.id) c
    join compliance_docs d on d.id = c.doc_id
   where c.doc_type = any (v_req)
   order by d.uploaded_at desc
   limit 1;

  if p.documents_at is null then
    if v_current = 'verified' then
      raise exception 'already_verified' using errcode = 'P0001';
    end if;
    update compliance_docs set review_status = 'superseded'
     where staff_id = s.id and doc_type = any (v_req) and review_status = 'pending';
  else
    -- A rejected document takes a new file (§2.3, N8), and so does a
    -- requirement with none at all: one the office's branch correction
    -- added after Submit (this migration). In review or verified: no.
    -- A completion letter in review or verified answers the term letter
    -- (ADR-0112, as onboarding_submit_documents), so that requirement is
    -- not "missing".
    if (v_current is not null and v_current <> 'rejected')
       or (v_current is null
           and 'university_term_dates_letter' = any (v_req)
           and exists (select 1 from current_compliance_docs(s.id) c
                        where c.doc_type = 'university_completion_letter'
                          and c.status in ('pending', 'verified'))) then
      raise exception 'not_rejected' using errcode = 'P0001';
    end if;
    -- A rejected passport answered with a national ID (EU branch): the
    -- passport row must stop counting, or its rejection blocks for ever.
    update compliance_docs set review_status = 'superseded'
     where staff_id = s.id and doc_type = any (v_req) and doc_type <> v_type
       and review_status in ('pending', 'rejected');
  end if;

  -- Pre-filled expiries. The term letter's is the 31 December fallback
  -- until its dates are read (doc_expires_on, ADR-0103); a visa or status
  -- document starts from what the worker typed on step 1, for the AI and
  -- then the office to confirm.
  v_expiry := case
    when v_type = 'university_term_dates_letter'
      then doc_expires_on(v_type, null, null, null, now())
    when v_type in ('visa_document', 'status_document') then p.visa_expiry
    else null
  end;

  -- clock_timestamp(), not now(): "the latest upload" is how
  -- current_compliance_docs() tells a re-upload from the row it replaces,
  -- and two statements in one transaction share now().
  insert into compliance_docs (staff_id, doc_type, file_path, file_name, size_bytes, mime_type,
                               expiry_date, needs_manual_review, review_status, uploaded_at)
  values (s.id, v_type, p_path, left(coalesce(nullif(btrim(p_file_name), ''), 'upload'), 200),
          v_check.size_bytes, v_check.mime, v_expiry, true, 'pending', clock_timestamp())
  returning id into v_id;

  return jsonb_build_object('ok', true, 'docId', v_id, 'docType', v_type::text,
                            'expiryDate', v_expiry);
end $$;

comment on function public.onboarding_attach_document(text, text, text, int, text) is
  '§2.5 pt 7 step 4 upload, as the worker: the branch''s set only, into <staff_id>/<doc_type>/, judged on the Storage object itself (evidence_upload_problem, PDF/JPG/PNG/HEIC up to 10 MB) — p_file_size and p_mime are ignored. After Submit, only a requirement whose document was rejected, or which has none (a branch the office corrected), takes a new file (20261013180000).';
