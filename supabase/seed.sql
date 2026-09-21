-- =====================================================================
-- The Hospitality Company · development seed (Phase 0)
--
-- Exactly what docs/02-build-plan.md Phase 0 asks for: 5 clients, 8 venues,
-- 6 roles, 40 workers, plus a handful of events with role sections so the
-- Back Office screens render. Names, rates and event windows mirror
-- wireframes/CONVENTIONS.md so a screenshot and a test read the same.
--
-- IDEMPOTENT. Every statement is an upsert keyed on a fixed UUID or on the
-- table's natural key, so `supabase db reset` and a bare re-run of this file
-- both leave the database in the same state.
--
-- Dates are relative to the run date (next Friday = the wireframes' "Fri 19
-- Sep 2026"), so the Back Office never shows an empty upcoming list. Every
-- scheduled time is written as a Europe/London wall-clock time and stored as
-- timestamptz (§1.8).
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- Helpers (session-local, so nothing is left behind in the schema)
-- ---------------------------------------------------------------------
-- The Friday of the wireframe week: the next Friday strictly after today.
create or replace function pg_temp.seed_friday() returns date
language sql stable as $$
  select (current_date + (((5 - extract(isodow from current_date)::int) + 6) % 7 + 1))::date
$$;

-- A Europe/London wall-clock time on a given day, stored as timestamptz.
create or replace function pg_temp.uk(d date, t time) returns timestamptz
language sql stable as $$ select (d + t) at time zone 'Europe/London' $$;

-- ---------------------------------------------------------------------
-- ROLES (6) — base pay from wireframes/CONVENTIONS.md.
-- Final rate is always calculated (final_rate()), never stored.
-- ---------------------------------------------------------------------
insert into roles (id, name, description, pay_rate) values
 ('30000000-0000-4000-8000-000000000001','Waiting Staff','Silver service and plated service; bar-back where needed. Minimum 18.',14.00),
 ('30000000-0000-4000-8000-000000000002','Bar Staff','Cocktail and wine service, cellar basics; personal licence not required.',15.50),
 ('30000000-0000-4000-8000-000000000003','Chef','Chef de partie level and above; own knives and whites.',19.00),
 ('30000000-0000-4000-8000-000000000004','Kitchen Porter','Pot wash, prep support, deliveries.',13.50),
 ('30000000-0000-4000-8000-000000000005','Host','Front of house, guest lists, cloakroom; strong spoken English.',16.00),
 ('30000000-0000-4000-8000-000000000006','Barista','Espresso bar; latte art a plus.',14.50)
on conflict (id) do update set
  name = excluded.name, description = excluded.description, pay_rate = excluded.pay_rate;

-- ---------------------------------------------------------------------
-- CLIENTS (5)
-- ---------------------------------------------------------------------
insert into clients (id, name, contact_name, phone, staff_contact_point, contact_emails, pays_breaks, pays_buffer) values
 ('40000000-0000-4000-8000-000000000001','Leonardo Hotel St Pauls','Marco V.','+44 20 7074 1000','Banqueting Manager, Cathedral Suite',array['events@leonardo-stpauls.example','ops@leonardo-stpauls.example'],true,true),
 ('40000000-0000-4000-8000-000000000002','Mandarin Oriental','Sophie L.','+44 20 7235 2000','Duty Manager, staff entrance Knightsbridge',array['banqueting@mo-hydepark.example'],true,false),
 ('40000000-0000-4000-8000-000000000003','The Dorchester','James H.','+44 20 7629 8888','Events Office, Deanery St entrance',array['events@dorchester.example','payroll@dorchester.example'],false,true),
 ('40000000-0000-4000-8000-000000000004','Private client (Hurst)','Eleanor Hurst','+44 7700 900410','Eleanor Hurst, marquee lawn',array['eleanor@hurstmanor.example'],true,true),
 ('40000000-0000-4000-8000-000000000005','ExCeL London','Nina P.','+44 20 7069 5000','Loading Bay 4, Hall S6',array['staffing@excel.example'],false,false)
on conflict (id) do update set
  name = excluded.name, contact_name = excluded.contact_name, phone = excluded.phone,
  staff_contact_point = excluded.staff_contact_point, contact_emails = excluded.contact_emails,
  pays_breaks = excluded.pays_breaks, pays_buffer = excluded.pays_buffer;

-- ---------------------------------------------------------------------
-- RATE CARDS — charge rate per client AND role (§9.7).
-- Leonardo · Waiting Staff £22.97 is the figure quoted in CONVENTIONS.md;
-- the rest reproduce the margins shown on backoffice/client-card.html.
-- ---------------------------------------------------------------------
insert into client_rate_cards (id, client_id, role_id, charge_rate, dress_codes) values
 ('41000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',22.97,array['Black & whites','All black']),
 ('41000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002',25.42,array['Black shirt & apron']),
 ('41000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003',30.69,array['Chef whites','Kitchen blacks']),
 ('41000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000004',21.23,array['Kitchen blacks']),
 ('41000000-0000-4000-8000-000000000005','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000005',26.83,array['Business suit (navy)']),
 ('41000000-0000-4000-8000-000000000006','40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001',23.80,array['All black']),
 ('41000000-0000-4000-8000-000000000007','40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002',26.40,array['Black shirt & apron']),
 ('41000000-0000-4000-8000-000000000008','40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000006',23.79,array['All black','Branded apron']),
 ('41000000-0000-4000-8000-000000000009','40000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001',24.10,array['Black & whites']),
 ('41000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000002',26.90,array['Black shirt & apron']),
 ('41000000-0000-4000-8000-000000000011','40000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000005',28.20,array['Business suit (navy)']),
 ('41000000-0000-4000-8000-000000000012','40000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003',31.40,array['Chef whites']),
 ('41000000-0000-4000-8000-000000000013','40000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000001',21.50,array['All black']),
 ('41000000-0000-4000-8000-000000000014','40000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000003',29.00,array['Chef whites']),
 ('41000000-0000-4000-8000-000000000015','40000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000001',22.10,array['All black']),
 ('41000000-0000-4000-8000-000000000016','40000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000004',20.60,array['Kitchen blacks']),
 ('41000000-0000-4000-8000-000000000017','40000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000006',22.90,array['All black'])
on conflict (id) do update set
  client_id = excluded.client_id, role_id = excluded.role_id,
  charge_rate = excluded.charge_rate, dress_codes = excluded.dress_codes;

-- ---------------------------------------------------------------------
-- VENUES (8) — coordinates and geofence radii from backoffice/venues.html.
-- Hurst Manor is deliberately 250 m (widened from the 150 m private
-- residence default for the grounds) to exercise the override path (§9.11).
-- ---------------------------------------------------------------------
insert into venues (id, name, address, location, venue_type, geofence_radius_m) values
 ('50000000-0000-4000-8000-000000000001','Leonardo Royal Hotel','10 Godliman St, London EC4V 5AJ',st_setsrid(st_makepoint(-0.0990,51.5133),4326)::geography,'hotel',150),
 ('50000000-0000-4000-8000-000000000002','Mandarin Oriental Hyde Park','66 Knightsbridge, London SW1X 7LA',st_setsrid(st_makepoint(-0.1601,51.5022),4326)::geography,'hotel',150),
 ('50000000-0000-4000-8000-000000000003','The Dorchester','53 Park Lane, London W1K 1QA',st_setsrid(st_makepoint(-0.1523,51.5071),4326)::geography,'hotel',150),
 ('50000000-0000-4000-8000-000000000004','Hurst Manor','Cuckfield, Haywards Heath RH17 5LB',st_setsrid(st_makepoint(-0.1455,51.0034),4326)::geography,'private_residence',250),
 ('50000000-0000-4000-8000-000000000005','ExCeL London','Royal Victoria Dock, London E16 1XL',st_setsrid(st_makepoint(0.0294,51.5081),4326)::geography,'exhibition',400),
 ('50000000-0000-4000-8000-000000000006','Sky Garden','1 Sky Garden Walk, London EC3M 8AF',st_setsrid(st_makepoint(-0.0836,51.5112),4326)::geography,'restaurant_bar',100),
 ('50000000-0000-4000-8000-000000000007','Lord''s Cricket Ground','St John''s Wood Rd, London NW8 8QN',st_setsrid(st_makepoint(-0.1727,51.5294),4326)::geography,'stadium',500),
 ('50000000-0000-4000-8000-000000000008','Epsom Downs Racecourse','Epsom Downs, Epsom KT18 5LQ',st_setsrid(st_makepoint(-0.2586,51.3113),4326)::geography,'racecourse',1500)
on conflict (id) do update set
  name = excluded.name, address = excluded.address, location = excluded.location,
  venue_type = excluded.venue_type, geofence_radius_m = excluded.geofence_radius_m, deleted_at = null;

-- ---------------------------------------------------------------------
-- WORKERS (40) — statuses spread across the whole staff_status enum
-- (§2.12) so the onboarding kanban, the compliance queue and the staff
-- directory all have rows. Employee IDs are only set from `contract`
-- onwards, because they are generated at contract signature (§2.7).
-- Home locations are scattered around London so proximity scoring has
-- something to rank.
-- ---------------------------------------------------------------------
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, home_address, home_location,
                   status, rtw_branch, right_to_work_until, rating, reliability, contract_signed_at, contract_version) values
 ('20000000-0000-4000-8000-000000000001',873,'Amara','Kalu','amara.kalu@example.com','+44 7700 900101','2002-04-11','Mile End, London E1 4NS',st_setsrid(st_makepoint(-0.0333,51.5250),4326)::geography,'compliant','international_student','2026-12-13',4.60,98.0,now() - interval '300 days','v1.2'),
 ('20000000-0000-4000-8000-000000000002',412,'Tom','Reid','tom.reid@example.com','+44 7700 900102','1994-09-02','Camberwell, London SE5 8TR',st_setsrid(st_makepoint(-0.0930,51.4740),4326)::geography,'compliant','uk_irish',null,4.80,99.0,now() - interval '520 days','v1.1'),
 ('20000000-0000-4000-8000-000000000003',655,'Priya','Sharma','priya.sharma@example.com','+44 7700 900103','1996-01-23','Bethnal Green, London E2 0AA',st_setsrid(st_makepoint(-0.0553,51.5270),4326)::geography,'compliant','eu_settled',null,4.90,99.0,now() - interval '410 days','v1.1'),
 ('20000000-0000-4000-8000-000000000004',701,'Luca','Moretti','luca.moretti@example.com','+44 7700 900104','1993-07-14','Laurie Grove, London SE14 6NW',st_setsrid(st_makepoint(-0.0400,51.4750),4326)::geography,'compliant','work_visa','2027-06-30',4.40,95.0,now() - interval '260 days','v1.2'),
 ('20000000-0000-4000-8000-000000000005',619,'Grace','Lindqvist','grace.lindqvist@example.com','+44 7700 900105','1997-03-30','Roman Rd, London E3 5LU',st_setsrid(st_makepoint(-0.0330,51.5320),4326)::geography,'compliant','eu_settled',null,4.60,98.0,now() - interval '580 days','v1.0'),
 ('20000000-0000-4000-8000-000000000006',811,'Marcus','Bright','marcus.bright@example.com','+44 7700 900106','1991-11-05','Bankside, London SE1 9DT',st_setsrid(st_makepoint(-0.0995,51.5064),4326)::geography,'compliant','uk_irish',null,4.10,97.0,now() - interval '190 days','v1.2'),
 ('20000000-0000-4000-8000-000000000007',424,'Ben','Ashworth','ben.ashworth@example.com','+44 7700 900107','1995-06-18','Cephas St, London E1 4AT',st_setsrid(st_makepoint(-0.0490,51.5220),4326)::geography,'compliant','uk_irish',null,4.50,96.0,now() - interval '500 days','v1.1'),
 ('20000000-0000-4000-8000-000000000008',438,'Chloe','Baptiste','chloe.baptiste@example.com','+44 7700 900108','1998-12-09','Carter Lane, London EC4V 5ER',st_setsrid(st_makepoint(-0.1000,51.5135),4326)::geography,'compliant','uk_irish',null,4.70,97.0,now() - interval '470 days','v1.1'),
 ('20000000-0000-4000-8000-000000000009',446,'Ravi','Chandra','ravi.chandra@example.com','+44 7700 900109','1992-02-27','Exhibition Rd, London SW7 2AP',st_setsrid(st_makepoint(-0.1740,51.4990),4326)::geography,'compliant','work_visa','2028-03-31',4.30,94.0,now() - interval '440 days','v1.1'),
 ('20000000-0000-4000-8000-000000000010',452,'Emily','Dawson','emily.dawson@example.com','+44 7700 900110','1999-08-16','Grove Rd, London E3 5TB',st_setsrid(st_makepoint(-0.0396,51.5362),4326)::geography,'compliant','uk_irish',null,4.80,99.0,now() - interval '430 days','v1.1'),
 ('20000000-0000-4000-8000-000000000011',467,'Daniel','Okafor','daniel.okafor@example.com','+44 7700 900111','1990-05-21','Peckham, London SE15 5DQ',st_setsrid(st_makepoint(-0.0690,51.4700),4326)::geography,'compliant','dependant_other','2027-11-30',4.20,93.0,now() - interval '380 days','v1.1'),
 ('20000000-0000-4000-8000-000000000012',473,'Aisha','Bello','aisha.bello@example.com','+44 7700 900112','1996-10-02','Stratford, London E15 1AZ',st_setsrid(st_makepoint(-0.0030,51.5410),4326)::geography,'compliant','uk_irish',null,4.60,96.0,now() - interval '360 days','v1.1'),
 ('20000000-0000-4000-8000-000000000013',488,'Mateusz','Nowak','mateusz.nowak@example.com','+44 7700 900113','1989-04-04','Ealing, London W5 2NU',st_setsrid(st_makepoint(-0.3020,51.5130),4326)::geography,'compliant','eu_settled',null,4.50,95.0,now() - interval '340 days','v1.2'),
 ('20000000-0000-4000-8000-000000000014',495,'Hugo','Ferreira','hugo.ferreira@example.com','+44 7700 900114','1994-01-19','Vauxhall, London SW8 1SP',st_setsrid(st_makepoint(-0.1230,51.4860),4326)::geography,'compliant','eu_settled',null,4.40,92.0,now() - interval '320 days','v1.2'),
 ('20000000-0000-4000-8000-000000000015',503,'Nadia','Haddad','nadia.haddad@example.com','+44 7700 900115','1995-09-25','Islington, London N1 8LX',st_setsrid(st_makepoint(-0.1030,51.5380),4326)::geography,'compliant','work_visa','2027-02-28',4.70,98.0,now() - interval '300 days','v1.2'),
 ('20000000-0000-4000-8000-000000000016',511,'Olivia','Nguyen','olivia.nguyen@example.com','+44 7700 900116','1997-07-07','Hackney, London E8 3DL',st_setsrid(st_makepoint(-0.0560,51.5450),4326)::geography,'compliant','uk_irish',null,4.90,100.0,now() - interval '280 days','v1.2'),
 ('20000000-0000-4000-8000-000000000017',528,'Isla','Thornton','isla.thornton@example.com','+44 7700 900117','1993-03-13','Clapham, London SW4 7AA',st_setsrid(st_makepoint(-0.1380,51.4620),4326)::geography,'compliant','uk_irish',null,4.30,94.0,now() - interval '250 days','v1.2'),
 ('20000000-0000-4000-8000-000000000018',536,'Yusuf','Yilmaz','yusuf.yilmaz@example.com','+44 7700 900118','2001-11-29','Whitechapel, London E1 1BB',st_setsrid(st_makepoint(-0.0610,51.5190),4326)::geography,'compliant','international_student','2027-01-31',4.50,96.0,now() - interval '220 days','v1.2'),
 ('20000000-0000-4000-8000-000000000019',544,'Hana','Kowalska','hana.kowalska@example.com','+44 7700 900119','1992-06-08','Willesden, London NW10 2JY',st_setsrid(st_makepoint(-0.2380,51.5480),4326)::geography,'compliant','eu_settled',null,4.60,97.0,now() - interval '200 days','v1.2'),
 ('20000000-0000-4000-8000-000000000020',559,'Hannah','Brooks','hannah.brooks@example.com','+44 7700 900120','1998-02-14','Greenwich, London SE10 9LS',st_setsrid(st_makepoint(-0.0090,51.4820),4326)::geography,'compliant','uk_irish',null,4.40,95.0,now() - interval '160 days','v1.2'),
 ('20000000-0000-4000-8000-000000000021',417,'Jonah','Whitfield','jonah.whitfield@example.com','+44 7700 900121','1990-10-30','Deptford, London SE8 4AF',st_setsrid(st_makepoint(-0.0260,51.4790),4326)::geography,'blocked','uk_irish',null,4.00,88.0,now() - interval '510 days','v1.1'),
 ('20000000-0000-4000-8000-000000000022',566,'Beth','Carter','beth.carter@example.com','+44 7700 900122','1996-05-06','Brixton, London SW9 8LF',st_setsrid(st_makepoint(-0.1140,51.4620),4326)::geography,'blocked','uk_irish',null,3.60,74.0,now() - interval '290 days','v1.2'),
 ('20000000-0000-4000-8000-000000000023',574,'Marek','Nowak','marek.nowak@example.com','+44 7700 900123','1988-08-22','Acton, London W3 6NA',st_setsrid(st_makepoint(-0.2680,51.5080),4326)::geography,'inactive','eu_settled',null,4.20,91.0,now() - interval '700 days','v1.0'),
 ('20000000-0000-4000-8000-000000000024',582,'Sofia','Almeida','sofia.almeida@example.com','+44 7700 900124','1991-12-01','Wembley, London HA9 0WS',st_setsrid(st_makepoint(-0.2800,51.5560),4326)::geography,'inactive','eu_settled',null,4.10,89.0,now() - interval '660 days','v1.0'),
 ('20000000-0000-4000-8000-000000000025',1042,'Deleted','account','removed-1042@invalid.example','+44 7700 900125','1993-09-09',null,null,'removed','uk_irish',null,null,null,now() - interval '820 days','v1.0'),
 ('20000000-0000-4000-8000-000000000026',null,'Oscar','Bennett','oscar.bennett@example.com','+44 7700 900126','2000-03-03','Croydon, London CR0 1LH',st_setsrid(st_makepoint(-0.1000,51.3760),4326)::geography,'rejected',null,null,null,null,null,null),
 ('20000000-0000-4000-8000-000000000027',591,'Zainab','Idris','zainab.idris@example.com','+44 7700 900127','1999-01-12','Tottenham, London N17 0AP',st_setsrid(st_makepoint(-0.0700,51.5880),4326)::geography,'contract','uk_irish',null,null,null,null,null),
 ('20000000-0000-4000-8000-000000000028',604,'Callum','Fraser','callum.fraser@example.com','+44 7700 900128','1997-04-26','Walthamstow, London E17 7JN',st_setsrid(st_makepoint(-0.0200,51.5860),4326)::geography,'contract','uk_irish',null,null,null,null,null),
 ('20000000-0000-4000-8000-000000000029',null,'Elif','Demir','elif.demir@example.com','+44 7700 900129','2001-06-15','Haringey, London N8 0DL',st_setsrid(st_makepoint(-0.1100,51.5830),4326)::geography,'additional_info','work_visa','2028-06-30',null,null,null,null),
 ('20000000-0000-4000-8000-000000000030',null,'Patrick','Nolan','patrick.nolan@example.com','+44 7700 900130','1995-02-05','Kilburn, London NW6 7YD',st_setsrid(st_makepoint(-0.1950,51.5470),4326)::geography,'additional_info','uk_irish',null,null,null,null,null),
 ('20000000-0000-4000-8000-000000000031',null,'Jamal','Osei','jamal.osei@example.com','+44 7700 900131','2002-08-08','Lewisham, London SE13 6EN',st_setsrid(st_makepoint(-0.0130,51.4620),4326)::geography,'quiz','uk_irish',null,null,null,null,null),
 ('20000000-0000-4000-8000-000000000032',null,'Leila','Farrokh','leila.farrokh@example.com','+44 7700 900132','2000-10-19','Shepherd''s Bush, London W12 8QE',st_setsrid(st_makepoint(-0.2260,51.5050),4326)::geography,'quiz','dependant_other','2029-05-31',null,null,null,null),
 ('20000000-0000-4000-8000-000000000033',null,'Dimitri','Popescu','dimitri.popescu@example.com','+44 7700 900133','1994-11-11','Barking, London IG11 8AA',st_setsrid(st_makepoint(0.0810,51.5390),4326)::geography,'documents','eu_settled',null,null,null,null,null),
 ('20000000-0000-4000-8000-000000000034',null,'Keisha','Campbell','keisha.campbell@example.com','+44 7700 900134','1998-07-02','Wood Green, London N22 6BH',st_setsrid(st_makepoint(-0.1100,51.5970),4326)::geography,'documents','uk_irish',null,null,null,null,null),
 ('20000000-0000-4000-8000-000000000035',null,'Tomas','Silva','tomas.silva@example.com','+44 7700 900135','2003-01-28','Queen Mary, London E1 4NS',st_setsrid(st_makepoint(-0.0400,51.5240),4326)::geography,'documents','international_student','2027-09-30',null,null,null,null),
 ('20000000-0000-4000-8000-000000000036',null,'Freya','Lindgren','freya.lindgren@example.com','+44 7700 900136','1996-09-17','Fulham, London SW6 1HS',st_setsrid(st_makepoint(-0.1950,51.4750),4326)::geography,'interview_completed','eu_settled',null,null,null,null,null),
 ('20000000-0000-4000-8000-000000000037',null,'Nadeem','Rashid','nadeem.rashid@example.com','+44 7700 900137','1999-05-23','Ilford, London IG1 1BA',st_setsrid(st_makepoint(0.0720,51.5590),4326)::geography,'interview_completed','uk_irish',null,null,null,null,null),
 ('20000000-0000-4000-8000-000000000038',null,'Noah','Adeyemi','noah.adeyemi@example.com','+44 7700 900138','2004-02-09','Thamesmead, London SE28 8AS',st_setsrid(st_makepoint(0.1120,51.5030),4326)::geography,'interview_requested',null,null,null,null,null,null),
 ('20000000-0000-4000-8000-000000000039',null,'Mia','Kowalczyk','mia.kowalczyk@example.com','+44 7700 900139','2003-12-30','Hounslow, London TW3 1ES',st_setsrid(st_makepoint(-0.3620,51.4680),4326)::geography,'interview_requested',null,null,null,null,null,null),
 ('20000000-0000-4000-8000-000000000040',null,'Adam','Whelan','adam.whelan@example.com','+44 7700 900140','2002-06-21','Enfield, London EN1 1TH',st_setsrid(st_makepoint(-0.0800,51.6520),4326)::geography,'interview_requested',null,null,null,null,null,null)
on conflict (id) do update set
  employee_id = excluded.employee_id, first_name = excluded.first_name, last_name = excluded.last_name,
  email = excluded.email, phone = excluded.phone, dob = excluded.dob,
  home_address = excluded.home_address, home_location = excluded.home_location,
  status = excluded.status, rtw_branch = excluded.rtw_branch,
  right_to_work_until = excluded.right_to_work_until, rating = excluded.rating,
  reliability = excluded.reliability, contract_signed_at = excluded.contract_signed_at,
  contract_version = excluded.contract_version;

-- Employee IDs above were assigned by hand; keep the sequence ahead of them
-- so the first contract signed after a reset does not collide (§2.7).
do $$ begin
  perform setval('employee_id_seq', greatest((select max(employee_id) from staff) + 1, 10001), false);
end $$;

-- --- worker detail that does not fit the bulk insert ---------------------

-- Amara K.: international student, 20 h term-time cap until 13.12.2026.
-- term_dates holds the HOLIDAY ranges from the verified term-dates letter;
-- any day outside them is term time and drops the week to 20 h (RULE-20).
update staff set
  term_dates = array[
    daterange('2026-12-14','2027-01-11','[)'),
    daterange('2027-03-22','2027-04-19','[)'),
    daterange('2027-06-14','2027-09-20','[)')
  ],
  share_code = 'W1A2B3C4D'
where id = '20000000-0000-4000-8000-000000000001';

update staff set share_code = 'W9Z8Y7X6W' where id = '20000000-0000-4000-8000-000000000018';

-- 48 h opt-out signed (RULE-20: lifts the WTR ceiling, never a visa limit).
update staff set wtr_optout = true
where id in ('20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000016');

-- Blocked workers (§4.3 auto-block, §9.6 manual block).
update staff set block_kind = 'auto_document',
  block_reason = 'Passport expired 02.09.2026 — re-upload required'
where id = '20000000-0000-4000-8000-000000000021';
update staff set block_kind = 'manual',
  block_reason = 'Left site without notifying the on-site contact — under review'
where id = '20000000-0000-4000-8000-000000000022';

-- Leavers (§10.6) and the GDPR removal (§1.7): history rows are kept and the
-- name is only masked at the view layer (client_lineup_v).
update staff set left_at = now() - interval '45 days', leave_reason = 'Moving abroad'
where id = '20000000-0000-4000-8000-000000000023';
update staff set left_at = now() - interval '90 days', leave_reason = 'Full-time role elsewhere'
where id = '20000000-0000-4000-8000-000000000024';
update staff set removed_at = now() - interval '30 days', home_address = null, ni_number = null
where id = '20000000-0000-4000-8000-000000000025';

-- Completion letter verified → graduated, so the 20 h cap no longer applies.
update staff set graduated_at = current_date - 40
where id = '20000000-0000-4000-8000-000000000011';

-- ---------------------------------------------------------------------
-- ROLE QUALIFICATIONS (what a worker can do anywhere)
-- ---------------------------------------------------------------------
insert into staff_roles (staff_id, role_id)
select s.id, r.id
from (
  values
    ('20000000-0000-4000-8000-000000000001','Waiting Staff'),('20000000-0000-4000-8000-000000000001','Host'),
    ('20000000-0000-4000-8000-000000000002','Waiting Staff'),('20000000-0000-4000-8000-000000000002','Bar Staff'),
    ('20000000-0000-4000-8000-000000000003','Waiting Staff'),
    ('20000000-0000-4000-8000-000000000004','Chef'),
    ('20000000-0000-4000-8000-000000000005','Waiting Staff'),
    ('20000000-0000-4000-8000-000000000006','Bar Staff'),('20000000-0000-4000-8000-000000000006','Waiting Staff'),
    ('20000000-0000-4000-8000-000000000007','Waiting Staff'),('20000000-0000-4000-8000-000000000007','Kitchen Porter'),
    ('20000000-0000-4000-8000-000000000008','Waiting Staff'),('20000000-0000-4000-8000-000000000008','Host'),
    ('20000000-0000-4000-8000-000000000009','Kitchen Porter'),
    ('20000000-0000-4000-8000-000000000010','Waiting Staff'),('20000000-0000-4000-8000-000000000010','Barista'),
    ('20000000-0000-4000-8000-000000000011','Chef'),('20000000-0000-4000-8000-000000000011','Kitchen Porter'),
    ('20000000-0000-4000-8000-000000000012','Waiting Staff'),
    ('20000000-0000-4000-8000-000000000013','Kitchen Porter'),
    ('20000000-0000-4000-8000-000000000014','Bar Staff'),('20000000-0000-4000-8000-000000000014','Barista'),
    ('20000000-0000-4000-8000-000000000015','Host'),('20000000-0000-4000-8000-000000000015','Waiting Staff'),
    ('20000000-0000-4000-8000-000000000016','Waiting Staff'),('20000000-0000-4000-8000-000000000016','Bar Staff'),
    ('20000000-0000-4000-8000-000000000017','Waiting Staff'),('20000000-0000-4000-8000-000000000017','Bar Staff'),
    ('20000000-0000-4000-8000-000000000018','Bar Staff'),
    ('20000000-0000-4000-8000-000000000019','Waiting Staff'),('20000000-0000-4000-8000-000000000019','Host'),
    ('20000000-0000-4000-8000-000000000020','Waiting Staff'),
    ('20000000-0000-4000-8000-000000000021','Bar Staff'),
    ('20000000-0000-4000-8000-000000000022','Waiting Staff'),
    ('20000000-0000-4000-8000-000000000023','Kitchen Porter'),
    ('20000000-0000-4000-8000-000000000024','Waiting Staff'),
    ('20000000-0000-4000-8000-000000000025','Waiting Staff'),
    ('20000000-0000-4000-8000-000000000027','Waiting Staff'),
    ('20000000-0000-4000-8000-000000000028','Bar Staff')
) as q(staff_id, role_name)
join staff s on s.id = q.staff_id::uuid
join roles r on r.name = q.role_name
on conflict (staff_id, role_id) do nothing;

-- ---------------------------------------------------------------------
-- CLIENT QUALIFICATIONS (per client AND role — RULE-17, §9.6)
-- Mirrors the "Qualified staff" block on backoffice/client-card.html.
-- ---------------------------------------------------------------------
insert into client_qualifications (client_id, role_id, staff_id, granted_at, note)
select c.id, r.id, q.staff_id::uuid, now() - (q.days || ' days')::interval, q.note
from (values
  ('Leonardo Hotel St Pauls','Waiting Staff','20000000-0000-4000-8000-000000000001',13,'automatically from Gala Dinner'),
  ('Leonardo Hotel St Pauls','Host',         '20000000-0000-4000-8000-000000000001',13,'automatically from Gala Dinner'),
  ('Leonardo Hotel St Pauls','Waiting Staff','20000000-0000-4000-8000-000000000005',216,'manual by Gisela M. · "site induction done"'),
  ('Leonardo Hotel St Pauls','Waiting Staff','20000000-0000-4000-8000-000000000002',3,'automatically from Breakfast Briefing'),
  ('Leonardo Hotel St Pauls','Bar Staff',    '20000000-0000-4000-8000-000000000002',3,'automatically from Breakfast Briefing'),
  ('Leonardo Hotel St Pauls','Waiting Staff','20000000-0000-4000-8000-000000000003',17,'automatically from Lunch Service'),
  ('Leonardo Hotel St Pauls','Chef',         '20000000-0000-4000-8000-000000000004',60,'manual by Gisela M.'),
  ('Mandarin Oriental','Bar Staff',          '20000000-0000-4000-8000-000000000006',14,'automatically from Reception'),
  ('Mandarin Oriental','Waiting Staff',      '20000000-0000-4000-8000-000000000002',200,'manual by Gisela M.'),
  ('Mandarin Oriental','Bar Staff',          '20000000-0000-4000-8000-000000000016',35,'automatically from Late Bar'),
  ('The Dorchester','Host',                  '20000000-0000-4000-8000-000000000015',75,'manual by Gisela M.'),
  ('The Dorchester','Waiting Staff',         '20000000-0000-4000-8000-000000000008',52,'automatically from Board Dinner'),
  ('ExCeL London','Waiting Staff',           '20000000-0000-4000-8000-000000000012',28,'automatically from Trade Expo')
) as q(client_name, role_name, staff_id, days, note)
join clients c on c.name = q.client_name
join roles r on r.name = q.role_name
on conflict (client_id, role_id, staff_id) do update set note = excluded.note;

-- Do-not-return, so the auto-assign hard gate has something to exclude (§3.4).
insert into client_qualifications (client_id, role_id, staff_id, do_not_return, note)
select c.id, r.id, '20000000-0000-4000-8000-000000000022'::uuid, true, 'Do not return — client request'
from clients c, roles r where c.name = 'The Dorchester' and r.name = 'Waiting Staff'
on conflict (client_id, role_id, staff_id) do update set do_not_return = true, note = excluded.note;

-- ---------------------------------------------------------------------
-- EVENTS + ROLE SECTIONS (RULE-18: every timing rule uses the role section,
-- never the event window). Buffer is absolute: headcount 6 with buffer 1 is
-- shown as "6 (+1)", never 7, and allocation defaults to headcount + buffer.
-- ---------------------------------------------------------------------
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, notes, onsite_contact, po_number, pays_breaks, pays_buffer, auto_assign)
select e.id::uuid, c.id, v.id, v.name, v.address, v.location, v.geofence_radius_m,
       e.title, e.event_date, e.notes, e.onsite_contact, e.po_number, c.pays_breaks, c.pays_buffer, e.auto_assign
from (values
  ('60000000-0000-4000-8000-000000000001','Leonardo Hotel St Pauls','Leonardo Royal Hotel','Gala Dinner',
     pg_temp.seed_friday(), 'Cathedral Suite. Staff entrance on Carter Lane.','Banqueting Manager','4471-A',true),
  ('60000000-0000-4000-8000-000000000002','Mandarin Oriental','Mandarin Oriental Hyde Park','Product Launch — Bar',
     pg_temp.seed_friday(), 'Rooftop bar. Late licence to 01:00.','Duty Manager','4482',true),
  ('60000000-0000-4000-8000-000000000003','Private client (Hurst)','Hurst Manor','Wedding — Marquee',
     pg_temp.seed_friday() + 1, 'Marquee on the lawn. No parking on site; shuttle from Haywards Heath.','Eleanor Hurst','HURST-09',true),
  ('60000000-0000-4000-8000-000000000004','ExCeL London','ExCeL London','Conference Lunch',
     pg_temp.seed_friday() + 2, 'Hall S6.','Loading Bay 4','4490',false),
  ('60000000-0000-4000-8000-000000000005','The Dorchester','The Dorchester','Awards Night',
     pg_temp.seed_friday() + 4, 'Ballroom. Black tie.','Events Office','4495',true),
  ('60000000-0000-4000-8000-000000000006','Leonardo Hotel St Pauls','Leonardo Royal Hotel','Lunch Service',
     pg_temp.seed_friday() - 14, 'Wren Suite.','Banqueting Manager','4431',true)
) as e(id, client_name, venue_name, title, event_date, notes, onsite_contact, po_number, auto_assign)
join clients c on c.name = e.client_name
join venues v on v.name = e.venue_name
on conflict (id) do update set
  client_id = excluded.client_id, venue_id = excluded.venue_id, venue_name = excluded.venue_name,
  venue_address = excluded.venue_address, venue_location = excluded.venue_location,
  geofence_radius_m = excluded.geofence_radius_m, title = excluded.title, event_date = excluded.event_date,
  notes = excluded.notes, onsite_contact = excluded.onsite_contact, po_number = excluded.po_number,
  pays_breaks = excluded.pays_breaks, pays_buffer = excluded.pays_buffer, auto_assign = excluded.auto_assign;

-- Conference Lunch is the cancelled example on the events list (§3.1).
update events set cancelled_at = now() - interval '2 days', cancel_reason = 'Client cancelled — low delegate numbers'
where id = '60000000-0000-4000-8000-000000000004';

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, dress_code, allocation_per_hour)
select sr.id::uuid, sr.event_id::uuid, r.id,
       pg_temp.uk(e.event_date, sr.start_t), pg_temp.uk(e.event_date + sr.end_day_offset, sr.end_t),
       sr.headcount, sr.buffer, sr.charge_rate, r.pay_rate, sr.dress_code, sr.headcount + sr.buffer
from (values
  -- Gala Dinner (CONVENTIONS: Chef 07:00–15:00 2(+0), KP 09:00–17:00 3(+1), Waiting 17:00–23:30 12(+2))
  ('61000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','Chef',          time '07:00', time '15:00', 0, 2,  0, 30.69,'Chef whites'),
  ('61000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','Kitchen Porter',time '09:00', time '17:00', 0, 3,  1, 21.23,'Kitchen blacks'),
  ('61000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000001','Waiting Staff', time '17:00', time '23:30', 0, 12, 2, 22.97,'Black & whites'),
  -- Product Launch — Bar (18:00–01:00, crosses midnight)
  ('61000000-0000-4000-8000-000000000004','60000000-0000-4000-8000-000000000002','Bar Staff',     time '18:00', time '01:00', 1, 6,  1, 26.40,'Black shirt & apron'),
  -- Wedding — Marquee
  ('61000000-0000-4000-8000-000000000005','60000000-0000-4000-8000-000000000003','Chef',          time '09:00', time '17:00', 0, 2,  0, 29.00,'Chef whites'),
  ('61000000-0000-4000-8000-000000000006','60000000-0000-4000-8000-000000000003','Waiting Staff', time '12:00', time '22:00', 0, 10, 2, 21.50,'All black'),
  -- Conference Lunch (cancelled)
  ('61000000-0000-4000-8000-000000000007','60000000-0000-4000-8000-000000000004','Waiting Staff', time '10:00', time '15:00', 0, 8,  1, 22.10,'All black'),
  -- Awards Night
  ('61000000-0000-4000-8000-000000000008','60000000-0000-4000-8000-000000000005','Host',          time '17:00', time '23:00', 0, 4,  1, 28.20,'Business suit (navy)'),
  ('61000000-0000-4000-8000-000000000009','60000000-0000-4000-8000-000000000005','Waiting Staff', time '18:00', time '00:30', 1, 16, 2, 24.10,'Black & whites'),
  -- Lunch Service (completed, two weeks ago)
  ('61000000-0000-4000-8000-000000000010','60000000-0000-4000-8000-000000000006','Waiting Staff', time '11:00', time '16:00', 0, 6,  1, 22.97,'Black & whites')
) as sr(id, event_id, role_name, start_t, end_t, end_day_offset, headcount, buffer, charge_rate, dress_code)
join events e on e.id = sr.event_id::uuid
join roles r on r.name = sr.role_name
on conflict (id) do update set
  event_id = excluded.event_id, role_id = excluded.role_id, starts_at = excluded.starts_at,
  ends_at = excluded.ends_at, headcount = excluded.headcount, buffer = excluded.buffer,
  charge_rate = excluded.charge_rate, pay_rate = excluded.pay_rate, dress_code = excluded.dress_code,
  allocation_per_hour = excluded.allocation_per_hour;

-- ---------------------------------------------------------------------
-- BOOKINGS — enough to make the event board and the fill chips real.
-- Fill counts ONLY confirmed, so these sections read 9 of 12, 2 of 2, etc.
-- Keyed on (shift_id, staff_id), which is unique, so re-running is a no-op.
-- ---------------------------------------------------------------------
insert into bookings (shift_id, staff_id, status, source, confirmed_at, day_before_confirmed_at)
select p.shift_id::uuid, p.staff_id::uuid, p.status::booking_status, p.source::booking_source,
       case when p.status in ('confirmed','worked') then now() - interval '2 days' end,
       case when p.status = 'worked' then now() - interval '15 days' end
from (values
  -- Gala Dinner · Chef 2 (+0) — full
  ('61000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000004','confirmed','auto'),
  ('61000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000011','confirmed','manual'),
  -- Gala Dinner · Kitchen Porter 3 (+1) — 2 confirmed, 1 invited
  ('61000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000009','confirmed','auto'),
  ('61000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000013','confirmed','auto'),
  ('61000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000007','invited','auto'),
  -- Gala Dinner · Waiting Staff 12 (+2) — 9 confirmed, 3 invited, 1 self-applied
  ('61000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','confirmed','auto'),
  ('61000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002','confirmed','auto'),
  ('61000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','confirmed','auto'),
  ('61000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000005','confirmed','auto'),
  ('61000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000008','confirmed','auto'),
  ('61000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000010','confirmed','manual'),
  ('61000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000012','confirmed','auto'),
  ('61000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000017','confirmed','auto'),
  ('61000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000020','confirmed','auto'),
  ('61000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000015','invited','auto'),
  ('61000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000019','invited','auto'),
  ('61000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000016','invited','auto'),
  ('61000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000024','applied','self'),
  -- Product Launch · Bar Staff 6 (+1) — 4 confirmed, 2 invited
  ('61000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000006','confirmed','auto'),
  ('61000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000014','confirmed','auto'),
  ('61000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000016','confirmed','auto'),
  ('61000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000018','confirmed','manual'),
  ('61000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000002','invited','auto'),
  ('61000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000017','invited','escalation'),
  -- Awards Night · Host 4 (+1) — 3 confirmed
  ('61000000-0000-4000-8000-000000000008','20000000-0000-4000-8000-000000000015','confirmed','auto'),
  ('61000000-0000-4000-8000-000000000008','20000000-0000-4000-8000-000000000001','confirmed','auto'),
  ('61000000-0000-4000-8000-000000000008','20000000-0000-4000-8000-000000000019','confirmed','manual'),
  -- Lunch Service (completed) · Waiting Staff 6 (+1) — all worked
  ('61000000-0000-4000-8000-000000000010','20000000-0000-4000-8000-000000000002','worked','auto'),
  ('61000000-0000-4000-8000-000000000010','20000000-0000-4000-8000-000000000003','worked','auto'),
  ('61000000-0000-4000-8000-000000000010','20000000-0000-4000-8000-000000000005','worked','auto'),
  ('61000000-0000-4000-8000-000000000010','20000000-0000-4000-8000-000000000008','worked','auto'),
  ('61000000-0000-4000-8000-000000000010','20000000-0000-4000-8000-000000000017','worked','manual'),
  ('61000000-0000-4000-8000-000000000010','20000000-0000-4000-8000-000000000025','worked','auto')
) as p(shift_id, staff_id, status, source)
on conflict (shift_id, staff_id) do update set
  status = excluded.status, source = excluded.source,
  confirmed_at = excluded.confirmed_at, day_before_confirmed_at = excluded.day_before_confirmed_at;

update bookings set applied_at = now() - interval '1 day' where status = 'applied';

-- ---------------------------------------------------------------------
-- Compliance evidence so the review queue and the documents tab are not
-- empty (§4.1). One expiring passport drives the auto-block on Jonah W.
-- ---------------------------------------------------------------------
insert into compliance_docs (id, staff_id, doc_type, file_path, expiry_date, review_status, needs_manual_review, ai_confidence)
values
 ('62000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','passport','documents/412/passport.pdf', current_date + 900,'verified',false,0.980),
 ('62000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000021','passport','documents/417/passport.pdf', current_date - 19,'verified',false,0.960),
 ('62000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','visa_document','documents/873/visa.pdf', date '2026-12-13','verified',false,0.910),
 ('62000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','university_term_dates_letter','documents/873/term-dates.pdf', null,'verified',false,0.870),
 ('62000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000033','national_id','documents/pending/dp-id.pdf', current_date + 1200,'pending',true,0.520),
 ('62000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000034','passport','documents/pending/kc-passport.pdf', current_date + 400,'pending',false,0.940),
 ('62000000-0000-4000-8000-000000000007','20000000-0000-4000-8000-000000000035','share_code_report','documents/pending/ts-share-code.pdf', date '2027-09-30','pending',true,0.610),
 ('62000000-0000-4000-8000-000000000008','20000000-0000-4000-8000-000000000011','university_completion_letter','documents/467/completion.pdf', null,'verified',false,0.890)
on conflict (id) do update set
  staff_id = excluded.staff_id, doc_type = excluded.doc_type, file_path = excluded.file_path,
  expiry_date = excluded.expiry_date, review_status = excluded.review_status,
  needs_manual_review = excluded.needs_manual_review, ai_confidence = excluded.ai_confidence;

-- Criminal declarations: "No" is auto-verified at onboarding (§2.9).
insert into criminal_declarations (id, staff_id, source, answer, review_status)
select ('63000000-0000-4000-8000-0000000000' || lpad(row_number() over (order by s.employee_id)::text, 2, '0'))::uuid,
       s.id, 'onboarding', false, 'verified'
from staff s where s.status in ('compliant','blocked','inactive')
on conflict (id) do nothing;

commit;

-- =====================================================================
-- DEV LOGINS (local only)
--
-- profiles.id is a foreign key to auth.users, so a profile can only exist
-- where GoTrue has a user. This block is skipped with a NOTICE when the
-- auth schema is not the one GoTrue creates (for example when this file is
-- replayed against a bare Postgres), so the seed above always applies.
--
-- Passwords are all `password123`. Local development only — production
-- accounts are created by invite (§1.4, workers land on /activate).
-- =====================================================================
do $$
declare
  required text[] := array['id','aud','role','email','encrypted_password','email_confirmed_at',
                           'raw_app_meta_data','raw_user_meta_data','created_at','updated_at'];
  missing text;
begin
  if to_regclass('auth.users') is null then
    raise notice 'seed: auth.users not found, skipping dev logins';
    return;
  end if;

  select string_agg(c, ', ') into missing
  from unnest(required) c
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'users' and column_name = c);

  if missing is not null then
    raise notice 'seed: auth.users is missing % — skipping dev logins', missing;
    return;
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', u.id::uuid, 'authenticated', 'authenticated', u.email,
         crypt('password123', gen_salt('bf')), now(),
         '{"provider":"email","providers":["email"]}'::jsonb,
         jsonb_build_object('full_name', u.full_name), now(), now()
  from (values
    ('10000000-0000-4000-8000-000000000001','gisela@thehospitalitycompany.example','Gisela M.'),
    ('10000000-0000-4000-8000-000000000002','ops@thehospitalitycompany.example','Operations'),
    ('10000000-0000-4000-8000-000000000003','marco@leonardo-stpauls.example','Marco V.'),
    ('10000000-0000-4000-8000-000000000004','sophie@mo-hydepark.example','Sophie L.'),
    ('10000000-0000-4000-8000-000000000005','tom.reid@example.com','Tom Reid'),
    ('10000000-0000-4000-8000-000000000006','amara.kalu@example.com','Amara Kalu')
  ) as u(id, email, full_name)
  on conflict (id) do update set
    email = excluded.email, encrypted_password = excluded.encrypted_password,
    email_confirmed_at = excluded.email_confirmed_at, updated_at = now();

  -- GoTrue >= 2.x needs an identity row before email/password login works.
  if to_regclass('auth.identities') is not null
     and exists (select 1 from information_schema.columns
                 where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id') then
    insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    select gen_random_uuid(), u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
           'email', now(), now(), now()
    from auth.users u
    where u.id in ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
                   '10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004',
                   '10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000006')
      and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');
  end if;

  insert into profiles (id, role, full_name, client_id) values
    ('10000000-0000-4000-8000-000000000001','admin', 'Gisela M.',  null),
    ('10000000-0000-4000-8000-000000000002','admin', 'Operations', null),
    ('10000000-0000-4000-8000-000000000003','client','Marco V.',   '40000000-0000-4000-8000-000000000001'),
    ('10000000-0000-4000-8000-000000000004','client','Sophie L.',  '40000000-0000-4000-8000-000000000002'),
    ('10000000-0000-4000-8000-000000000005','staff', 'Tom Reid',   null),
    ('10000000-0000-4000-8000-000000000006','staff', 'Amara Kalu', null)
  on conflict (id) do update set
    role = excluded.role, full_name = excluded.full_name, client_id = excluded.client_id;

  -- Link the two worker logins to their staff records.
  update staff set user_id = '10000000-0000-4000-8000-000000000005'
   where id = '20000000-0000-4000-8000-000000000002';
  update staff set user_id = '10000000-0000-4000-8000-000000000006'
   where id = '20000000-0000-4000-8000-000000000001';
end $$;
