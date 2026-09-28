-- =====================================================================
-- Migration 20261001208000 · onboarding_documents_missing() reads the four
--                            columns it uses, not `select *` (§2.5, §9.5)
--
-- The defect. The Back Office Onboarding board failed to load with
-- "permission denied for table staff" (28.09, the first live candidate).
-- The board reads onboarding_candidates_v with `select *`, which evaluates
-- docs_missing and quiz_blockers; both call onboarding_documents_missing(),
-- an INVOKER function (it runs under the caller's RLS) that did
-- `select * into s from staff`. `select *` needs every column, and since
-- 20260923090000 / 20260923220000 `authenticated` holds no SELECT on
-- staff.block_reason or staff.rejection_reason (both internal). So every
-- signed-in caller — the office on the board, a candidate in the Staff App
-- wizard's quiz gate — was refused as soon as a candidate row existed.
--
-- pgTAP never saw it: 380 and 595 read named view columns, and Postgres
-- does not evaluate a view column the query does not ask for.
--
-- The fix. Read exactly id, dob, rtw_branch and share_code — all granted
-- to authenticated — and nothing else changes: same body, same STABLE,
-- same search_path, same INVOKER rights. onboarding_do_accept /
-- onboarding_do_reject also `select *`, but they are reached only through
-- definer functions (onboarding_accept, onboarding_reject,
-- willo_record_event) and hold no grant of their own, so they are left.
-- pgTAP 757 reads the whole view as the office and as the candidate.
-- =====================================================================

create or replace function public.onboarding_documents_missing(p_staff uuid)
returns text[]
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  s_id         uuid;
  s_dob        date;
  s_rtw_branch rtw_branch;
  s_share_code text;
  have doc_type[];
  missing text[] := '{}';
begin
  -- Named columns only: `authenticated` may not read staff.block_reason or
  -- staff.rejection_reason, so `select *` fails under the caller's rights.
  select id, dob, rtw_branch, share_code
    into s_id, s_dob, s_rtw_branch, s_share_code
    from staff where id = p_staff;
  if s_id is null then
    return null;
  end if;

  select coalesce(array_agg(d.doc_type), '{}') into have
    from current_compliance_docs(p_staff) d;

  if s_dob is null then
    missing := missing || 'dob'::text;             -- §2.5: mandatory in every branch
  end if;

  if s_rtw_branch is null then
    missing := missing || 'rtw_branch'::text;
  else
    case s_rtw_branch
      when 'uk_irish' then
        -- passport OR birth certificate + a document showing the NI number
        if not ('passport' = any(have)) then
          if 'birth_certificate' = any(have) then
            if not ('ni_evidence' = any(have)) then
              missing := missing || 'ni_evidence'::text;
            end if;
          else
            missing := missing || 'passport'::text;
          end if;
        end if;
      when 'eu_settled' then
        if not ('passport' = any(have) or 'national_id' = any(have)) then
          missing := missing || 'passport'::text;
        end if;
      when 'work_visa' then
        if not ('passport' = any(have)) then missing := missing || 'passport'::text; end if;
        if not ('visa_document' = any(have)) then missing := missing || 'visa_document'::text; end if;
      when 'international_student' then
        if not ('passport' = any(have)) then missing := missing || 'passport'::text; end if;
        if not ('university_term_dates_letter' = any(have)) then
          missing := missing || 'university_term_dates_letter'::text;
        end if;
      when 'dependant_other' then
        if not ('passport' = any(have)) then missing := missing || 'passport'::text; end if;
        if not ('status_document' = any(have)) then missing := missing || 'status_document'::text; end if;
    end case;

    -- The share code is typed, never uploaded (§2.5), and every branch
    -- but the first carries one.
    if s_rtw_branch <> 'uk_irish' and s_share_code is null then
      missing := missing || 'share_code'::text;
    end if;
  end if;

  -- The declaration sits on the same step (4/11) and is part of the same
  -- single blocker (§2.10).
  if not exists (select 1 from criminal_declarations c
                  where c.staff_id = p_staff and not c.superseded) then
    missing := missing || 'criminal_declaration'::text;
  end if;

  return missing;
end $$;
