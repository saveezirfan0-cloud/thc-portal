-- =====================================================================
-- Migration 20261005120000 · role descriptions from "Roles and Description"
--
-- The product owner supplied the agency's own wording for each role
-- (Roles_and_Description.xlsx, 05.10.2026). roles.name is unique, so one
-- role carries one description.
--
-- New roles (6): Day Waiting Staff M&E, Evening Waiting Staff, Breakdown/
-- Set Up Staff, Wine Waiting Service, Mid Morning Waiting, Evening Waiting
-- Staff Leo's Bar. Base staff pay is £12.71/h, the same as every other
-- catalogue role (20261001213000); holiday +12.07% stays derived (§1.5).
--
-- Existing roles (6) get the sheet's description: Cloakroom Staff, Bar
-- Staff, Kitchen Porter, Waiting Staff, Barista, and Lifting and Shifting
-- (the sheet spells it "Lift and Shifting"; same role). Their pay rates
-- are not touched.
--
-- The sheet repeats Bar Staff (2 wordings) and Waiting Staff (4 wordings)
-- against the same name. The wording used most often is taken; the others
-- are variants that need a role name of their own, which the sheet does
-- not give.
--
-- Typos in the sheet are corrected ("manualy", "includes", "responsibly",
-- "Serving guest", a missing space, a stray quote); nothing else is
-- reworded. Descriptions are internal and never shown to a client.
--
-- On a fresh database supabase/seed.sql runs after this and restores its
-- six sample roles' descriptions (wireframes/CONVENTIONS.md).
-- =====================================================================

insert into roles (name, pay_rate, description) values
  ('Day Waiting Staff M&E', 12.71,
   $d$Working as Marketing and Event Staff, you will be working directly with the Meetings and Events Team, delivering exceptional conference service in their meeting rooms. This role may also include clearing tables, waiting, polishing glasses and cutlery.$d$),
  ('Evening Waiting Staff', 12.71,
   $d$You will be working directly with the Meetings and Events Team. Serving plated food to your assigned tables, clearing tables, polishing glasses and cutlery and attending to customers' requests.$d$),
  ('Breakdown/Set Up Staff', 12.71,
   $d$You will be working directly with the Meetings and Events Team. You will also be required to set up or breakdown the event by moving tables and chairs, carrying heavy objects and ensuring the room is left tidy. This role may also include clearing tables, waiting, polishing glasses and cutlery.$d$),
  ('Wine Waiting Service', 12.71,
   $d$Working as a wine waiter, it is SO important to have a corkscrew with you! You will be working directly with the Meetings and Events team taking drink orders at table and serving the drinks and alcohol at the table. This role may also include clearing tables, waiting, polishing glasses and cutlery.$d$),
  ('Mid Morning Waiting', 12.71,
   $d$Working as Marketing and Event Staff, you will be working directly with the Meetings and Events Team, delivering exceptional conference service in their meeting rooms. This role may also include clearing tables, waiting, polishing glasses and cutlery.$d$),
  ('Evening Waiting Staff Leo''s Bar', 12.71,
   $d$You will be working directly with the Food and Beverage managers, taking orders from the tables, serving food/drinks inc alcohol at the table.
Making sure the area is clean and tables are cleared in line with clients' wishes. Polishing cutlery/glasses, setting up tables for service.$d$)
on conflict (name) do update set description = excluded.description;

update roles set description = $d$As cloakroom staff, you will be supporting the Front of House Team getting the room ready, set up, run and breakdown the cloakroom. This role may also include clearing tables, waiting, polishing glasses and cutlery.$d$
 where name = 'Cloakroom Staff';

update roles set description = $d$You will need to help set up the bar, do some wine waiting if needed, service a busy bar full of customers and keep your bar clean and stocked. At the end of the event you will also need to breakdown the bar and clear away.
This role may also include clearing tables, waiting, polishing glasses and cutlery.$d$
 where name = 'Bar Staff';

update roles set description = $d$Working as Kitchen Porter, you will be working directly with the Executive Chef supporting anything the kitchen requires, primarily: cleaning, washing and sanitising crockery and glassware, supporting chefs directly and working with the Back of House team to deliver an exceptional service.$d$
 where name = 'Kitchen Porter';

update roles set description = $d$Serving guests with a range of drinks (including alcohol) and food. Remember to check for dietary requirements.
This role may also include food serving, clearing tables, waiting, polishing glasses and cutlery.$d$
 where name = 'Waiting Staff';

update roles set description = $d$You will be required to manually move tables and chairs, carry heavy objects and ensure the room is left tidy.$d$
 where name = 'Lifting and Shifting';

update roles set description = $d$Prepare and serve high-quality espresso-based beverages using traditional methods.
Operate and maintain traditional espresso machines and grinders.
Accurately dial in grinders and adjust extraction to ensure consistency and quality.
Texture milk to appropriate standards for various drinks (e.g., cappuccino, flat white, latte).
Maintain cleanliness and organisation of the coffee station at all times.
Follow all health, safety, and food hygiene regulations.
Deliver friendly, professional, and knowledgeable customer service.
Process customer orders accurately using the POS system.
Restock supplies and monitor inventory levels.
Support team members during busy service periods.$d$
 where name = 'Barista';
