-- =====================================================================
-- The client card (§9.7) — the rate card, the qualified pool and the
-- client's own events
--
-- §9.7's card is four blocks. The first is the directory row the /clients
-- migration already assembles, so this adds the other three and the rate
-- card's write paths.
--
-- The rate card is the only place in the system where a charge rate or a
-- dress code can be set. §9.7 is explicit about both:
--
--   "the manager sets and edits the charge rate and the dress code — both
--    are individual to each client, and this is the only place either can
--    be added or edited, not in the Roles section"
--
-- and about how a role gets onto it at all: explicitly, from the §9.8
-- catalogue, never automatically. "Roles are not shared automatically
-- across all clients — each client's Rate card holds its own explicitly-
-- added set."
--
-- A NOTE ON THE NAMES. Every view here is `clients_`, plural. The
-- singular `client_` prefix is reserved for views the Client Portal
-- reaches, and 050_client_views.sql enforces that none of them carries a
-- money column (§11.1, ADR-0004). These three are Back Office views built
-- on charge rates, and the first draft of this file called them
-- `client_rate_card_v`, `client_qualified_staff_v` and
-- `client_events_list_v` — which broke that guard immediately, and would
-- have been a charge rate one rename away from the customer's screen. The
-- clients directory migration made the same mistake and recorded the same
-- reason; this is the second time, so it is written down again here.
-- =====================================================================

create index if not exists client_rate_cards_client_idx on client_rate_cards (client_id);
create index if not exists events_client_date_idx on events (client_id, event_date desc);

-- ---------------------------------------------------------------------
-- clients_rate_card_v — block 2
--
-- Base pay comes from the Roles catalogue, final pay is base × 1.1207,
-- and the margin is charge − final. Every one of those is computed here
-- rather than in the screen, through final_rate() — the same function
-- the Roles directory and every payroll figure use. §9.8: "All margin
-- across the system is calculated from this figure", and a second
-- implementation in TypeScript is how two screens come to disagree about
-- what a client is worth.
--
-- The margin percentage is of the CHARGE, not of the pay: it is the share
-- of what the client pays that THC keeps. Dividing by the pay instead
-- gives a bigger, flattering number that means nothing.
-- ---------------------------------------------------------------------
create or replace view clients_rate_card_v with (security_invoker = true) as
select
  rc.id,
  rc.client_id,
  rc.role_id,
  r.name                                                     as role_name,
  r.description                                              as role_description,
  rc.charge_rate,
  r.pay_rate                                                 as base_pay_rate,
  final_rate(r.pay_rate)                                     as final_pay_rate,
  rc.charge_rate - final_rate(r.pay_rate)                    as margin_per_hour,
  case
    when rc.charge_rate > 0
      then round((1 - final_rate(r.pay_rate) / rc.charge_rate) * 100, 1)
  end                                                        as margin_pct,
  rc.dress_codes,
  -- A role already used on a built event is not blocked from editing —
  -- §9.7 says editing must "stay available on an ongoing basis, since
  -- both staff pay rates and client charge rates can change during the
  -- year". The count is here so the screen can say what a change will not
  -- affect: shift_requirements snapshots the rate at build time.
  (select count(*) from shift_requirements s
     join events e on e.id = s.event_id
    where e.client_id = rc.client_id and s.role_id = rc.role_id)::int as section_count
from client_rate_cards rc
join roles r on r.id = rc.role_id;

comment on view clients_rate_card_v is
  '§9.7 block 2: this client''s charge rate and dress codes per role, with base pay from the §9.8 catalogue and final pay and margin derived through final_rate() — the one definition of the 12.07% (§9.8). margin_pct is of the charge, the share of what the client pays that THC keeps.';

-- ---------------------------------------------------------------------
-- clients_qualified_staff_v — block 3
--
-- The §9.6 list read from the other end. One row per WORKER, not per
-- qualification, because §9.7 asks for "qualified role(s) at this client"
-- on a single line per person and a per-role counter beside the group
-- header — so the roles are aggregated and the screen groups by them.
--
-- The whole worker row comes through staff_directory_v, which means
-- §1.7's anonymisation applies here too: a removed worker who is still
-- cleared reads as "Deleted account #id" rather than by name.
-- ---------------------------------------------------------------------
create or replace view clients_qualified_staff_v with (security_invoker = true) as
select
  q.client_id,
  d.id                                                       as staff_id,
  d.display_name,
  d.employee_id,
  d.photo_path,
  d.status,
  d.rating,
  d.reliability,
  array_agg(r.name order by r.name)                          as role_names,
  array_agg(q.role_id order by r.name)                       as role_ids,
  -- The entry ids, in the same order, so a Remove on this screen targets
  -- the row the manager clicked rather than one the view picked.
  array_agg(q.id order by r.name)                            as qualification_ids,
  -- Do not return is client-wide even though it is stored per entry: the
  -- auto-assign gate reads "any do_not_return row at this client"
  -- (20260921141500), so a worker barred through one role is barred for
  -- all of them and the row must say so rather than showing a mixture.
  bool_or(q.do_not_return)                                   as do_not_return,
  min(q.granted_at)                                          as first_granted_at,
  max(q.granted_at)                                          as last_granted_at,
  -- "How granted" on a row that aggregates several entries: manual wins,
  -- because a manager's decision is the more specific fact and the one
  -- they will look for when deciding whether to remove somebody.
  case when bool_or(q.granted_by is not null) then 'manual' else 'automatic' end as granted_how,
  max(p.full_name)                                           as granted_by_name,
  max(ev.title)                                              as granted_from_event_title,
  max(ev.event_date)                                         as granted_from_event_date,
  string_agg(q.note, ' · ') filter (where q.note is not null) as notes
from client_qualifications q
join staff_directory_v d on d.id = q.staff_id
join roles r on r.id = q.role_id
left join profiles p on p.id = q.granted_by
left join events ev on ev.id = q.granted_from_event
group by q.client_id, d.id, d.display_name, d.employee_id, d.photo_path,
         d.status, d.rating, d.reliability;

comment on view clients_qualified_staff_v is
  '§9.7 block 3: the workers cleared at a client, one row each with every role they hold here. Reads through staff_directory_v, so §1.7''s anonymisation is not repeated. do_not_return is bool_or across the entries because the gate is client-wide (RULE-17).';

-- ---------------------------------------------------------------------
-- clients_event_list_v — block 4
--
-- §9.7's columns, and two of them are decisions rather than lookups.
--
-- The date column is "the derived event window" (§3.2): min start to max
-- end across the role sections, never a stored pair. Role sections at
-- different times are exactly why RULE-18 exists, and this is the one
-- place the event window is the right answer.
--
-- The margin is FORECAST for an event that has not happened: it is what
-- the event was built to earn, headcount × hours × (charge − final).
-- Cancelled events are excluded from the figure but NOT from the list —
-- the manager still needs to see them, so `margin_gbp` is null there
-- rather than zero, which would drag an average down.
-- ---------------------------------------------------------------------
create or replace view clients_event_list_v with (security_invoker = true) as
select
  e.id,
  e.client_id,
  e.title,
  e.po_number,
  e.event_date,
  w.starts_at,
  w.ends_at,
  e.venue_name,
  e.cancelled_at,
  event_status(e.*, w.starts_at, w.ends_at)                  as status,
  (select count(*) from shift_requirements s where s.event_id = e.id)::int as section_count,
  (select string_agg(r.name || ' ' || s.headcount || ' (+' || s.buffer || ')', ' · '
                     order by r.name)
     from shift_requirements s join roles r on r.id = s.role_id
    where s.event_id = e.id)                                 as roles_summary,
  case when e.cancelled_at is null then (
    select round(sum((s.charge_rate - final_rate(s.pay_rate)) * s.headcount
                     * extract(epoch from (s.ends_at - s.starts_at)) / 3600), 2)
      from shift_requirements s where s.event_id = e.id
  ) end                                                      as margin_gbp,
  case when e.cancelled_at is null then (
    select case when sum(s.charge_rate * s.headcount
                         * extract(epoch from (s.ends_at - s.starts_at)) / 3600) > 0
                then round((1 - sum(final_rate(s.pay_rate) * s.headcount
                                    * extract(epoch from (s.ends_at - s.starts_at)) / 3600)
                              / sum(s.charge_rate * s.headcount
                                    * extract(epoch from (s.ends_at - s.starts_at)) / 3600)) * 100, 1)
           end
      from shift_requirements s where s.event_id = e.id
  ) end                                                      as margin_pct
from events e
join event_windows w on w.event_id = e.id;

comment on view clients_event_list_v is
  '§9.7 block 4: every event for a client with its PO, the DERIVED window (§3.2 — min start to max end across role sections, never a stored pair), its role sections and its margin. A cancelled event keeps its row but has a null margin, not a zero one: zero would pull an average down with money nobody ever expected.';

-- =====================================================================
-- Rate card writes (§9.7)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Adding a role to a client's rate card.
--
-- §9.7: the dropdown lists the §9.8 catalogue, and "If the role you need
-- isn't in the dropdown yet, it must first be created in the Roles
-- section". So an unknown role is an error here rather than something
-- this function creates — creating one silently is how the catalogue
-- fills up with a client's typo.
--
-- The charge rate is rejected with a third decimal rather than rounded,
-- for the same reason the Roles migration rejects one on the pay rate: a
-- numeric(8,2) column turns £22.975 into £22.98 and never mentions it,
-- and every margin on this screen is derived from the figure.
-- ---------------------------------------------------------------------
create or replace function public.assert_charge_rate(p_rate numeric)
returns void
language plpgsql immutable as $$
begin
  if p_rate is null or p_rate < 0 then
    raise exception 'A charge rate cannot be negative' using errcode = 'check_violation';
  end if;
  if p_rate <> round(p_rate, 2) then
    raise exception 'A charge rate is in pounds and pence — % has more precision than the column keeps', p_rate
      using errcode = 'check_violation';
  end if;
end $$;

create or replace function public.add_client_role(
  p_client      uuid,
  p_role        uuid,
  p_charge_rate numeric,
  p_dress_codes text[] default '{}'
) returns uuid
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from clients where id = p_client) then
    raise exception 'unknown_client' using errcode = 'P0001';
  end if;
  if not exists (select 1 from roles where id = p_role) then
    raise exception 'A role must exist in the Roles catalogue before it can be added to a rate card (§9.7, §9.8)'
      using errcode = 'P0001';
  end if;
  perform assert_charge_rate(p_charge_rate);

  insert into client_rate_cards (client_id, role_id, charge_rate, dress_codes)
  values (p_client, p_role, p_charge_rate, coalesce(p_dress_codes, '{}'))
  on conflict (client_id, role_id) do update
    set charge_rate = excluded.charge_rate,
        dress_codes = excluded.dress_codes
  returning id into v_id;

  return v_id;
end $$;

comment on function public.add_client_role(uuid, uuid, numeric, text[]) is
  '§9.7: adds a role from the §9.8 catalogue to a client''s rate card with its charge rate and dress codes. An unknown role is refused rather than created — the catalogue is not filled in from here.';

create or replace function public.update_client_role(
  p_id          uuid,
  p_charge_rate numeric,
  p_dress_codes text[]
) returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
begin
  perform assert_charge_rate(p_charge_rate);

  update client_rate_cards
     set charge_rate = p_charge_rate,
         dress_codes = coalesce(p_dress_codes, '{}')
   where id = p_id;

  if not found then
    raise exception 'unknown_rate_card_row' using errcode = 'P0001';
  end if;

  return jsonb_build_object('id', p_id::text);
end $$;

comment on function public.update_client_role(uuid, numeric, text[]) is
  '§9.7: the charge rate and the dress-code list for one client + role. The only place either can be edited, and it stays open all year because both staff pay and charge rates change (§9.7).';

-- ---------------------------------------------------------------------
-- Removing a role from a rate card.
--
-- This does NOT touch any event. shift_requirements copies the charge
-- rate, the pay rate and the dress code at build time (§3.2), so an event
-- already in the diary keeps what it was built with and every historical
-- margin stays correct. Deleting the row only stops the role being
-- offered when the next event for this client is built.
--
-- Not to be confused with deleting a client, which §9.7 forbids outright
-- and which has no function anywhere.
-- ---------------------------------------------------------------------
create or replace function public.remove_client_role(p_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v client_rate_cards;
begin
  select * into v from client_rate_cards where id = p_id;
  if v.id is null then
    raise exception 'unknown_rate_card_row' using errcode = 'P0001';
  end if;

  delete from client_rate_cards where id = p_id;
  return jsonb_build_object('id', p_id::text, 'removed', true);
end $$;

comment on function public.remove_client_role(uuid) is
  '§9.7: drops a role from a client''s rate card. Events already built are untouched — shift_requirements snapshots the charge rate, pay rate and dress code at build time (§3.2) — so this only removes the role from the next event''s options.';
