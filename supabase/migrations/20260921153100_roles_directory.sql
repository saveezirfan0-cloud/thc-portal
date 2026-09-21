-- =====================================================================
-- Roles & rates (§9.8)
--
-- Why this exists
-- ---------------
-- 0001_init.sql has the `roles` table and `final_rate(base)`. Three things
-- the /roles screen needs are missing:
--
--   1. The two derived columns, next to the row. §9.8 shows Staff pay rate,
--      Holiday +12.07% and Final rate in one table, and §1.5 says the
--      holiday element is calculated and never stored. Computing it in the
--      screen would put the 12.07% in a second place.
--   2. "On rate cards" — how many clients have this role on their rate card
--      (§9.7). It is the column the list shows, and it is also what decides
--      whether a role may be deleted.
--   3. A delete that refuses while the role is in use. §9.8 has Delete per
--      row; a role on a rate card or on a built event cannot go, because
--      client_rate_cards and shift_requirements both reference it. Without
--      the guard the manager gets a foreign-key error instead of an answer.
--
-- Everything is security invoker, so `roles`' RLS decides who may read and
-- write: admin_all from 0001, and no policy for staff or client. A worker
-- sees a rate only through their own booking, never through this.
-- =====================================================================

-- The two counts below are read once per role, and again by delete_role.
create index if not exists client_rate_cards_role_id_idx on client_rate_cards (role_id);
create index if not exists shift_requirements_role_id_idx on shift_requirements (role_id);

-- ---------------------------------------------------------------------
-- role_directory_v — one row per role, everything /roles renders
--
-- `holiday` and `final` are derived here so the 12.07% lives in exactly two
-- places that are tested against each other: final_rate() in SQL and
-- HOLIDAY_RATE in packages/domain. The screen holds neither.
-- ---------------------------------------------------------------------
create or replace view role_directory_v with (security_invoker = true) as
select
  r.id,
  r.name,
  r.description,
  r.pay_rate,
  round(r.pay_rate * 0.1207, 2)              as holiday_rate,
  final_rate(r.pay_rate)                     as final_rate,
  r.created_at,
  (select count(*) from client_rate_cards c where c.role_id = r.id)::int    as rate_card_count,
  (select count(*) from shift_requirements s where s.role_id = r.id)::int   as section_count
from roles r;

comment on view role_directory_v is
  'The /roles table (§9.8): the base rate with its holiday element and final rate derived, plus how many client rate cards and how many built role sections use the role. security_invoker, so roles'' RLS applies unchanged.';

-- ---------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------
create or replace function assert_role_input(p_name text, p_pay_rate numeric)
returns void
language plpgsql immutable as $$
begin
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'A role needs a name' using errcode = 'check_violation';
  end if;
  if p_pay_rate is null or p_pay_rate < 0 then
    raise exception 'A pay rate cannot be negative' using errcode = 'check_violation';
  end if;
  -- Two decimals, because the rate is money and the table stores numeric(8,2).
  -- Rounding silently would change a rate the manager typed.
  if p_pay_rate <> round(p_pay_rate, 2) then
    raise exception 'A pay rate is set to the penny' using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function create_role(p_name text, p_pay_rate numeric, p_description text)
returns uuid
language plpgsql security invoker as $$
declare v_id uuid;
begin
  perform assert_role_input(p_name, p_pay_rate);
  insert into roles (name, pay_rate, description)
  values (btrim(p_name), p_pay_rate, nullif(btrim(coalesce(p_description, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;

comment on function create_role is
  'Adds a role to the catalogue (§9.8). The name is unique: a second "Bar Staff" would make the rate-card picker ambiguous.';

create or replace function update_role(
  p_id uuid, p_name text, p_pay_rate numeric, p_description text
) returns void
language plpgsql security invoker as $$
begin
  perform assert_role_input(p_name, p_pay_rate);
  -- A rate change applies to events built from now on. Events already built
  -- carry their own pay_rate and charge_rate on shift_requirements, so
  -- nothing in the diary reprices behind the manager's back (§3.2, §9.8).
  update roles set
    name        = btrim(p_name),
    pay_rate    = p_pay_rate,
    description = nullif(btrim(coalesce(p_description, '')), '')
  where id = p_id;

  if not found then
    raise exception 'No role %', p_id using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function update_role is
  'Edits a role (§9.8). Changing the base rate never reprices an event that is already built: shift_requirements carries its own copy.';

create or replace function delete_role(p_id uuid) returns void
language plpgsql security invoker as $$
declare v_cards int; v_sections int;
begin
  select count(*) into v_cards    from client_rate_cards   where role_id = p_id;
  select count(*) into v_sections from shift_requirements  where role_id = p_id;

  -- §9.8's Delete, with the wireframe's guard: a role in use cannot go.
  -- Both references are hard ones — a rate card without its role has no
  -- charge rate and no dress code, and a past event's role section is the
  -- record of what someone was paid for.
  if v_cards > 0 or v_sections > 0 then
    raise exception
      'This role is on % rate card(s) and % event role section(s); remove it from those rate cards first',
      v_cards, v_sections
      using errcode = 'foreign_key_violation';
  end if;

  delete from roles where id = p_id;

  if not found then
    raise exception 'No role %', p_id using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function delete_role is
  'Deletes an unused role (§9.8). Refuses while any client rate card or any built role section still references it, so the manager gets the reason rather than a foreign-key error.';
