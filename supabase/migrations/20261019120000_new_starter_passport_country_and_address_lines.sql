-- =====================================================================
-- Passport country and the address in separate fields on the New Starter
-- (HMRC) report (§9.9 Tab 3, ADR-0159)
--
-- THC, 19.10.2026: "For the New Starter HMRC report, can Passport Country
-- be added in, and can the address be in separate fields, not just one
-- field." Payroll keys a new starter in from this one file; its address
-- form has a box per line, and its record asks which country issued the
-- passport.
--
--   1. known_countries() — the fixed list a passport country is held to
--      (packages/domain/src/countries.ts is its twin; countries.test.ts
--      holds the two to each other). A misread page, or a page written to
--      talk the model into something, can only ever name a real country.
--   2. staff.passport_country — the country that ISSUED the passport, by
--      name ("Poland"). Null = not on file.
--   3. record_passport_country() — the AI read of a passport's photo page
--      (§2.6, ADR-0033) fills it from the issuing-state code in the
--      machine-readable zone. Service role only, and it only ever fills a
--      BLANK: it never overwrites what the office (or an earlier read) put
--      there, and never touches a removed worker.
--   4. set_staff_passport_country() — the office sets or corrects it on
--      /staff/:id, as it does gender (ADR-0079). The only way a worker
--      onboarded before the read existed gets one.
--   5. staff_wipe_report_fields() — §1.7: nulled on removal with the rest.
--   6. new_starter_address_parts() — the one stored line
--      (`staff.home_address`, "Flat 4, 22 Roman Road, Bethnal Green,
--      London E2 0RY": what onboarding_save_address() writes from the
--      wizard's boxes, and what a Profile edit is asked to end with) read
--      back into Address line 1 · 2 · 3 and Town / City. The postcode is
--      already its own column. Best effort for a line typed free-hand: a
--      line with no UK postcode at its end has no town to find, and every
--      part of it lands in the address lines, in order — never dropped.
--   7. new_starter_rows() and its two callers gain address_line_1..3,
--      town and passport_country. The full Home address column stays
--      (THC chose to keep it alongside). As in 20261013200000 a changed
--      result shape cannot be `create or replace`d, so the three are
--      dropped and re-created with their live bodies plus the columns;
--      grants are restated as they were.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The list
-- ---------------------------------------------------------------------
create or replace function public.known_countries()
returns text[]
language sql immutable parallel safe
set search_path = public
as $$
  select array[
    'Afghanistan',
    'Albania',
    'Algeria',
    'Andorra',
    'Angola',
    'Antigua and Barbuda',
    'Argentina',
    'Armenia',
    'Australia',
    'Austria',
    'Azerbaijan',
    'Bahamas',
    'Bahrain',
    'Bangladesh',
    'Barbados',
    'Belarus',
    'Belgium',
    'Belize',
    'Benin',
    'Bhutan',
    'Bolivia',
    'Bosnia and Herzegovina',
    'Botswana',
    'Brazil',
    'Brunei',
    'Bulgaria',
    'Burkina Faso',
    'Burundi',
    'Cambodia',
    'Cameroon',
    'Canada',
    'Cape Verde',
    'Central African Republic',
    'Chad',
    'Chile',
    'China',
    'Colombia',
    'Comoros',
    'Congo',
    'Congo (Democratic Republic)',
    'Costa Rica',
    'Croatia',
    'Cuba',
    'Cyprus',
    'Czechia',
    'Denmark',
    'Djibouti',
    'Dominica',
    'Dominican Republic',
    'East Timor',
    'Ecuador',
    'Egypt',
    'El Salvador',
    'Equatorial Guinea',
    'Eritrea',
    'Estonia',
    'Eswatini',
    'Ethiopia',
    'Fiji',
    'Finland',
    'France',
    'Gabon',
    'Gambia',
    'Georgia',
    'Germany',
    'Ghana',
    'Greece',
    'Grenada',
    'Guatemala',
    'Guinea',
    'Guinea-Bissau',
    'Guyana',
    'Haiti',
    'Honduras',
    'Hong Kong',
    'Hungary',
    'Iceland',
    'India',
    'Indonesia',
    'Iran',
    'Iraq',
    'Ireland',
    'Israel',
    'Italy',
    'Ivory Coast',
    'Jamaica',
    'Japan',
    'Jordan',
    'Kazakhstan',
    'Kenya',
    'Kiribati',
    'Kosovo',
    'Kuwait',
    'Kyrgyzstan',
    'Laos',
    'Latvia',
    'Lebanon',
    'Lesotho',
    'Liberia',
    'Libya',
    'Liechtenstein',
    'Lithuania',
    'Luxembourg',
    'Macao',
    'Madagascar',
    'Malawi',
    'Malaysia',
    'Maldives',
    'Mali',
    'Malta',
    'Marshall Islands',
    'Mauritania',
    'Mauritius',
    'Mexico',
    'Micronesia',
    'Moldova',
    'Monaco',
    'Mongolia',
    'Montenegro',
    'Morocco',
    'Mozambique',
    'Myanmar (Burma)',
    'Namibia',
    'Nauru',
    'Nepal',
    'Netherlands',
    'New Zealand',
    'Nicaragua',
    'Niger',
    'Nigeria',
    'North Korea',
    'North Macedonia',
    'Norway',
    'Oman',
    'Pakistan',
    'Palau',
    'Palestine',
    'Panama',
    'Papua New Guinea',
    'Paraguay',
    'Peru',
    'Philippines',
    'Poland',
    'Portugal',
    'Qatar',
    'Romania',
    'Russia',
    'Rwanda',
    'St Kitts and Nevis',
    'St Lucia',
    'St Vincent',
    'Samoa',
    'San Marino',
    'Sao Tome and Principe',
    'Saudi Arabia',
    'Senegal',
    'Serbia',
    'Seychelles',
    'Sierra Leone',
    'Singapore',
    'Slovakia',
    'Slovenia',
    'Solomon Islands',
    'Somalia',
    'South Africa',
    'South Korea',
    'South Sudan',
    'Spain',
    'Sri Lanka',
    'Sudan',
    'Suriname',
    'Sweden',
    'Switzerland',
    'Syria',
    'Taiwan',
    'Tajikistan',
    'Tanzania',
    'Thailand',
    'Togo',
    'Tonga',
    'Trinidad and Tobago',
    'Tunisia',
    'Turkey',
    'Turkmenistan',
    'Tuvalu',
    'Uganda',
    'Ukraine',
    'United Arab Emirates',
    'United Kingdom',
    'United States',
    'Uruguay',
    'Uzbekistan',
    'Vanuatu',
    'Vatican City',
    'Venezuela',
    'Vietnam',
    'Yemen',
    'Zambia',
    'Zimbabwe'
  ]::text[]
$$;

comment on function public.known_countries() is
  'ADR-0159: every country a passport_country may name, A → Z. Twin of PASSPORT_COUNTRIES in packages/domain/src/countries.ts.';

-- ---------------------------------------------------------------------
-- 2 · The column
-- ---------------------------------------------------------------------
alter table staff
  add column if not exists passport_country text
    constraint staff_passport_country_known
      check (passport_country is null or passport_country = any(known_countries()));

comment on column staff.passport_country is
  'ADR-0159: the country that issued the worker''s passport, by name. Filled from the AI read of an uploaded passport (record_passport_country, only when blank) or by the office (set_staff_passport_country). Read by the New Starter (HMRC) report. Nulled on GDPR removal (staff_wipe_report_fields).';

-- 20260923220000 replaced SELECT on staff with SELECT on a named column
-- list; a column added since needs its own grant. RLS still decides the
-- rows: a worker reads their own, the office everyone's.
grant select (passport_country) on table public.staff to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3 · record_passport_country — the AI read fills a blank
--
-- Called by apps/staff/lib/extract.ts after record_document_extraction(),
-- with the name packages/domain mapped from the issuing-state code. A
-- rejected passport fills nothing. A
-- country off the list is ignored, not raised: the read is best effort and
-- the document still goes to a human. Returns whether it wrote.
-- ---------------------------------------------------------------------
create or replace function public.record_passport_country(p_doc uuid, p_country text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_country text := nullif(btrim(coalesce(p_country, '')), '');
  v_staff   uuid;
  v_rows    int;
begin
  -- A passport the office has rejected (not the worker's, not legible) is
  -- not evidence of anything, so its read fills nothing.
  select d.staff_id into v_staff
    from compliance_docs d
   where d.id = p_doc and d.doc_type = 'passport' and d.review_status <> 'rejected';
  if v_staff is null then
    return jsonb_build_object('ok', true, 'written', false, 'reason', 'not_a_passport');
  end if;
  if v_country is null or not (v_country = any(known_countries())) then
    return jsonb_build_object('ok', true, 'written', false, 'reason', 'unknown_country');
  end if;

  update staff
     set passport_country = v_country
   where id = v_staff
     and passport_country is null
     and removed_at is null;
  get diagnostics v_rows = row_count;

  return jsonb_build_object('ok', true, 'written', v_rows > 0);
end $$;

comment on function public.record_passport_country(uuid, text) is
  'ADR-0159: the AI read of a passport photo page fills staff.passport_country — only when it is blank, only with a name from known_countries(), never from a rejected passport, never for a removed worker. Service role only.';

revoke all on function public.record_passport_country(uuid, text) from public, anon, authenticated;
grant execute on function public.record_passport_country(uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- 4 · set_staff_passport_country — the office records it on /staff/:id
--
-- A name from known_countries() (any case); null clears it. A Back Office
-- login that is not read-only. Refused on a removed worker: §1.7 has
-- already wiped it. The audit row names the worker and that it changed,
-- not the value, as set_staff_gender() does.
-- ---------------------------------------------------------------------
create or replace function public.set_staff_passport_country(p_staff uuid, p_country text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_in      text := nullif(regexp_replace(btrim(coalesce(p_country, '')), '\s+', ' ', 'g'), '');
  v_country text;
  v_removed timestamptz;
begin
  perform assert_office_caller();
  perform assert_not_read_only();

  if v_in is not null then
    select c into v_country from unnest(known_countries()) c where lower(c) = lower(v_in);
    if v_country is null then
      raise exception 'unknown_country' using errcode = 'P0001';
    end if;
  end if;

  select s.removed_at into v_removed from staff s where s.id = p_staff for update;
  if not found then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if v_removed is not null then
    raise exception 'staff_removed' using errcode = 'P0001';
  end if;

  update staff set passport_country = v_country where id = p_staff;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'staff.passport_country_set', 'staff', p_staff,
          jsonb_build_object('staffId', p_staff::text));

  return jsonb_build_object('staffId', p_staff::text, 'passportCountry', v_country);
end $$;

comment on function public.set_staff_passport_country(uuid, text) is
  'ADR-0159: the office records (or, with null, clears) the country that issued a worker''s passport on /staff/:id — a name from known_countries(). Office logins that are not read-only; refused on a removed worker; audited without the value.';

revoke all on function public.set_staff_passport_country(uuid, text) from public, anon;
grant execute on function public.set_staff_passport_country(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5 · §1.7 — wiped on removal with the other report fields
-- ---------------------------------------------------------------------
create or replace function public.staff_wipe_report_fields() returns trigger
language plpgsql set search_path = public, extensions as $$
begin
  if new.removed_at is not null and old.removed_at is null then
    new.gender := null;
    new.home_postcode := null;
    new.home_country := null;
    -- ADR-0080.
    new.languages := null;
    -- ADR-0159.
    new.passport_country := null;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 6 · The one stored line → Address line 1 · 2 · 3 · Town / City
--
--   "Flat 4, 22 Roman Road, Bethnal Green, London E2 0RY"
--     line 1  Flat 4
--     line 2  22 Roman Road
--     line 3  Bethnal Green
--     town    London            (the part in front of the postcode)
--
-- A fourth or later part before the town joins line 3 with ", ", so
-- nothing is lost. With no UK postcode at the end there is no town to
-- find: every part is an address line. Immutable and pure — pgTAP 851
-- holds the vectors.
-- ---------------------------------------------------------------------
create or replace function public.new_starter_address_parts(p_address text)
returns table (address_line_1 text, address_line_2 text, address_line_3 text, town text)
language plpgsql immutable parallel safe
set search_path = public
as $$
declare
  v_text  text := btrim(regexp_replace(coalesce(p_address, ''), '\s+', ' ', 'g'));
  v_m     text[];
  v_rest  text;
  v_pc    boolean := false;
  v_parts text[];
  v_lines text[];
  v_town  text;
  v_n     int;
begin
  if v_text = '' then
    return;
  end if;

  -- A UK postcode ending the line, after a space or a comma (or alone).
  v_m := regexp_match(v_text,
    '^(?:(.*?)[ ,]+)?([A-Za-z]{1,2}[0-9][A-Za-z0-9]? ?[0-9][A-Za-z]{2})$');
  if v_m is not null then
    v_pc := true;
    v_rest := coalesce(v_m[1], '');
  else
    v_rest := v_text;
  end if;

  select coalesce(array_agg(btrim(x) order by i), '{}')
    into v_parts
    from unnest(string_to_array(v_rest, ',')) with ordinality u(x, i)
   where btrim(x) <> '';
  v_n := coalesce(array_length(v_parts, 1), 0);

  if v_pc and v_n >= 2 then
    v_town := v_parts[v_n];
    v_lines := v_parts[1:v_n - 1];
  else
    v_lines := v_parts;
  end if;

  address_line_1 := v_lines[1];
  address_line_2 := v_lines[2];
  address_line_3 := nullif(array_to_string(v_lines[3:], ', '), '');
  town := v_town;
  return next;
end $$;

comment on function public.new_starter_address_parts(text) is
  'ADR-0159: staff.home_address (one line, "flat, house street, area, town POSTCODE") read back into Address line 1 · 2 · 3 and Town / City for the New Starter (HMRC) report. Parts beyond the third line join line 3; with no trailing UK postcode there is no town and every part is a line.';

-- ---------------------------------------------------------------------
-- 7 · The report's row builder and its two callers
-- ---------------------------------------------------------------------
drop function if exists public.new_starter_report(date);
drop function if exists public.new_starter_report_rows(bigint);
drop function if exists public.new_starter_rows(uuid[]);

create function public.new_starter_rows(p_staff uuid[])
returns table (
  staff_id uuid, employee_id int, staff_name text, removed boolean, photo_path text,
  ni_number text, home_address text,
  address_line_1 text, address_line_2 text, address_line_3 text, town text,
  postcode text, country text, passport_country text,
  date_of_birth date, gender text, first_shift_date date,
  hmrc_statement text, student_loan text,
  bank_account_holder text, bank_sort_code text, bank_account_number text
)
language sql stable security definer set search_path = public, extensions as $$
  select st.id, st.employee_id,
         case when st.removed_at is null then st.first_name || ' ' || st.last_name
              else deleted_account_label(st.employee_id) end,
         st.removed_at is not null,
         case when st.removed_at is null then st.photo_path end,
         st.ni_number,
         st.home_address,
         a.address_line_1, a.address_line_2, a.address_line_3, a.town,
         coalesce(st.home_postcode, new_starter_postcode(st.home_address)),
         st.home_country,
         case when st.removed_at is null then st.passport_country end,
         -- A removed worker's dob is the 1900 placeholder, not a date of birth.
         case when st.removed_at is null then st.dob end,
         st.gender,
         f.first_shift_date,
         h.statement::text,
         case
           when h.staff_id is null then null
           when h.student_loan = 'none' and h.postgraduate_loan then 'Postgraduate'
           when h.student_loan = 'none' then 'No'
           else 'Plan ' || substring(h.student_loan::text from '[0-9]+')
                || case when h.postgraduate_loan then ' + Postgraduate' else '' end
         end,
         case when st.removed_at is null then bd.account_holder end,
         -- Stored as six digits (staff_save_bank); written the way a bank prints it.
         case when st.removed_at is null and bd.sort_code ~ '^[0-9]{6}$'
              then substr(bd.sort_code, 1, 2) || '-' || substr(bd.sort_code, 3, 2) || '-' || substr(bd.sort_code, 5, 2)
              when st.removed_at is null then bd.sort_code end,
         case when st.removed_at is null then bd.account_number end
    from staff st
    join report_first_shifts_v f on f.staff_id = st.id
    left join hmrc_checklists h  on h.staff_id = st.id
    left join bank_details bd    on bd.staff_id = st.id
    left join lateral new_starter_address_parts(st.home_address) a on true
   where st.id = any(p_staff)
   order by st.removed_at is not null, st.last_name, st.first_name, st.employee_id
$$;

revoke execute on function public.new_starter_rows(uuid[]) from public, anon, authenticated;

create function public.new_starter_report(p_date date)
returns table (
  staff_id uuid, employee_id int, staff_name text, removed boolean, photo_path text,
  ni_number text, home_address text,
  address_line_1 text, address_line_2 text, address_line_3 text, town text,
  postcode text, country text, passport_country text,
  date_of_birth date, gender text, first_shift_date date,
  hmrc_statement text, student_loan text,
  bank_account_holder text, bank_sort_code text, bank_account_number text,
  period_start date, period_end date
)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_start date := date_trunc('week', p_date)::date - 7;
begin
  perform assert_finance_caller();
  return query
  select n.*, v_start, v_start + 6
    from new_starter_rows(array(
           select f.staff_id from report_first_shifts_v f
            where f.first_shift_date between v_start and v_start + 6)) n;
end $$;

comment on function public.new_starter_report(date) is
  '§9.9 Tab 3: the people whose first paid shift fell in the Mon–Sun week before the picked date''s week, with the HMRC columns (Staff · Employee ID · NI · home address, and the same address in lines 1–3 and town (ADR-0159) · postcode · country · passport country (ADR-0159) · DOB · gender · first shift · statement · student loan) and their bank details (account holder · sort code · account number, ADR-0130). Role and salutation are deliberately absent. Owner and manager only (assert_finance_caller).';

create function public.new_starter_report_rows(p_send bigint)
returns table (
  staff_id uuid, employee_id int, staff_name text, removed boolean, photo_path text,
  ni_number text, home_address text,
  address_line_1 text, address_line_2 text, address_line_3 text, town text,
  postcode text, country text, passport_country text,
  date_of_birth date, gender text, first_shift_date date,
  hmrc_statement text, student_loan text,
  bank_account_holder text, bank_sort_code text, bank_account_number text
)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform assert_reports_caller();
  return query
  select * from new_starter_rows(array(
    select r.staff_id from new_starter_reported r where r.report_send_id = p_send));
end $$;

comment on function public.new_starter_report_rows(bigint) is
  'ADR-0091 step 2: the CSV rows for a prepared New Starter (HMRC) send — the workers recorded against it, with the §9.9 Tab 3 columns, the address in lines and passport country (ADR-0159) and their bank details (ADR-0130).';

revoke execute on function public.new_starter_report(date) from public, anon;
grant execute on function public.new_starter_report(date) to authenticated, service_role;

revoke execute on function public.new_starter_report_rows(bigint) from public, anon, authenticated;
grant execute on function public.new_starter_report_rows(bigint) to service_role;
