-- =====================================================================
-- A refused upload may be discarded; evidence may not (§2.3, §2.6,
-- completion letter requirement §4, ADR-0012)
--
-- The Staff App's upload actions take the object path back from the
-- browser and, when the worker's RPC refuses it, remove the object with
-- the service key. The only check was "under your own staff id", so a
-- worker could name their own VERIFIED passport, have the RPC refuse it
-- (already attached, wrong state, bad notice period) and watch the
-- service key delete it — right-to-work evidence the employer must keep,
-- gone while the row still points at it.
--
-- This is the one question the actions now ask before any remove(): is
-- this object referenced by anything, and was it uploaded in the last
-- hour (the life of a signed upload slot plus the form)? Only an
-- unreferenced, fresh object under the caller's own folder is discarded.
-- Service role only — the actions already hold that key and nothing else
-- should be able to probe which paths are referenced.
-- =====================================================================
create or replace function public.evidence_path_discardable(p_staff uuid, p_path text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select p_staff is not null
     and p_path is not null
     and p_path like p_staff::text || '/%'
     and p_path !~ '(^|/)\.\.(/|$)'
     and not exists (select 1 from compliance_docs d
                      where d.file_path = p_path or d.gov_report_path = p_path)
     and not exists (select 1 from staff s where s.wtr_optout_copy_path = p_path)
     and exists (select 1 from storage.objects o
                  where o.bucket_id = 'documents'
                    and o.name = p_path
                    and o.created_at > now() - interval '1 hour')
$$;

comment on function public.evidence_path_discardable(uuid, text) is
  'True only for a documents-bucket object under the worker''s own folder, uploaded within the hour, that no compliance_docs row or opt-out copy references. The Staff App asks this before removing a refused upload with the service key.';

revoke execute on function public.evidence_path_discardable(uuid, text) from public, anon, authenticated;
grant  execute on function public.evidence_path_discardable(uuid, text) to service_role;
