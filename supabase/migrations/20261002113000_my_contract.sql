-- =====================================================================
-- Migration 20261002113000 · The agreement the worker signed (ADR-0083)
--   §2.11, §1.8 · /profile/agreement
--
--   my_contract()   read
--
-- The contract step (10/11) has always told the worker "A copy of the
-- signed agreement is kept on your profile" (wireframes/staff/onboarding-3
-- .html), and nothing on the profile showed one. This is the read behind
-- that screen.
--
-- It returns the version the worker SIGNED (staff.contract_version), not
-- current_contract_version(): onboarding_state() hands the wizard the
-- current one because that is what a candidate is about to sign, but a
-- worker who signed the placeholder in September signed that text, and a
-- later version is not their agreement (20260930140100's header). Published
-- versions are immutable, so the text returned is exactly what was signed.
--
-- The signature stamp is formatted here, in UK time, the way
-- onboarding_state() formats it — an audit record is never converted to
-- the viewer's zone (§1.8).
--
-- ADR-0031's shape: security definer, caller resolved by staff_caller()
-- and never passed, named keys, pinned search_path, EXECUTE revoked from
-- public and anon.
--
--   not yet signed      null
--   a leaver            reads it (their agreement does not stop existing)
--   a removed worker    account_closed
--
-- Forward-only.
-- =====================================================================

create or replace function public.my_contract()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  s staff;
  v_row jsonb;
begin
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  select * into s from staff where id = v_id;
  if s.status = 'removed' then
    raise exception 'account_closed' using errcode = 'P0001';
  end if;
  if s.contract_signed_at is null or s.contract_version is null then
    return null;
  end if;

  select jsonb_build_object(
           'version',       cv.version,
           'title',         cv.title,
           'body',          cv.body,
           'isPlaceholder', cv.is_placeholder,
           'signedAt',      s.contract_signed_at,
           'signedStamp',   to_char(s.contract_signed_at at time zone 'Europe/London',
                                    'DD.MM.YYYY HH24:MI') || ' UK time')
    into v_row
    from contract_versions cv
   where cv.version = s.contract_version;
  return v_row;
end $$;

comment on function public.my_contract() is
  'ADR-0083: the calling worker''s signed agreement ({version, title, body, isPlaceholder, signedAt, signedStamp}) — the version they signed, never the current one — or null before signing. A leaver may read it; a removed worker is refused (account_closed). Takes no staff id.';

revoke execute on function public.my_contract() from public, anon;
grant  execute on function public.my_contract() to authenticated;
