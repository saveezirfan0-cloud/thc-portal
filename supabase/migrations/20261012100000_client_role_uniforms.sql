-- =====================================================================
-- Uniforms per client and role · from THC's "Clients and Roles" sheet
-- (12.10.2026)
--
-- The owner asked for each client + role's uniform to be saved so the
-- right one appears by itself when that role is built into an event, and
-- stays editable there (§3.2, §9.7).
--
-- The mechanism already exists: a rate card's `dress_codes` is the
-- predefined list for that client + role, and the Shift Builder offers it.
-- This loads the sheet into it. One list entry is one WHOLE uniform (the
-- garments joined with "; ") so the builder can fill it in as the event's
-- dress code; the older entries on some cards were one garment each, which
-- could never be applied as a single dress code. The Shift Builder now
-- fills the field when the card holds exactly one uniform.
--
-- Only cards that already exist are updated. A rate card needs a charge
-- rate, which the sheet does not carry, and a guessed rate would quietly
-- under- or over-charge events. Sheet rows with no card yet are listed in
-- the migration notice and need the card added on the client's page.
--
-- The sheet's client names are the parent names; THC's live clients are
-- split by department, so each row names the live client(s) it applies to.
-- A name ending "-%" covers that client and its sub-clients (Hackney Town
-- Council → its four venues).
-- =====================================================================

do $$
declare
  missing text;
begin
  create temp table uniform_sheet (
    client_name text not null,   -- exact clients.name, or 'Name-%' for the family
    role_name   text not null,   -- exact roles.name
    uniform     text not null
  ) on commit drop;

  insert into uniform_sheet (client_name, role_name, uniform) values
    -- Leonardo Hotel St Paul's · Meetings & Events
    ('Leonardo Hotel St Paul''s - M &E', 'Day Waiting Staff M&E',
      'Plain White Long Sleeved Collared Shirt (clean and pressed); Plain Black Trousers (not jeans/denim/cargo); Black Socks (not white socks); Black Leather Polishable Shoes (no trainers)'),
    ('Leonardo Hotel St Paul''s - M &E', 'Evening Waiting Staff M&E',
      'Plain White Long Sleeved Collared Shirt (clean and pressed); Plain Black Trousers (not jeans/denim/cargo); Black Socks (not white socks); Black Leather Polishable Shoes (no trainers)'),
    ('Leonardo Hotel St Paul''s - M &E', 'Cloakroom Staff',
      'Plain White Long Sleeved Collared Shirt (clean and pressed); Plain Black Trousers (not jeans/denim/cargo); Black Socks (not white socks); Black Leather Polishable Shoes (no trainers)'),
    ('Leonardo Hotel St Paul''s - M &E', 'Breakdown/Set Up Staff',
      'Plain White Long Sleeved Collared Shirt (clean and pressed); Plain Black Trousers (not jeans/denim/cargo); Black Socks (not white socks); Black Leather Polishable Shoes (no trainers)'),
    ('Leonardo Hotel St Paul''s - M &E', 'Wine Waiting Service',
      'Plain Black Tie; Plain White Long Sleeved Collared Shirt (clean and pressed); Plain Black Trousers (not jeans/denim/cargo); Black Socks (not white socks); Black Leather Polishable Shoes (no trainers)'),
    ('Leonardo Hotel St Paul''s - M &E', 'Mid Morning Waiting M&E',
      'Plain White Long Sleeved Collared Shirt (clean and pressed); Plain Black Trousers (not jeans/denim/cargo); Black Socks (not white socks); Black Leather Polishable Shoes (no trainers)'),
    ('Leonardo Hotel St Paul''s - M &E', 'Evening Waiting Staff Leo''s Bar',
      'Plain White Long Sleeved Collared Shirt (clean and pressed); Plain Black Trousers (not jeans/denim/cargo); Black Socks (not white socks); Black Leather Polishable Shoes (no trainers)'),
    ('Leonardo Hotel St Paul''s - M &E', 'Bar Staff',
      'Plain Black Tie; Plain Black Waistcoat; Plain White Long Sleeved Collared Shirt (clean and pressed); Plain Black Trousers (not jeans/denim/cargo); Black Socks (not white socks); Black Leather Polishable Shoes (no trainers)'),
    -- Leonardo Hotel St Paul's · Kitchen and Sabine Bar
    ('Leonardo Hotel St Paul''s - Kitchen Porter', 'Kitchen Porter',
      'Plain Black T-Shirt; Plain Black Jeans; Hard Toed Shoes Are Recommended'),
    ('Leonardo Hotel St Paul''s - Sabine Bar', 'Bar Staff',
      'Plain White Long Sleeved Collared Shirt (clean and pressed); Plain Black Trousers (not jeans/denim/cargo); Black Socks (not white socks); Black Leather Polishable Shoes (no trainers)'),
    -- Hackney Town Council and its venues
    ('Hackney Town Council-%', 'Bar Staff',
      'Plain White Long Sleeved Collared Shirt (clean and pressed); Plain Black Trousers (not jeans/denim/cargo); Black Socks (not white socks); Black Leather Polishable Shoes (no trainers)'),
    ('Hackney Town Council-%', 'Waiting Staff',
      'Plain White Long Sleeved Collared Shirt (clean and pressed); Plain Black Trousers (not jeans/denim/cargo); Black Socks (not white socks); Black Leather Polishable Shoes (no trainers)'),
    -- Everyone else
    ('Rhubarb at Sky Garden', 'Lifting and Shifting',
      'Appropriate footwear (can be trainers, but no smart shoes, for health and safety); Black T-shirt; Black jeans'),
    ('Leonardo NYX Hotel', 'Kitchen Porter',
      'Plain Black T-Shirt; Plain Black Jeans; Hard Toed Shoes Are Recommended'),
    ('Como The Halkin', 'Waiting Staff ( The Halkin)',
      'Plain White Long Sleeved Collared Shirt (clean and pressed); Plain Black Trousers (not jeans/denim/cargo); Black Socks (not white socks); Black Leather Polishable Shoes (no trainers)'),
    ('Mandarin Oriental Hotel Hyde Park, London', 'Waiting Staff (Mandarin Oriental)',
      'Plain Black T Shirt (clean and pressed); Plain Black Trousers (not jeans/denim/cargo); Black Socks (not white socks); Black Leather Polishable Shoes (no trainers)'),
    ('The Conduit Club', 'Lifting and Shifting',
      'Appropriate footwear (can be trainers, but no smart shoes, for health and safety); Black T-shirt; Black jeans'),
    ('The Goose and Gridiron', 'Barista',
      'Plain Black Smart Suit Trousers; Plain Black T-Shirt; Plain Black trainers'),
    ('The Goose and Gridiron', 'Bar Staff',
      'Plain Black Smart Suit Trousers; Plain Black T-Shirt; Plain Black trainers'),
    ('The Hellenic Centre', 'Waiting Staff',
      'Plain BLACK Collared Long Sleeve Shirt (clean and pressed); Plain Black Trousers (not jeans/denim/cargo); Plain Black Socks (not white socks); Black Leather Polishable Shoes (no trainers)'),
    ('United Grand Lodge', 'Waiting Staff (UGLE)',
      'Plain White Collared Shirt; Plain Black Smart Suit Trousers; Plain Black Polished Leather Shoes; Plain Black Tie; Plain Black Waistcoat');

  update client_rate_cards rc
     set dress_codes = array[s.uniform]
    from uniform_sheet s, clients c, roles r
   where rc.client_id = c.id
     and rc.role_id = r.id
     and r.name = s.role_name
     and (c.name = s.client_name
          or (s.client_name like '%-%' and right(s.client_name, 2) = '-%'
              and c.name like s.client_name));

  select string_agg(s.client_name || ' · ' || s.role_name, E'\n' order by s.client_name, s.role_name)
    into missing
    from uniform_sheet s
   where not exists (
     select 1
       from client_rate_cards rc
       join clients c on c.id = rc.client_id
       join roles r on r.id = rc.role_id
      where r.name = s.role_name
        and (c.name = s.client_name
             or (right(s.client_name, 2) = '-%' and c.name like s.client_name)));

  if missing is not null then
    raise notice E'Uniforms not saved — no rate card yet for:\n%', missing;
  end if;
end
$$;
