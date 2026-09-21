# ADR-0010 · `spatial_ref_sys` is a known gap, not a passing test

**Status:** Accepted, 21.09.2026. Reverses the premise of the `spatial_ref_sys` work in
`20260921123503_db_hardening.sql` and the four assertions it added to
`supabase/tests/001_rls_guard.sql` (2, 9) and `supabase/tests/002_schema_hardening.sql`
(6, 7). Confirms in a decision what
`20260921130156_pin_remaining_search_paths.sql` had already concluded in prose.

## Context

`create extension postgis` in `0001_init.sql` creates `public.spatial_ref_sys`, the EPSG
lookup table. On Supabase the extension is created by `supabase_admin`, so that role owns
the table and granted the default privileges on it — which, on Supabase, means `anon`,
`authenticated` and `service_role` all hold full DML.

That is a genuine finding. `anon` can insert a forged projection, or delete SRID 4326.

`20260921123503_db_hardening.sql` set out to close it by enabling row-level security and
adding a read-only policy, wrapped so it would "degrade with a notice where the extension
owner differs rather than aborting the migration". It also added four assertions requiring
the closed state.

On Supabase the owner always differs. The migration takes the degradation branch every
time, changes nothing, and the four assertions fail. `main` was red on exactly those four
from `9640d72` onwards — four consecutive runs over more than an hour, blocking nine
parallel sessions, with every open pull request inheriting the failure.

The successor migration diagnosed it correctly and left the tests alone:

> PostGIS's table is owned by supabase_admin and its privileges were granted by
> supabase_admin, so only that role can revoke them or enable row-level security on it.
> Neither `postgres` nor the SQL editor can, and Supabase does not expose supabase_admin.
> [...] anon therefore retains write privileges on the SRID lookup table on every Supabase
> project using PostGIS. [...] Recorded here so nobody spends another pass trying.

## Decision

The tests record the gap instead of asserting its absence.

- `001` assertion 2 exempts `spatial_ref_sys` by name, so a *new* table arriving without
  RLS still fails.
- `001` assertion 9 asserts the property that holds in both worlds — no policy on the
  table permits anything but `SELECT` — rather than the exact policy set, which only
  exists where the migration role owns the extension. It still refuses a policy that would
  let `anon` write.
- `002` assertions 6 and 7 assert what is true: `anon` can still insert and delete. They
  are labelled `KNOWN GAP` in their own descriptions, so the failure is visible in the TAP
  output of every run rather than buried in a comment.

## Why this is acceptable rather than merely tolerated

Because nothing in this schema reads that table at query time. Every geography column is
`geography(Point, 4326)` and no migration calls `ST_Transform`, so a forged or deleted
SRID cannot move a geofence radius or change a check-in decision (§5.1). **That argument
is the whole justification, and it expires the moment a second SRID enters the schema** —
which is why it is written here and in the test rather than assumed.

The residual risk is a denial of service against PostGIS itself by an attacker holding the
anon key: delete SRID 4326 and geography casts start failing. That is real, it is not
data disclosure, and it is identical on every Supabase project using PostGIS.

## What would close it

`supabase_admin`, which Supabase does not expose through the SQL editor, the CLI or the
migration role. It is therefore a project-setup step against the platform rather than a
migration, and belongs in `docs/04-setup-github-vercel-supabase.md` beside the other
things only an owner can do. If Supabase ever exposes it, the two `002` assertions fail
the moment the hole closes, and whoever closed it flips them back — which is the point of
writing a gap down as a test rather than a TODO.

## Rejected alternatives

**Leave `main` red.** It had already cost nine sessions over an hour, every open pull
request was inheriting the failure, and a permanently red suite stops being read at all —
which is worse for security than a recorded gap, because the next real regression hides in
the noise.

**Delete the four assertions.** Cheapest, and it loses the record. The gap stops being
visible anywhere a developer looks.

**Retry the migration with more force** (`alter table ... owner to postgres`, or revoking
as `postgres`). Fails on Supabase for the reason the successor migration already
established, and a migration that tries and silently degrades is what produced this
situation in the first place.
