-- =====================================================================
-- The database's calls to the Edge Functions carry their key on
-- `apikey`, and as a bearer only while it is a JWT (ADR-0165)
--
-- Supabase switches the legacy `anon` / `service_role` JWT keys off at
-- the end of 2026. Their replacements, `sb_publishable_…` and
-- `sb_secret_…`, are not JWTs: they belong on the `apikey` header, and
-- anything that tries to verify one as a bearer JWT fails. Three places
-- in the database post to an Edge Function with the Vault secret
-- `service_role_key` as `Authorization: Bearer <key>`:
--
--   install_job_schedules()    every pg_cron command for an edge row
--   willo_invite_nudge()       the trigger that calls willo-webhook/invite
--   auto_assign_first_round()  "Auto-assign now" on an event
--
-- All three now build their headers with edge_call_headers(key):
--
--   a legacy JWT (three dot-separated parts)  → apikey + Authorization: Bearer
--   anything else (sb_secret_…)               → apikey only
--
-- so the owner can put either key form in the Vault secret and nothing
-- else changes. supabase/functions/_shared/job.ts accepts the key from
-- either header (packages/db/src/service-caller.ts). With a legacy JWT
-- the request is the same as before plus an `apikey` header, which is
-- what supabase-js has always sent beside the bearer.
--
-- The Back Office rows of job_schedules (base_url_source =
-- 'office_base_url': rtw-check, event-documents, new-starter-report) are
-- NOT Supabase keys — they carry the office's own `rtw_job_secret`, which
-- /api/jobs/* compares as a bearer — and keep exactly the header they had.
-- rtw_check_nudge() posts to the office the same way and is not touched.
--
-- The Vault secret keeps its name, `service_role_key`, whichever form it
-- holds: rotating it to the new key is one vault.update_secret
-- (docs/16 §10). The values are still read when a command RUNS, never
-- stored in it.
--
-- Re-created from the LIVE bodies with exact-text replacements
-- (docs/10 §3b); each one must match exactly once or the migration stops.
-- install_job_schedules() is the body of 20261019120100.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The header builder. Pure: it reads no secret, it shapes the one it
--     is given. Not callable from the API roles all the same — nothing
--     outside the database has a reason to.
-- ---------------------------------------------------------------------
create or replace function public.edge_call_headers(p_key text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'Content-Type',  'application/json',
    'apikey',        p_key,
    'Authorization', case
                       when p_key ~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
                       then 'Bearer ' || p_key
                     end))
$$;

comment on function public.edge_call_headers(text) is
  'Headers for a database → Edge Function call (ADR-0165): the key on apikey always, and as Authorization: Bearer only when it is a JWT (a legacy service_role key). A new sb_secret_ key is not a JWT and goes on apikey alone.';

revoke execute on function public.edge_call_headers(text) from public, anon, authenticated;
grant  execute on function public.edge_call_headers(text) to service_role;

-- ---------------------------------------------------------------------
-- 2 · The three callers.
-- ---------------------------------------------------------------------
do $mig$
declare
  p     record;
  v_def text;
  v_n   int;
begin
  for p in
    select * from (values
      -- install_job_schedules(): a header variable beside the reader …
      ('public.install_job_schedules()',
       $p$  v_reader  text;
begin$p$,
       $r$  v_reader  text;
  v_headers text;
begin$r$),

      -- … chosen per row: an Edge Function gets edge_call_headers(), a Back
      -- Office job keeps its own bearer, word for word as before …
      ('public.install_job_schedules()',
       $p$    v_command := format($p$,
       $r$    -- ADR-0165: an Edge Function gets the key on apikey (and as a
    -- bearer only while it is a legacy JWT); a Back Office job keeps its
    -- own bearer. Both still read the secret when the command runs.
    if r.base_url_source = 'edge_base_url' then
      v_headers := format(
        'public.edge_call_headers((select decrypted_secret from vault.decrypted_secrets where name = %L))',
        r.secret_name);
    else
      v_headers := format(
        $hdr$jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = %L)
              )$hdr$,
        r.secret_name);
    end if;

    v_command := format($r$),

      -- … and spliced into the command where the fixed header was.
      ('public.install_job_schedules()',
       $p$              headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = %L)
              ),$p$,
       $r$              headers := %s,$r$),

      ('public.install_job_schedules()',
       $p$quote_literal('/' || r.edge_path), r.secret_name, r.job);$p$,
       $r$quote_literal('/' || r.edge_path), v_headers, r.job);$r$),

      ('public.willo_invite_nudge()',
       $p$      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'Authorization', 'Bearer ' || v_key));$p$,
       $r$      headers := public.edge_call_headers(v_key));$r$),

      ('public.auto_assign_first_round(uuid)',
       $p$      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'Authorization', 'Bearer ' || v_key));$p$,
       $r$      headers := public.edge_call_headers(v_key));$r$)
    ) as t(fn, pattern, replacement)
  loop
    v_def := pg_get_functiondef(p.fn::regprocedure);
    v_n := (length(v_def) - length(replace(v_def, p.pattern, ''))) / length(p.pattern);
    if v_n <> 1 then
      raise exception '20261020140000: % - expected one match of %, found %', p.fn, p.pattern, v_n;
    end if;
    execute replace(v_def, p.pattern, p.replacement);
  end loop;
end
$mig$;

comment on function public.install_job_schedules() is
  'Applies job_schedules to pg_cron, each POST with a 30 s pg_net timeout (ADR-0154), then reinstalls the SQL housekeeping jobs (install_housekeeping_schedules). Run once per deploy; needs settings.edge_base_url (a Supabase Functions base — edge_base_url() refuses anything else) and vault secret service_role_key — a legacy service_role JWT or a new sb_secret_ key; an Edge Function row sends it through edge_call_headers() (ADR-0165) — and for an office_base_url row (rtw-check) the vault secrets office_base_url (office_base_url() refuses anything but a Back Office origin) and rtw_job_secret, sent as a bearer — without them that row is skipped with a notice. Returns the number of job_schedules rows scheduled.';
