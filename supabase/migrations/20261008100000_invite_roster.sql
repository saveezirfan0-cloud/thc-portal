-- =====================================================================
-- Migration 20261008100000 · the invite list: who is SpudBros Express,
--                            and each person's Payroll ID (ADR-0105;
--                            owner request, 08.10.2026)
--
-- The app cannot see which mailbox an invitation came from, and both
-- groups are emailed the same kind of link. What it CAN see is the email
-- address somebody applies with. So the office loads a list — one row per
-- person: email, name, Payroll ID, and which group they are (SpudBros
-- Express or THC) — and the application is matched against it.
--
--   1. invite_roster — the list. One row per email; admin_read; written
--      only by load_invite_roster(). A row is CONSUMED when its person
--      applies (the group and Payroll ID move onto their staff row and an
--      audit row says so), so what is left is exactly "invited, not yet
--      applied". Rows older than 180 days are dropped on every load: a
--      list of people who never applied is not kept for ever (§1.7).
--
--   2. record_application_source() (20261008090000) now decides the group
--      for EVERY new application, not only /apply/spudbros:
--        · on the list → the list's group wins (a SpudBros person who
--          clicks the ordinary link is still SpudBros; a THC person who
--          clicks the SpudBros link is not);
--        · not on the list → the link decides (/apply/spudbros marks them,
--          /apply does not);
--      and the list's Payroll ID goes onto the new candidate. It runs only
--      for the candidate THIS application created, never for a returning
--      applicant (§2.12), so the public form cannot change a live worker.
--      submit_application_as_caller is restated byte-for-byte but for the
--      one line that now always calls it.
--
--   3. staff.payroll_id — text, because the sheet has IDs such as 1641A
--      that employee_id (an int) cannot hold. Unique across people. The
--      office edits it on /staff/:id (set_staff_payroll_id).
--
--   4. Employee ID (ADR-0076) follows it: issue_employee_id() now prefers
--      a numeric Payroll ID on the person (matched by EMAIL, so it does
--      not depend on two spellings of a name agreeing) before falling back
--      to the name match and then the next system ID. An ID with a letter
--      keeps a system Employee ID and shows its Payroll ID beside it.
--
--   5. load_invite_roster() also applies the list to people ALREADY here
--      (same email): their Payroll ID, their numeric Payroll ID as
--      Employee ID where the system had issued one (the ADR-0076 backfill
--      rule), and SpudBros marking — except where that would strand an
--      upcoming shift, which it reports instead of doing.
--
--   6. staff_directory_v and onboarding_candidates_v gain spudbros_express,
--      thc_shifts_enabled and payroll_id (appended), so the Staff
--      directory and the onboarding board can show and filter the groups.
--
-- What does NOT change: statuses, documents, the contract, the Employee
-- ID of anyone who already has one that is not system-issued, payroll
-- exports (never corrected retroactively), any grant already given.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · staff.payroll_id
-- ---------------------------------------------------------------------
alter table public.staff
  add column if not exists payroll_id text
    constraint staff_payroll_id_shape check (payroll_id ~ '^[A-Z0-9-]{1,20}$');

create unique index if not exists staff_payroll_id_key on public.staff (payroll_id)
  where payroll_id is not null;

comment on column public.staff.payroll_id is
  '20261008100000: the ID the payroll sheet knows this person by — text, upper case, so 1641A fits. From the invite list or the office. A numeric one below 10001 also becomes the Employee ID at contract signature (issue_employee_id). Unique.';

-- 20260923220000 replaced SELECT on staff with SELECT on a named column
-- list; a column added since needs its own grant. RLS decides the rows.
grant select (payroll_id) on table public.staff to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2 · Helpers
-- ---------------------------------------------------------------------
-- One Payroll ID, one spelling: upper case, and an all-digit ID without
-- leading zeros, so 0183 and 183 are the same ID — as they are the same
-- Employee ID, which is an int.
create or replace function public.canonical_payroll_id(p text)
returns text
language sql
immutable
parallel safe
as $$
  select case when v ~ '^[0-9]+$' then coalesce(nullif(ltrim(v, '0'), ''), '0') else v end
    from (select nullif(upper(btrim(coalesce(p, ''))), '') as v) q
$$;

-- Is the person on the sheet plausibly the person in the app? Same first
-- name and same last word of the surname. The sheet carries "First" and
-- "Surname" only, so a middle name in the app ("Aadithya Nalannadiyil
-- Sukumar" against Aadithya / Sukumar) is fine; a different person who
-- shares a mistyped email is not. A row with no name on the sheet has
-- nothing to compare, so it is compatible.
create or replace function public.payroll_names_compatible(
  a_first text, a_last text, b_first text, b_last text
) returns boolean
language sql
immutable
parallel safe
as $$
  select case
    when payroll_name_key(b_first, b_last) is null or payroll_name_key(a_first, a_last) is null then true
    else split_part(payroll_name_key(a_first, a_last), ' ', 1) = split_part(payroll_name_key(b_first, b_last), ' ', 1)
     and regexp_replace(payroll_name_key(a_first, a_last), '^.* ', '')
       = regexp_replace(payroll_name_key(b_first, b_last), '^.* ', '')
  end
$$;

-- ---------------------------------------------------------------------
-- 3 · The list
-- ---------------------------------------------------------------------
create table public.invite_roster (
  id         uuid primary key default gen_random_uuid(),
  email      text not null check (email = lower(btrim(email))),
  first_name text,
  last_name  text,
  payroll_id text check (payroll_id ~ '^[A-Z0-9-]{1,20}$'),
  grp        text not null check (grp in ('spudbros', 'thc')),
  loaded_at  timestamptz not null default now(),
  loaded_by  uuid
);

create unique index invite_roster_email_key on public.invite_roster (email);
create unique index invite_roster_payroll_id_key on public.invite_roster (payroll_id)
  where payroll_id is not null;

comment on table public.invite_roster is
  'ADR-0105: people the office has invited, with the group each belongs to (spudbros / thc) and their Payroll ID. Matched on email when somebody applies; the row is deleted when it is used, so the table is "invited, not yet applied". Loaded by load_invite_roster(); read by the office (admin_read); no write path for any session.';

alter table public.invite_roster enable row level security;

revoke all on table public.invite_roster from public, anon, authenticated;
grant select on table public.invite_roster to authenticated;
grant all on table public.invite_roster to service_role;

create policy admin_read on public.invite_roster
  for select to authenticated
  using ((select current_app_role()) = 'admin'::app_role);

-- ADR-0060: every public table carries the viewer's write guard.
create trigger office_read_only
  before insert or update or delete or truncate on public.invite_roster
  for each statement execute function public.office_read_only_guard();

-- The group, in whatever words the sheet uses. Null = not understood: the
-- row is reported back, never guessed at.
create or replace function public.invite_roster_group(p_group text)
returns text
language sql
immutable
parallel safe
as $$
  select case regexp_replace(lower(btrim(coalesce(p_group, ''))), '[^a-z]', '', 'g')
    when 'spudbros'        then 'spudbros'
    when 'spudbro'         then 'spudbros'
    when 'spud'            then 'spudbros'
    when 'spudbrosexpress' then 'spudbros'
    when 'sbe'             then 'spudbros'
    when 'thc'             then 'thc'
    when 'normal'          then 'thc'
    when 'standard'        then 'thc'
    when 'regular'         then 'thc'
    when 'main'            then 'thc'
    else null
  end
$$;

-- ---------------------------------------------------------------------
-- 3 · Loading the list
-- ---------------------------------------------------------------------
-- p_rows: [{"email": "a@b.co", "first_name": "A", "last_name": "B",
--           "payroll_id": "1641A", "group": "spudbros"}, …]
create or replace function public.load_invite_roster(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  e          jsonb;
  s          staff;
  v_email    text;
  v_group    text;
  v_pay      text;
  v_first    text;
  v_last     text;
  v_code     int;
  v_loaded   int := 0;
  v_updated  int := 0;
  v_changed  boolean;
  v_emails   text[] := '{}';
  v_pays     text[] := '{}';
  v_held     jsonb := '[]';
  v_skip     jsonb := '[]';
begin
  perform assert_office_caller();
  perform assert_not_read_only();

  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'rows_not_an_array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'too_many_rows' using errcode = '22023';
  end if;

  -- §1.7: a list of people who never applied is not kept for ever.
  delete from invite_roster where loaded_at < now() - interval '180 days';

  for e in select * from jsonb_array_elements(p_rows) loop
    v_email := nullif(lower(btrim(coalesce(e ->> 'email', ''))), '');
    v_group := invite_roster_group(e ->> 'group');
    v_pay   := canonical_payroll_id(e ->> 'payroll_id');
    v_first := nullif(btrim(regexp_replace(coalesce(e ->> 'first_name', ''), '\s+', ' ', 'g')), '');
    v_last  := nullif(btrim(regexp_replace(coalesce(e ->> 'last_name', ''), '\s+', ' ', 'g')), '');

    if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      v_skip := v_skip || jsonb_build_array(e || jsonb_build_object('reason', 'bad_email'));
    elsif v_group is null then
      v_skip := v_skip || jsonb_build_array(e || jsonb_build_object('reason', 'group_unknown'));
    elsif v_pay is not null and v_pay !~ '^[A-Z0-9-]{1,20}$' then
      v_skip := v_skip || jsonb_build_array(e || jsonb_build_object('reason', 'bad_payroll_id'));
    elsif v_email = any (v_emails) then
      v_skip := v_skip || jsonb_build_array(e || jsonb_build_object('reason', 'duplicate_email_in_file'));
    elsif v_pay is not null and v_pay = any (v_pays) then
      v_skip := v_skip || jsonb_build_array(e || jsonb_build_object('reason', 'duplicate_payroll_id_in_file'));
    else
      v_emails := v_emails || v_email;
      if v_pay is not null then v_pays := v_pays || v_pay; end if;

      select * into s from staff
       where lower(btrim(email)) = v_email and removed_at is null
       order by created_at asc limit 1;

      if found then
        -- Already here: apply the list to the person, now — but only if the
        -- sheet's name is their name. A mistyped email that happens to be
        -- another live worker's must change nothing.
        if not payroll_names_compatible(s.first_name, s.last_name, v_first, v_last) then
          v_held := v_held || jsonb_build_array(e || jsonb_build_object('reason', 'name_mismatch'));
        elsif v_pay is not null
           and exists (select 1 from staff o where o.payroll_id = v_pay and o.id <> s.id) then
          v_skip := v_skip || jsonb_build_array(e || jsonb_build_object('reason', 'payroll_id_taken'));
        else
          v_changed := false;

          if v_pay is not null and s.payroll_id is distinct from v_pay then
            update staff set payroll_id = v_pay where id = s.id;
            v_changed := true;
            -- ADR-0076's backfill rule: only an ID the system issued (or none).
            if v_pay ~ '^[0-9]{1,5}$' then
              v_code := v_pay::int;
              if v_code between 1 and 10000
                 and (s.employee_id is null or s.employee_id >= 10001)
                 and not exists (select 1 from staff o where o.employee_id = v_code) then
                update staff set employee_id = v_code where id = s.id;
                delete from payroll_codes where code = v_code;
                insert into audit_log (actor, action, entity, entity_id, data)
                values (auth.uid(), 'employee_id_from_payroll', 'staff', s.id,
                        jsonb_build_object('employeeId', v_code, 'replaced', s.employee_id,
                                           'when', 'invite_list'));
              end if;
            end if;
          end if;

          if v_group = 'spudbros' and not s.spudbros_express then
            if exists (select 1 from bookings b join shift_requirements sr on sr.id = b.shift_id
                        where b.staff_id = s.id
                          and b.status in ('invited', 'applied', 'confirmed')
                          and sr.starts_at > now()) then
              v_held := v_held || jsonb_build_array(e || jsonb_build_object('reason', 'has_upcoming_shifts'));
            else
              update staff set spudbros_express = true, thc_shifts_enabled = false where id = s.id;
              v_changed := true;
            end if;
          elsif v_group = 'thc' and s.spudbros_express then
            -- Never switched back by a list: it may be a deliberate exception.
            v_held := v_held || jsonb_build_array(e || jsonb_build_object('reason', 'already_marked_spudbros'));
          end if;

          if v_changed then
            v_updated := v_updated + 1;
            insert into audit_log (actor, action, entity, entity_id, data)
            values (auth.uid(), 'roster.applied_existing', 'staff', s.id,
                    jsonb_build_object('staffId', s.id::text, 'group', v_group, 'payrollId', v_pay,
                                       'previousPayrollId', s.payroll_id,
                                       'previousSpudbros', s.spudbros_express));
          end if;
        end if;
      elsif v_pay is not null
            and (exists (select 1 from staff o where o.payroll_id = v_pay)
                 or exists (select 1 from invite_roster ir where ir.payroll_id = v_pay and ir.email <> v_email)) then
        v_skip := v_skip || jsonb_build_array(e || jsonb_build_object('reason', 'payroll_id_taken'));
      else
        insert into invite_roster (email, first_name, last_name, payroll_id, grp, loaded_by)
        values (v_email, v_first, v_last, v_pay, v_group, auth.uid())
        on conflict (email) do update
          set first_name = excluded.first_name, last_name = excluded.last_name,
              payroll_id = excluded.payroll_id, grp = excluded.grp,
              loaded_at = now(), loaded_by = excluded.loaded_by;
        v_loaded := v_loaded + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('loaded', v_loaded, 'updated', v_updated,
                            'held', v_held, 'skipped', v_skip);
end $$;

comment on function public.load_invite_roster(jsonb) is
  'ADR-0105: the office loads the invite list — email, name, Payroll ID, group (spudbros / thc). Someone not yet here is added to invite_roster; someone already here (same email) gets the list applied now (Payroll ID, numeric ID as Employee ID if system-issued, SpudBros marking unless it would strand an upcoming shift). Returns {loaded, updated, held, skipped} with the reason on every row it did not take. Office logins that are not read-only.';

revoke all on function public.load_invite_roster(jsonb) from public, anon;
grant execute on function public.load_invite_roster(jsonb) to authenticated, service_role;

-- Removing entries: null = every one still waiting.
create or replace function public.remove_invite_roster_entries(p_ids uuid[] default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  perform assert_office_caller();
  perform assert_not_read_only();
  delete from invite_roster where p_ids is null or id = any (p_ids);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

comment on function public.remove_invite_roster_entries(uuid[]) is
  'ADR-0105: the office removes entries from the invite list (null = all still waiting).';

revoke all on function public.remove_invite_roster_entries(uuid[]) from public, anon;
grant execute on function public.remove_invite_roster_entries(uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4 · The office edits one person's Payroll ID
-- ---------------------------------------------------------------------
create or replace function public.set_staff_payroll_id(p_staff uuid, p_payroll_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pay     text := canonical_payroll_id(p_payroll_id);
  v_removed timestamptz;
begin
  perform assert_office_caller();
  perform assert_not_read_only();

  if v_pay is not null and v_pay !~ '^[A-Z0-9-]{1,20}$' then
    raise exception 'payroll_id_shape' using errcode = 'P0001';
  end if;

  select s.removed_at into v_removed from staff s where s.id = p_staff for update;
  if not found then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if v_removed is not null then
    raise exception 'staff_removed' using errcode = 'P0001';
  end if;
  if v_pay is not null and exists (select 1 from staff o where o.payroll_id = v_pay and o.id <> p_staff) then
    raise exception 'payroll_id_taken' using errcode = 'P0001';
  end if;

  update staff set payroll_id = v_pay where id = p_staff;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'staff.payroll_id_set', 'staff', p_staff,
          jsonb_build_object('staffId', p_staff::text, 'payrollId', v_pay));

  return jsonb_build_object('staffId', p_staff::text, 'payrollId', v_pay);
end $$;

comment on function public.set_staff_payroll_id(uuid, text) is
  'ADR-0105: the office sets or clears a worker''s Payroll ID (letters, digits, hyphen; unique). Does not change the Employee ID. Office logins that are not read-only; refused on a removed worker; audited.';

revoke all on function public.set_staff_payroll_id(uuid, text) from public, anon;
grant execute on function public.set_staff_payroll_id(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5 · An application is matched to the list
-- ---------------------------------------------------------------------
create or replace function public.record_application_source(
  p_email  text,
  p_source text
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  -- submit_application()'s normalisation, so the lookups find what it wrote.
  v_email     text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_candidate uuid;
  v_first     text;
  v_last      text;
  r           invite_roster;
  v_listed    boolean;
  v_group     text;
  v_via       text;
  v_pay       text;
  v_taken     boolean := false;
begin
  if v_email is null then
    return;
  end if;

  begin
    -- The application just written (stamped in this transaction) and one
    -- that created a NEW candidate. A returning-applicant match is an
    -- existing record — possibly a live worker — and is never touched:
    -- anyone knowing an email and a date of birth could otherwise close
    -- someone else's shifts, or move their Payroll ID, from the public form.
    select a.staff_id
      into v_candidate
      from applications a
     where a.email = v_email
       and a.outcome = 'candidate_created'
       and a.created_at = now()
     limit 1;

    if v_candidate is null then
      return;
    end if;

    select * into r from invite_roster where email = v_email;
    v_listed := found;

    -- Somebody who knows an invited email but not the invitee's name is not
    -- the invitee: the row is left where it is and nothing is applied from
    -- it (the link, if any, still decides). The office sees the miss.
    if v_listed then
      select s.first_name, s.last_name into v_first, v_last from staff s where s.id = v_candidate;
      if not payroll_names_compatible(v_first, v_last, r.first_name, r.last_name) then
        insert into audit_log (actor, action, entity, entity_id, data)
        values (null, 'roster.name_mismatch', 'staff', v_candidate,
                jsonb_build_object('staffId', v_candidate::text));
        v_listed := false;
      end if;
    end if;

    if v_listed then
      -- The list is the office's own word and wins over the link.
      v_group := r.grp;
      v_via   := case when p_source = 'spudbros' and r.grp = 'thc' then 'list_over_link' else 'list' end;
      v_pay   := r.payroll_id;
    elsif p_source = 'spudbros' then
      v_group := 'spudbros';
      v_via   := 'link';
    else
      return;
    end if;

    if v_pay is not null
       and exists (select 1 from staff o where o.payroll_id = v_pay and o.id <> v_candidate) then
      v_pay := null;
      v_taken := true;
    end if;

    update staff
       set spudbros_express = (v_group = 'spudbros'),
           payroll_id       = coalesce(v_pay, payroll_id)
     where id = v_candidate;

    if v_listed then
      delete from invite_roster where id = r.id;
    end if;

    insert into audit_log (actor, action, entity, entity_id, data)
    values (null, 'roster.matched', 'staff', v_candidate,
            jsonb_build_object('staffId', v_candidate::text, 'group', v_group, 'via', v_via,
                               'payrollId', v_pay, 'payrollIdTaken', v_taken));
  exception when others then
    -- Never raises: the application the caller just wrote stands. But a
    -- failure is not silent: it is recorded, and a SpudBros applicant is
    -- still marked (unless the list says THC) so a failed Payroll ID step
    -- can never leave them open to THC shifts.
    begin
      insert into audit_log (actor, action, entity, entity_id, data)
      values (null, 'roster.match_failed', 'staff', v_candidate,
              jsonb_build_object('staffId', v_candidate::text, 'source', p_source));
      if v_candidate is not null and p_source = 'spudbros' and coalesce(v_group, 'spudbros') = 'spudbros' then
        update staff set spudbros_express = true where id = v_candidate;
      end if;
    exception when others then
      null;
    end;
    return;
  end;
end $$;

comment on function public.record_application_source(text, text) is
  '20261008100000 (ADR-0105): decides the group of the NEW candidate the current application created — the invite list''s group if their email is on it, otherwise SpudBros when the application came through /apply/spudbros — and moves the list''s Payroll ID onto them, consuming the list row. A returning-applicant match is never touched. Never raises. Owner-only: called by submit_application_as_caller(), by no API role.';

revoke execute on function public.record_application_source(text, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5b · §1.7: removal clears the Payroll ID and the SpudBros markers. They are
--      not history, and a removed row must not keep an ID that blocks its
--      re-use. (The Employee ID survives, as before.)
-- ---------------------------------------------------------------------
create or replace function public.staff_clear_roster_fields_on_removal()
returns trigger
language plpgsql
as $$
begin
  if new.removed_at is not null and old.removed_at is null then
    new.payroll_id         := null;
    new.spudbros_express   := false;
    new.thc_shifts_enabled := false;
  end if;
  return new;
end $$;

drop trigger if exists staff_clear_roster_fields_on_removal on public.staff;
create trigger staff_clear_roster_fields_on_removal
  before update of removed_at on public.staff
  for each row execute function public.staff_clear_roster_fields_on_removal();

-- ---------------------------------------------------------------------
-- 6 · submit_application_as_caller — 20261008090000's body, the one clause
--     now unconditional
-- ---------------------------------------------------------------------
create or replace function public.submit_application_as_caller(
  p_first_name  text,
  p_last_name   text,
  p_email       text,
  p_phone       text,
  p_dob         date,
  p_consent     boolean,
  p_caller_hash text,
  -- ADR-0047: /apply?ref=. Recorded after the application is written,
  -- never a reason to refuse it.
  p_referral_code text default null,
  -- 20261008090000: /apply/spudbros. 'spudbros' marks a NEW candidate as
  -- SpudBros Express staff; anything else is ignored.
  p_source text default null
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash      text := nullif(lower(btrim(coalesce(p_caller_hash, ''))), '');
  v_limits    jsonb;
  v_per_hour  int;
  v_per_day   int;
  v_retention interval;
begin
  if v_hash is not null then
    -- A digest or nothing: never a raw address (§1.7).
    if v_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'bad_caller_hash' using errcode = 'P0001';
    end if;

    v_limits    := coalesce((select value from settings where key = 'apply_caller_throttle'), '{}'::jsonb);
    v_per_hour  := coalesce((v_limits ->> 'per_hour')::int, 5);
    v_per_day   := coalesce((v_limits ->> 'per_day')::int, 20);
    v_retention := make_interval(hours => greatest(coalesce((v_limits ->> 'retention_hours')::int, 48), 24));

    -- Two submissions from one caller cannot both read a count under the
    -- limit.
    perform pg_advisory_xact_lock(hashtext('apply:caller'), hashtext(v_hash));

    -- Retention (§1.7), here rather than in a job: every call trims what
    -- has aged out, so nothing outlives two days by more than the gap
    -- between two applications.
    delete from private.apply_caller_hits where at < now() - v_retention;

    if (select count(*) from private.apply_caller_hits
         where caller_hash = v_hash and at > now() - interval '1 hour') >= v_per_hour
    or (select count(*) from private.apply_caller_hits
         where caller_hash = v_hash and at > now() - interval '24 hours') >= v_per_day
    then
      -- 22023: shown to the applicant as written. Says nothing about any
      -- email or mobile (§2.12).
      raise exception 'We’ve received several applications from your connection recently. Please try again later — or email admin@thehospitalitycompany.co.uk and we’ll help.'
        using errcode = '22023';
    end if;
  end if;

  -- Everything else — validation, the per-email/mobile throttle, the
  -- §2.12 match, the writes — is the public function's, unchanged. If it
  -- refuses, the hit below is never written: what is counted is
  -- applications accepted.
  perform public.submit_application(p_first_name, p_last_name, p_email, p_phone, p_dob, p_consent);

  -- ADR-0047: the one new clause. Only reached once the application is
  -- written; record_application_referral() never raises, so a bad,
  -- revoked or own code changes nothing the caller can see.
  if p_referral_code is not null then
    perform public.record_application_referral(p_email, p_referral_code);
  end if;

  -- 20261008090000: SpudBros Express / the invite list. Never raises, and
  -- only ever touches the candidate this call created.
  -- 20261008100000 (ADR-0105): always, because the invite list can decide a
  -- group (and a Payroll ID) for an application that came through /apply.
  perform public.record_application_source(p_email, p_source);

  if v_hash is not null then
    insert into private.apply_caller_hits (caller_hash) values (v_hash);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 7 · issue_employee_id — 20261002104000's body, a Payroll ID on the
--     person first
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
  v_pay  text;
  v_num  int;
begin
  -- ADR-0105: a numeric Payroll ID already on the person (from the invite
  -- list, matched by email) is their code — no name match needed, and no
  -- chance of two spellings disagreeing.
  select s.payroll_id into v_pay from staff s where s.id = p_staff;
  -- A case, not an AND: the cast must never be evaluated for 1641A.
  v_num := case when v_pay ~ '^[0-9]{1,5}$' then v_pay::int end;
  if v_num between 1 and 10000
     and not exists (select 1 from staff s where s.employee_id = v_num and s.id <> p_staff) then
    v_code := v_num;
    delete from payroll_codes where code = v_code;
    insert into audit_log (actor, action, entity, entity_id, data)
    values (auth.uid(), 'employee_id_from_payroll', 'staff', p_staff,
            jsonb_build_object('employeeId', v_code, 'when', 'issued', 'via', 'payroll_id'));
    return v_code;
  end if;

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

comment on function public.issue_employee_id(uuid, text, text) is
  'ADR-0076 / ADR-0105: the Employee ID for a person at contract signature (§2.7). A numeric Payroll ID on the person (invite list) is their code; otherwise their payroll code when their name matches exactly one row of payroll_codes and no other live worker shares it; otherwise the next employee_id_seq value. Consumed payroll_codes rows are deleted; audit_log records the match.';

-- ---------------------------------------------------------------------
-- 8 · The office's two lists carry the group and the Payroll ID
--     (appended columns; grants stand)
-- ---------------------------------------------------------------------
create or replace view onboarding_candidates_v with (security_invoker = true) as
select
  s.id,
  s.first_name,
  s.last_name,
  s.first_name || ' ' || s.last_name                           as display_name,
  s.email,
  s.phone,
  s.dob,
  case when s.dob is not null
       then extract(year from age((now() at time zone 'Europe/London')::date, s.dob))::int end as age,
  s.applied_age_band,
  s.photo_path,
  s.status,
  s.stage_entered_at,
  s.onboarding_started_at,
  s.created_at                                                 as applied_at,
  s.gdpr_consent_at,
  s.employee_id,
  s.rtw_branch,
  s.right_to_work_until,
  s.share_code,
  coalesce(staff_account_activated(s.id), false)               as activated,
  coalesce((select array_agg(r.name order by r.name)
              from staff_roles sr join roles r on r.id = sr.role_id
             where sr.staff_id = s.id), '{}'::text[])           as role_names,
  coalesce((select array_agg(sr.role_id)
              from staff_roles sr where sr.staff_id = s.id), '{}'::uuid[]) as role_ids,
  -- Willo (§2.4)
  s.willo_candidate_id is not null                             as willo_linked,
  case when s.willo_candidate_id is not null
        and jsonb_typeof((select value from settings where key = 'willo_review_url_template')) = 'string'
       then replace((select value #>> '{}' from settings where key = 'willo_review_url_template'),
                    '{id}', s.willo_candidate_id) end         as willo_review_url,
  s.willo_invited_at,
  s.willo_answers_done,
  s.willo_answers_total,
  s.willo_completed_at,
  s.willo_decision,
  s.willo_decided_at,
  s.willo_decided_via,
  -- Documents (§2.3): current rows only; superseded ones are the previous
  -- period's record and never count (§2.12).
  (select count(*) from current_compliance_docs(s.id))::int                        as docs_total,
  (select count(*) from current_compliance_docs(s.id) d where d.status = 'verified')::int as docs_verified,
  (select count(*) from current_compliance_docs(s.id) d where d.status = 'pending')::int  as docs_pending,
  (select count(*) from current_compliance_docs(s.id) d where d.status = 'rejected')::int as docs_rejected,
  (select max(c.reviewed_at) from compliance_docs c
    where c.staff_id = s.id and c.review_status = 'rejected')                      as last_doc_rejected_at,
  onboarding_documents_missing(s.id)                                               as docs_missing,
  onboarding_quiz_blockers(s.id)                                                   as quiz_blockers,
  (select c.answer from criminal_declarations c
    where c.staff_id = s.id and not c.superseded
    order by c.declared_at desc limit 1)                                           as declaration_answer,
  (select c.review_status from criminal_declarations c
    where c.staff_id = s.id and not c.superseded
    order by c.declared_at desc limit 1)                                           as declaration_status,
  -- Quiz (§2.9), this period only
  (select count(*) from quiz_attempts q
    where q.staff_id = s.id and q.taken_at >= s.onboarding_started_at)::int        as quiz_attempts_used,
  (select max(q.score) from quiz_attempts q
    where q.staff_id = s.id and q.taken_at >= s.onboarding_started_at)             as quiz_best_score,
  (select min(q.taken_at) from quiz_attempts q
    where q.staff_id = s.id and q.passed and q.taken_at >= s.onboarding_started_at) as quiz_passed_at,
  -- Additional info (§2.10), wizard steps 7-9
  (select h.submitted_at from hmrc_checklists h
    where h.staff_id = s.id and not h.superseded)                                  as hmrc_submitted_at,
  (select count(*) from staff_references r where r.staff_id = s.id)::int           as references_count,
  exists (select 1 from bank_details b where b.staff_id = s.id)                     as bank_saved,
  s.ni_number is not null                                                          as ni_entered,
  -- Contract (§2.11)
  s.contract_signed_at,
  s.contract_version,
  -- Rejection
  s.rejected_at,
  s.rejected_from,
  s.rejection_cause,
  -- §2.9 / ADR-0017: the office's free-text reason for rejecting a
  -- candidate is internal. E2 and E2b never carry it, and this view runs
  -- with the caller's privileges, so it is read through the owner-rights
  -- sub-view rather than off `s` — the caller no longer holds the column.
  (select r.rejection_reason from public.staff_rejection_reason_v r
    where r.staff_id = s.id)                                   as rejection_reason,
  p.full_name                                                                      as rejected_by_name,
  -- ---- appended 20260928110000 ----------------------------------------
  -- §2.7: the date beside "activated" on the Documents card and the
  -- "Activated dd.mm.yyyy (E3)" fact on the profile.
  staff_account_activated_at(s.id)                                                 as activated_at,
  -- ADR-0013: the derived move from Additional info to Contract, dated.
  -- The three wizard stamps are written only by the onboarding_* definer
  -- functions (20260923120200), one per step, so the latest of them is
  -- when the phase completed; null while any step is still open.
  (select case when p.hmrc_at is not null and p.references_at is not null and p.bank_at is not null
               then greatest(p.hmrc_at, p.references_at, p.bank_at) end
     from onboarding_progress p where p.staff_id = s.id)                           as additional_info_done_at,
  -- §2.9: every attempt this period, in attempt order. score is already a
  -- whole percentage (floor(correct * 100 / total), 20260923120100).
  coalesce((select array_agg(round(q.score)::int order by q.attempt_no) from quiz_attempts q
             where q.staff_id = s.id and q.taken_at >= s.onboarding_started_at),
           '{}'::int[])                                                             as quiz_scores,
  -- ---- appended 20261008100000 (ADR-0105) ------------------------------
  s.spudbros_express,
  s.thc_shifts_enabled,
  s.payroll_id
from staff s
left join profiles p on p.id = s.rejected_by
where s.removed_at is null;

create or replace view public.staff_directory_v with (security_invoker = true) as
select
  s.id,
  s.employee_id,
  s.status,
  s.removed_at is not null                                   as removed,
  case
    when s.removed_at is not null then deleted_account_label(s.employee_id)
    else s.first_name || ' ' || s.last_name
  end                                                        as display_name,
  case when s.removed_at is null then s.photo_path end       as photo_path,
  s.rating,
  -- §6 show-rate, derived from the worker's history (20260928110100):
  -- the figure auto-assign ranks by, never the stored column. NULL with
  -- no history — the screen draws "—" (20260928110700).
  staff_show_rate(s.id)::numeric(5,2)                        as reliability,
  s.block_kind,
  -- The reason for a manual block is internal and is never shown to the
  -- worker (§10.1), but the office sees it first when deciding to
  -- unblock. It is read through staff_block_reason_v rather than off
  -- `s`, because this view runs with the caller's privileges and the
  -- caller — admin or worker, both `authenticated` — no longer holds the
  -- column. The sub-view carries the admin gate and §1.7's suppression.
  br.block_reason                                            as block_reason,
  s.rtw_branch,
  s.right_to_work_until,
  s.graduated_at,
  s.wtr_optout,
  s.left_at,
  case when s.removed_at is null then s.leave_reason end     as leave_reason,
  coalesce(
    (select array_agg(r.name order by r.name)
       from staff_roles sr join roles r on r.id = sr.role_id
      where sr.staff_id = s.id),
    '{}'::text[]
  )                                                          as role_names,
  (select count(*) from violations v
    where v.staff_id = s.id and not v.resolved)::int          as unresolved_violations,
  coalesce(
    (select array_agg(distinct c.name order by c.name)
       from client_qualifications q join clients c on c.id = q.client_id
      where q.staff_id = s.id and q.do_not_return),
    '{}'::text[]
  )                                                          as do_not_return_clients,
  weekly_cap_hours(s.id, (now() at time zone 'Europe/London')::date)   as weekly_cap_hours,
  weekly_cap_band(s.id, (now() at time zone 'Europe/London')::date)    as weekly_cap_band,
  weekly_booked_hours(s.id, (now() at time zone 'Europe/London')::date) as weekly_booked_hours,
  -- ---- appended 20260928110000 ----------------------------------------
  -- §9.6 / §4.4: the Sunday the band holds until, for the three bands the
  -- term calendar moves (N14 asks the same question, 20260924130200).
  -- graduated_48, standard_48 and uncapped have no end: null.
  case
    when weekly_cap_band(s.id, (now() at time zone 'Europe/London')::date)
         in ('student_term_10', 'student_term_20', 'student_holiday_48')
      then cap_band_until(s.term_dates, (now() at time zone 'Europe/London')::date)
  end                                                        as weekly_cap_until,
  -- §10.6: the end of the last shift actually worked — E8's lastShiftDate.
  (select max(sr.ends_at)
     from bookings b join shift_requirements sr on sr.id = b.shift_id
    where b.staff_id = s.id and b.status = 'worked')          as last_shift_at,
  -- Confirmed shifts the system released from this worker (header).
  (select count(*) from bookings b
    where b.staff_id = s.id
      and b.status = 'cancelled'
      and b.cancel_cause in ('ready_cutoff', 'left', 'blocked', 'gdpr'))::int as released_shift_count,
  -- §10.6: when the P45 was asked for, while the row is a leaver's.
  case when s.status = 'inactive' then s.left_at end         as p45_requested_at,
  -- ---- appended 20260930110500 ----------------------------------------
  -- §9.6 "Hours this week (worked / calculated weekly limit)": the hours
  -- of this Mon–Sun Europe/London week's shifts that reached `worked`,
  -- each at its role section's SCHEDULED window (RULE-18) — the same unit
  -- and the same week as weekly_booked_hours(), so the two sit side by
  -- side. Booked stays: it is what the cap gates on (ADR-0038).
  (select coalesce(sum(extract(epoch from (sr.ends_at - sr.starts_at)) / 3600.0), 0)::numeric
     from bookings b
     join shift_requirements sr on sr.id = b.shift_id
    where b.staff_id = s.id
      and b.status = 'worked'
      and (sr.starts_at at time zone 'Europe/London')::date
          between cap_week_start((now() at time zone 'Europe/London')::date)
              and cap_week_start((now() at time zone 'Europe/London')::date) + 6)
                                                             as weekly_worked_hours,
  -- ---- appended 20261008100000 (ADR-0105) ------------------------------
  s.spudbros_express,
  s.thc_shifts_enabled,
  s.payroll_id
from staff s
left join staff_block_reason_v br on br.staff_id = s.id;
