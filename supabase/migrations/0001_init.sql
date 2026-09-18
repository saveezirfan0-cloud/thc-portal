-- =====================================================================
-- The Hospitality Company · Staffing platform
-- Migration 0001 · core schema (Scope of Work v1.6 §1.5 data model)
-- Postgres 15 on Supabase. PostGIS for distances / geofences.
-- Every scheduled time is stored as timestamptz; rules evaluate in Europe/London.
-- =====================================================================

create extension if not exists postgis;
create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------
create type app_role as enum ('admin', 'client', 'staff');

-- Staff.status state machine (§2.12)
create type staff_status as enum (
  'interview_requested', 'interview_completed', 'documents', 'quiz', 'additional_info', 'contract',
  'compliant', 'blocked', 'inactive', 'rejected', 'removed'
);
create type block_kind as enum ('auto_document', 'manual', 'conviction_review');

-- Right to Work branches (§2.5)
create type rtw_branch as enum ('uk_irish', 'eu_settled', 'work_visa', 'international_student', 'dependant_other');

create type doc_type as enum (
  'passport', 'birth_certificate', 'ni_evidence', 'national_id', 'visa_document', 'status_document',
  'university_term_dates_letter', 'university_completion_letter', 'share_code_report'
);
create type review_status as enum ('pending', 'verified', 'rejected', 'superseded');

create type event_status as enum ('upcoming', 'ongoing', 'completed', 'cancelled'); -- only 'cancelled' is stored; others derived
create type booking_status as enum ('invited', 'confirmed', 'worked', 'cancelled', 'closed', 'applied', 'turned_away');
create type booking_source as enum ('auto', 'manual', 'self', 'escalation');
create type checklog_outcome as enum ('checked_in', 'turned_away', 'out_of_radius');
create type violation_type as enum ('no_show', 'late', 'left_early', 'left_geofence', 'no_checkout');
create type feedback_author as enum ('client', 'office');
create type declaration_source as enum ('onboarding', 'in_employment');
create type hmrc_statement as enum ('A', 'B', 'C');
create type student_loan_plan as enum ('none', 'plan1', 'plan2', 'plan4');
create type notification_channel as enum ('push', 'email', 'sms');

-- ---------------------------------------------------------------------
-- IDENTITY / RBAC
-- ---------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role app_role not null,
  full_name text not null,
  client_id uuid,            -- set for role = client
  created_at timestamptz not null default now()
);

-- helper: current role for RLS
create or replace function public.current_app_role() returns app_role
language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() $$;

create or replace function public.current_client_id() returns uuid
language sql stable security definer set search_path = public as
$$ select client_id from profiles where id = auth.uid() $$;

-- ---------------------------------------------------------------------
-- REFERENCE DATA
-- ---------------------------------------------------------------------
create table roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,                       -- internal, never shown to client
  pay_rate numeric(8,2) not null check (pay_rate >= 0),   -- £/h base
  created_at timestamptz not null default now()
);
-- final rate = pay_rate * 1.1207 (holiday +12.07%) — calculated, never stored (§1.5)
create or replace function final_rate(base numeric) returns numeric
language sql immutable as $$ select round(base * 1.1207, 2) $$;

create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text not null,
  phone text not null,
  staff_contact_point text not null,       -- default on-site contact shown to staff
  contact_emails text[] not null check (array_length(contact_emails,1) between 1 and 5),
  pays_breaks boolean not null default true,     -- Break policy (§3.2)
  pays_buffer boolean not null default true,     -- Buffer policy (§3.2)
  created_at timestamptz not null default now()
);

create table client_rate_cards (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  role_id uuid not null references roles(id),
  charge_rate numeric(8,2) not null check (charge_rate >= 0),
  dress_codes text[] not null default '{}',      -- predefined list per client+role (§9.7)
  unique (client_id, role_id)
);

create table venue_types (
  key text primary key,                          -- editable defaults (§9.11)
  label text not null,
  default_radius_m int not null check (default_radius_m between 100 and 3000)
);
insert into venue_types values
 ('restaurant_bar','Restaurant / bar',100),('hotel','Hotel',150),('private_residence','Private residence',150),
 ('conference','Conference or banqueting venue',250),('exhibition','Exhibition centre',400),('stadium','Stadium or arena',500),
 ('racecourse','Racecourse or showground',1500),('outdoor','Outdoor or festival site',3000),('other','Other',150);

create table venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  location geography(point, 4326) not null,
  venue_type text not null references venue_types(key),
  geofence_radius_m int not null check (geofence_radius_m between 100 and 3000),
  deleted_at timestamptz,                        -- soft delete: existing events keep their own copy (§9.11)
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- STAFF / CANDIDATES
-- ---------------------------------------------------------------------
create sequence employee_id_seq start 10001;

create table staff (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id),
  employee_id int unique,                         -- generated at contract signature (§2.7); retained on reset
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text not null,
  dob date not null,
  home_address text,
  home_location geography(point, 4326),
  photo_path text,                                -- selfie in Storage; locked after onboarding
  status staff_status not null default 'interview_requested',
  block_kind block_kind,
  block_reason text,                              -- manual block reason (§9.6) / 'Criminal conviction declared — under review'
  rtw_branch rtw_branch,
  share_code text,                                -- 9 alnum starting with W, normalised upper, spaces stripped
  right_to_work_until date,                       -- from gov.uk report
  ni_number text,                                 -- masked in UI, locked once set
  wtr_optout boolean not null default false,      -- 48h opt-out (§4.4)
  graduated_at date,                              -- set when completion letter verified (§4.5)
  term_dates daterange[] not null default '{}',   -- holiday ranges from verified term letter (RULE-20)
  rating numeric(3,2),
  reliability numeric(5,2),                       -- show-rate %
  left_at timestamptz, leave_reason text,         -- worker left via app (§10.6)
  removed_at timestamptz,                         -- GDPR (§1.7)
  willo_candidate_id text,
  quiz_attempts int not null default 0,
  contract_signed_at timestamptz, contract_version text,
  gdpr_consent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint age_18 check (dob <= (current_date - interval '18 years'))
);
create index on staff (status);
create index on staff using gist (home_location);

create table staff_roles (                       -- role qualification (what they can do anywhere)
  staff_id uuid references staff(id) on delete cascade,
  role_id uuid references roles(id),
  primary key (staff_id, role_id)
);

create table client_qualifications (             -- per client AND per role (§1.5, RULE-17)
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  role_id uuid not null references roles(id),
  staff_id uuid not null references staff(id) on delete cascade,
  granted_by uuid references profiles(id),        -- null = system
  granted_from_event uuid,                        -- automatic grant after a clean shift
  granted_at timestamptz not null default now(),
  do_not_return boolean not null default false,
  note text,
  unique (client_id, role_id, staff_id)
);

create table staff_references (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id) on delete cascade,
  name text not null, relationship text not null, phone text not null, email text not null
);

create table bank_details (
  staff_id uuid primary key references staff(id) on delete cascade,
  account_holder text not null, sort_code text not null, account_number text not null,
  updated_at timestamptz not null default now()
);

create table hmrc_checklists (
  staff_id uuid primary key references staff(id) on delete cascade,
  q1_other_job boolean not null,
  q2_pension boolean,                             -- only if q1 = false
  q3_since_6_april boolean,                       -- only if q1 = false and q2 = false
  statement hmrc_statement not null,              -- derived, worker never sees it (§2.8)
  student_loan student_loan_plan not null default 'none',
  postgraduate_loan boolean not null default false,
  declared boolean not null check (declared),     -- mandatory declaration tick
  submitted_at timestamptz not null default now(),
  superseded boolean not null default false
);

create table criminal_declarations (             -- history, never edited (§1.5)
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id) on delete cascade,
  declared_at timestamptz not null default now(),
  source declaration_source not null,
  answer boolean not null,                        -- true = yes
  details text, conviction_date date,
  review_status review_status not null default 'pending',
  reviewed_by uuid references profiles(id), reviewed_at timestamptz, review_note text,
  superseded boolean not null default false
);

create table compliance_docs (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id) on delete cascade,
  doc_type doc_type not null,
  file_path text,                                 -- Storage path (bucket: documents)
  uploaded_at timestamptz not null default now(),
  expiry_date date,                               -- AI pre-filled, manager confirmed
  ai_extracted jsonb,                             -- raw provider output
  ai_confidence numeric(4,3),
  needs_manual_review boolean not null default false,
  review_status review_status not null default 'pending',
  rejection_reason text,
  reviewed_by uuid references profiles(id), reviewed_at timestamptz,
  share_code text, gov_report_path text, right_to_work_until date,
  term_dates daterange[],                         -- for term letters
  completion_date date, awarding_institution text -- for completion letters
);
create index on compliance_docs (staff_id, review_status);
create index on compliance_docs (expiry_date) where review_status = 'verified';

create table quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id) on delete cascade,
  attempt_no int not null check (attempt_no between 1 and 3),
  score numeric(5,2) not null, passed boolean not null,
  answers jsonb not null, taken_at timestamptz not null default now(),
  unique (staff_id, attempt_no)
);

-- ---------------------------------------------------------------------
-- EVENTS / SHIFTS / BOOKINGS
-- ---------------------------------------------------------------------
create table events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  venue_id uuid references venues(id),
  venue_name text not null, venue_address text not null,        -- snapshot (venue delete never breaks events)
  venue_location geography(point,4326) not null, geofence_radius_m int not null,
  title text not null,
  event_date date not null,
  notes text,
  onsite_contact text,
  po_number text,                                 -- free text, entered by manager, no format (§3.2)
  pays_breaks boolean not null, pays_buffer boolean not null,   -- copied from client at creation
  cancelled_at timestamptz, cancel_reason text, cancelled_by uuid references profiles(id),
  auto_assign boolean not null default true,      -- event-level switch
  payroll_exported_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index on events (event_date);

create table shift_requirements (                -- one per role section (RULE-18)
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  role_id uuid not null references roles(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  headcount int not null check (headcount >= 1),
  buffer int not null default 0 check (buffer >= 0),
  charge_rate numeric(8,2) not null,
  pay_rate numeric(8,2) not null,
  dress_code text,
  auto_assign boolean not null default true,      -- role-level switch
  allocation_per_hour int not null,               -- default headcount + buffer
  constraint min_4h check (ends_at >= starts_at + interval '4 hours')
);
create index on shift_requirements (starts_at);

-- derived event window (§1.5): earliest role start → latest role end
create or replace view event_windows as
  select event_id, min(starts_at) as starts_at, max(ends_at) as ends_at
  from shift_requirements group by event_id;

create or replace function event_status(e events, window_start timestamptz, window_end timestamptz)
returns event_status language sql stable as $$
  select case when e.cancelled_at is not null then 'cancelled'::event_status
              when now() < window_start then 'upcoming'
              when now() between window_start and window_end then 'ongoing'
              else 'completed' end $$;

create table bookings (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references shift_requirements(id) on delete cascade,
  staff_id uuid not null references staff(id),
  status booking_status not null,
  source booking_source not null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  day_before_confirmed_at timestamptz,
  on_day_confirmed_at timestamptz,
  reconfirm_required boolean not null default false,   -- time/venue/dress change → Awaiting (§3.5)
  reconfirm_reason text,
  cancelled_at timestamptz, cancel_cause text,         -- withdraw / cutoff / self_cancel / gdpr / blocked / event_cancelled / left
  self_cancelled boolean not null default false,       -- RULE-04: permanently excluded from this event
  applied_at timestamptz,                              -- Radar self-application
  unique (shift_id, staff_id)
);
create index on bookings (staff_id, status);
create index on bookings (shift_id, status);

create table check_logs (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  attempted_at timestamptz not null default now(),   -- every button press, regardless of outcome
  outcome checklog_outcome not null,
  location geography(point,4326),
  distance_m numeric(9,1),
  check_in_at timestamptz,                             -- set when outcome = checked_in
  check_out_at timestamptz,                            -- actual recorded (in-radius press / last on-site fix / manager-entered)
  check_out_pressed_at timestamptz,
  check_out_on_site boolean,
  last_on_site_at timestamptz,                         -- from background tracking (Capacitor) or last foreground fix
  manager_finish_at timestamptz,                       -- RULE-02 resolution
  on_site_verified boolean not null default false
);
create index on check_logs (booking_id);

create table breaks (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  started_at timestamptz not null, ended_at timestamptz
);

create table location_pings (                        -- during-shift tracking (only if native shell provides it)
  id bigint generated always as identity primary key,
  booking_id uuid not null references bookings(id) on delete cascade,
  at timestamptz not null default now(),
  location geography(point,4326) not null,
  inside_geofence boolean not null
);
create index on location_pings (booking_id, at desc);

create table violations (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id),
  booking_id uuid not null references bookings(id) on delete cascade,
  type violation_type not null,
  detected_at timestamptz not null default now(),
  minutes_late int,
  resolved boolean not null default false,
  resolved_by uuid references profiles(id), resolved_at timestamptz, resolution_note text,
  actual_finish_at timestamptz                       -- for no_checkout resolution (UK time input)
);
create index on violations (resolved, detected_at desc);

create table feedback (
  id uuid primary key default gen_random_uuid(),
  author_kind feedback_author not null,
  author_id uuid references profiles(id),
  staff_id uuid not null references staff(id),
  event_id uuid not null references events(id),
  rating int not null check (rating between 1 and 5),
  text text,
  read_at timestamptz,                                 -- client feedback counts toward rating only after read (§9.10)
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

-- ---------------------------------------------------------------------
-- NOTIFICATIONS (outbox pattern, idempotent by key)
-- ---------------------------------------------------------------------
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id) on delete cascade,
  endpoint text not null unique, p256dh text not null, auth text not null,
  user_agent text, created_at timestamptz not null default now()
);

create table notification_outbox (
  id bigint generated always as identity primary key,
  key text not null unique,                            -- e.g. 'N6:booking:<id>' — prevents duplicates
  channel notification_channel not null,
  template text not null,                              -- N1..N15, E2..E9, ...
  recipient_staff_id uuid references staff(id),
  recipient_emails text[],
  payload jsonb not null default '{}',
  send_after timestamptz not null default now(),
  sent_at timestamptz, failed_at timestamptz, error text
);
create index on notification_outbox (send_after) where sent_at is null and failed_at is null;

create table report_sends (                            -- BG-08 audit (§9.9 send status)
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('payroll','new_starter')),
  period_start date not null, period_end date not null,
  sent_at timestamptz, status text not null,           -- sent / failed / no_new
  error text
);

create table settings (                                -- Django-Admin equivalents: scoring weights, stage mapping, senders
  key text primary key, value jsonb not null, updated_at timestamptz not null default now()
);
insert into settings values
 ('scoring_weights', '{"show_rate":0.30,"rating":0.25,"proximity":0.25,"fair_rotation":0.10,"venue_history":0.10}'),
 ('willo_stage_map', '{"new_response":"interview_completed","accepted":"documents","rejected":"rejected"}'),
 ('booked_elsewhere_gap_minutes', '120'),
 ('escalation_radius_miles', '3');

create table audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid, action text not null, entity text not null, entity_id uuid, data jsonb
);

-- ---------------------------------------------------------------------
-- WEEKLY CAP — RULE-20 (calculated, never stored)
-- ---------------------------------------------------------------------
create or replace function weekly_cap_hours(p_staff uuid, p_date date)
returns int language plpgsql stable as $$
declare s staff; d date; cap int := 48; lowest int := 48; in_holiday boolean;
begin
  select * into s from staff where id = p_staff;
  if s.rtw_branch <> 'international_student' or s.graduated_at is not null and s.graduated_at <= p_date then
    return case when s.wtr_optout then null else 48 end;   -- null = no ceiling
  end if;
  -- Mon–Sun week containing p_date takes the LOWEST cap of any day
  for d in select generate_series(date_trunc('week', p_date)::date, date_trunc('week', p_date)::date + 6, '1 day')::date loop
    in_holiday := exists (select 1 from unnest(s.term_dates) r where d <@ r);
    if not in_holiday then lowest := 20; end if;
  end loop;
  if lowest = 20 then return 20; end if;                  -- opt-out cannot lift a visa condition
  return case when s.wtr_optout then null else 48 end;
end $$;

-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY (skeleton — every table gets RLS; policies by role)
-- ---------------------------------------------------------------------
alter table profiles enable row level security;
alter table staff enable row level security;
alter table events enable row level security;
alter table shift_requirements enable row level security;
alter table bookings enable row level security;
alter table compliance_docs enable row level security;
alter table feedback enable row level security;
alter table clients enable row level security;
alter table venues enable row level security;
alter table roles enable row level security;
alter table client_rate_cards enable row level security;
alter table check_logs enable row level security;
alter table breaks enable row level security;
alter table violations enable row level security;
alter table criminal_declarations enable row level security;
alter table notification_outbox enable row level security;
alter table settings enable row level security;

-- Admin: everything
create policy admin_all on staff for all using (current_app_role() = 'admin');
create policy admin_all on events for all using (current_app_role() = 'admin');
create policy admin_all on shift_requirements for all using (current_app_role() = 'admin');
create policy admin_all on bookings for all using (current_app_role() = 'admin');
create policy admin_all on compliance_docs for all using (current_app_role() = 'admin');
create policy admin_all on feedback for all using (current_app_role() = 'admin');
create policy admin_all on clients for all using (current_app_role() = 'admin');
create policy admin_all on venues for all using (current_app_role() = 'admin');
create policy admin_all on roles for all using (current_app_role() = 'admin');
create policy admin_all on client_rate_cards for all using (current_app_role() = 'admin');
create policy admin_all on check_logs for all using (current_app_role() = 'admin');
create policy admin_all on breaks for all using (current_app_role() = 'admin');
create policy admin_all on violations for all using (current_app_role() = 'admin');
create policy admin_all on criminal_declarations for all using (current_app_role() = 'admin');
create policy admin_all on settings for all using (current_app_role() = 'admin');

-- Staff: own record only (no rates other than their own base pay; no other workers)
create policy staff_self on staff for select using (user_id = auth.uid());
create policy staff_self_docs on compliance_docs for select using (staff_id = (select id from staff where user_id = auth.uid()));
create policy staff_self_bookings on bookings for select using (staff_id = (select id from staff where user_id = auth.uid()));
create policy staff_self_decl on criminal_declarations for select using (staff_id = (select id from staff where user_id = auth.uid()));
create policy profiles_self on profiles for select using (id = auth.uid());

-- Client: own events only; money columns are hidden via views (client_events_v, client_lineup_v)
create policy client_events on events for select using (current_app_role() = 'client' and client_id = current_client_id());
create policy client_shifts on shift_requirements for select using (
  current_app_role() = 'client' and exists (select 1 from events e where e.id = event_id and e.client_id = current_client_id()));
create policy client_feedback_insert on feedback for insert with check (
  current_app_role() = 'client' and author_kind = 'client'
  and exists (select 1 from events e where e.id = event_id and e.client_id = current_client_id()));

-- Client-safe views (no charge/pay/margin columns ever leave the DB for a client)
create or replace view client_events_v with (security_invoker = true) as
  select e.id, e.client_id, e.title, e.venue_name, e.venue_address, e.event_date, e.po_number, w.starts_at, w.ends_at,
         event_status(e, w.starts_at, w.ends_at) as status
  from events e join event_windows w on w.event_id = e.id;

create or replace view client_lineup_v with (security_invoker = true) as
  select b.id as booking_id, sr.event_id, r.name as role, sr.starts_at, sr.ends_at,
         case when s.removed_at is null then s.first_name || ' ' || s.last_name else 'Deleted account #' || s.employee_id end as name,
         case when s.removed_at is null then s.photo_path end as photo_path
  from bookings b join shift_requirements sr on sr.id = b.shift_id join roles r on r.id = sr.role_id join staff s on s.id = b.staff_id
  where b.status in ('confirmed','worked');

-- Storage buckets (documents private, photos private) are created via the Supabase dashboard/CLI:
--   documents (private) · photos (private) · reports (private) · timesheets (private)
