-- =====================================================================
-- The worker's own profile — §10.1 (Profile details, Security, Payment
-- information) and §10.6 (Request my P45)
--
-- Everything the Staff App's /profile screens read and write. The shape
-- follows 20260922140000: `security definer` functions that resolve the
-- caller themselves through staff_caller(), because the staff role holds a
-- SELECT policy on its own `staff` row and nothing more. It must not gain
-- an UPDATE policy on `staff` — that table carries `status`, `block_kind`,
-- `right_to_work_until`, `rating` and `employee_id`, and a column-level
-- grant is not a thing RLS can express per policy. A function that names
-- the three editable columns and no others is the only way to let a worker
-- change their phone number without also letting them change their status.
--
-- Three §10.1 locks are enforced here rather than on the screen, because a
-- screen that forgets one is a forged POST away from being wrong:
--
--   Name          never writable by the worker at all (right to work +
--                 payroll). No function below touches first/last name.
--   NI number     set-once. Entering it the first time queues E6; a second
--                 attempt is refused, not ignored.
--   Avatar        set-once (§10.1: "set once during onboarding and then
--                 locked"). staff_set_photo() therefore refuses a worker
--                 who already has one — which also means the profile
--                 screen can be where a worker who never got as far as the
--                 selfie step supplies it, without becoming a way to
--                 change a photo that is already on timesheets.
--
-- E5, E6 and E7 are queued in the same transaction as the write they
-- describe. Outside a definer function they could not be: `staff` holds no
-- INSERT policy on notification_outbox for the staff role, and §8 requires
-- the send to be a consequence of the save rather than a second call the
-- app might not make.
-- =====================================================================

-- ---------------------------------------------------------------------
-- staff_me() — the profile sheet (§10.1) and the app lock it routes on
--
-- One round trip for the whole sheet: who the worker is, which of the four
-- §10.1 lock cases they are in, and whether Request my P45 is available.
--
-- `block_reason` is NOT returned and must never be. §10.1: "The manager's
-- reason for the block is internal and is never shown to the worker." The
-- lock case is; the reason is not.
--
-- `checked_in` is the §10.6 point-3 gate stated as a boolean, using
-- exactly the predicate request_p45() refuses on, so the greyed-out button
-- and the server's refusal cannot drift apart.
-- ---------------------------------------------------------------------
create or replace function public.staff_me()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  s staff;
  v_blockers text[];
  v_checked_in boolean;
  v_roles text[];
  v_bank jsonb;
begin
  if v_id is null then
    return null;
  end if;

  select * into s from staff where id = v_id;
  if s.id is null then
    return null;
  end if;

  select coalesce(array_agg(reason), '{}') into v_blockers
    from compliance_blockers(v_id, (now() at time zone 'Europe/London')::date);

  select exists (
    select 1
      from bookings b
      join shift_requirements sr on sr.id = b.shift_id
      join check_logs cl         on cl.booking_id = b.id
     where b.staff_id = v_id
       and b.cancelled_at is null
       and cl.check_in_at is not null
       and cl.check_out_at is null
       and now() < sr.ends_at + interval '4 hours'
  ) into v_checked_in;

  select coalesce(array_agg(r.name order by r.name), '{}') into v_roles
    from staff_roles sr join roles r on r.id = sr.role_id
   where sr.staff_id = v_id;

  select jsonb_build_object(
           'accountHolder', b.account_holder,
           'sortCode',      b.sort_code,
           'accountNumber', b.account_number,
           'updatedAt',     b.updated_at)
    into v_bank
    from bank_details b where b.staff_id = v_id;

  return jsonb_build_object(
    'staffId',        s.id::text,
    'firstName',      s.first_name,
    'lastName',       s.last_name,
    'employeeId',     s.employee_id,
    'email',          s.email,
    'phone',          s.phone,
    'homeAddress',    s.home_address,
    'photoPath',      s.photo_path,
    'photoLocked',    s.photo_path is not null,
    'status',         s.status::text,
    -- The KIND of manual block, never its reason (§10.1).
    'blockKind',      s.block_kind::text,
    'leftAt',         s.left_at,
    'rtwBranch',      s.rtw_branch::text,
    'niMasked',       case
                        when s.ni_number is null then null
                        else repeat('●', greatest(length(s.ni_number) - 2, 0))
                             || right(s.ni_number, 2)
                      end,
    'hasNiNumber',    s.ni_number is not null,
    'rating',         s.rating,
    'reliability',    s.reliability,
    'quizAttempts',   s.quiz_attempts,
    'roles',          to_jsonb(v_roles),
    'blockers',       to_jsonb(v_blockers),
    'checkedIn',      v_checked_in,
    'bank',           v_bank);
end $$;

comment on function public.staff_me() is
  'The worker''s own profile for the §10.1 profile sheet, plus the app-lock inputs. Never returns block_reason.';

-- ---------------------------------------------------------------------
-- Profile details — phone and home address (§10.1)
--
-- Email is not here: it goes through Supabase Auth's own verification
-- (§10.1 "a new email is verified via a confirmation code before it
-- replaces the old one"), and staff_sync_email() below is the second half
-- of that, run only once the code has been accepted.
--
-- An address change queues E7. A phone change alone does not: §10.1 names
-- "both an email change and an address change" as E7's trigger, and §8's
-- register says the same. Queueing E7 for a corrected typo in a phone
-- number would train the office to ignore it.
--
-- home_location is deliberately NOT recalculated. It is the pin the worker
-- dropped at onboarding step 2/11 and it drives the proximity factor in
-- §6 scoring; re-deriving it from free text with no geocoder would move a
-- worker's score on a typo. E7 tells the office, and the office moves the
-- pin. See the note in the app's actions.ts.
-- ---------------------------------------------------------------------
create or replace function public.staff_update_contact(
  p_phone        text,
  p_home_address text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  s staff;
  v_phone text := nullif(btrim(p_phone), '');
  v_addr  text := nullif(btrim(p_home_address), '');
  -- The ::text casts on the appends below are load-bearing. An untyped
  -- literal makes Postgres resolve `text[] || 'x'` as anyarray||anyarray
  -- and cast the literal to text[], which raises 22P02 malformed array
  -- literal at run time — not at create time, so it ships silently.
  v_changed text[] := '{}';
begin
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if v_phone is null then
    raise exception 'phone_required' using errcode = 'P0001';
  end if;

  select * into s from staff where id = v_id for update;

  -- A leaver keeps Payment information and nothing else (§10.6 step 7).
  if s.status in ('inactive', 'removed') then
    raise exception 'not_editable' using errcode = 'P0001';
  end if;

  if s.phone is distinct from v_phone then
    v_changed := v_changed || 'phone number'::text;
  end if;
  if s.home_address is distinct from v_addr then
    v_changed := v_changed || 'home address'::text;
  end if;

  if array_length(v_changed, 1) is null then
    return jsonb_build_object('ok', true, 'changed', to_jsonb(v_changed));
  end if;

  update staff
     set phone = v_phone,
         home_address = v_addr
   where id = v_id;

  -- E7 for the address only (§8). A phone-only save is silent.
  if 'home address' = any (v_changed) then
    perform queue_contact_change(v_id, 'home address');
  end if;

  return jsonb_build_object('ok', true, 'changed', to_jsonb(v_changed));
end $$;

-- ---------------------------------------------------------------------
-- E7, written once, because two call sites queue it (§8).
-- ---------------------------------------------------------------------
create or replace function public.queue_contact_change(p_staff uuid, p_what text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare s staff;
begin
  select * into s from staff where id = p_staff;
  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values ('E7:staff:' || p_staff || ':' || extract(epoch from clock_timestamp())::bigint,
          'email', 'E7',
          array['admin@thehospitalitycompany.co.uk', 'thc_payroll@topsourceworldwide.com'],
          jsonb_build_object(
            'name',       s.first_name || ' ' || s.last_name,
            'employeeId', coalesce(s.employee_id::text, '(not yet issued)'),
            'changedAt',  to_char(now() at time zone 'Europe/London', 'DD Mon YYYY HH24:MI'),
            'changed',    p_what))
  on conflict (key) do nothing;
end $$;

-- ---------------------------------------------------------------------
-- The second half of the email change (§10.1)
--
-- Supabase Auth owns the confirmation code: the app calls updateUser({
-- email }), the worker types the 6-digit code from the NEW address, and
-- verifyOtp() swaps it on auth.users. Only then does this run, so the old
-- address really does stay in place until the code is entered.
--
-- It reads the address off auth.users rather than taking one as an
-- argument. An argument would be a worker-supplied string with no proof
-- behind it — the whole point of the code step. auth.uid()'s own row is
-- the proof.
-- ---------------------------------------------------------------------
create or replace function public.staff_sync_email()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  s staff;
  v_email text;
begin
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;

  select email into v_email from auth.users where id = auth.uid();
  if v_email is null then
    raise exception 'no_verified_email' using errcode = 'P0001';
  end if;

  select * into s from staff where id = v_id for update;
  if s.email is not distinct from v_email then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  update staff set email = v_email where id = v_id;
  perform queue_contact_change(v_id, 'email address');

  return jsonb_build_object('ok', true, 'changed', true, 'email', v_email);
end $$;

-- ---------------------------------------------------------------------
-- NI number — set once, E6 (§2.10, §10.1)
--
-- "Joined without one? Add it here once HMRC issues it." Once set it is
-- locked and masked; a second attempt raises rather than silently doing
-- nothing, so the screen can say why.
-- ---------------------------------------------------------------------
create or replace function public.staff_set_ni_number(p_ni text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  s staff;
  -- Normalised the way the rest of the system stores it: upper case, no
  -- spaces, so "ab 12 34 56 c" and "AB123456C" are one value.
  v_ni text := upper(regexp_replace(coalesce(p_ni, ''), '\s', '', 'g'));
begin
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if v_ni !~ '^[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z][0-9]{6}[A-D]$' then
    raise exception 'invalid_ni' using errcode = 'P0001';
  end if;

  select * into s from staff where id = v_id for update;
  if s.ni_number is not null then
    raise exception 'ni_locked' using errcode = 'P0001';
  end if;

  update staff set ni_number = v_ni where id = v_id;

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values ('E6:staff:' || v_id, 'email', 'E6',
          array['gisela@thehospitalitycompany.co.uk', 'thc_payroll@topsourceworldwide.com'],
          jsonb_build_object(
            'name',       s.first_name || ' ' || s.last_name,
            'employeeId', coalesce(s.employee_id::text, '(not yet issued)'),
            'changedAt',  to_char(now() at time zone 'Europe/London', 'DD Mon YYYY HH24:MI')))
  on conflict (key) do nothing;

  return jsonb_build_object('ok', true,
    'niMasked', repeat('●', greatest(length(v_ni) - 2, 0)) || right(v_ni, 2));
end $$;

-- ---------------------------------------------------------------------
-- The selfie (§1.6, §10.1) — set once, then locked
--
-- The path is not taken on trust: it must be the caller's own folder in
-- the private `photos` bucket. The app builds it server-side from the
-- session, so a mismatch here means a forged call, not a mistake.
-- ---------------------------------------------------------------------
create or replace function public.staff_set_photo(p_path text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  s staff;
begin
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if p_path is null or p_path not like v_id::text || '/%' then
    raise exception 'wrong_path' using errcode = 'P0001';
  end if;

  select * into s from staff where id = v_id for update;
  if s.photo_path is not null then
    -- §10.1: locked after onboarding. Changing it goes through the office.
    raise exception 'photo_locked' using errcode = 'P0001';
  end if;

  update staff set photo_path = p_path where id = v_id;
  return jsonb_build_object('ok', true, 'photoPath', p_path);
end $$;

-- ---------------------------------------------------------------------
-- Bank & payroll — §2.10, editable again in §10.1, always E5
--
-- bank_details already carries self insert/update policies (0004,
-- hardened in 20260921123503), so the write itself needs no escalation.
-- The E5 queue does, and §2.10 makes the email part of the save rather
-- than a follow-up: "which triggers the same E5 notification as at
-- onboarding". Both halves in one transaction is the only way a saved
-- change cannot exist without the office hearing about it.
-- ---------------------------------------------------------------------
create or replace function public.staff_save_bank(
  p_account_holder text,
  p_sort_code      text,
  p_account_number text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  s staff;
  v_holder text := nullif(btrim(p_account_holder), '');
  v_sort   text := regexp_replace(coalesce(p_sort_code, ''), '[^0-9]', '', 'g');
  v_acct   text := regexp_replace(coalesce(p_account_number, ''), '[^0-9]', '', 'g');
begin
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if v_holder is null then
    raise exception 'holder_required' using errcode = 'P0001';
  end if;
  if length(v_sort) <> 6 then
    raise exception 'bad_sort_code' using errcode = 'P0001';
  end if;
  if length(v_acct) <> 8 then
    raise exception 'bad_account_number' using errcode = 'P0001';
  end if;

  select * into s from staff where id = v_id;

  insert into bank_details (staff_id, account_holder, sort_code, account_number, updated_at)
  values (v_id, v_holder,
          substr(v_sort,1,2) || '-' || substr(v_sort,3,2) || '-' || substr(v_sort,5,2),
          v_acct, now())
  on conflict (staff_id) do update
    set account_holder = excluded.account_holder,
        sort_code      = excluded.sort_code,
        account_number = excluded.account_number,
        updated_at     = excluded.updated_at;

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values ('E5:staff:' || v_id || ':' || extract(epoch from clock_timestamp())::bigint,
          'email', 'E5',
          array['gisela@thehospitalitycompany.co.uk', 'thc_payroll@topsourceworldwide.com'],
          jsonb_build_object(
            'name',       s.first_name || ' ' || s.last_name,
            'employeeId', coalesce(s.employee_id::text, '(not yet issued)'),
            'changedAt',  to_char(now() at time zone 'Europe/London', 'DD Mon YYYY HH24:MI')))
  on conflict (key) do nothing;

  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- Earnings history — §10.1's Payment information, tab 1
--
-- "A card per completed, paid shift (role · rate/h · event name · venue
-- address · date/time · the amount earned on that shift)."
--
-- The base rate and nothing else. charge_rate is on the same row and is
-- never selected: §9.8's rule is that a worker sees the base rate only,
-- and the surest way to keep it is for the function not to return the
-- number at all. Holiday pay is likewise absent — §9.9 breaks it out at
-- 12.07% and never blends it, and this screen is base pay.
--
-- The payable figure comes from payable_minutes(), the same function
-- §9.9's payroll export uses, with the same unpaid-break deduction and
-- the same RULE-14 floor. If this screen disagreed with the export the
-- worker would be right and we would be wrong, so it does not get its own
-- arithmetic.
--
-- WHICH shifts are paid is a calendar rule, not a stored flag: THC pays
-- the Friday after the Mon-Sun week worked. That is computed here and
-- again in the app (`payments/pay-date.ts`), and the two are asserted
-- against the same worked examples.
-- ---------------------------------------------------------------------
create or replace function public.staff_earnings()
returns table (
  booking_id     uuid,
  event_title    text,
  venue_name     text,
  venue_address  text,
  role_name      text,
  starts_at      timestamptz,
  ends_at        timestamptz,
  pay_rate       numeric,
  check_in_at    timestamptz,
  check_out_at   timestamptz,
  unpaid_break_min int,
  left_early     boolean,
  no_check_out   text,
  payable        jsonb,
  pay_date       date
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with mine as (
    select b.id, b.staff_id, sr.starts_at, sr.ends_at, sr.pay_rate, sr.role_id,
           e.title, e.venue_name, e.venue_address, e.pays_breaks,
           cl.check_in_at,
           coalesce(cl.manager_finish_at, cl.check_out_at) as check_out_at,
           -- RULE-14's two blockers on the four-hour floor, resolved here
           -- so the app and payable_minutes() are handed the same inputs.
           exists (select 1 from violations v
                    where v.booking_id = b.id and v.type = 'left_early') as left_early,
           case
             when not exists (select 1 from violations v
                               where v.booking_id = b.id and v.type = 'no_checkout') then 'none'
             when exists (select 1 from violations v
                           where v.booking_id = b.id and v.type = 'no_checkout'
                             and not v.resolved) then 'unresolved'
             else 'resolved'
           end as no_check_out
      from bookings b
      join shift_requirements sr on sr.id = b.shift_id
      join events e              on e.id = sr.event_id
      -- `check_logs` records EVERY button press, so a booking can hold
      -- several rows: a turned-away attempt, an out-of-radius attempt,
      -- and the one accepted check-in. A plain join would return the
      -- shift once per press and bill the worker for each. The accepted
      -- row is the one with check_in_at set, and check_out() updates
      -- that same row — the same lateral unpaid_break_minutes() uses.
      left join lateral (
        select * from check_logs c
         where c.booking_id = b.id and c.check_in_at is not null
         order by c.check_in_at limit 1
      ) cl on true
     where b.staff_id = staff_caller()
       and b.status = 'worked'
       and b.cancelled_at is null
  )
  select
    m.id,
    m.title,
    m.venue_name,
    m.venue_address,
    r.name,
    m.starts_at,
    m.ends_at,
    m.pay_rate,
    m.check_in_at,
    m.check_out_at,
    case when m.pays_breaks then 0 else unpaid_break_minutes(m.id) end,
    m.left_early,
    m.no_check_out,
    payable_minutes(
      m.starts_at, m.ends_at, m.check_in_at, m.check_out_at,
      case when m.pays_breaks then 0 else unpaid_break_minutes(m.id) end,
      m.left_early, m.no_check_out),
    -- The Friday after the Mon-Sun week the section ENDED in, in UK time.
    ((m.ends_at at time zone 'Europe/London')::date
      + (7 - extract(isodow from (m.ends_at at time zone 'Europe/London')::date)::int)
      + 5)::date
  from mine m
  join roles r on r.id = m.role_id
  order by m.ends_at desc
$$;

comment on function public.staff_earnings() is
  '§10.1 Payment information, Earnings history. Base rate only — charge_rate and holiday pay are deliberately not returned.';

-- ---------------------------------------------------------------------
-- §10.6 — the caller for request_p45()
--
-- request_p45() has done the whole cascade since 20260921180312 but was
-- service_role only, because until this screen there was nobody to grant
-- it to (docs/14 O10). It stays that way: what `authenticated` gets is
-- this wrapper, which takes no staff id at all.
--
-- That is the difference that matters. request_p45(uuid, …) granted to
-- `authenticated` would let any signed-in worker retire any colleague by
-- id; the wrapper's subject is auth.uid()'s own row and there is no
-- argument to forge. Admin does not get a back door through it either —
-- a manager retiring someone is Block/Reset in the Back Office (§9.6),
-- not this.
-- ---------------------------------------------------------------------
create or replace function public.request_my_p45(p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_id uuid;
begin
  select id into v_id from staff where user_id = auth.uid();
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  return request_p45(v_id, nullif(btrim(coalesce(p_reason, '')), ''), now());
end $$;

comment on function public.request_my_p45(text) is
  '§10.6 Request my P45, for the worker themselves. Takes no staff id: the subject is always auth.uid()''s own row.';

-- ---------------------------------------------------------------------
-- Grants. The staff role reaches its own profile only through these.
-- ---------------------------------------------------------------------
revoke execute on function public.staff_me()                          from public, anon;
revoke execute on function public.staff_update_contact(text, text)    from public, anon;
revoke execute on function public.staff_sync_email()                  from public, anon;
revoke execute on function public.staff_set_ni_number(text)           from public, anon;
revoke execute on function public.staff_set_photo(text)               from public, anon;
revoke execute on function public.staff_save_bank(text, text, text)   from public, anon;
revoke execute on function public.staff_earnings()                    from public, anon;
revoke execute on function public.request_my_p45(text)                from public, anon;
-- Internal helper: only the two functions above queue E7.
revoke execute on function public.queue_contact_change(uuid, text)
  from public, anon, authenticated;

grant execute on function public.staff_me()                        to authenticated;
grant execute on function public.staff_update_contact(text, text)  to authenticated;
grant execute on function public.staff_sync_email()                to authenticated;
grant execute on function public.staff_set_ni_number(text)         to authenticated;
grant execute on function public.staff_set_photo(text)             to authenticated;
grant execute on function public.staff_save_bank(text, text, text) to authenticated;
grant execute on function public.staff_earnings()                  to authenticated;
grant execute on function public.request_my_p45(text)              to authenticated;
grant execute on function public.queue_contact_change(uuid, text)  to service_role;

-- =====================================================================
-- §9.11 / §9.12 settings the Back Office /settings screen edits
--
-- The settings table is key/value, so the two keys the Django-Admin
-- replacement needs that 0001 did not seed are seeded here rather than
-- invented by the app at first save. A screen that writes a key nobody
-- has ever read is a screen whose defaults live in TypeScript, and then
-- the database and the app disagree about what "unset" means.
--
-- Venue-type radii are NOT copied in here: they already have a home in
-- `venue_types.default_radius_m` (0001, ordered in 0007), which is what
-- the venue modal pre-fills from. /settings edits that table.
-- =====================================================================
insert into settings (key, value) values
  ('senders', jsonb_build_object(
     'timesheets', 'timesheets@thehospitalitycompany.co.uk',
     'admin',      'admin@thehospitalitycompany.co.uk')),
  ('payroll_recipients', jsonb_build_array(
     'gisela@thehospitalitycompany.co.uk',
     'thc_payroll@topsourceworldwide.com'))
on conflict (key) do nothing;
