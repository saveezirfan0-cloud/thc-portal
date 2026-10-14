-- =====================================================================
-- Release audit 14.10.2026, B1 · Do not return could not be switched by
-- any office login (§9.6)
--
-- set_do_not_return() (20260922094500) was SECURITY INVOKER and ends by
-- writing its audit row. audit_log is admin-read, service/definer-write
-- (0004_rls_gaps, §1.7): no API role holds an INSERT policy on it, so the
-- insert was refused for every manager — "new row violates row-level
-- security policy for table audit_log" — and the whole call rolled back.
-- The pgTAP that covered it (260, 270) ran as the table owner, which
-- bypasses RLS, so the suite stayed green while the switch was dead.
--
-- Every other function that writes audit_log is already SECURITY DEFINER
-- (checked against pg_proc on 14.10.2026: this was the only invoker one).
-- The fix is the same shape as set_client_name_badges() (20261002112000):
--
--   · SECURITY DEFINER with a pinned search_path, so the audit insert is
--     the owner's;
--   · the gate RLS used to be, written out at the top: a signed-in Back
--     Office session (current_app_role() = 'admin', which also refuses a
--     switched-off login and a two-step login below aal2);
--   · a viewer (ADR-0060) is still refused by the office_read_only
--     trigger on client_qualifications, which fires inside a definer too;
--   · EXECUTE revoked from public and anon, granted to authenticated.
--
-- The body is otherwise 20260922094500's, with the row locked FOR UPDATE
-- (two managers flipping the same worker no longer race) and a null p_on
-- refused rather than read as "off".
-- =====================================================================

create or replace function public.set_do_not_return(
  p_id     uuid,
  p_on     boolean,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v client_qualifications;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if p_on is null then
    raise exception 'Do not return must be switched on or off' using errcode = '22004';
  end if;

  select * into v from client_qualifications where id = p_id for update;
  if v.id is null then
    raise exception 'unknown_qualification' using errcode = 'P0001';
  end if;

  -- Switching it ON needs a reason of its own (20260922094500): an entry's
  -- note says why somebody was CLEARED, and is not a reason to bar them.
  if p_on and not v.do_not_return and coalesce(btrim(p_reason), '') = '' then
    raise exception 'Do not return needs a reason — it is shown on this client''s events (§9.6)'
      using errcode = 'check_violation';
  end if;

  -- The flag is stored per entry, but the gate is client-wide, so every
  -- entry this worker has at the client moves together (20260922094500).
  update client_qualifications
     set do_not_return = p_on,
         note = coalesce(nullif(btrim(p_reason), ''), note)
   where staff_id = v.staff_id and client_id = v.client_id;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(),
          case when p_on then 'do_not_return_on' else 'do_not_return_off' end,
          'client_qualification', p_id,
          jsonb_build_object('staffId', v.staff_id::text,
                             'clientId', v.client_id::text,
                             'roleId', v.role_id::text,
                             'reason', nullif(btrim(p_reason), '')));

  return jsonb_build_object('id', p_id::text, 'doNotReturn', p_on);
end $$;

comment on function public.set_do_not_return(uuid, boolean, text) is
  '§9.6 Do not return: the client-scoped hard gate — not invited in either wave, never on the Radar, cannot be invited manually. Applies to EVERY entry this worker has at the client. Requires a reason to switch on, keeps it when switched off, and writes both directions to audit_log. SECURITY DEFINER since 20261014093100 (release audit B1): the audit insert is the owner''s; the caller must be a Back Office session, and a viewer is refused by office_read_only.';

revoke all on function public.set_do_not_return(uuid, boolean, text) from public, anon;
grant execute on function public.set_do_not_return(uuid, boolean, text) to authenticated;
