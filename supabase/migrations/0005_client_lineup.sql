-- =====================================================================
-- Migration 0005 · the Client Portal's confirmed line-up (§11.1, §11.2)
--
-- Why this exists
-- ---------------
-- client_lineup_v returned nothing to the one role it was written for. It
-- was a `security_invoker` view, so it ran with the caller's privileges,
-- and it joins bookings, shift_requirements, roles and staff. After
-- 0002_client_money_isolation the client role holds a policy on exactly two
-- tables — events (select) and feedback (insert) — so every join in the
-- line-up hit a table the client cannot read and row level security
-- filtered the result to nothing. §11.2's "photo · name · role, grouped by
-- role" had no data path at all.
--
-- ADR-0004 (docs/adr/0004-client-lineup-data-path.md) records the choice
-- between the two honest fixes and takes the second:
--
--   A. Give the client select policies on bookings, shift_requirements,
--      roles and staff, which is what an invoker view needs. That undoes
--      0002. `roles` carries pay_rate and shift_requirements carries
--      charge_rate AND pay_rate, and Supabase grants the `authenticated`
--      PostgREST role DML on every table in public, so a policy on those
--      tables is a policy on the money. It would also put every worker's
--      date of birth, address, NI number and right-to-work state inside a
--      customer's reach.
--
--   B. Let the view run with its owner's rights and carry the tenancy rule
--      in its own body. The base tables stay exactly as 0002 and 0004 left
--      them, and the client keeps one route to worker data that can only
--      ever return the columns §11.2 names.
--
-- This is not a new pattern here: `event_windows` has run with owner rights
-- since 0001, and 0002 relies on it for the client's event window.
--
-- What changes is where the tenancy check lives. RLS on the tables
-- underneath is bypassed for the view owner, so client_portal_visible() is
-- not a convenience filter — it is the whole of §11.1's "they see only
-- their own events". Three defences keep that honest:
--
--   1. One predicate, used by both views. Nothing without a client profile
--      row matches it.
--   2. security_barrier = true, so a user-supplied function in a WHERE
--      clause cannot be evaluated ahead of that predicate.
--   3. select is granted to `authenticated` only; anon is revoked outright
--      rather than left to return an empty set because auth.uid() is null.
--
-- Forward-only: 0001, 0002 and 0004 are left untouched.
-- =====================================================================

-- ---------------------------------------------------------------------
-- The tenancy predicate (§11.1 "they see only their own events")
--
-- Not `security definer` itself: current_app_role() and current_client_id()
-- already are, and they read nothing but the caller's own profile row. A
-- client profile with a null client_id matches no event rather than every
-- event, which is what the coalesce is for.
-- ---------------------------------------------------------------------
create or replace function public.client_portal_visible(p_client_id uuid)
returns boolean
language sql stable set search_path = public as
$$
  select coalesce(
    case current_app_role()
      when 'client' then p_client_id = current_client_id()
      when 'admin'  then true
      else false
    end, false)
$$;

comment on function public.client_portal_visible(uuid) is
  'Tenancy predicate for the client_* views (§11.1, ADR-0004). True for the admin, true for a client on its own client_id, false for everybody else. Those views run with owner rights, so this call is the access control, not a filter.';

-- ---------------------------------------------------------------------
-- §11.2 · the confirmed line-up
--
-- The body is unchanged from 0001 apart from the join to events and the
-- predicate: ONLY confirmed staff (a `closed` booking lost the invite to
-- first-to-confirm and a `turned_away` one never worked, so neither is part
-- of the line-up the customer is promised), the role-section window rather
-- than the event window (RULE-18), and a removed worker reads as
-- "Deleted account #id" with no photo (§1.7).
--
-- Dropped and recreated rather than replaced: the view is losing the
-- security_invoker reloption, and dropping says so unambiguously.
-- ---------------------------------------------------------------------
drop view if exists client_lineup_v;

create view client_lineup_v with (security_barrier = true) as
  select b.id as booking_id,
         sr.event_id,
         r.name as role,
         sr.starts_at,
         sr.ends_at,
         case when s.removed_at is null then s.first_name || ' ' || s.last_name
              else 'Deleted account #' || s.employee_id end as name,
         case when s.removed_at is null then s.photo_path end as photo_path
    from bookings b
    join shift_requirements sr on sr.id = b.shift_id
    join events e              on e.id  = sr.event_id
    join roles r               on r.id  = sr.role_id
    join staff s               on s.id  = b.staff_id
   where b.status in ('confirmed', 'worked')
     and client_portal_visible(e.client_id);

comment on view client_lineup_v is
  'The confirmed line-up a customer sees (§11.2). Owner rights + client_portal_visible() per ADR-0004; the client role holds no policy on bookings, shift_requirements, roles or staff and must not be given one. Photo, name and role only: never a rate, never the selection process (Invited / Potential pool / Unavailable).';

-- ---------------------------------------------------------------------
-- §11.1 · "N of M confirmed"
--
-- M is the headcount the customer ordered and it lives on the
-- money-bearing shift_requirements row, so the client cannot read it
-- directly (0002). N is the confirmed count — RULE: fill counts ONLY
-- confirmed, and it matches row-for-row what client_lineup_v returns for
-- the same section.
--
-- `buffer` is deliberately absent. The buffer is THC's own over-booking
-- (displayed internally as `6 (+1)`); §11.1 shows the customer N of M.
-- Rates are absent for the same reason the table is closed.
-- ---------------------------------------------------------------------
create view client_role_sections_v with (security_barrier = true) as
  select sr.id as shift_id,
         sr.event_id,
         r.name as role,
         sr.starts_at,
         sr.ends_at,
         sr.headcount,
         (select count(*)
            from bookings b
           where b.shift_id = sr.id
             and b.status in ('confirmed', 'worked'))::int as confirmed
    from shift_requirements sr
    join events e on e.id = sr.event_id
    join roles r  on r.id = sr.role_id
   where client_portal_visible(e.client_id);

comment on view client_role_sections_v is
  'Role sections as the customer sees them (§11.1 "N of M confirmed", §11.2 grouped by role). Owner rights + client_portal_visible() per ADR-0004. Carries the role-section window (RULE-18), the ordered headcount and the confirmed count — no charge_rate, no pay_rate, no buffer.';

-- ---------------------------------------------------------------------
-- Privileges
--
-- Supabase grants anon, authenticated and service_role everything on new
-- objects in `public` by default. §11.1 is read-only and signed-in, so both
-- views are taken back to select-for-authenticated. service_role keeps its
-- default grant: the PDF and report jobs run on the service key.
-- ---------------------------------------------------------------------
revoke all on client_lineup_v        from public, anon, authenticated;
revoke all on client_role_sections_v from public, anon, authenticated;
grant select on client_lineup_v        to authenticated;
grant select on client_role_sections_v to authenticated;
