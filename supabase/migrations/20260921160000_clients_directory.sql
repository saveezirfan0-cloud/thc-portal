-- =====================================================================
-- Clients directory (§9.7)
--
-- Why this exists
-- ---------------
-- 0001_init.sql has `clients` and `client_rate_cards`. The /clients list
-- shows four things that are not on the row:
--
--   1. The rate-card roles, as names. The directory prints them as chips,
--      and the client card groups by them.
--   2. How many events the client has.
--   3. The average margin. The wireframe defines it exactly:
--      (charge − final pay) ÷ charge across completed events, after
--      holiday pay. It is money and it is a weighted mean, so it belongs
--      in SQL next to final_rate(), not in a screen.
--   4. Nothing else — §9.7 is explicit that a client record can be edited
--      at any time and never deleted, so there is no delete function here.
--
-- security invoker throughout: `clients` and `client_rate_cards` both
-- carry admin_all and nothing else, and client_rate_cards carries
-- charge_rate, which §11.1 keeps from the client absolutely.
-- =====================================================================

create index if not exists client_rate_cards_client_id_idx on client_rate_cards (client_id);
create index if not exists events_client_id_idx on events (client_id);

-- ---------------------------------------------------------------------
-- client_margins_v — the average margin, per client
--
-- §9.7: "(charge − final pay) ÷ charge across completed events, after
-- holiday pay". Three decisions the one-line definition leaves open, taken
-- here so every screen quoting a margin quotes the same number:
--
--   · "final pay" is final_rate(pay_rate) — base plus the 12.07% holiday
--     element (§9.8). Margin is never computed against the base alone.
--   · "across completed events" is weighted, not a mean of means. A role
--     section for 20 people over 8 hours has to count for more than one
--     person for 4. The weight is headcount * hours, so the result is the
--     margin on the money rather than the average of the percentages.
--   · Sections are read from the event as BUILT (§3.2 copies the rates
--     onto shift_requirements), so a later change to a role's base rate
--     or a client's charge rate never rewrites history.
--
-- Cancelled events and events still to come are both excluded: neither has
-- been delivered, and a margin on an event that never ran is not a margin.
-- ---------------------------------------------------------------------
create or replace view client_margins_v with (security_invoker = true) as
select
  e.client_id,
  count(distinct e.id)::int as completed_events,
  sum(s.charge_rate * s.headcount * extract(epoch from (s.ends_at - s.starts_at)) / 3600)
    as charge_total,
  sum(final_rate(s.pay_rate) * s.headcount * extract(epoch from (s.ends_at - s.starts_at)) / 3600)
    as pay_total
from events e
join shift_requirements s on s.event_id = e.id
where e.cancelled_at is null
  and e.event_date < (now() at time zone 'Europe/London')::date
group by e.client_id;

comment on view client_margins_v is
  'Charge and final-pay totals per client across completed events (§9.7), weighted by headcount and section hours. The margin is 1 - pay_total/charge_total; the two totals are exposed rather than the ratio so a caller can aggregate further without averaging an average.';

-- ---------------------------------------------------------------------
-- client_directory_v — one row per client, everything /clients renders
-- ---------------------------------------------------------------------
create or replace view client_directory_v with (security_invoker = true) as
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
  -- Null rather than zero where nothing has been delivered yet: a client
  -- with no completed event has no margin, which is not the same as 0%.
  (select case when m.charge_total > 0 then round((1 - m.pay_total / m.charge_total) * 100, 1) end
     from client_margins_v m where m.client_id = c.id)                        as avg_margin_pct
from clients c;

comment on view client_directory_v is
  'The /clients directory (§9.7): the client, its two policies, its rate-card role names, how many events it has and its average margin. security_invoker — clients and client_rate_cards are admin-only, and charge_rate never leaves the database for a client (§11.1).';

-- ---------------------------------------------------------------------
-- Writes
--
-- §9.7: every field on the form is mandatory and there is no Delete —
-- a client record cannot be removed from the system, only edited.
-- ---------------------------------------------------------------------
create or replace function assert_client_input(
  p_name text, p_contact_name text, p_phone text,
  p_staff_contact_point text, p_contact_emails text[]
) returns void
language plpgsql immutable as $$
declare v_email text;
begin
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'A client needs a name' using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_contact_name), '') = '' then
    raise exception 'A client needs a contact name' using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_phone), '') = '' then
    raise exception 'A client needs a contact phone' using errcode = 'check_violation';
  end if;
  -- The on-site contact the staff see at the venue; it pre-fills every
  -- event built for this client (§3.2), so an empty one is not a blank
  -- field, it is every future allocation sheet missing who to ask for.
  if coalesce(btrim(p_staff_contact_point), '') = '' then
    raise exception 'A client needs a staff contact point' using errcode = 'check_violation';
  end if;
  if p_contact_emails is null or array_length(p_contact_emails, 1) is null then
    raise exception 'A client needs at least one contact email' using errcode = 'check_violation';
  end if;
  -- The allocation sheet and the timesheet go to every address here
  -- (§11.4). One that does not resolve is a document nobody receives.
  foreach v_email in array p_contact_emails loop
    if btrim(v_email) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      raise exception '% is not an email address', v_email using errcode = 'check_violation';
    end if;
  end loop;
end;
$$;

create or replace function create_client(
  p_name text, p_contact_name text, p_phone text, p_staff_contact_point text,
  p_contact_emails text[], p_pays_breaks boolean, p_pays_buffer boolean
) returns uuid
language plpgsql security invoker as $$
declare v_id uuid;
begin
  perform assert_client_input(p_name, p_contact_name, p_phone, p_staff_contact_point, p_contact_emails);
  if p_pays_breaks is null or p_pays_buffer is null then
    raise exception 'Both policies are mandatory; neither has a "not set" state'
      using errcode = 'check_violation';
  end if;

  insert into clients (name, contact_name, phone, staff_contact_point, contact_emails,
                       pays_breaks, pays_buffer)
  values (btrim(p_name), btrim(p_contact_name), btrim(p_phone), btrim(p_staff_contact_point),
          (select array_agg(btrim(e)) from unnest(p_contact_emails) e),
          p_pays_breaks, p_pays_buffer)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function create_client is
  'Creates a client (§9.7). Every field is mandatory, including both policies: neither switch has a "not set" state.';

create or replace function update_client(
  p_id uuid, p_name text, p_contact_name text, p_phone text, p_staff_contact_point text,
  p_contact_emails text[], p_pays_breaks boolean, p_pays_buffer boolean
) returns void
language plpgsql security invoker as $$
begin
  perform assert_client_input(p_name, p_contact_name, p_phone, p_staff_contact_point, p_contact_emails);
  if p_pays_breaks is null or p_pays_buffer is null then
    raise exception 'Both policies are mandatory; neither has a "not set" state'
      using errcode = 'check_violation';
  end if;

  -- The two policies are copied onto an event when it is built (§3.2), so
  -- changing them here moves the next event, never one already in the diary.
  update clients set
    name                = btrim(p_name),
    contact_name        = btrim(p_contact_name),
    phone               = btrim(p_phone),
    staff_contact_point = btrim(p_staff_contact_point),
    contact_emails      = (select array_agg(btrim(e)) from unnest(p_contact_emails) e),
    pays_breaks         = p_pays_breaks,
    pays_buffer         = p_pays_buffer
  where id = p_id;

  if not found then
    raise exception 'No client %', p_id using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function update_client is
  'Edits a client (§9.7). There is deliberately no delete_client: a client record cannot be removed from the system, only edited. Policy changes apply to events built from now on; events already built carry their own copy.';
