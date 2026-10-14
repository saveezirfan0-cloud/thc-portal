-- =====================================================================
-- Migration 20261014160000 · editing safety: length caps, the pay floor,
--                            a client phone that is a phone
--                            (release audit 14.10.2026 D-M2, D-M3, D-M7;
--                            ADR-0137)
--
-- Release audit, Back Office editing:
--
--   D-M7 · £0.00 personal pay and a £5.00 role base rate were accepted.
--       A base rate below the UK National Living Wage is unlawful for a
--       worker aged 21 or over, and every hourly rate in the catalogue is
--       paid to adults. The floor is a setting, `minimum_hourly_pay`,
--       because it changes every April without a release:
--         £12.71 from 1 April 2026 (21 and over) — GOV.UK, "National
--         Minimum Wage and National Living Wage rates"; it was £12.21
--         for 2025/26. The seed's catalogue rates (£12.71) are this
--         figure. When the rate changes, update the setting on 1 April.
--       create_role() refuses a base rate below it; update_role() refuses
--       one only when the rate itself changes (renaming a role priced
--       under an older floor still works); set_staff_pay_rate() refuses a
--       personal rate below it. Above £1,000.00 an hour is refused too —
--       999999 came back as "not a rate" from the form and as a numeric
--       overflow from the database.
--
--   D-M2 · a client's phone "not a phone" was accepted. assert_client_input
--       now wants 7–15 digits once spaces, dashes and brackets are taken
--       out, with an optional leading + — `isPhone()` in packages/domain,
--       so UK numbers (020 7946 0000) and international ones
--       (+44 20 7946 0000, +33 1 23 45 67 89) both pass. Names are capped
--       at 120 characters, the staff contact point at 200.
--
--   D-M3 · one long unbroken string widened pages to 2,802 px, and nothing
--       bounded a venue name, a client name, a dress code or the office's
--       own feedback. Caps, each held twice (a sentence from the input
--       function where there is one, and a CHECK on the table for every
--       other path):
--         venue name ≤ 120 · client name ≤ 120 · each dress code (rate
--         card list and an event section's own) ≤ 200 · office feedback
--         ≤ 2,000 — the Client Portal's figure for a client's comment
--         (20261012120600).
--       Every CHECK goes in NOT VALID and is validated at once only when
--       no existing row breaks it, so a long historical row neither stops
--       this deploy nor is silently cut (a NOTICE names it instead).
--
-- 822_editing_safety_caps_and_pay_floor pins all of it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The statutory floor
-- ---------------------------------------------------------------------
insert into settings (key, value)
values ('minimum_hourly_pay', '12.71'::jsonb)
on conflict (key) do nothing;

create or replace function public.minimum_pay_rate()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  -- A missing or unreadable setting falls back to the 2026/27 figure: the
  -- floor never silently becomes zero.
  select coalesce(
    (select case when jsonb_typeof(value) = 'number' then (value #>> '{}')::numeric end
       from settings where key = 'minimum_hourly_pay'),
    12.71);
$$;

comment on function public.minimum_pay_rate() is
  '20261014160000 (ADR-0137): the UK National Living Wage for 21 and over, £/h — settings.minimum_hourly_pay (£12.71 from 1 April 2026, GOV.UK). No base or personal pay rate is set below it.';

revoke all on function public.minimum_pay_rate() from public, anon;
grant execute on function public.minimum_pay_rate() to authenticated, service_role;

create or replace function public.assert_pay_floor(p_pay_rate numeric)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  v_floor numeric := minimum_pay_rate();
begin
  if p_pay_rate is null then
    return;
  end if;
  if p_pay_rate < v_floor then
    raise exception 'A pay rate cannot be below the National Living Wage, £%/h', to_char(v_floor, 'FM999990.00')
      using errcode = 'check_violation';
  end if;
  if p_pay_rate > 1000 then
    raise exception 'A pay rate over £1,000.00 an hour is refused — check the figure'
      using errcode = 'check_violation';
  end if;
end;
$$;

revoke all on function public.assert_pay_floor(numeric) from public, anon;
grant execute on function public.assert_pay_floor(numeric) to authenticated, service_role;

-- update_role() is security invoker, and since ADR-0061 no signed-in
-- session may SELECT roles.pay_rate — so the "did the rate change?" read
-- is this definer's. It answers nothing: it refuses or returns.
create or replace function public.assert_role_rate_floor(p_id uuid, p_pay_rate numeric)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_pay_rate is distinct from (select pay_rate from roles where id = p_id) then
    perform assert_pay_floor(p_pay_rate);
  end if;
end;
$$;

revoke all on function public.assert_role_rate_floor(uuid, numeric) from public, anon;
grant execute on function public.assert_role_rate_floor(uuid, numeric) to authenticated, service_role;

-- 20260921153100's bodies with the floor added.
create or replace function public.create_role(p_name text, p_pay_rate numeric, p_description text)
returns uuid
language plpgsql
set search_path = public, extensions
as $$
declare v_id uuid;
begin
  perform assert_role_input(p_name, p_pay_rate);
  perform assert_pay_floor(p_pay_rate);
  insert into roles (name, pay_rate, description)
  values (btrim(p_name), p_pay_rate, nullif(btrim(coalesce(p_description, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.update_role(p_id uuid, p_name text, p_pay_rate numeric, p_description text)
returns void
language plpgsql
set search_path = public, extensions
as $$
begin
  perform assert_role_input(p_name, p_pay_rate);
  -- Only a CHANGED rate meets today's floor: a role priced under an older
  -- one can still be renamed or described without being repriced here.
  perform assert_role_rate_floor(p_id, p_pay_rate);
  -- A rate change applies to events built from now on. Events already built
  -- carry their own pay_rate and charge_rate on shift_requirements, so
  -- nothing in the diary reprices behind the manager's back (§3.2, §9.8).
  update roles set
    name        = btrim(p_name),
    pay_rate    = p_pay_rate,
    description = nullif(btrim(coalesce(p_description, '')), '')
  where id = p_id;

  if not found then
    raise exception 'No role %', p_id using errcode = 'no_data_found';
  end if;
end;
$$;

-- 20261001215000's body with the floor added.
create or replace function public.set_staff_pay_rate(p_staff uuid, p_pay_rate numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_removed timestamptz;
begin
  -- A Back Office login with finance, or the service role (ADR-0056).
  perform assert_finance_caller();

  -- assert_role_input's words: the rate is money and the column is to the
  -- penny, so a third decimal is refused, never rounded.
  if p_pay_rate = 'NaN'::numeric then
    raise exception 'A pay rate must be a number' using errcode = 'check_violation';
  end if;
  if p_pay_rate is not null and p_pay_rate < 0 then
    raise exception 'A pay rate cannot be negative' using errcode = 'check_violation';
  end if;
  if p_pay_rate is not null and p_pay_rate <> round(p_pay_rate, 2) then
    raise exception 'A pay rate is set to the penny' using errcode = 'check_violation';
  end if;
  -- 20261014160000: never below the National Living Wage.
  perform assert_pay_floor(p_pay_rate);

  select s.removed_at into v_removed from staff s where s.id = p_staff for update;
  if not found then
    raise exception 'No staff member %', p_staff using errcode = 'no_data_found';
  end if;
  -- §1.7: a removed worker works no more shifts; their history keeps the
  -- rate it was priced at.
  if v_removed is not null then
    raise exception 'staff_removed' using errcode = 'P0001',
      detail = 'This worker was removed under GDPR; their pay rate is kept as it was.';
  end if;

  if p_pay_rate is null then
    delete from staff_pay_rates where staff_id = p_staff;
  else
    insert into staff_pay_rates (staff_id, pay_rate, set_by, set_at)
    values (p_staff, p_pay_rate, auth.uid(), now())
    on conflict (staff_id) do update
      set pay_rate = excluded.pay_rate, set_by = excluded.set_by, set_at = excluded.set_at;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 2 · Client input: a phone that is a phone, and bounded names
-- ---------------------------------------------------------------------
create or replace function public.assert_client_input(
  p_name text, p_contact_name text, p_phone text, p_staff_contact_point text, p_contact_emails text[])
returns void
language plpgsql
immutable
set search_path = public, extensions
as $$
declare v_email text;
begin
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'A client needs a name' using errcode = 'check_violation';
  end if;
  if char_length(btrim(p_name)) > 120 then
    raise exception 'A client name is at most 120 characters' using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_contact_name), '') = '' then
    raise exception 'A client needs a contact name' using errcode = 'check_violation';
  end if;
  if char_length(btrim(p_contact_name)) > 120 then
    raise exception 'A contact name is at most 120 characters' using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_phone), '') = '' then
    raise exception 'A client needs a contact phone' using errcode = 'check_violation';
  end if;
  -- isPhone() in packages/domain: 7–15 digits once separators are out.
  if regexp_replace(btrim(p_phone), '[[:space:]()-]', '', 'g') !~ '^\+?[0-9]{7,15}$' then
    raise exception 'Enter the contact phone as a phone number, e.g. 020 7946 0000 or +44 20 7946 0000'
      using errcode = 'check_violation';
  end if;
  -- The on-site contact the staff see at the venue; it pre-fills every
  -- event built for this client (§3.2), so an empty one is not a blank
  -- field, it is every future allocation sheet missing who to ask for.
  if coalesce(btrim(p_staff_contact_point), '') = '' then
    raise exception 'A client needs a staff contact point' using errcode = 'check_violation';
  end if;
  if char_length(btrim(p_staff_contact_point)) > 200 then
    raise exception 'The staff contact point is at most 200 characters' using errcode = 'check_violation';
  end if;
  if p_contact_emails is null or array_length(p_contact_emails, 1) is null then
    raise exception 'A client needs at least one contact email' using errcode = 'check_violation';
  end if;
  -- The allocation sheet and the timesheet go to every address here
  -- (§11.4). One that does not resolve is a document nobody receives.
  foreach v_email in array p_contact_emails loop
    if btrim(v_email) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      raise exception '% is not an email address', v_email using errcode = 'check_violation';
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 3 · Venue input: a bounded name
-- ---------------------------------------------------------------------
create or replace function public.assert_venue_input(p_name text, p_address text, p_lat double precision, p_lng double precision)
returns void
language plpgsql
immutable
set search_path = public, extensions
as $$
begin
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'A venue needs a name' using errcode = 'check_violation';
  end if;
  if char_length(btrim(p_name)) > 120 then
    raise exception 'A venue name is at most 120 characters' using errcode = 'check_violation';
  end if;
  -- §9.11: the address is reverse-geocoded from the pin, never typed. An
  -- empty one means the lookup did not resolve, and the row must not be
  -- written with a blank address a manager cannot correct.
  if coalesce(btrim(p_address), '') = '' then
    raise exception 'A venue needs an address from the pin' using errcode = 'check_violation';
  end if;
  if p_lat is null or p_lat < -90 or p_lat > 90 then
    raise exception 'Latitude % is out of range', p_lat using errcode = 'check_violation';
  end if;
  if p_lng is null or p_lng < -180 or p_lng > 180 then
    raise exception 'Longitude % is out of range', p_lng using errcode = 'check_violation';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 4 · The same caps on the tables, for every other write path
-- ---------------------------------------------------------------------
create or replace function public.dress_codes_fit(p_codes text[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(bool_and(char_length(code) <= 200), true) from unnest(p_codes) as code;
$$;

comment on function public.dress_codes_fit(text[]) is
  '20261014160000: every dress code in a rate card''s list is at most 200 characters (client_rate_cards_dress_code_length).';

alter table venues drop constraint if exists venues_name_length;
alter table venues add constraint venues_name_length check (char_length(name) <= 120) not valid;
alter table clients drop constraint if exists clients_name_length;
alter table clients add constraint clients_name_length check (char_length(name) <= 120) not valid;
alter table client_rate_cards drop constraint if exists client_rate_cards_dress_code_length;
alter table client_rate_cards add constraint client_rate_cards_dress_code_length
  check (dress_codes is null or dress_codes_fit(dress_codes)) not valid;
alter table shift_requirements drop constraint if exists shift_requirements_dress_code_length;
alter table shift_requirements add constraint shift_requirements_dress_code_length
  check (dress_code is null or char_length(dress_code) <= 200) not valid;
alter table feedback drop constraint if exists feedback_office_text_length;
alter table feedback add constraint feedback_office_text_length
  check (author_kind <> 'office' or text is null or char_length(text) <= 2000) not valid;

do $$
declare
  v record;
  v_bad bigint;
begin
  for v in
    select * from (values
      ('venues', 'venues_name_length', 'char_length(name) > 120'),
      ('clients', 'clients_name_length', 'char_length(name) > 120'),
      ('client_rate_cards', 'client_rate_cards_dress_code_length', 'not dress_codes_fit(dress_codes)'),
      ('shift_requirements', 'shift_requirements_dress_code_length', 'char_length(dress_code) > 200'),
      ('feedback', 'feedback_office_text_length', 'author_kind = ''office'' and char_length(text) > 2000')
    ) as t(tbl, con, bad)
  loop
    execute format('select count(*) from %I where %s', v.tbl, v.bad) into v_bad;
    if v_bad > 0 then
      raise notice '% left NOT VALID: % row(s) of % break it', v.con, v_bad, v.tbl;
    else
      execute format('alter table %I validate constraint %I', v.tbl, v.con);
    end if;
  end loop;
end $$;

comment on constraint venues_name_length on venues is
  '20261014160000 (release audit D-M3): a venue name is at most 120 characters.';
comment on constraint clients_name_length on clients is
  '20261014160000 (release audit D-M3): a client name is at most 120 characters.';
comment on constraint client_rate_cards_dress_code_length on client_rate_cards is
  '20261014160000 (release audit D-M3): each dress code on a rate card is at most 200 characters.';
comment on constraint shift_requirements_dress_code_length on shift_requirements is
  '20261014160000 (release audit D-M3): an event section''s dress code is at most 200 characters.';
comment on constraint feedback_office_text_length on feedback is
  '20261014160000 (release audit D-M3): the office''s own feedback is at most 2,000 characters, the Client Portal''s figure (20261012120600).';
