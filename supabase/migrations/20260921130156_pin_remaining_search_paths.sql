-- =====================================================================
-- Pin the search_path on every remaining function this repo defines
--
-- Why this exists
-- ---------------
-- 20260921123503_db_hardening.sql pinned three functions, which was the
-- whole set the linter reported at the time. Migrations 0006 to 0009 then
-- added seventeen more without pinning them, so the count went up rather
-- than to zero.
--
-- The exposure is the same one the earlier migration argued: a caller who
-- controls search_path decides which `staff` table `weekly_cap_would_breach`
-- reads, or which `venues` table `update_venue` writes. These seventeen are
-- invoker-rights rather than security definer, so the blast radius is
-- smaller than the three already pinned, but several carry rules that money
-- and compliance depend on: payable_minutes is RULE-01, weekly_cap_* is
-- RULE-20, and check_in_decision is RULE-15.
--
-- Setting a search_path also blocks SQL-function inlining, which is what
-- makes the pin binding rather than advisory.
--
-- Note on public.spatial_ref_sys, which the earlier migration tried and
-- failed to protect: it cannot be fixed from here, and the graceful
-- degradation in that migration was correct but its goal is unreachable.
-- PostGIS's table is owned by supabase_admin and its privileges were granted
-- by supabase_admin, so only that role can revoke them or enable row-level
-- security on it. Neither `postgres` nor the SQL editor can, and Supabase
-- does not expose supabase_admin. anon therefore retains write privileges on
-- the SRID lookup table on every Supabase project using PostGIS. Our schema
-- stores geography(Point,4326) and never calls ST_Transform, so the geofence
-- maths does not read that table at query time. Recorded here so nobody
-- spends another pass trying.
-- =====================================================================

alter function public.assert_venue_input(text, text, double precision, double precision) set search_path = public, extensions;
alter function public.cap_term_state(daterange[], date) set search_path = public, extensions;
alter function public.cap_week_start(date) set search_path = public, extensions;
alter function public.check_in_decision(timestamptz, timestamptz, timestamptz, boolean, timestamptz, integer, integer, boolean) set search_path = public, extensions;
alter function public.check_out_decision(timestamptz, timestamptz, timestamptz, boolean, timestamptz, timestamptz) set search_path = public, extensions;
alter function public.create_venue(text, text, double precision, double precision, text, integer) set search_path = public, extensions;
alter function public.delete_venue(uuid) set search_path = public, extensions;
alter function public.payable_minutes(timestamptz, timestamptz, timestamptz, timestamptz, integer, boolean, text) set search_path = public, extensions;
alter function public.turned_away_minutes(timestamptz, timestamptz) set search_path = public, extensions;
alter function public.update_venue(uuid, text, text, double precision, double precision, text, integer) set search_path = public, extensions;
alter function public.venue_point(double precision, double precision) set search_path = public, extensions;
alter function public.weekly_booked_hours(uuid, date) set search_path = public, extensions;
alter function public.weekly_cap(boolean, text, boolean, boolean) set search_path = public, extensions;
alter function public.weekly_cap_band(uuid, date) set search_path = public, extensions;
alter function public.weekly_cap_for(uuid, date) set search_path = public, extensions;
alter function public.weekly_cap_would_breach(uuid, uuid) set search_path = public, extensions;
alter function public.weekly_hours_remaining(uuid, date) set search_path = public, extensions;
