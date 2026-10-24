-- =====================================================================
-- Migration 20261027130000 · "Not needed — graduated" on a Term Dates
--                            Letter (ADR-0213, ticket TK-19)
--
-- A graduate needs no University Term Dates Letter (ADR-0112). When the
-- office approves their Completion Letter, approve_completion_letter()
-- supersedes a pending or rejected term letter by itself. Until then the
-- office had two bad choices for a term letter a graduate uploaded anyway:
-- Verify it (it is not evidence of anything for them) or Reject it, which
-- sends N8 asking them to upload a Term Dates Letter again — the wrong
-- document. On 24.10.2026 the office asked what to do with exactly that.
--
-- compliance_set_aside_term_letter(p_doc) is the third choice: the letter
-- leaves the review queue as superseded, with no message to the worker.
--
--   * assert_office_caller(); a viewer is refused (assert_not_read_only).
--   * Only a University Term Dates Letter, only pending or rejected —
--     a verified one stays the evidence it was.
--   * Only for someone who has told us they have graduated: a Completion
--     Letter on file (any status) whose completion date — read by the
--     office, or as the worker claimed it — is today or earlier, UK time.
--     Otherwise no_graduation (Verify or Reject as usual).
--   * Superseded, never deleted; audited as term_letter.set_aside.
--
-- What the worker sees: superseded documents are not current
-- (current_compliance_docs), so the Staff App's term letter row falls back
-- to the Completion Letter (ADR-0112, ADR-0211) — "Not needed if you've
-- graduated — upload a new Completion Letter" while that letter is
-- rejected. Nothing about the weekly cap moves: the cap reads verified
-- documents and the completion date on a verified Completion Letter.
-- =====================================================================

create or replace function public.compliance_set_aside_term_letter(p_doc uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  d       compliance_docs;
  v_today date := (now() at time zone 'Europe/London')::date;
  v_done  date;
begin
  perform assert_office_caller();
  -- ADR-0060: a viewer reads and changes nothing.
  perform assert_not_read_only();

  select * into d from compliance_docs where id = p_doc for update;
  if d.id is null then
    raise exception 'unknown_document' using errcode = 'P0001';
  end if;
  if d.doc_type <> 'university_term_dates_letter' then
    raise exception 'not_a_term_letter' using errcode = 'P0001';
  end if;
  if d.review_status not in ('pending', 'rejected') then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;

  select max(coalesce(c.completion_date, c.completion_date_claimed)) into v_done
    from compliance_docs c
   where c.staff_id = d.staff_id
     and c.doc_type = 'university_completion_letter'
     and coalesce(c.completion_date, c.completion_date_claimed) <= v_today;
  if v_done is null then
    raise exception 'no_graduation' using errcode = 'P0001';
  end if;

  update compliance_docs set review_status = 'superseded' where id = d.id;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'term_letter.set_aside', 'compliance_doc', d.id,
          jsonb_build_object('staff_id', d.staff_id, 'completed', v_done, 'was', d.review_status));

  return jsonb_build_object('ok', true, 'completed', v_done);
end $$;

comment on function public.compliance_set_aside_term_letter(uuid) is
  'ADR-0213: "Not needed — graduated". The office sets aside a pending or rejected University Term Dates Letter of someone with a Completion Letter on file dated today or earlier (read or claimed): superseded, no message to the worker, audited as term_letter.set_aside. Office logins that may write; refuses not_a_term_letter, not_pending, no_graduation.';

revoke all on function public.compliance_set_aside_term_letter(uuid) from public, anon;
grant execute on function public.compliance_set_aside_term_letter(uuid) to authenticated;
