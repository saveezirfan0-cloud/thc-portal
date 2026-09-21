-- =====================================================================
-- 060 · seed shape (docs/02-build-plan.md, Phase 0)
--
-- "seed data (5 clients, 8 venues, 6 roles, 40 workers)". This file asserts
-- that supabase/seed.sql still delivers it, and that the values the
-- wireframes quote have not drifted. It requires a seeded database, which
-- is what `supabase db reset` / `supabase start` give you.
-- =====================================================================
begin;
select plan(12);

select is((select count(*)::int from clients), 5,  'Phase 0 seeds exactly 5 clients');
select is((select count(*)::int from venues),  8,  'Phase 0 seeds exactly 8 venues');
select is((select count(*)::int from roles),   6,  'Phase 0 seeds exactly 6 roles');
select is((select count(*)::int from staff),   40, 'Phase 0 seeds exactly 40 workers');

select bag_eq(
  $$ select name::text from clients $$,
  $$ values ('Leonardo Hotel St Pauls'::text),('Mandarin Oriental'),('The Dorchester'),
            ('Private client (Hurst)'),('ExCeL London') $$,
  'client names mirror wireframes/CONVENTIONS.md'
);

select is((select pay_rate from roles where name = 'Waiting Staff'), 14.00::numeric, 'Waiting Staff base pay is £14.00');
select is((select pay_rate from roles where name = 'Bar Staff'),     15.50::numeric, 'Bar Staff base pay is £15.50');
select is(final_rate((select pay_rate from roles where name = 'Waiting Staff')), 15.69::numeric,
  'final rate is base x 1.1207, calculated not stored (§9.8)');
select is(
  (select rc.charge_rate from client_rate_cards rc
     join clients c on c.id = rc.client_id join roles r on r.id = rc.role_id
    where c.name = 'Leonardo Hotel St Pauls' and r.name = 'Waiting Staff'),
  22.97::numeric,
  'Leonardo · Waiting Staff charge rate is £22.97'
);

-- Every status in the state machine is represented, so no onboarding or
-- compliance screen renders empty (§2.12).
select bag_eq(
  $$ select distinct status::text from staff $$,
  $$ select unnest(enum_range(null::staff_status))::text $$,
  'every staff_status value has at least one seeded worker'
);

-- Buffer is absolute and allocation defaults to headcount + buffer (§3.2).
select is((select count(*)::int from shift_requirements where allocation_per_hour <> headcount + buffer), 0,
  'every seeded role section allocates headcount + buffer');
select is(
  (select sr.headcount || ' (+' || sr.buffer || ')'
     from shift_requirements sr join events e on e.id = sr.event_id join roles r on r.id = sr.role_id
    where e.title = 'Gala Dinner' and r.name = 'Waiting Staff'),
  '12 (+2)',
  'Gala Dinner Waiting Staff reads 12 (+2), never 14'
);

select * from finish();
rollback;
