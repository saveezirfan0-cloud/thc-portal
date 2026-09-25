-- =====================================================================
-- Migration 20260930120300 · Refer a friend — the worker's code and count
--   docs/18-staff-features-plan.md §5 (Phase 1, Agent B · staff-pwa)
--   ADR-0040 (proposed — awaiting THC) · Q19, Q20
--
--   my_referral_code()     the caller's code, minted the first time a
--                          COMPLIANT worker asks; stable after that
--   my_referral_summary()  {code, applied} — a count, never names
--
-- staff_referral_codes and application_referrals are Phase 0
-- (20260930100100): admin_read only, no staff or client policy. Recording
-- a referral on /apply is Agent D's (20260930140000); nothing here reads an
-- applicant's name, email or outcome, and nothing reaches pay, reports or
-- a PDF (Q19: no reward). ADR-0031's shape: security definer, caller
-- resolved by staff_caller() and never passed, named columns, pinned
-- search_path, EXECUTE revoked from public and anon.
--
-- The code: eight characters from A–H J–N P–Z 2–9 (no I, O, 0 or 1 —
-- REFERRAL_CODE_ALPHABET in packages/domain), drawn from
-- gen_random_bytes(). 256 is a multiple of the alphabet's 32, so
-- `byte % 32` is unbiased. A collision with another worker's code is
-- retried; two first calls racing for the same worker are settled by the
-- primary key (on conflict do nothing) and both return the one row.
--
-- Forward-only.
-- =====================================================================

create or replace function public.my_referral_code()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  v_status staff_status;
  v_code text;
  v_revoked timestamptz;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
begin
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  select s.status into v_status from staff s where s.id = v_id;
  if v_status = 'removed' then
    raise exception 'account_closed' using errcode = 'P0001';
  end if;
  -- ADR-0040: compliant workers only. A candidate, a worker on a block
  -- and a leaver have no link to share.
  if v_status <> 'compliant' then
    raise exception 'not_compliant' using errcode = 'P0001';
  end if;

  select c.code, c.revoked_at into v_code, v_revoked
    from staff_referral_codes c where c.staff_id = v_id;
  if found then
    if v_revoked is not null then
      -- Never reissued (20260930100100).
      raise exception 'code_revoked' using errcode = 'P0001';
    end if;
    return v_code;
  end if;

  for attempt in 1 .. 20 loop
    v_bytes := gen_random_bytes(8);
    select string_agg(substr(v_alphabet, get_byte(v_bytes, n) % 32 + 1, 1), '' order by n)
      into v_code
      from generate_series(0, 7) n;
    begin
      insert into staff_referral_codes (staff_id, code)
      values (v_id, v_code)
      on conflict (staff_id) do nothing;
      select c.code into v_code from staff_referral_codes c where c.staff_id = v_id;
      return v_code;
    exception when unique_violation then
      -- Another worker already holds this code: draw again.
      null;
    end;
  end loop;
  raise exception 'mint_failed' using errcode = 'P0001';
end $$;

comment on function public.my_referral_code() is
  'ADR-0040: the calling worker''s referral code for /apply?ref=, minted on first call (8 chars, ^[A-HJ-NP-Z2-9]{8}$) and stable after. Compliant workers only (not_compliant); a revoked code is never reissued (code_revoked); account_closed for a removed worker. Takes no staff id.';

create or replace function public.my_referral_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  v_status staff_status;
  v_code text;
  v_applied int;
begin
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  select s.status into v_status from staff s where s.id = v_id;
  if v_status = 'removed' then
    raise exception 'account_closed' using errcode = 'P0001';
  end if;

  select c.code into v_code
    from staff_referral_codes c
   where c.staff_id = v_id and c.revoked_at is null;
  -- A count, never who (Q20): no join to applications, no names.
  select count(*)::int into v_applied
    from application_referrals r
   where r.referrer_staff_id = v_id;

  return jsonb_build_object('code', v_code, 'applied', v_applied);
end $$;

comment on function public.my_referral_summary() is
  'ADR-0040: {code, applied} for the calling worker — their live code (null until minted, or once revoked) and how many applications arrived with it. A count only: never names or outcomes (Q20). Mints nothing.';

revoke execute on function public.my_referral_code()    from public, anon;
revoke execute on function public.my_referral_summary() from public, anon;
grant  execute on function public.my_referral_code()    to authenticated;
grant  execute on function public.my_referral_summary() to authenticated;
