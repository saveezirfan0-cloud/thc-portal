-- =====================================================================
-- anon holds no privilege on any table, view or sequence in public
-- (ADR-0163)
--
-- Security review 17.10.2026, L4. Supabase's default privileges give the
-- `anon` role INSERT / SELECT / UPDATE / DELETE / TRUNCATE on every table
-- and view created in `public`, and USAGE / SELECT / UPDATE on every
-- sequence. On the live project that was 47 tables and 12 views with
-- full DML (catalog, 19.10.2026): RLS was the only wall between a
-- logged-out caller holding the published anon key and bookings, staff,
-- bank_details. One permissive policy written `to public` by mistake would
-- have been a write path for the whole internet.
--
-- Nothing logged-out needs one. Every public route was checked:
--   /apply          submit_application_as_caller() over the service key
--   /activate       the service key for activation_preview(); the form
--                   itself runs after verifyOtp, signed in
--   /forgot, /reset GoTrue only
--   sign-in and the two-step / recover throttles
--                   auth_attempt_allowed() / record_auth_attempt() over the
--                   service key (service-role only since 20261012121000)
--   willo-webhook and every job   the service role
-- and the only definer functions anon can execute are the two RLS helpers
-- current_app_role() and current_client_id() (190 · 2e), which read no
-- table on anon's behalf.
--
-- So all of it goes, and the default privileges stop handing it back to
-- the next table. USAGE on the schema stays: PostgREST needs it to answer
-- anon at all (a clean 401/42501 rather than a schema error), and the two
-- helpers live there.
--
-- Not here:
--   · functions — anon's EXECUTE is already pinned per definer by 190 2e
--     and 2f, and the default privilege for functions in public never
--     included anon (20260930120200);
--   · PostGIS's own relations (spatial_ref_sys, geometry_columns,
--     geography_columns): extension members, owned by supabase_admin on
--     the live project, and readable by anon through PostGIS's own grant
--     to PUBLIC. Only their owner can revoke that; the statement below
--     leaves them with a WARNING there, and ADR-0131's support ticket
--     (with the security review's L1) is where they are asked for;
--   · GraphQL. pg_graphql is not installed on the live project (catalog,
--     19.10.2026), so graphql_public.graphql() is Supabase's stub that
--     answers "extension not enabled" and introspects nothing. The schema
--     grants to anon on graphql / graphql_public were made by
--     supabase_admin and cannot be revoked from a migration; the owner's
--     checklist (docs/14 §4) says to keep the extension off and remove
--     graphql_public from the API's exposed schemas.
-- =====================================================================

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;

-- supabase_admin also carries a default for public that includes anon.
-- Only a member of that role may change it; on the live project the
-- migration role is not, so this is best effort and says so.
do $$
begin
  begin
    execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from anon';
    execute 'alter default privileges for role supabase_admin in schema public revoke all on sequences from anon';
  exception when insufficient_privilege or undefined_object then
    raise notice 'ADR-0163: supabase_admin''s default privileges in public are not this role''s to change; objects it creates still need their own revoke';
  end;
end $$;

-- ---------------------------------------------------------------------
-- Prove it: no relation in public that this role owns leaves anon a
-- privilege, and a table created now inherits none.
-- ---------------------------------------------------------------------
do $$
declare
  v_left text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
    into v_left
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
     and pg_get_userbyid(c.relowner) = current_user
     -- PostGIS's own relations (extension members) carry its PUBLIC grants
     -- in every environment and belong to supabase_admin on the live one.
     and not exists (select 1 from pg_depend d
                      where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
     and case when c.relkind = 'S'
              then has_sequence_privilege('anon', c.oid, 'usage, select, update')
              else has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate, references, trigger')
                   or exists (select 1 from pg_attribute a
                               where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                                 and has_column_privilege('anon', c.oid, a.attnum, 'select, insert, update, references'))
         end;
  if v_left is not null then
    raise exception 'ADR-0163: anon still holds a privilege on: %', v_left;
  end if;

  create table public.adr0163_default_probe (id int);
  if has_table_privilege('anon', 'public.adr0163_default_probe', 'select, insert, update, delete') then
    raise exception 'ADR-0163: a new table in public still grants anon by default';
  end if;
  drop table public.adr0163_default_probe;
end $$;
