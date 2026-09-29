-- =====================================================================
-- Migration 20261001213000 · roles from the 2026–2027 rate card (§9.8)
--
-- Merged as 20261001212000 (#104) in the same hour as #105's
-- onboarding_chasers, which took the same version; neither had reached
-- the live project (the deploy stopped before db push), so this one moved.
--
-- The product owner asked on 29.09.2026 for every role on "The Hospitality
-- Company Rate Card 2026-2027" to be in the Roles catalogue. Waiting Staff,
-- Bar Staff and Kitchen Porter were already there; "Wine Staff" is covered
-- by Waiting Staff (the card lists them as one entry). The other ten are
-- added here.
--
-- Staff pay: the card quotes client CHARGE rates (£21.50–£25.98/h + VAT),
-- not what the worker is paid. The product owner set the base staff pay
-- rate of EVERY role in the catalogue to £12.71/h — the National Living
-- Wage from 1 April 2026, which the card promises as every worker's
-- minimum. Holiday +12.07% stays derived (final_rate, role_directory_v:
-- £12.71 → £14.24), never stored (§1.5). Each role stays editable on
-- /roles, and each built role section carries its own pay_rate, editable
-- in the Shift Builder.
--
-- The UPDATE is to the catalogue only. Events already built keep the
-- rates on their own role sections (shift_requirements), so nothing in
-- the diary reprices (§9.8, update_role).
--
-- Charge rates belong on each client's rate card (§9.7), not here. They
-- were put on the live project's client rate cards on 29.09.2026 (missing
-- rows only, existing rates untouched); a rate card is per-client data,
-- so this migration does not write one.
--
-- On a fresh database, supabase/seed.sql runs after this and restores its
-- six sample roles' wireframe rates (wireframes/CONVENTIONS.md), which
-- 060_seed_shape asserts.
-- =====================================================================

insert into roles (name, pay_rate, description) values
  ('Cloakroom Staff',                 12.71, 'Capable of overseeing a cloakroom operation; plan 1 staff per 100 guests.'),
  ('Team Leader',                     12.71, 'Experienced; leads teams of 5 staff during service, on the bar or wherever needed. Cash-till trained.'),
  ('Delegate Registration Assistant', 12.71, 'Guest check-ins, registration desks, distributing materials, handling queries.'),
  ('Runner',                          12.71, 'Errands, transporting materials, on-the-go support.'),
  ('On-site Delivery Support',        12.71, 'Coordinates event deliveries, manages supplies, resolves issues on the day.'),
  ('Receptionist',                    12.71, 'Welcoming first impression; efficient check-ins, guiding attendees, answering enquiries.'),
  ('Kitchen Assistant',               12.71, 'Food preparation, portioning and plating; keeps sections stocked, clean and running.'),
  ('Lifting and Shifting',            12.71, 'Set-up, breakdown and moving of furniture, equipment and supplies.'),
  ('Housekeeping Staff',              12.71, 'Bedrooms and public areas to hotel standard: bed making, bathrooms, linen, turndown.'),
  ('Cleaning Staff',                  12.71, 'Daily, deep and after-event cleans of kitchens, washrooms and public areas.')
on conflict (name) do nothing;

update roles set pay_rate = 12.71 where pay_rate <> 12.71;
