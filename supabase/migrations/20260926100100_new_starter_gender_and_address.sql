-- =====================================================================
-- The New Starter (HMRC) report's Gender, Postcode and Country are
-- collected (§2.8, §9.9 Tab 3; ADR-0024; docs/14 §4)
--
-- 20260923130000 added staff.gender / home_postcode / home_country for the
-- report and said "Null until onboarding collects it". Nothing did.
--
-- §9.9 Tab 3's columns, confirmed by THC 28.07.2026, are: Staff ·
-- Employee ID · NI Number · Home address · Postcode · Country · Date of
-- birth · Gender (M/F) · First shift date · HMRC Statement (A/B/C) ·
-- Student Loan. So the scope DOES ask for gender, as HMRC's own two
-- values, and the report's CHECK (staff_gender_m_or_f) already holds it to
-- them.
--
--   1. GENDER is asked on step 7 (the HMRC New Starter Checklist), the
--      step whose data the report exports (§2.8). A new overload of
--      submit_hmrc_checklist takes p_gender; the 7-argument function is
--      untouched (same name, same arguments, same defaults) and does all
--      the work — the overload validates the gender, calls it, and writes
--      staff.gender in the same transaction. PostgREST picks the overload
--      by the argument names the app sends.
--   2. POSTCODE and COUNTRY follow the home address, whoever writes it:
--      the wizard's step 2 (onboarding_save_address, which only accepts a
--      UK postcode) and the worker's later edit on Profile
--      (staff_update_contact, free text). A trigger re-derives both on
--      every change to home_address, so the report can never carry the
--      postcode of an address the worker has since left. Country is
--      "United Kingdom" exactly when a UK postcode ends the address, and
--      blank otherwise — never guessed from anything weaker.
--   3. Backfill for rows already on file.
--
-- §1.7: staff_wipe_report_fields (20260923130000) still nulls all three on
-- removal; removal also nulls home_address, which this trigger follows.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · Gender on step 7
-- ---------------------------------------------------------------------
create or replace function public.submit_hmrc_checklist(
  p_q1_other_job   boolean,
  p_q2_pension     boolean,
  p_q3_since_april boolean,
  p_student_loan   text,
  p_postgraduate   boolean,
  p_ni_number      text,
  p_declared       boolean,
  p_gender         text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s        staff := onboarding_me();
  v_gender text := upper(btrim(coalesce(p_gender, '')));
  v_out    jsonb;
begin
  -- HMRC's payroll record takes M or F only (RTI FPS "Gender").
  v_gender := case v_gender when 'MALE' then 'M' when 'FEMALE' then 'F' else v_gender end;
  if v_gender not in ('M', 'F') then
    raise exception 'gender_required' using errcode = 'P0001';
  end if;

  -- Every other rule, the stage check and the write are the 7-argument
  -- function's; if it refuses, nothing below runs.
  v_out := public.submit_hmrc_checklist(p_q1_other_job, p_q2_pension, p_q3_since_april,
                                        p_student_loan, p_postgraduate, p_ni_number, p_declared);

  update staff set gender = v_gender where id = s.id;
  return v_out;
end $$;

comment on function public.submit_hmrc_checklist(boolean, boolean, boolean, text, boolean, text, boolean, text) is
  '§2.8 + §9.9 Tab 3: the HMRC New Starter Checklist with the gender HMRC''s payroll record needs (M or F). Delegates everything else to the 7-argument submit_hmrc_checklist and writes staff.gender in the same transaction.';

revoke execute on function public.submit_hmrc_checklist(boolean, boolean, boolean, text, boolean, text, boolean, text) from public, anon;
grant  execute on function public.submit_hmrc_checklist(boolean, boolean, boolean, text, boolean, text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2 · Postcode and country follow the home address
-- ---------------------------------------------------------------------
create or replace function public.staff_sync_report_address()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if tg_op = 'UPDATE' then
    if new.home_address is not distinct from old.home_address then
      return new;
    end if;
    -- A writer that sets the postcode itself in the same statement wins.
    if new.home_postcode is distinct from old.home_postcode then
      return new;
    end if;
  elsif new.home_postcode is not null then
    return new;
  end if;

  new.home_postcode := new_starter_postcode(new.home_address);
  new.home_country := case when new.home_postcode is not null then 'United Kingdom' end;
  return new;
end $$;

revoke execute on function public.staff_sync_report_address() from public, anon, authenticated;

drop trigger if exists staff_sync_report_address on staff;
create trigger staff_sync_report_address
  before insert or update of home_address on staff
  for each row execute function public.staff_sync_report_address();

comment on column staff.home_postcode is
  'HMRC New Starter report (§9.9 Tab 3). Derived from home_address on every change to it (staff_sync_report_address), so it follows a Profile edit; null when the address does not end in a UK postcode.';
comment on column staff.home_country is
  'HMRC New Starter report (§9.9 Tab 3). "United Kingdom" when home_address ends in a UK postcode (the wizard accepts nothing else), otherwise null — never a guessed country.';
comment on column staff.gender is
  'HMRC New Starter report only (§9.9 Tab 3): M or F, as HMRC''s payroll record takes it. Asked on onboarding step 7 (submit_hmrc_checklist, 8 arguments). Null for anyone onboarded before 26.09.2026.';

-- ---------------------------------------------------------------------
-- 3 · Backfill
-- ---------------------------------------------------------------------
update staff
   set home_postcode = new_starter_postcode(home_address),
       home_country  = 'United Kingdom'
 where removed_at is null
   and home_postcode is null
   and new_starter_postcode(home_address) is not null;
