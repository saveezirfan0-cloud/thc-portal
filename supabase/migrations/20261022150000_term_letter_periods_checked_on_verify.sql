-- =====================================================================
-- Migration 20261022150000 · a term letter's holiday periods are checked
--                            when it is verified (ADR-0178)
--
-- The office now corrects the holiday periods on a University Term Dates
-- Letter as it verifies it — from Needs review and the /staff/:id
-- Documents tab, as the candidate screen already could. Those periods are
-- what the weekly cap is calculated from (RULE-20) and the last of them is
-- the letter's expiry (ADR-0103), so a typo is not cosmetic: 17/01/2072
-- for 17/01/2027 would give a student 48 hours a week, and a letter that
-- never runs out, for forty-five years.
--
-- What the database already refused, and still does, unchanged:
--
--   · a period that ends before it starts, or a date not on the calendar
--     — the daterange literal cannot be cast (22000 / 22008), before any
--     body runs;
--   · an empty or open-ended period — term_dates_invalid
--     (compliance_verify_document_as, 20261007130000);
--   · a letter whose every period is past — term_letter_expired.
--
-- What this adds: on the flip to verified, a term letter none of whose
-- holiday periods runs for more than a year (366 days, inclusive). No
-- holiday on a term letter is longer; a period that is longer is a typed
-- year. Raised as `term_dates_implausible` (22023), which the office's
-- screens put in words.
--
-- A trigger rather than a restated compliance_verify_document_as(): that
-- function is the one Verify path for every document (and the automated
-- gov.uk check's), the trigger sees whatever ranges the row is verified
-- with — the reviewer's or the extractor's — and nothing it already does
-- changes. It fires as the rtw-date guard does (20260923200000): on the
-- flip to verified only, so an admin data fix on a verified row and the
-- extractor's writes to a pending one are not refused. The exception rolls
-- back the staff.term_dates write the Verify made just before it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · What is wrong with a letter's periods, if anything. Null when
--     nothing is (and for no periods at all: zero is a real answer).
-- ---------------------------------------------------------------------
create or replace function public.term_letter_periods_problem(p_ranges daterange[])
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select case
    when exists (select 1 from unnest(coalesce(p_ranges, '{}')) r
                  where r is null or isempty(r) or lower_inf(r) or upper_inf(r))
      then 'term_dates_invalid'
    when exists (select 1 from unnest(coalesce(p_ranges, '{}')) r
                  where upper(r) - lower(r) > 366)
      then 'term_dates_implausible'
  end
$$;

comment on function public.term_letter_periods_problem(daterange[]) is
  'ADR-0178: why a University Term Dates Letter''s holiday periods cannot be verified — term_dates_invalid (an empty or open-ended period) or term_dates_implausible (a period longer than a year, 366 days inclusive) — or null. Mirrors termPeriodsProblem in apps/office/app/compliance/termDates.ts.';

revoke all on function public.term_letter_periods_problem(daterange[]) from public, anon;
grant execute on function public.term_letter_periods_problem(daterange[]) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2 · On the row: no term letter verified with a nonsense period.
-- ---------------------------------------------------------------------
create or replace function public.compliance_docs_term_periods_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v_problem text := term_letter_periods_problem(new.term_dates);
begin
  if v_problem = 'term_dates_implausible' then
    raise exception 'term_dates_implausible: a holiday period on this letter runs for more than a year'
      using errcode = '22023',
            hint = 'No holiday on a University Term Dates Letter is longer than a year — check the year of each date (ADR-0178).';
  elsif v_problem is not null then
    raise exception '%', v_problem using errcode = '22023';
  end if;
  return new;
end $$;

comment on function public.compliance_docs_term_periods_guard() is
  'ADR-0178: refuses the flip to verified of a University Term Dates Letter carrying a holiday period that is empty, open-ended or longer than a year (term_letter_periods_problem).';

revoke all on function public.compliance_docs_term_periods_guard() from public, anon, authenticated;

drop trigger if exists compliance_docs_term_periods_guard on compliance_docs;
create trigger compliance_docs_term_periods_guard
  before update of review_status on compliance_docs
  for each row
  when (new.doc_type = 'university_term_dates_letter'
        and new.review_status = 'verified'
        and old.review_status is distinct from 'verified')
  execute function compliance_docs_term_periods_guard();
