# ADR-0131 · `spatial_ref_sys` writes are closed by a statement trigger

**Status:** Accepted, 13.10.2026. Amends ADR-0010: the write hole it recorded is closed; the RLS switch it explains still cannot be flipped. **Trigger:** Supabase security email of 11.10.2026 (`rls_disabled_in_public`, critical) and the owner's failed "Enable RLS" in the dashboard (`42501: must be owner of table spatial_ref_sys`).

## Context
ADR-0010 recorded that PostGIS's EPSG lookup table, `public.spatial_ref_sys`, is owned by `supabase_admin` on Supabase, which granted `anon`, `authenticated` and `service_role` full DML on it. Only the owner can enable RLS or revoke those grants, and Supabase does not expose `supabase_admin`, so the anon key could insert a forged projection, delete SRID 4326 or truncate the table. ADR-0010 concluded nothing in a migration could close it.

That was true of RLS and grants, not of triggers. Checked on the live project on 13.10.2026: `postgres` holds the **TRIGGER** privilege on the table (granted by `supabase_admin` with the rest of the defaults), and `CREATE TRIGGER` needs only that and EXECUTE on the function. It was tested on live in rolled-back transactions before this was written.

## Decision
`20261013210000_spatial_ref_sys_read_only.sql` adds `spatial_ref_sys_read_only`: **BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE, FOR EACH STATEMENT**, calling `spatial_ref_sys_read_only_guard()`. That function raises `42501` when the statement runs as `anon`, `authenticated` or `service_role`, or arrives through PostgREST at all (`session_user = 'authenticator'`, so a definer reached over the API is refused too).

- **Per statement, not per row.** It fires even when a DELETE matches nothing and it covers TRUNCATE, which neither a row trigger nor an RLS policy can.
- **Reads are untouched.** PostGIS reads this table as whoever is connected (ADR-0010).
- **Who can still write:** `postgres` and `supabase_admin` (a PostGIS upgrade, a restore). Nothing in this system writes the table.

## Consequences
- The hole is closed in every environment: on Supabase by the trigger, locally by the trigger on top of the RLS that `20260921123503` already enables where `postgres` owns PostGIS. `002` assertions 6–12 assert the refusal for all three API roles and pin the trigger's shape. The two "expected" local failures in `docs/14` are gone, so the clean local baseline is now **zero** failures.
- **The advisor finding stays.** `rls_disabled_in_public` reads `relrowsecurity`, which only the owner can set. It will keep listing this one table, and the weekly security email with it, until Supabase support runs, as `supabase_admin`:
  ```sql
  alter table public.spatial_ref_sys enable row level security;
  create policy spatial_ref_sys_read on public.spatial_ref_sys for select to public using (true);
  revoke insert, update, delete, truncate on public.spatial_ref_sys from anon, authenticated;
  ```
  If that is ever done, `001` assertion 2's exemption can go; the trigger can stay.
- **One-way on Supabase.** `DROP TRIGGER` and `ALTER TABLE … DISABLE TRIGGER` both need the owner, so `postgres` can never remove this trigger (also checked on live). To stand it down, `create or replace` the guard with a body that only returns null. The migration's `DO` block makes a re-run a no-op for the same reason.
- **Fails loudly, on purpose.** Unlike `20260921123503`, the migration has no `insufficient_privilege` branch: an environment where `postgres` lacks TRIGGER on this table stops `db push` / `db reset` rather than deploying green with the hole open, which is what ADR-0010 says went wrong last time.
- **Not tested from pgTAP:** the `session_user = 'authenticator'` branch. Switching `session_user` needs a superuser login, which the suite does not have; the three API roles it would catch are each asserted directly.
- ADR-0010's survivability argument (every geography column is 4326; nothing calls `ST_Transform`) is no longer what keeps the system safe, but it is still worth keeping true.

## Rejected alternatives
- **Reinstall PostGIS into `extensions`** (Supabase's general advice for this lint). PostGIS is not relocatable, so this means `drop extension postgis cascade`, which drops `staff.home_location`, `check_logs.location`, `location_pings.location`, `events.venue_location` and `venues.location`, the 16 functions doing the geofence maths and both GiST indexes. That is a staged data migration on the live check-in path to silence a lint that this trigger already makes harmless.
- **A PostgREST `db_pre_request` hook refusing writes to `/spatial_ref_sys`.** It covers only the REST path, needs an `authenticator` role setting outside the migrations, and would run on every request.
