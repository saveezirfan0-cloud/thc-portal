-- =====================================================================
-- Migration 20260923120200 · The onboarding wizard, steps 7–11
--                            (§10.3, §2.8, §2.10, §2.11, §2.7, §1.8)
--
--   7/11  HMRC New Starter Checklist — three sequential Yes/No questions
--         from which the database derives statement A/B/C; the worker
--         never sees the letter. Student loan + a separate Postgraduate
--         tick. NI optional, masked and locked once entered (E6). The
--         declaration tick is mandatory. No P45, anywhere.
--   8/11  Two references — mandatory, no relatives, phone AND email, not
--         verified by anyone.
--   9/11  Bank & payroll — staff_save_bank() (E5), recorded as the step.
--  10/11  Contract — the versioned zero-hours agreement; ticking "I agree"
--         IS the signature and its timestamp is the record, shown in UK
--         time only (§1.8 audit). Signing makes the candidate `compliant`;
--         staff_status_guard (B5, 20260923110000) issues the Employee ID
--         at that moment, once — a worker reset and re-onboarded keeps
--         theirs (§2.7, §2.12).
--  11/11  How it works — a tutorial and "Open app".
--
-- All four of 7–10 happen in the `contract` stage (the quiz pass moves
-- the candidate there, 20260923120100). The Back Office kanban's
-- "Additional info" column is that stage with the checklist, references
-- or bank still outstanding (ADR-0013, B5); the §2.12 machine has no
-- additional_info edge and this does not add one.
--
-- PLACEHOLDER CONTENT. The agreement text below is the wireframe's draft
-- (wireframes/staff/onboarding-3.html), marked is_placeholder. THC's
-- zero-hours agreement is an Appendix B input we do not hold; publishing
-- it is an insert of a new version, which the table's CHECK holds to the
-- §2.11 duty to disclose convictions.
--
-- Forward-only.
-- =====================================================================

insert into contract_versions (version, title, body, published_at, is_placeholder)
values (
  'placeholder-2026-09',
  'Casual worker agreement — The Hospitality Company Ltd',
  E'1. Status. This is a zero-hours agreement. The Company is under no obligation to offer you work and you are under no obligation to accept any work offered. Each assignment you accept is a separate engagement.\n\n'
  '2. Pay. You are paid at the base hourly rate shown for each shift, calculated on the payable time recorded through the app (check-in to check-out within the scheduled shift, less unpaid breaks where the client does not pay for breaks). Holiday pay is accrued and paid in accordance with the Working Time Regulations. Pay is made on the Friday following the Mon–Sun week worked.\n\n'
  '3. Confirmations and attendance. You agree to confirm each accepted shift the day before by 12:00, to check in and out on site using the app, and that a confirmed shift not re-confirmed by that deadline may be reallocated.\n\n'
  '4. Right to work. You confirm the right-to-work information and documents you have supplied are true and complete, and you will supply renewed documents before they expire.\n\n'
  '5. Ongoing duty to disclose convictions. You confirm that the criminal-conviction declaration you made during onboarding is accurate, and you undertake to declare any unspent criminal conviction that arises during your engagement, as soon as reasonably practicable, using the "Declare a criminal conviction" route in the app. The Company may pause your assignments while such a declaration is reviewed.\n\n'
  '6. Conduct on site. You will follow the client''s reasonable instructions, the dress code for the shift and the Health & Safety induction you have completed.\n\n'
  '7. Data. Your personal data, including your location while checked in to a shift, is processed as described in the Privacy Notice.\n\n'
  '8. Ending the agreement. Either party may end this agreement at any time; you may do so from the app ("Request my P45").',
  timestamptz '2026-09-01 00:00:00+01',
  true
)
on conflict (version) do nothing;

-- ---------------------------------------------------------------------
-- Shared rules (packages/domain: hmrc.ts deriveStatement, onboarding.ts
-- looksLikeRelative — onboarding.sql.test.ts holds the literals)
-- ---------------------------------------------------------------------

-- §2.8, HMRC questions 8–10. Answers to questions that are not asked are
-- ignored rather than read.
create or replace function public.hmrc_statement_for(p_q1 boolean, p_q2 boolean, p_q3 boolean)
returns hmrc_statement
language sql
immutable
set search_path = public, extensions
as $$
  select case
    when p_q1 is null then null
    when p_q1 then 'C'
    when p_q2 is null then null
    when p_q2 then 'C'
    when p_q3 is null then null
    when p_q3 then 'B'
    else 'A'
  end::hmrc_statement
$$;

-- §2.10 "No relatives." Whole words, so "Motherwell FC coach" passes.
create or replace function public.looks_like_relative(p text)
returns boolean
language sql
immutable
set search_path = public, extensions
as $$
  select replace(lower(coalesce(p, '')), 'step-', 'step')
         ~ '(^|[^a-z])(mother|mum|mom|mummy|father|dad|daddy|parent|parents|brother|sister|sibling|son|daughter|child|aunt|auntie|aunty|uncle|cousin|niece|nephew|grandmother|grandfather|grandma|grandpa|granny|grandad|granddad|grandparent|grandson|granddaughter|stepmother|stepfather|stepbrother|stepsister|stepson|stepdaughter|stepmum|stepdad|husband|wife|spouse|fiance|fiancee|fiancé|fiancée|relative|relation|in-law)([^a-z]|$)'
$$;

-- The contract stage, before the signature: where steps 7–10 are open.
create or replace function public.onboarding_assert_contract_stage(s staff)
returns void
language plpgsql
stable
set search_path = public, extensions
as $$
begin
  if s.status <> 'contract' or s.contract_signed_at is not null then
    raise exception 'wrong_stage' using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Step 7 — HMRC New Starter Checklist (§2.8)
--
-- Named as 0004's note on hmrc_checklists asks: the table is admin-only
-- because the derived letter is on the row, and this is the definer door.
-- ---------------------------------------------------------------------
create or replace function public.submit_hmrc_checklist(
  p_q1_other_job   boolean,
  p_q2_pension     boolean,
  p_q3_since_april boolean,
  p_student_loan   text,
  p_postgraduate   boolean,
  p_ni_number      text,
  p_declared       boolean
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s staff := onboarding_me();
  v_q2 boolean;
  v_q3 boolean;
  v_statement hmrc_statement;
  v_loan student_loan_plan;
  v_ni text := upper(regexp_replace(coalesce(p_ni_number, ''), '\s', '', 'g'));
  v_masked text;
begin
  perform onboarding_assert_contract_stage(s);

  if p_q1_other_job is null then
    raise exception 'answer_required' using errcode = 'P0001';
  end if;
  -- Q2 only if Q1 = No; Q3 only if Q1 = No and Q2 = No. A hidden answer
  -- is stored as null, never as whatever the form last held.
  v_q2 := case when not p_q1_other_job then p_q2_pension end;
  v_q3 := case when not p_q1_other_job and v_q2 is false then p_q3_since_april end;
  v_statement := hmrc_statement_for(p_q1_other_job, v_q2, v_q3);
  if v_statement is null then
    raise exception 'answer_required' using errcode = 'P0001';
  end if;

  begin
    v_loan := coalesce(p_student_loan, '')::student_loan_plan;
  exception when invalid_text_representation then
    raise exception 'bad_student_loan' using errcode = 'P0001';
  end;

  if p_declared is not true then
    raise exception 'declaration_required' using errcode = 'P0001';
  end if;

  -- NI: optional, and once on file it is locked (§2.8). Entering it the
  -- first time goes through staff_set_ni_number(), which validates it and
  -- queues E6 (§2.10) — one door for that rule, not two.
  if v_ni <> '' then
    if s.ni_number is null then
      select r->>'niMasked' into v_masked from staff_set_ni_number(v_ni) r;
    elsif s.ni_number <> v_ni then
      raise exception 'ni_locked' using errcode = 'P0001';
    end if;
  end if;

  insert into hmrc_checklists (staff_id, q1_other_job, q2_pension, q3_since_6_april, statement,
                               student_loan, postgraduate_loan, declared, submitted_at)
  values (s.id, p_q1_other_job, v_q2, v_q3, v_statement, v_loan, coalesce(p_postgraduate, false),
          true, now())
  on conflict (staff_id) where not superseded do update
    set q1_other_job      = excluded.q1_other_job,
        q2_pension        = excluded.q2_pension,
        q3_since_6_april  = excluded.q3_since_6_april,
        statement         = excluded.statement,
        student_loan      = excluded.student_loan,
        postgraduate_loan = excluded.postgraduate_loan,
        declared          = excluded.declared,
        submitted_at      = excluded.submitted_at;

  insert into onboarding_progress (staff_id, hmrc_at, updated_at)
  values (s.id, now(), now())
  on conflict (staff_id) do update set hmrc_at = excluded.hmrc_at, updated_at = excluded.updated_at;

  -- Deliberately NOT returned: the statement. "The worker never sees the
  -- resulting letter" (§2.8).
  return jsonb_build_object('ok', true,
    'niMasked', coalesce(v_masked,
                         case when s.ni_number is not null
                              then repeat('●', greatest(length(s.ni_number) - 2, 0)) || right(s.ni_number, 2) end));
end $$;

comment on function public.submit_hmrc_checklist(boolean, boolean, boolean, text, boolean, text, boolean) is
  '§2.8 HMRC New Starter Checklist for the caller. Derives A/B/C from the three questions and never returns it; NI set-once through staff_set_ni_number() (E6); declaration mandatory.';

-- ---------------------------------------------------------------------
-- Step 8 — Two references (§2.10)
--
-- p_referees: [{"name","relationship","phone","email"}, {…}]. Exactly
-- two, both complete, not relatives, not the same person twice. Replaces
-- what was there: a reference is supporting information, not evidence,
-- and the step is being answered again.
-- ---------------------------------------------------------------------
create or replace function public.onboarding_save_references(p_referees jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s staff := onboarding_me();
  r jsonb;
  v_name text; v_rel text; v_phone text; v_email text;
  v_emails text[] := '{}';
begin
  perform onboarding_assert_contract_stage(s);
  if (select hmrc_at from onboarding_progress where staff_id = s.id) is null then
    raise exception 'previous_step' using errcode = 'P0001';
  end if;
  if p_referees is null or jsonb_typeof(p_referees) <> 'array' or jsonb_array_length(p_referees) <> 2 then
    raise exception 'two_references_required' using errcode = 'P0001';
  end if;

  for r in select * from jsonb_array_elements(p_referees) loop
    v_name  := nullif(btrim(r->>'name'), '');
    v_rel   := nullif(btrim(r->>'relationship'), '');
    v_phone := nullif(btrim(r->>'phone'), '');
    v_email := lower(nullif(btrim(r->>'email'), ''));
    if v_name is null or v_rel is null or v_phone is null or v_email is null then
      -- "both phone and email are mandatory, not either/or"
      raise exception 'reference_incomplete' using errcode = 'P0001';
    end if;
    if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
      raise exception 'bad_reference_email' using errcode = 'P0001';
    end if;
    if regexp_replace(regexp_replace(v_phone, '[\s\-()]', '', 'g'), '^\+', '') !~ '^[0-9]{7,15}$' then
      raise exception 'bad_reference_phone' using errcode = 'P0001';
    end if;
    if looks_like_relative(v_rel) then
      raise exception 'reference_is_relative' using errcode = 'P0001';
    end if;
    if v_email = any (v_emails) then
      raise exception 'same_referee_twice' using errcode = 'P0001';
    end if;
    v_emails := v_emails || v_email;
  end loop;

  delete from staff_references where staff_id = s.id;
  insert into staff_references (staff_id, name, relationship, phone, email)
  select s.id, btrim(e->>'name'), btrim(e->>'relationship'), btrim(e->>'phone'), btrim(e->>'email')
    from jsonb_array_elements(p_referees) e;

  update onboarding_progress set references_at = now(), updated_at = now() where staff_id = s.id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- Step 9 — Bank & payroll (§2.10)
--
-- The save and its E5 are staff_save_bank()'s (20260922180000), the same
-- door the profile uses later: "the same E5 notification as at
-- onboarding". This adds the stage check and records the step.
-- ---------------------------------------------------------------------
create or replace function public.onboarding_save_bank(
  p_account_holder text,
  p_sort_code      text,
  p_account_number text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s staff := onboarding_me();
begin
  perform onboarding_assert_contract_stage(s);
  if (select references_at from onboarding_progress where staff_id = s.id) is null then
    raise exception 'previous_step' using errcode = 'P0001';
  end if;
  perform staff_save_bank(p_account_holder, p_sort_code, p_account_number);
  update onboarding_progress set bank_at = now(), updated_at = now() where staff_id = s.id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- Step 10 — the signature (§2.11, §2.7, §2.12, §1.8)
--
-- p_version is the version the worker was SHOWN. If a new version was
-- published while they were reading, the signature is refused rather
-- than attached to text they never saw.
--
-- The stamp returned is UK time and only UK time: an audit record "must
-- read identically to everyone who opens that file" (§1.8).
-- ---------------------------------------------------------------------
create or replace function public.sign_contract(p_version text, p_agree boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s staff := onboarding_me();
  p onboarding_progress;
  v_current text := current_contract_version();
  v_now timestamptz := now();
  v_employee int;
begin
  perform onboarding_assert_contract_stage(s);
  select * into p from onboarding_progress where staff_id = s.id;
  if p.hmrc_at is null or p.references_at is null or p.bank_at is null then
    raise exception 'previous_step' using errcode = 'P0001';
  end if;
  if p_agree is not true then
    raise exception 'agreement_required' using errcode = 'P0001';
  end if;
  if v_current is null then
    raise exception 'contract_not_configured' using errcode = 'P0001';
  end if;
  if p_version is distinct from v_current then
    raise exception 'contract_version_changed' using errcode = 'P0001';
  end if;

  -- contract → compliant, with the signature in the SAME update: that is
  -- the evidence staff_status_guard (B5) requires for this move, and the
  -- guard is what issues the Employee ID at this exact moment (§2.7) —
  -- or keeps the one a returning worker already has (§2.12 point 2).
  perform assert_staff_transition(s.status, 'compliant'::staff_status);
  update staff
     set status = 'compliant',
         contract_signed_at = v_now,
         contract_version = v_current
   where id = s.id
  returning employee_id into v_employee;

  update onboarding_progress set contract_at = v_now, updated_at = v_now where staff_id = s.id;

  -- The signature's permanent record. staff.contract_signed_at is cleared
  -- by Reset to candidate (§2.12 point 3); this is what survives it.
  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (v_now, auth.uid(), 'contract_signed', 'staff', s.id,
          jsonb_build_object('version', v_current, 'employeeId', v_employee,
                             'signedAtUk', to_char(v_now at time zone 'Europe/London',
                                                   'DD.MM.YYYY HH24:MI')));

  return jsonb_build_object(
    'ok',         true,
    'signedAt',   v_now,
    'stamp',      to_char(v_now at time zone 'Europe/London', 'DD.MM.YYYY HH24:MI') || ' UK time',
    'version',    v_current,
    'employeeId', v_employee);
end $$;

comment on function public.sign_contract(text, boolean) is
  '§2.11: "I agree" = the signature. Refuses a version other than the one shown; on success the candidate becomes compliant and the Employee ID is generated once (§2.7). Audit stamp in UK time only (§1.8).';

-- ---------------------------------------------------------------------
-- Step 11 — How it works, then "Open app"
-- ---------------------------------------------------------------------
create or replace function public.onboarding_finish_tutorial()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s staff := onboarding_me();
begin
  if s.status <> 'compliant' or s.contract_signed_at is null then
    raise exception 'wrong_stage' using errcode = 'P0001';
  end if;
  insert into onboarding_progress (staff_id, tutorial_at, updated_at)
  values (s.id, now(), now())
  on conflict (staff_id) do update
    set tutorial_at = coalesce(onboarding_progress.tutorial_at, excluded.tutorial_at),
        updated_at = excluded.updated_at;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke execute on function public.submit_hmrc_checklist(boolean, boolean, boolean, text, boolean, text, boolean) from public, anon;
revoke execute on function public.onboarding_save_references(jsonb)            from public, anon;
revoke execute on function public.onboarding_save_bank(text, text, text)       from public, anon;
revoke execute on function public.sign_contract(text, boolean)                 from public, anon;
revoke execute on function public.onboarding_finish_tutorial()                 from public, anon;
revoke execute on function public.onboarding_assert_contract_stage(staff)      from public, anon, authenticated;

grant execute on function public.submit_hmrc_checklist(boolean, boolean, boolean, text, boolean, text, boolean) to authenticated;
grant execute on function public.onboarding_save_references(jsonb)            to authenticated;
grant execute on function public.onboarding_save_bank(text, text, text)       to authenticated;
grant execute on function public.sign_contract(text, boolean)                 to authenticated;
grant execute on function public.onboarding_finish_tutorial()                 to authenticated;
