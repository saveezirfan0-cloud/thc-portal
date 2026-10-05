-- =====================================================================
-- Venues and Clients: who added the record, and when (§9.7, §9.11)
--
-- Why this exists
-- ---------------
-- /venues and /clients are the two directories the office keeps by hand,
-- and with several managers adding to them the first question about a
-- record is "who put this here, and when?". `created_at` has been on both
-- tables since 0001 and both directory views already return it; nothing
-- recorded WHO, so the lists could not show it or filter by it.
--
--   1. venues.created_by / clients.created_by — the signed-in manager who
--      made the row. A column DEFAULT of auth.uid() stamps it, so
--      create_venue and create_client (both `security invoker`, both
--      inserting as the caller) record it without a change to either, and
--      nobody can forget to pass it. Rows that already exist, and rows
--      written by the migration role or the seed, have no session and so
--      carry NULL: the screens print "—", not a guess.
--      `on delete set null`: removing a manager's login must not take the
--      venue or the client with it.
--
--   2. office_user_name(uuid) — the manager's name. It lives in `profiles`,
--      whose only policy is profiles_self (010_rls_admin pins that as a
--      known gap), so a security_invoker view would name the signed-in
--      manager and print NULL for every colleague. ADR-0016 solved the
--      same problem for /feedback by giving the whole view owner rights;
--      these two directory views carry the clients' rate cards and the
--      venues' geofences and are read by other callers too, so widening
--      THEM is the larger change. A narrow definer function is not: it
--      answers one question — "what is this office user called?" — for an
--      admin asking about another admin, and returns NULL to everyone
--      else. Both views stay security_invoker.
--
-- Forward-only. `create or replace view` can only append columns, which is
-- all this does, so every existing column keeps its position and every
-- existing grant on the views is kept.
-- =====================================================================

alter table venues
  add column if not exists created_by uuid references profiles(id) on delete set null
    default auth.uid();
alter table clients
  add column if not exists created_by uuid references profiles(id) on delete set null
    default auth.uid();

comment on column venues.created_by is
  'The manager who added the venue (§9.11): stamped from the session by the column default, NULL for rows that pre-date it or were written without one.';
comment on column clients.created_by is
  'The manager who added the client (§9.7): stamped from the session by the column default, NULL for rows that pre-date it or were written without one.';

-- Every foreign key is indexed (20260921123503_db_hardening).
create index if not exists venues_created_by_idx  on venues (created_by);
create index if not exists clients_created_by_idx on clients (created_by);

-- ---------------------------------------------------------------------
-- office_user_name — an office user's name, for an office user
--
-- Admin asking about an admin; NULL otherwise. A client or a worker who
-- reaches the function by RPC learns nothing, and neither does an admin
-- asking about a worker or a portal user: the directories only ever name
-- the manager who added a row.
-- ---------------------------------------------------------------------
create or replace function public.office_user_name(p_id uuid)
returns text
language sql stable security definer
set search_path = public
as $$
  select p.full_name
    from profiles p
   where p.id = p_id
     and p.role = 'admin'
     and current_app_role() = 'admin'
$$;

comment on function public.office_user_name(uuid) is
  'The name of the office user p_id, for a signed-in office user and nobody else (NULL for any other caller or any non-office target). Owner rights because profiles'' only policy is profiles_self; the narrow answer is the point (20261004100000).';

revoke all on function public.office_user_name(uuid) from public, anon;
grant execute on function public.office_user_name(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- The two directory views gain created_by and created_by_name
-- ---------------------------------------------------------------------
create or replace view venue_directory_v with (security_invoker = true) as
select
  v.id,
  v.name,
  v.address,
  v.venue_type,
  vt.label                                   as venue_type_label,
  vt.default_radius_m,
  v.geofence_radius_m,
  st_y(v.location::geometry)                 as lat,
  st_x(v.location::geometry)                 as lng,
  v.created_at,
  (select count(*) from events e
     where e.venue_id = v.id and e.cancelled_at is null
       and e.event_date <  (now() at time zone 'Europe/London')::date)::int as events_past,
  (select count(*) from events e
     where e.venue_id = v.id and e.cancelled_at is null
       and e.event_date >= (now() at time zone 'Europe/London')::date)::int as events_upcoming,
  v.created_by,
  office_user_name(v.created_by)             as created_by_name
from venues v
join venue_types vt on vt.key = v.venue_type
where v.deleted_at is null;

create or replace view clients_directory_v with (security_invoker = true) as
select
  c.id,
  c.name,
  c.contact_name,
  c.phone,
  c.staff_contact_point,
  c.contact_emails,
  c.pays_breaks,
  c.pays_buffer,
  c.created_at,
  coalesce(
    (select array_agg(r.name order by r.name)
       from client_rate_cards rc join roles r on r.id = rc.role_id
      where rc.client_id = c.id),
    '{}'::text[]
  ) as rate_card_roles,
  (select count(*) from client_rate_cards rc where rc.client_id = c.id)::int as rate_card_count,
  (select count(*) from events e
     where e.client_id = c.id and e.cancelled_at is null)::int                as event_count,
  (select case when m.charge_total > 0 then round((1 - m.pay_total / m.charge_total) * 100, 1) end
     from clients_margins_v m where m.client_id = c.id)                        as avg_margin_pct,
  c.created_by,
  office_user_name(c.created_by)                                               as created_by_name
from clients c;
