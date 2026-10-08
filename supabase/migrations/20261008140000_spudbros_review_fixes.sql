-- =====================================================================
-- Migration 20261008140000 · SpudBros Express and the invite list: the QA and
-- security review of 08.10 (ADR-0107, "Review 08.10")
--
-- 20261008120000 and 20261008130000 were applied before the review's fixes
-- could be made in them, so the fixes restate the five functions they touch.
-- `create or replace` keeps each function's grants; nothing is dropped.
--
--   * load_invite_roster, remove_invite_roster_entries, set_staff_payroll_id:
--     owner and manager only (assert_finance_caller). A Payroll ID is the key
--     pay is filed under; a scheduler is refused in the database, not just
--     hidden by the screen.
--   * record_application_source: a SpudBros row whose name does not match the
--     applicant still marks them SpudBros (no Payroll ID, the row stays,
--     audited list_name_mismatch); a Payroll ID is not moved while another
--     live record holds the same email.
--   * set_staff_scheduling, load_invite_roster: a shift still under way
--     (ends_at + 4 h, the check-out window) counts as upcoming.
-- =====================================================================

create or replace function public.set_staff_scheduling(
  p_staff       uuid,
  p_spudbros    boolean,
  p_thc_shifts  boolean
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_removed timestamptz;
  v_spud    boolean := coalesce(p_spudbros, false);
  -- Switching THC shifts on is only meaningful for SpudBros staff; for
  -- everyone else the column is kept false so the pair never contradicts.
  v_shifts  boolean := coalesce(p_spudbros, false) and coalesce(p_thc_shifts, false);
begin
  perform assert_office_caller();
  perform assert_not_read_only();

  select s.removed_at into v_removed from staff s where s.id = p_staff for update;
  if not found then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if v_removed is not null then
    raise exception 'staff_removed' using errcode = 'P0001';
  end if;

  -- Closing the app on someone with an upcoming invitation, application
  -- or confirmed shift would strand it. The office moves or cancels those
  -- first.
  if v_spud and not v_shifts and exists (
       select 1
         from bookings b
         join shift_requirements sr on sr.id = b.shift_id
        where b.staff_id = p_staff
          and b.status in ('invited', 'applied', 'confirmed')
          and sr.ends_at + interval '4 hours' > now()) then
    raise exception 'has_upcoming_shifts' using errcode = 'P0001';
  end if;

  update staff
     set spudbros_express   = v_spud,
         thc_shifts_enabled = v_shifts
   where id = p_staff;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'staff.scheduling_set', 'staff', p_staff,
          jsonb_build_object('staffId', p_staff::text,
                             'spudbrosExpress', v_spud,
                             'thcShiftsEnabled', v_shifts));

  return jsonb_build_object('staffId', p_staff::text,
                            'spudbrosExpress', v_spud,
                            'thcShiftsEnabled', v_shifts);
end $$;


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
  -- A Payroll ID is the key the pay is filed under: owner and manager only,
  -- like the payroll code list (ADR-0076). A scheduler is refused here, not
  -- just hidden by the screen.
  perform assert_finance_caller();

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
                          and sr.ends_at + interval '4 hours' > now()) then
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
  -- A Payroll ID is the key the pay is filed under: owner and manager only,
  -- like the payroll code list (ADR-0076). A scheduler is refused here, not
  -- just hidden by the screen.
  perform assert_finance_caller();
  delete from invite_roster where p_ids is null or id = any (p_ids);
  get diagnostics v_n = row_count;
  return v_n;
end $$;


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
  -- A Payroll ID is the key the pay is filed under: owner and manager only,
  -- like the payroll code list (ADR-0076). A scheduler is refused here, not
  -- just hidden by the screen.
  perform assert_finance_caller();

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
  v_spud_miss boolean := false;
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
    -- the invitee: the row is left where it is and no Payroll ID moves (the
    -- link, if any, still decides). The office sees the miss. The one thing
    -- that still applies is the RESTRICTIVE half: a row that says SpudBros
    -- marks the candidate SpudBros whatever name they typed ("Mohamed" for
    -- "Mohammed"), because the other outcome opens THC shifts to someone the
    -- list says is on Connecteam.
    if v_listed then
      select s.first_name, s.last_name into v_first, v_last from staff s where s.id = v_candidate;
      if not payroll_names_compatible(v_first, v_last, r.first_name, r.last_name) then
        insert into audit_log (actor, action, entity, entity_id, data)
        values (null, 'roster.name_mismatch', 'staff', v_candidate,
                jsonb_build_object('staffId', v_candidate::text));
        v_listed := false;
        v_spud_miss := (r.grp = 'spudbros');
      end if;
    end if;

    if v_listed then
      -- The list is the office's own word and wins over the link.
      v_group := r.grp;
      v_via   := case when p_source = 'spudbros' and r.grp = 'thc' then 'list_over_link' else 'list' end;
      v_pay   := r.payroll_id;
    elsif p_source = 'spudbros' or v_spud_miss then
      v_group := 'spudbros';
      v_via   := case when v_spud_miss then 'list_name_mismatch' else 'link' end;
    else
      return;
    end if;

    -- Another live record already holds this email (a second application with
    -- a different date of birth, say): the Payroll ID is not moved and the row
    -- stays, so an application written to get ahead of the real invitee cannot
    -- take the ID. The group still applies.
    if v_listed and exists (select 1 from staff o
                             where lower(btrim(o.email)) = v_email
                               and o.removed_at is null and o.id <> v_candidate) then
      v_pay := null;
      v_taken := true;
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

    -- The row is consumed when it has done its job. If the Payroll ID could
    -- not be given (somebody else holds it) the row STAYS, still carrying the
    -- ID, so the office sees on /staff/roster that this person came in
    -- without theirs and can sort out who holds it.
    if v_listed and not v_taken then
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
      if v_candidate is not null
         and ((p_source = 'spudbros' and coalesce(v_group, 'spudbros') = 'spudbros')
              or exists (select 1 from invite_roster ir where ir.email = v_email and ir.grp = 'spudbros')) then
        update staff set spudbros_express = true where id = v_candidate;
      end if;
    exception when others then
      null;
    end;
    return;
  end;
end $$;
