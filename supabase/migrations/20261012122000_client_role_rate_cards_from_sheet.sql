-- =====================================================================
-- Rate cards and uniforms for eight client + role pairs · from THC's
-- completed "Uniforms and rates to confirm" sheet (12.10.2026)
--
-- Follows 20261012100000_client_role_uniforms.sql, which could only fill
-- uniforms on rate cards that already existed. These pairs had no card, and
-- a card needs a charge rate, which THC has now confirmed. Each card is a
-- default, not a lock: the charge rate and the uniform stay editable on the
-- client's page (§9.7) and per event in the Shift Builder (§3.2).
--
-- Not included: the ten pairs whose rate THC left unconfirmed in the sheet
-- (Leonardo M&E x5, Hackney Town Council and Clissold House x4, Leonardo NYX
-- Kitchen Porter). They are added once a rate is given.
--
-- An existing card is never overwritten. A name that does not resolve is
-- skipped and reported in a notice.
-- =====================================================================

do $$
declare
  expected int;
  added int;
begin
  create temp table rate_sheet (
    client_name text not null,
    role_name   text not null,
    uniform     text not null,
    charge_rate numeric(8,2) not null
  ) on commit drop;

  insert into rate_sheet (client_name, role_name, uniform, charge_rate) values
    ('Leonardo Hotel St Paul''s - Sabine Bar', 'Bar Staff',
      'Plain White Long Sleeved Collared Shirt (clean and pressed); Plain Black Trousers (not jeans/denim/cargo); Black Socks (not white socks); Black Leather Polishable Shoes (no trainers)',
      18.98),
    ('Rhubarb at Sky Garden', 'Lifting and Shifting',
      'Appropriate footwear (can be trainers, but no smart shoes, for health and safety); Black T-shirt; Black jeans',
      21.75),
    ('Como The Halkin', 'Waiting Staff ( The Halkin)',
      'Plain White Long Sleeved Collared Shirt (clean and pressed); Plain Black Trousers (not jeans/denim/cargo); Black Socks (not white socks); Black Leather Polishable Shoes (no trainers)',
      18.98),
    ('Mandarin Oriental Hotel Hyde Park, London', 'Waiting Staff (Mandarin Oriental)',
      'Plain Black T Shirt (clean and pressed); Plain Black Trousers (not jeans/denim/cargo); Black Socks (not white socks); Black Leather Polishable Shoes (no trainers)',
      18.98),
    ('The Goose and Gridiron', 'Barista',
      'Plain Black Smart Suit Trousers; Plain Black T-Shirt; Plain Black trainers',
      18.50),
    ('The Goose and Gridiron', 'Bar Staff',
      'Plain Black Smart Suit Trousers; Plain Black T-Shirt; Plain Black trainers',
      18.50),
    ('The Hellenic Centre', 'Waiting Staff',
      'Plain BLACK Collared Long Sleeve Shirt (clean and pressed); Plain Black Trousers (not jeans/denim/cargo); Plain Black Socks (not white socks); Black Leather Polishable Shoes (no trainers)',
      21.50),
    ('United Grand Lodge', 'Waiting Staff (UGLE)',
      'Plain White Collared Shirt; Plain Black Smart Suit Trousers; Plain Black Polished Leather Shoes; Plain Black Tie; Plain Black Waistcoat',
      18.50);

  select count(*) into expected from rate_sheet;

  with resolved as (
    select c.id as client_id, r.id as role_id, s.uniform, s.charge_rate
      from rate_sheet s
      join clients c on c.name = s.client_name
      join roles   r on r.name = s.role_name
  ), ins as (
    insert into client_rate_cards (client_id, role_id, charge_rate, dress_codes)
    select client_id, role_id, charge_rate, array[uniform] from resolved
    on conflict (client_id, role_id) do nothing
    returning 1
  )
  select count(*) into added from ins;

  -- A fresh database (CI, `supabase db reset`) has no clients yet when
  -- migrations run, so nothing resolves there; say so instead of failing.
  if (select count(*) from rate_sheet s
       join clients c on c.name = s.client_name
       join roles   r on r.name = s.role_name) <> expected then
    raise notice 'rate sheet: % row(s) matched no client/role and were skipped',
      expected - (select count(*) from rate_sheet s
                   join clients c on c.name = s.client_name
                   join roles   r on r.name = s.role_name);
  end if;

  raise notice 'Rate cards added: % of % (existing cards are left as they are)', added, expected;
end
$$;
