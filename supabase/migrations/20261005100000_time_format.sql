-- =====================================================================
-- Clock format — 24-hour by default, 12-hour on request (ADR-0085)
--
-- Every time on screen was already written on a 24-hour clock, but the
-- time fields were the browser's own, and a browser draws those on the
-- DEVICE's clock — so a worker or manager on a 12-hour phone or laptop
-- saw and typed "5:00 PM". The platform now owns that. 24-hour is the
-- default for every login; each person can switch their own view to
-- 12-hour in their settings (Staff App: Profile → Preferences; Back
-- Office: My profile → Time format).
--
-- It is a DISPLAY and INPUT preference only. Nothing stored changes (every
-- time stays a timestamptz) and no rule reads it (every rule runs on
-- Europe/London instants, §1.8), so there is nothing to audit.
--
-- `profiles` has one policy (profiles_self, select) and no UPDATE policy,
-- and the client role holds no table policy at all (ADR-0026), so neither
-- read nor write goes through the table: two definer functions, callable
-- by any signed-in role, each touching only the caller's own row.
-- =====================================================================

alter table profiles
  add column if not exists time_format text not null default '24h'
    constraint profiles_time_format_check check (time_format in ('24h', '12h'));

comment on column profiles.time_format is
  'ADR-0085: how this login reads and types clock times, "24h" (the default) or "12h". Display only; every stored time stays timestamptz and every rule runs on Europe/London. Read and written through my_time_format() / set_my_time_format().';

-- ---------------------------------------------------------------------
-- my_time_format — the caller's own choice
-- ---------------------------------------------------------------------
create or replace function public.my_time_format() returns text
language sql
stable
security definer
set search_path = public
as $$
  -- NULL for a login with no profile row: the caller treats that as the default.
  select time_format from profiles where id = auth.uid()
$$;

comment on function public.my_time_format() is
  'ADR-0085: the signed-in login''s clock format, "24h" or "12h"; NULL when there is no profile row or no session.';

-- ---------------------------------------------------------------------
-- set_my_time_format — change it
-- ---------------------------------------------------------------------
create or replace function public.set_my_time_format(p_format text) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_format is null or p_format not in ('24h', '12h') then
    raise exception 'time_format_invalid' using errcode = 'P0001';
  end if;

  update profiles set time_format = p_format where id = v_uid;
  if not found then
    raise exception 'no_profile' using errcode = 'P0001';
  end if;
  return p_format;
end;
$$;

comment on function public.set_my_time_format(text) is
  'ADR-0085: the signed-in login sets its own clock format ("24h" or "12h"). Any role; only the caller''s own profiles row. A display preference, so not audited.';

revoke all on function public.my_time_format()            from public, anon;
revoke all on function public.set_my_time_format(text)    from public, anon;
grant execute on function public.my_time_format()         to authenticated;
grant execute on function public.set_my_time_format(text) to authenticated;
