-- =====================================================================
-- Migration 20261001211000 · roles from the 2026–2027 rate card (§9.8)
--
-- The product owner asked on 29.09.2026 for every role on "The Hospitality
-- Company Rate Card 2026-2027" to be in the Roles catalogue. Waiting Staff,
-- Bar Staff and Kitchen Porter were already there; "Wine Staff" is covered
-- by Waiting Staff (the card lists them as one entry). The other ten are
-- added here.
--
-- The card quotes client CHARGE rates (£21.50–£25.98/h + VAT). The
-- catalogue holds the staff PAY rate, which the card does not give, so
-- each new role takes the base pay of the nearest existing role, as the
-- product owner chose:
--   Host £16.00           Cloakroom Staff, Team Leader, Delegate
--                         Registration Assistant, Receptionist
--   Waiting Staff £14.00  Runner
--   Kitchen Porter £13.50 On-site Delivery Support, Kitchen Assistant,
--                         Lifting and Shifting, Housekeeping Staff,
--                         Cleaning Staff
-- Holiday +12.07% stays derived (final_rate, role_directory_v), never
-- stored (§1.5). Edit any of these on /roles.
--
-- The charge rates belong on each client's rate card (§9.7), not here.
-- They were put on the live project's client rate cards on 29.09.2026
-- through the same table (missing rows only, existing rates untouched);
-- a rate card is per-client data, so this migration does not write one.
--
-- Idempotent: the live project already has these rows (added through
-- create_role on 29.09.2026), so a name that exists is left as it is —
-- including any rate the office has since changed.
-- =====================================================================

insert into roles (name, pay_rate, description) values
  ('Cloakroom Staff',                 16.00, 'Capable of overseeing a cloakroom operation; plan 1 staff per 100 guests.'),
  ('Team Leader',                     16.00, 'Experienced; leads teams of 5 staff during service, on the bar or wherever needed. Cash-till trained.'),
  ('Delegate Registration Assistant', 16.00, 'Guest check-ins, registration desks, distributing materials, handling queries.'),
  ('Runner',                          14.00, 'Errands, transporting materials, on-the-go support.'),
  ('On-site Delivery Support',        13.50, 'Coordinates event deliveries, manages supplies, resolves issues on the day.'),
  ('Receptionist',                    16.00, 'Welcoming first impression; efficient check-ins, guiding attendees, answering enquiries.'),
  ('Kitchen Assistant',               13.50, 'Food preparation, portioning and plating; keeps sections stocked, clean and running.'),
  ('Lifting and Shifting',            13.50, 'Set-up, breakdown and moving of furniture, equipment and supplies.'),
  ('Housekeeping Staff',              13.50, 'Bedrooms and public areas to hotel standard: bed making, bathrooms, linen, turndown.'),
  ('Cleaning Staff',                  13.50, 'Daily, deep and after-event cleans of kitchens, washrooms and public areas.')
on conflict (name) do nothing;
