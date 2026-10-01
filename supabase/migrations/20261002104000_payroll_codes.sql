-- =====================================================================
-- Migration 20261002104000 · the existing payroll's codes become the
--                            Employee ID of the people already on it
--                            (ADR-0076; owner request, 01.10.2026)
--
-- The agency is moving people who are already on its payroll onto the
-- platform. They sign up like anybody else, and §2.7 issues an Employee
-- ID at contract signature from employee_id_seq (10001 up). Payroll
-- already knows them by a code (183 … 8002 in "THC - Staff on payroll
-- 01-10-26"), and the owner wants them to keep it.
--
--   1. payroll_codes holds that list: code, first name, last name. It is
--      loaded by load_payroll_codes() from the SQL editor / service role,
--      not here: the names are worker personal data and do not belong in
--      git, where GDPR removal could never reach them.
--   2. issue_employee_id() is what staff_status_guard now calls at
--      contract → compliant: a person whose full name matches exactly one
--      code on the list (and nobody holds it yet) is issued that code;
--      everybody else gets the next system ID, exactly as before. The row
--      is deleted as it is used — the list only ever holds people who
--      have not been matched — and audit_log records the match.
--   3. apply_payroll_codes() does the same for people who signed before
--      the list was loaded: a system-issued ID (10001 up) on a person who
--      matches is changed to the payroll code. load_payroll_codes() runs
--      it, so loading the list is one call.
--
-- Matching is on the whole name, case-, space-, hyphen- and
-- apostrophe-insensitive, so "Harish" / "Kumar Paidi" on payroll finds
-- "Harish Kumar" / "Paidi" in the app. A name that is on the list twice,
-- or that two people in the app share, is never matched: name alone
-- cannot say which one it is, so both get a system ID and the office
-- decides.
--
-- Codes are integers because employee_id is (0001_init.sql, and every
-- view and report since). The list's six "A" codes (e.g. 1641A) cannot be
-- stored, so load_payroll_codes() hands them back as skipped instead.
-- Every code is below 10001, so none can collide with a system ID.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The name key
-- ---------------------------------------------------------------------
create or replace function public.payroll_name_key(p_first text, p_last text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  -- Hyphens, dashes and full stops read as a space; apostrophes (straight
  -- and curly), backticks and acute accents are dropped, so O'Brien,
  -- O’Brien and OBrien read alike. Then every run of spaces is one space,
  -- which is what makes the split between first and last name irrelevant.
  select nullif(btrim(regexp_replace(
    translate(lower(coalesce(p_first, '') || ' ' || coalesce(p_last, '')),
              '-' || chr(8209) || chr(8211) || chr(8212) || '.'
                  || '''' || chr(8216) || chr(8217) || '`' || chr(180),
              '     '),
    '\s+', ' ', 'g')), '');
$$;

comment on function public.payroll_name_key(text, text) is
  'ADR-0076: the key payroll_codes and staff are matched on — first + last name, lower-cased, hyphens and full stops as spaces, apostrophes dropped, whitespace collapsed. NULL for an empty name.';

-- ---------------------------------------------------------------------
-- 2 · The list
-- ---------------------------------------------------------------------
create table public.payroll_codes (
  -- Below employee_id_seq's start (10001), so a payroll code can never be
  -- one the system issues.
  code       int primary key check (code between 1 and 10000),
  first_name text not null,
  last_name  text not null,
  name_key   text generated always as (payroll_name_key(first_name, last_name)) stored,
  loaded_at  timestamptz not null default now()
);

create index payroll_codes_name_key_idx on public.payroll_codes (name_key);

comment on table public.payroll_codes is
  'ADR-0076: people on the agency''s existing payroll who have not yet been matched to a worker. issue_employee_id() and apply_payroll_codes() give a matching worker the code as their Employee ID and delete the row. Loaded by load_payroll_codes() (service role); read by the office (admin_read); no write path for any session.';

alter table public.payroll_codes enable row level security;

revoke all on table public.payroll_codes from public, anon, authenticated;
grant select on table public.payroll_codes to authenticated;
grant all on table public.payroll_codes to service_role;

create policy admin_read on public.payroll_codes
  for select to authenticated
  using ((select current_app_role()) = 'admin'::app_role);

-- ADR-0060: every public table carries the viewer's write guard.
create trigger office_read_only
  before insert or update or delete or truncate on public.payroll_codes
  for each statement execute function public.office_read_only_guard();

-- ---------------------------------------------------------------------
-- 3 · Issuing an Employee ID
-- ---------------------------------------------------------------------
create or replace function public.issue_employee_id(p_staff uuid, p_first text, p_last text)
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key  text := payroll_name_key(p_first, p_last);
  v_code int;
begin
  if v_key is not null
     -- The name is on the list once …
     and (select count(*) from payroll_codes where name_key = v_key) = 1
     -- … and nobody else in the app has it, so it can only be this person.
     and not exists (select 1 from staff s
                      where s.id <> p_staff
                        and s.removed_at is null
                        and payroll_name_key(s.first_name, s.last_name) = v_key)
  then
    delete from payroll_codes c
     where c.name_key = v_key
       and not exists (select 1 from staff s where s.employee_id = c.code)
    returning c.code into v_code;
  end if;

  if v_code is null then
    return nextval('employee_id_seq');
  end if;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'employee_id_from_payroll', 'staff', p_staff,
          jsonb_build_object('employeeId', v_code, 'when', 'issued'));
  return v_code;
end $$;

revoke all on function public.issue_employee_id(uuid, text, text) from public, anon, authenticated;
grant execute on function public.issue_employee_id(uuid, text, text) to service_role;

comment on function public.issue_employee_id(uuid, text, text) is
  'ADR-0076: the Employee ID for a person at contract signature (§2.7). Their payroll code when their name matches exactly one row of payroll_codes and no other live worker shares it (the row is consumed and audit_log records it); otherwise the next employee_id_seq value.';

-- staff_status_guard: body identical to 20260927160900 except the one
-- line that issues the Employee ID.
create or replace function public.staff_status_guard()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_onboarding constant staff_status[] := array[
    'interview_requested', 'interview_completed', 'documents', 'quiz',
    'additional_info', 'contract']::staff_status[];
  v_blockers text[];
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- §2.12: every change is an edge of the machine, stopped states included.
  perform assert_staff_transition(old.status, new.status);

  if old.status = any(v_onboarding) or new.status = any(v_onboarding) then
    if old.status = 'documents' and new.status = 'quiz' then
      v_blockers := onboarding_quiz_blockers(new.id);
      if cardinality(v_blockers) > 0 then
        raise exception 'quiz_locked: %', array_to_string(v_blockers, ', ')
          using errcode = 'P0001';
      end if;

    elsif old.status = 'quiz' and new.status = 'contract' then
      if not exists (select 1 from quiz_attempts q
                      where q.staff_id = new.id
                        and q.passed
                        and q.taken_at >= old.onboarding_started_at) then
        raise exception 'quiz_not_passed' using errcode = 'P0001';
      end if;

    elsif old.status = 'contract' and new.status = 'compliant' then
      if new.contract_signed_at is null then
        raise exception 'contract_not_signed' using errcode = 'P0001';
      end if;
      -- §2.7: generated at this exact moment. §2.12 step 2: one person
      -- keeps one Employee ID across every period, so an existing one is
      -- never replaced. ADR-0076: someone already on payroll gets their
      -- payroll code.
      if new.employee_id is null then
        new.employee_id := issue_employee_id(new.id, new.first_name, new.last_name);
      end if;
    end if;
  end if;

  new.stage_entered_at := now();

  if new.status = 'interview_requested' then
    -- A new onboarding period (§2.12, Reset to candidate): the previous
    -- rejection and interview belong to the previous period. They stay in
    -- audit_log; a fresh Willo interview is due.
    new.onboarding_started_at := now();
    new.rejected_at := null;
    new.rejected_from := null;
    new.rejection_cause := null;
    new.rejection_reason := null;
    new.rejected_by := null;
    new.willo_candidate_id := null;
    new.willo_invited_at := null;
    new.willo_answers_done := null;
    new.willo_answers_total := null;
    new.willo_completed_at := null;
    new.willo_decision := null;
    new.willo_decided_at := null;
    new.willo_decided_via := null;
  elsif new.status = 'rejected' then
    new.rejected_at := now();
    new.rejected_from := old.status;
    -- §2.9's rejection comes from the wizard, which has no reason to name
    -- itself; a rejection out of the quiz stage with no cause is that one.
    new.rejection_cause := coalesce(new.rejection_cause,
                                    case when old.status = 'quiz' then 'quiz_failed' end);
  end if;

  return new;
end $$;

comment on function public.staff_status_guard() is
  '§2.12 on the row. EVERY status change must be an edge of staff_transitions (a leaver or a removed worker cannot be put straight back to compliant), and documents→quiz, quiz→contract and contract→compliant must carry their evidence. Stamps stage_entered_at, the rejection column, and a new onboarding period on entry to interview_requested; issues the Employee ID at contract→compliant if the person has none — their payroll code if they are on payroll_codes (ADR-0076).';

-- ---------------------------------------------------------------------
-- 4 · People who signed before the list was loaded
-- ---------------------------------------------------------------------
create or replace function public.apply_payroll_codes()
returns table (staff_id uuid, from_employee_id int, to_employee_id int)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r record;
begin
  for r in
    select s.id, s.employee_id, c.code
      from staff s
      join payroll_codes c
        on c.name_key = payroll_name_key(s.first_name, s.last_name)
     where s.removed_at is null
       -- Only an ID this system issued. A code someone already holds —
       -- a payroll code, or one an earlier load gave them — stays.
       and s.employee_id >= 10001
       and (select count(*) from payroll_codes c2 where c2.name_key = c.name_key) = 1
       and (select count(*) from staff s2
             where s2.removed_at is null
               and payroll_name_key(s2.first_name, s2.last_name) = c.name_key) = 1
       and not exists (select 1 from staff s3 where s3.employee_id = c.code)
     order by c.code
  loop
    update staff set employee_id = r.code where id = r.id;
    delete from payroll_codes where code = r.code;
    insert into audit_log (actor, action, entity, entity_id, data)
    values (auth.uid(), 'employee_id_from_payroll', 'staff', r.id,
            jsonb_build_object('employeeId', r.code, 'replaced', r.employee_id, 'when', 'backfill'));
    staff_id := r.id; from_employee_id := r.employee_id; to_employee_id := r.code;
    return next;
  end loop;
end $$;

revoke all on function public.apply_payroll_codes() from public, anon, authenticated;
grant execute on function public.apply_payroll_codes() to service_role;

comment on function public.apply_payroll_codes() is
  'ADR-0076: gives every live worker holding a system-issued Employee ID (10001 up) whose name matches exactly one payroll_codes row, and whom no other live worker shares a name with, that payroll code instead. Consumes the row, audits the change, returns what changed. Already-issued PDFs and payroll exports are not touched.';

-- ---------------------------------------------------------------------
-- 5 · Loading the list
-- ---------------------------------------------------------------------
-- p_rows: [{"code": "183", "first_name": "Gisela", "last_name": "Duncan"}, …]
-- Codes may arrive as numbers or text (the sheet has both).
create or replace function public.load_payroll_codes(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  e        jsonb;
  v_code   text;
  v_first  text;
  v_last   text;
  v_loaded int := 0;
  v_held   jsonb := '[]';
  v_skip   jsonb := '[]';
  v_moved  jsonb;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'rows_not_an_array' using errcode = '22023';
  end if;

  for e in select * from jsonb_array_elements(p_rows) loop
    v_code  := btrim(e->>'code');
    v_first := btrim(regexp_replace(e->>'first_name', '\s+', ' ', 'g'));
    v_last  := btrim(regexp_replace(e->>'last_name', '\s+', ' ', 'g'));

    if coalesce(v_code, '') !~ '^[0-9]{1,5}$'
       or coalesce(v_first, '') = '' or coalesce(v_last, '') = '' then
      v_skip := v_skip || jsonb_build_array(e);
    elsif v_code::int not between 1 and 10000 then
      v_skip := v_skip || jsonb_build_array(e);
    elsif exists (select 1 from staff s where s.employee_id = v_code::int) then
      -- Already somebody's Employee ID: matched on an earlier load.
      v_held := v_held || to_jsonb(v_code::int);
    else
      insert into payroll_codes (code, first_name, last_name)
      values (v_code::int, v_first, v_last)
      on conflict (code) do update
        set first_name = excluded.first_name, last_name = excluded.last_name, loaded_at = now();
      v_loaded := v_loaded + 1;
    end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('staffId', a.staff_id, 'from', a.from_employee_id,
                                               'to', a.to_employee_id) order by a.to_employee_id), '[]')
    into v_moved
    from apply_payroll_codes() a;

  return jsonb_build_object(
    'loaded',          v_loaded,
    'alreadyHeld',     v_held,
    'skipped',         v_skip,
    'changed',         v_moved,
    'ambiguousNames',  (select coalesce(jsonb_agg(k order by k), '[]')
                          from (select name_key k from payroll_codes group by name_key
                                 having count(*) > 1) d),
    'waiting',         (select count(*) from payroll_codes));
end $$;

revoke all on function public.load_payroll_codes(jsonb) from public, anon, authenticated;
grant execute on function public.load_payroll_codes(jsonb) to service_role;

comment on function public.load_payroll_codes(jsonb) is
  'ADR-0076: upserts the payroll list into payroll_codes (skipping codes that are not 1–10000 integers, and codes a worker already holds), then runs apply_payroll_codes(). Returns what was loaded, skipped and changed. Service role / SQL editor only.';
