-- =====================================================================
-- Migration 20261027150000 · A Completion Letter for a finished course sets
--                            the Term Dates Letter aside (ADR-0215, TK-23)
--
-- A student could upload both a Term Dates Letter and a Completion Letter
-- during onboarding, and the office then had both to review (TK-23). The
-- two are alternatives (ADR-0112): once a student files a Completion Letter
-- whose completion date has passed, their pending or rejected Term Dates
-- Letter is superseded at once, as approve_completion_letter() already does
-- on approval and compliance_set_aside_term_letter() (ADR-0213) does by
-- hand. A future completion date changes nothing. 20260927161100's body
-- otherwise unchanged.
-- =====================================================================

create or replace function public.submit_completion_letter(
  p_file_path            text,
  p_completion_date      date,
  p_evidence_form        text,
  p_awarding_institution text default null,
  p_staff                uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_me    uuid := staff_writer(p_staff);
  s       staff;
  v_check record;
  v_doc   uuid;
  v_today date := (now() at time zone 'Europe/London')::date;
begin
  if v_me is null then
    raise exception 'not_a_worker' using errcode = '42501';
  end if;
  select * into s from staff where id = v_me for update;
  if s.status in ('rejected', 'removed', 'inactive') or s.removed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible');
  end if;
  -- §2.1: "Any worker whose visa type is Student / Tier 4".
  if s.rtw_branch is distinct from 'international_student' then
    return jsonb_build_object('ok', false, 'reason', 'not_student_visa');
  end if;
  if p_evidence_form is null
     or p_evidence_form not in ('letter', 'transcript', 'university_email') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_form');
  end if;
  -- §2.1: "the worker must enter … the course completion date stated on
  -- the document". A date in the future is allowed — a letter issued
  -- before the final exam (§7) — and simply lifts nothing until it passes.
  if p_completion_date is null then
    return jsonb_build_object('ok', false, 'reason', 'completion_date_required');
  end if;
  if p_completion_date < date '2000-01-01' or p_completion_date > v_today + interval '5 years' then
    return jsonb_build_object('ok', false, 'reason', 'completion_date_implausible');
  end if;

  select * into v_check from evidence_upload_problem(v_me, 'completion-letter', p_file_path);
  if v_check.problem is not null then
    return jsonb_build_object('ok', false, 'reason', v_check.problem);
  end if;

  if exists (select 1 from compliance_docs d
              where d.staff_id = v_me
                and d.doc_type = 'university_completion_letter'
                and d.review_status = 'pending') then
    return jsonb_build_object('ok', false, 'reason', 'already_pending');
  end if;

  insert into compliance_docs (staff_id, doc_type, file_path, review_status,
                               evidence_form, completion_date_claimed,
                               awarding_institution, mime_type, size_bytes)
  values (v_me, 'university_completion_letter', p_file_path, 'pending',
          p_evidence_form, p_completion_date,
          nullif(trim(coalesce(p_awarding_institution, '')), ''),
          v_check.mime, v_check.size_bytes)
  returning id into v_doc;

  -- ADR-0215 (TK-23): a candidate or worker who files a Completion Letter
  -- for a course that has already finished has graduated, so a Term Dates
  -- Letter of theirs still waiting for review (or rejected) is set aside —
  -- the office never has both in front of it. A verified term letter stays
  -- the evidence it was, and a completion date still to come (a letter
  -- issued before the final exam, §7) leaves the term letter in force.
  -- Nothing is sent: the worker chose the Completion Letter.
  if p_completion_date <= v_today then
    with set_aside as (
      update compliance_docs t
         set review_status = 'superseded'
       where t.staff_id = v_me
         and t.doc_type = 'university_term_dates_letter'
         and t.review_status in ('pending', 'rejected')
      returning t.id, t.review_status
    )
    insert into audit_log (actor, action, entity, entity_id, data)
    select auth.uid(), 'term_letter.set_aside', 'compliance_doc', a.id,
           jsonb_build_object('staff_id', v_me, 'completed', p_completion_date,
                              'by', 'completion_letter_upload', 'completion_letter', v_doc)
      from set_aside a;
  end if;

  -- §5 · worker: upload received. admin: awaiting review.
  insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
  values ('CL1:doc:' || v_doc, 'push', 'CL1', v_me,
          jsonb_build_object('documentId', v_doc::text))
  on conflict (key) do nothing;

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values ('CL3:doc:' || v_doc, 'email', 'CL3',
          array['admin@thehospitalitycompany.co.uk'],
          jsonb_build_object(
            'name',           s.first_name || ' ' || s.last_name,
            'employeeId',     coalesce(s.employee_id::text, '(not yet issued)'),
            'uploadedAt',     to_char(now() at time zone 'Europe/London', 'DD Mon YYYY HH24:MI'),
            'form',           case p_evidence_form
                                when 'letter' then 'Official university completion letter'
                                when 'transcript' then 'Final / completers transcript'
                                else 'Official university email' end,
            'completionDate', to_char(p_completion_date, 'DD Mon YYYY')))
  on conflict (key) do nothing;

  return jsonb_build_object('ok', true, 'documentId', v_doc::text, 'status', 'pending');
end $$;
