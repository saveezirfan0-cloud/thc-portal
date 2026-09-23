-- =====================================================================
-- Migration 20260923130000 · Reports (§9.9) and the Monday send (BG-08)
--
-- What this exists for
-- --------------------
-- §9.9 is three tabs over one question — what is owed for the work that
-- happened — and BG-08 is the same question answered for finance every
-- Monday at 09:00 UK, by email, without anybody pressing anything. The
-- money has exactly one definition in this platform and it lives here:
--
--   · payable minutes are payable_shifts_v's (RULE-01/02/14/15). Nothing
--     below re-derives the pay window, the 15-minute grace, the break
--     deduction or the four-hour floor; it reads `pay` and prices it;
--   · the base for a shift is payable minutes x the section's own base
--     rate, rounded to the penny; the holiday element is base x 12.07%,
--     rounded to the penny, carried in its OWN column and never folded into
--     the rate (§1.5, §9.8, §9.9). This is `pay()` in
--     packages/domain/src/pay.ts, repeated here so the export and the
--     worker's earnings screen round identically. (The §9.1 dashboard
--     forecast uses final_rate() − base per HOUR; on a forecast the two
--     differ by pennies, and the Payroll tab is the one finance pays from);
--   · a shift carrying an unresolved "No check-out" is PENDING: no figure,
--     never a guessed one (RULE-02), and it is not exported (BG-08) — it
--     is HELD and rolls forward to the next Monday's run.
--
-- The four read functions — payroll_report, payroll_report_people,
-- finance_report, new_starter_report — are what /reports reads. BG-08 is
-- three more — finance_reports_due, prepare_finance_reports,
-- queue_finance_report_email — called in that order by the
-- `finance-reports` Edge Function, which builds the two CSVs in between
-- with the same TypeScript builder the "Export CSV" button uses
-- (packages/pdf/src/csv.ts).
--
-- "Never corrected retroactively"
-- -------------------------------
-- A payroll export is a fact about what finance was told. Once a line has
-- gone, `payroll_export_lines` holds the figures AS SENT — minutes, rate,
-- base, holiday — and nothing ever updates them. A later No-show, a
-- "Get back" or a resolved violation changes the live figure; the Payroll
-- tab then shows both and a warning, and the correction happens in THC's
-- own finance process (§3.3). A booking can be exported once: a partial
-- unique index says so, so a second run cannot pay it twice.
--
-- Who may call what
-- -----------------
-- Every function is `security definer` and starts with
-- assert_reports_caller(): the admin, or the service role (the Edge
-- Function). A worker has self policies on bookings and staff and must not
-- be able to read the payroll through a definer function that bypasses
-- them, so the guard raises rather than filtering. The line view under
-- them is owner-rights and granted to NOBODY; it is reachable only through
-- these functions.
--
-- Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0 · The three New Starter (HMRC) fields nothing collected yet
--
-- §9.9 Tab 3's columns, confirmed 28.07.2026, include Postcode, Country
-- and Gender (M/F). `staff` has a single free-text home_address and no
-- gender at all. They are added nullable, `if not exists`, so the §10.3
-- onboarding wizard (S2) can fill them without a second migration fighting
-- this one. Until it does, Postcode falls back to the UK postcode at the
-- end of home_address (new_starter_postcode below) and the other two print
-- blank rather than a guess.
--
-- GDPR (§1.7): remove_worker() predates these columns and does not null
-- them. They are wiped by the trigger at the bottom of this section, which
-- fires on the same update that sets removed_at, so the erasure does not
-- depend on remove_worker() being edited to know they exist.
-- ---------------------------------------------------------------------
alter table staff add column if not exists gender text;
alter table staff add column if not exists home_postcode text;
alter table staff add column if not exists home_country text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_gender_m_or_f') then
    alter table staff add constraint staff_gender_m_or_f check (gender is null or gender in ('M', 'F'));
  end if;
end $$;

comment on column staff.gender is 'HMRC New Starter report only (§9.9 Tab 3): M or F. Null until onboarding collects it.';
comment on column staff.home_postcode is 'HMRC New Starter report (§9.9 Tab 3). Null falls back to the postcode at the end of home_address.';
comment on column staff.home_country is 'HMRC New Starter report (§9.9 Tab 3). Null prints blank, never a guessed country.';

create or replace function public.staff_wipe_report_fields() returns trigger
language plpgsql set search_path = public, extensions as $$
begin
  if new.removed_at is not null and old.removed_at is null then
    new.gender := null;
    new.home_postcode := null;
    new.home_country := null;
  end if;
  return new;
end $$;

drop trigger if exists staff_wipe_report_fields on staff;
create trigger staff_wipe_report_fields
  before update of removed_at on staff
  for each row execute function public.staff_wipe_report_fields();

-- ---------------------------------------------------------------------
-- 1 · Money helpers — pay() from packages/domain, in SQL
-- ---------------------------------------------------------------------
create or replace function public.shift_base_pay(p_payable_min int, p_rate numeric)
returns numeric language sql immutable set search_path = public, extensions as $$
  select round(p_payable_min::numeric * p_rate / 60, 2)
$$;

create or replace function public.shift_holiday_pay(p_base numeric)
returns numeric language sql immutable set search_path = public, extensions as $$
  select round(p_base * 0.1207, 2)
$$;

comment on function public.shift_base_pay(int, numeric) is
  'Base pay for one shift: payable minutes x the section base rate, to the penny. pay().basePence in packages/domain/src/pay.ts.';
comment on function public.shift_holiday_pay(numeric) is
  'The 12.07% holiday element of one shift''s base, to the penny, always its own column (§1.5, §9.9). pay().holidayPence.';

-- The Mon–Sun week an instant falls in, by the London wall clock.
create or replace function public.report_week_start(p_now timestamptz default now())
returns date language sql stable set search_path = public, extensions as $$
  select date_trunc('week', uk_local(p_now))::date
$$;

-- A UK postcode at the end of a free-text address, or null. Used only when
-- staff.home_postcode has not been collected.
create or replace function public.new_starter_postcode(p_address text)
returns text language sql immutable set search_path = public, extensions as $$
  select nullif(substring(upper(coalesce(p_address, ''))
                from '.*\m([A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2})\M'), '')
$$;

-- The caller check every report function starts with.
create or replace function public.assert_reports_caller()
returns void language plpgsql stable set search_path = public, extensions as $$
begin
  if current_app_role() is distinct from 'admin'
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'admins_only' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2 · report_payroll_lines_v — one row per shift that can carry money
--
-- The spine of all four tabs and of BG-08. Two sources:
--
--   a. payable_shifts_v: worked, turned away (RULE-15) and no-show rows.
--      No-shows stay IN the view with 0 so a No-show recorded after an
--      export can still be seen next to what was exported; every reader
--      filters them out of the money.
--   b. §3.3's resolved edge case: an event cancelled ON the day or after
--      work started pays every affected worker, and bills the client, the
--      full scheduled hours. payable_shifts_v excludes every cancelled event
--      (it is right to: nothing happened), so those rows come from here.
--      An event cancelled before its day contributes nothing at all.
--
-- `status` is 'pending' exactly when payable_shifts_v says undetermined:
-- an unresolved No check-out, or a check-in/out pair with no overlap with
-- the section. Money columns are null then, never 0 — 0 would be a guess.
-- ---------------------------------------------------------------------
create or replace view report_payroll_lines_v with (security_barrier = true) as
with base as (
  select
    ps.booking_id,
    ps.shift_id,
    ps.event_id,
    ps.staff_id,
    ps.starts_at,
    ps.ends_at,
    ps.check_in_at,
    ps.check_out_at,
    ps.attempted_at,
    ps.kind,
    case when ps.pay->>'status' = 'settled' then 'settled' else 'pending' end as status,
    ps.unpaid_break_min,
    (ps.pay->>'workedMin')::int                        as worked_min,
    (ps.pay->>'payableMin')::int                       as payable_min,
    coalesce((ps.pay->>'floorApplied')::boolean, false) as floor_applied,
    ps.pay_rate,
    ps.charge_rate
  from payable_shifts_v ps
  union all
  select
    b.id, sr.id, e.id, b.staff_id, sr.starts_at, sr.ends_at,
    null::timestamptz, null::timestamptz, null::timestamptz,
    'cancelled_on_day', 'settled', 0,
    (extract(epoch from (sr.ends_at - sr.starts_at)) / 60)::int,
    (extract(epoch from (sr.ends_at - sr.starts_at)) / 60)::int,
    false,
    sr.pay_rate,
    sr.charge_rate
  from bookings b
  join shift_requirements sr on sr.id = b.shift_id
  join events e              on e.id = sr.event_id
  where e.cancelled_at is not null
    and uk_local(e.cancelled_at)::date >= e.event_date
    and b.confirmed_at is not null
    and (b.status in ('confirmed', 'worked')
         or (b.status = 'cancelled' and b.cancel_cause = 'event_cancelled'))
)
select
  x.booking_id,
  x.shift_id,
  x.event_id,
  x.staff_id,
  st.employee_id,
  case when st.removed_at is null then st.first_name || ' ' || st.last_name
       else deleted_account_label(st.employee_id) end            as staff_name,
  case when st.removed_at is null then st.last_name end           as sort_surname,
  st.removed_at is not null                                       as removed,
  case when st.removed_at is null then st.photo_path end          as photo_path,
  e.title                                                         as event_title,
  c.name                                                          as client_name,
  r.name                                                          as role_name,
  uk_local(x.starts_at)::date                                     as shift_date,
  x.starts_at,
  x.ends_at,
  x.check_in_at,
  x.check_out_at,
  x.attempted_at,
  x.kind,
  x.status,
  exists (select 1 from violations v
           where v.booking_id = x.booking_id and v.type = 'no_checkout' and not v.resolved)
                                                                  as no_check_out_unresolved,
  (x.kind = 'worked' and x.check_in_at > x.starts_at)             as late_check_in,
  (x.kind = 'worked' and x.check_out_at is not null
                     and x.check_out_at < x.ends_at)              as early_check_out,
  x.unpaid_break_min,
  x.worked_min,
  x.payable_min,
  x.floor_applied,
  x.pay_rate                                                      as rate,
  x.charge_rate,
  case when x.status = 'settled' then shift_base_pay(x.payable_min, x.pay_rate) end as base,
  case when x.status = 'settled'
       then shift_holiday_pay(shift_base_pay(x.payable_min, x.pay_rate)) end        as holiday,
  case when x.status = 'settled'
       then shift_base_pay(x.payable_min, x.pay_rate)
          + shift_holiday_pay(shift_base_pay(x.payable_min, x.pay_rate)) end        as total,
  -- Invoicing at the section's charge rate for the same payable minutes
  -- (breaks deducted from both — §5.2b). A turn-away is RULE-15 money THC
  -- absorbs: the strict buffer policy exists because the client does not
  -- pay for the buffer, so it is never invoiced.
  case when x.status <> 'settled' then null
       when x.kind in ('worked', 'cancelled_on_day')
         then round(x.payable_min::numeric * x.charge_rate / 60, 2)
       else 0 end                                                 as invoicing
from base x
join staff st              on st.id = x.staff_id
join events e              on e.id = x.event_id
join clients c             on c.id = e.client_id
join shift_requirements sr on sr.id = x.shift_id
join roles r               on r.id = sr.role_id;

comment on view report_payroll_lines_v is
  'One row per shift that can carry money (§9.9): worked, turned away, no-show (0) and §3.3 same-day cancellations (full scheduled hours). Pay from payable_shifts_v only; base and holiday priced separately; pending (unresolved No check-out) has no figure. Owner-rights and granted to nobody: read through the report functions.';

revoke all on report_payroll_lines_v from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3 · What has been exported, as it was exported
-- ---------------------------------------------------------------------
alter table report_sends add column if not exists created_at  timestamptz not null default now();
alter table report_sends add column if not exists row_count   int;
alter table report_sends add column if not exists held_count  int;
alter table report_sends add column if not exists storage_path text;
alter table report_sends add column if not exists outbox_key  text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'report_sends_status_known') then
    alter table report_sends add constraint report_sends_status_known
      check (status in ('preparing', 'queued', 'sent', 'failed', 'no_new'));
  end if;
end $$;

-- One run per kind per week. A re-run of BG-08 finds the row and resumes
-- it rather than exporting the week a second time.
create unique index if not exists report_sends_one_per_period on report_sends (kind, period_start);
create index if not exists report_sends_outbox_key_idx on report_sends (outbox_key);

comment on column report_sends.status is
  'preparing (lines stamped, CSV not yet queued) · queued (in notification_outbox) · sent · failed · no_new (New Starter week with nobody new — §9.9 shows "No new", not a failure).';

create table payroll_export_lines (
  id             bigint generated always as identity primary key,
  report_send_id bigint not null references report_sends(id),
  booking_id     uuid   not null references bookings(id),
  staff_id       uuid   not null references staff(id),
  event_id       uuid   not null references events(id),
  -- exported: went to finance with these figures. held: an unresolved No
  -- check-out kept it out of this run; it rolls to the next (BG-08).
  state          text   not null check (state in ('exported', 'held')),
  shift_date     date   not null,
  payable_min    int,
  rate           numeric(8,2) not null,
  base           numeric(10,2),
  holiday        numeric(10,2),
  created_at     timestamptz not null default now(),
  constraint payroll_export_lines_exported_has_money
    check (state = 'held' or (payable_min is not null and base is not null and holiday is not null)),
  unique (report_send_id, booking_id)
);

-- The "never twice" rule, in the one place it cannot be forgotten.
create unique index payroll_export_lines_once on payroll_export_lines (booking_id) where state = 'exported';
create index payroll_export_lines_held on payroll_export_lines (booking_id) where state = 'held';
-- Every foreign key indexed (002_schema_hardening): a GDPR removal or an
-- event lookup must not scan every export line ever written.
create index payroll_export_lines_booking_idx on payroll_export_lines (booking_id);
create index payroll_export_lines_staff_idx on payroll_export_lines (staff_id);
create index payroll_export_lines_event_idx on payroll_export_lines (event_id);

alter table payroll_export_lines enable row level security;
create policy admin_read on payroll_export_lines for select using (current_app_role() = 'admin');

comment on table payroll_export_lines is
  'BG-08: each shift a Monday run exported (with the figures AS SENT — never updated, §3.3/§9.9) or held for an unresolved No check-out. Written only by prepare_finance_reports(); admin-read.';

-- Per booking: has finance already been sent this shift? The event-level
-- events.payroll_exported_at is what the No-show / Get-back warnings read
-- today (§3.3); this is the exact answer for a caller that has a booking.
create or replace function public.booking_payroll_exported(p_booking uuid)
returns boolean language sql stable set search_path = public, extensions as $$
  select exists (select 1 from payroll_export_lines
                  where booking_id = p_booking and state = 'exported')
$$;

-- ---------------------------------------------------------------------
-- 4 · Tab 2 · Payroll — one row per shift in the range
-- ---------------------------------------------------------------------
create or replace function public.payroll_report(p_from date, p_to date)
returns table (
  booking_id uuid, shift_id uuid, event_id uuid, staff_id uuid, employee_id int,
  staff_name text, sort_surname text, removed boolean, photo_path text,
  event_title text, client_name text, role_name text, shift_date date,
  starts_at timestamptz, ends_at timestamptz,
  check_in_at timestamptz, check_out_at timestamptz, attempted_at timestamptz,
  kind text, status text, no_check_out_unresolved boolean,
  late_check_in boolean, early_check_out boolean,
  unpaid_break_min int, worked_min int, payable_min int, floor_applied boolean,
  rate numeric, base numeric, holiday numeric, total numeric,
  in_export boolean,
  exported_at timestamptz, exported_payable_min int, exported_total numeric,
  changed_since_export boolean
)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
begin
  perform assert_reports_caller();
  return query
  select l.booking_id, l.shift_id, l.event_id, l.staff_id, l.employee_id,
         l.staff_name, l.sort_surname, l.removed, l.photo_path,
         l.event_title, l.client_name, l.role_name, l.shift_date,
         l.starts_at, l.ends_at, l.check_in_at, l.check_out_at, l.attempted_at,
         l.kind, l.status, l.no_check_out_unresolved,
         l.late_check_in, l.early_check_out,
         l.unpaid_break_min, l.worked_min, l.payable_min, l.floor_applied,
         l.rate, l.base, l.holiday, l.total,
         -- The CSV rule, stated once: a settled shift with something to pay.
         -- Pending (No check-out) is held; a late turn-away is paid nothing.
         (l.status = 'settled' and coalesce(l.payable_min, 0) > 0 and l.kind <> 'no_show'),
         x.created_at,
         x.payable_min,
         x.base + x.holiday,
         (x.id is not null and (l.status <> 'settled'
                                or l.payable_min is distinct from x.payable_min
                                or l.total is distinct from x.base + x.holiday))
    from report_payroll_lines_v l
    left join payroll_export_lines x on x.booking_id = l.booking_id and x.state = 'exported'
   where l.shift_date between p_from and p_to
     -- A no-show is not a shift anybody is paid for — unless it was paid
     -- already, in which case it stays visible so the warning can say so.
     and (l.kind <> 'no_show' or x.id is not null)
   order by l.removed, l.sort_surname nulls last, l.staff_name, l.staff_id, l.starts_at;
end $$;

comment on function public.payroll_report(date, date) is
  '§9.9 Tab 2: every shift in the range with scheduled and actual times, break deduction, payable minutes, rate, base, holiday and total; pending for an unresolved No check-out; in_export is the CSV rule; the exported figures and changed_since_export make a post-export change visible instead of silently corrected.';

-- Per person, plus a grand total row (staff_id null) that carries the
-- period summary: workers on shifts · shifts · total to be paid · hours.
create or replace function public.payroll_report_people(p_from date, p_to date)
returns table (
  staff_id uuid, employee_id int, staff_name text, removed boolean, photo_path text,
  is_total boolean, workers int, shifts int, pending int, turned_away int,
  payable_min int, break_min int, base numeric, holiday numeric, total numeric,
  changed_since_export int
)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
begin
  perform assert_reports_caller();
  return query
  with lines as (
    select * from payroll_report(p_from, p_to) r where r.kind <> 'no_show'
  )
  select
    l.staff_id, l.employee_id, l.staff_name, l.removed, l.photo_path,
    grouping(l.staff_id) = 1,
    count(distinct l.staff_id)::int,
    count(*)::int,
    count(*) filter (where l.status = 'pending')::int,
    count(*) filter (where l.kind = 'turned_away')::int,
    coalesce(sum(l.payable_min) filter (where l.status = 'settled'), 0)::int,
    coalesce(sum(l.unpaid_break_min) filter (where l.status = 'settled'), 0)::int,
    coalesce(sum(l.base), 0),
    coalesce(sum(l.holiday), 0),
    coalesce(sum(l.total), 0),
    count(*) filter (where l.changed_since_export)::int
  from lines l
  group by grouping sets ((l.staff_id, l.employee_id, l.staff_name, l.removed, l.photo_path, l.sort_surname), ())
  order by grouping(l.staff_id), bool_or(l.removed), min(l.sort_surname) nulls last, l.staff_name;
end $$;

comment on function public.payroll_report_people(date, date) is
  '§9.9 Tab 2 per-person rows (Staff · Employee ID · Shifts · Payable hours · Base · Holiday · Total) and, with is_total, the period summary. Pending shifts are counted, never priced.';

-- ---------------------------------------------------------------------
-- 5 · Tab 1 · Financial — by day, client or role
--
-- A section that has not ended yet is a FORECAST, priced the way the §9.1
-- dashboard prices it: headcount x section hours at the section's rates,
-- buffer excluded. A section that has ended is ACTUAL: the priced lines
-- above, turned-away money in payroll and not in invoicing, pending shifts
-- counted and not priced. An event cancelled before its day is listed as
-- excluded with no money (§3.3).
-- ---------------------------------------------------------------------
create or replace function public.finance_report(p_from date, p_to date, p_by text default 'day')
returns table (
  group_key text, group_label text, is_total boolean,
  events text[], event_count int,
  payable_min int, base numeric, holiday numeric, payroll numeric,
  invoicing numeric, margin numeric, margin_pct numeric,
  actual_sections int, forecast_sections int, pending int,
  cancelled_events text[]
)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
begin
  perform assert_reports_caller();
  if p_by not in ('day', 'client', 'role') then
    raise exception 'unknown_grouping' using errcode = '22023';
  end if;

  return query
  with sections as (
    select sr.id as shift_id, e.id as event_id, e.title, c.name as client_name, r.name as role_name,
           uk_local(sr.starts_at)::date as day,
           sr.headcount, sr.pay_rate, sr.charge_rate,
           (extract(epoch from (sr.ends_at - sr.starts_at)) / 60)::int as section_min,
           e.cancelled_at is not null
             and uk_local(e.cancelled_at)::date < e.event_date                    as excluded,
           e.cancelled_at is not null
             and uk_local(e.cancelled_at)::date >= e.event_date                   as cancelled_on_day,
           now() < sr.ends_at                                                      as open
      from shift_requirements sr
      join events e  on e.id = sr.event_id
      join clients c on c.id = e.client_id
      join roles r   on r.id = sr.role_id
     where uk_local(sr.starts_at)::date between p_from and p_to
  ),
  actual as (
    select l.shift_id,
           coalesce(sum(l.payable_min) filter (where l.status = 'settled'), 0)::int as payable_min,
           coalesce(sum(l.base), 0)      as base,
           coalesce(sum(l.holiday), 0)   as holiday,
           coalesce(sum(l.invoicing), 0) as invoicing,
           count(*) filter (where l.status = 'pending')::int as pending
      from report_payroll_lines_v l
     where l.kind <> 'no_show'
       and l.shift_date between p_from and p_to
     group by l.shift_id
  ),
  priced as (
    select s.*,
           case
             when s.excluded then 'excluded'
             when s.open and not s.cancelled_on_day then 'forecast'
             else 'actual'
           end as basis,
           a.payable_min as a_min, a.base as a_base, a.holiday as a_holiday,
           a.invoicing as a_invoicing, coalesce(a.pending, 0) as a_pending
      from sections s
      left join actual a on a.shift_id = s.shift_id
  ),
  lines as (
    select p.*,
           case p.basis when 'forecast' then p.headcount * p.section_min
                        when 'actual'   then coalesce(p.a_min, 0) else 0 end            as l_min,
           case p.basis when 'forecast' then round(p.pay_rate * p.headcount * p.section_min / 60, 2)
                        when 'actual'   then coalesce(p.a_base, 0) else 0 end           as l_base,
           case p.basis when 'forecast'
                          then shift_holiday_pay(round(p.pay_rate * p.headcount * p.section_min / 60, 2))
                        when 'actual'   then coalesce(p.a_holiday, 0) else 0 end        as l_holiday,
           case p.basis when 'forecast' then round(p.charge_rate * p.headcount * p.section_min / 60, 2)
                        when 'actual'   then coalesce(p.a_invoicing, 0) else 0 end      as l_invoicing
      from (select pr.*,
                   case p_by when 'day'    then pr.day::text
                             when 'client' then pr.client_name
                             else pr.role_name end as by_key,
                   case p_by when 'day'    then to_char(pr.day, 'Dy DD Mon')
                             when 'client' then pr.client_name
                             else pr.role_name end as by_label
              from priced pr) p
  )
  select
    l.by_key,
    min(l.by_label),
    grouping(l.by_key) = 1,
    coalesce(array_agg(distinct l.title) filter (where l.basis <> 'excluded'), '{}'),
    count(distinct l.event_id) filter (where l.basis <> 'excluded')::int,
    coalesce(sum(l.l_min), 0)::int,
    coalesce(sum(l.l_base), 0),
    coalesce(sum(l.l_holiday), 0),
    coalesce(sum(l.l_base + l.l_holiday), 0),
    coalesce(sum(l.l_invoicing), 0),
    coalesce(sum(l.l_invoicing - l.l_base - l.l_holiday), 0),
    -- Null, never 0%, when nothing is invoiced: an empty week has no margin.
    case when coalesce(sum(l.l_invoicing), 0) > 0
         then round((sum(l.l_invoicing - l.l_base - l.l_holiday) / sum(l.l_invoicing)) * 100, 1) end,
    count(*) filter (where l.basis = 'actual')::int,
    count(*) filter (where l.basis = 'forecast')::int,
    coalesce(sum(l.a_pending) filter (where l.basis = 'actual'), 0)::int,
    coalesce(array_agg(distinct l.title) filter (where l.basis = 'excluded'), '{}')
  from lines l
  group by grouping sets ((l.by_key), ())
  order by grouping(l.by_key), l.by_key;
end $$;

comment on function public.finance_report(date, date, text) is
  '§9.9 Tab 1 grouped by day, client or role, with a total row: Staff payroll as base and holiday separately (never blended), Client invoicing at the charge rate (a revenue forecast, not the PO invoices), Gross margin after holiday. Ended sections are actual (RULE-01 payable time), open ones are forecast at headcount x hours; events cancelled before the day are excluded (§3.3).';

-- ---------------------------------------------------------------------
-- 6 · Tab 3 · New Starter (HMRC)
--
-- "Only NEW workers who ACTUALLY WORKED a shift last week". New = their
-- first shift that carries pay (worked, an on-time turn-away, a same-day
-- cancellation) falls in the Mon–Sun week BEFORE the picked date's week.
-- Pending counts as worked: the person turned up.
-- ---------------------------------------------------------------------
create or replace view report_first_shifts_v with (security_barrier = true) as
select distinct on (l.staff_id)
       l.staff_id, l.booking_id, l.shift_date as first_shift_date, l.starts_at
  from report_payroll_lines_v l
 where l.kind in ('worked', 'turned_away', 'cancelled_on_day')
   and (l.status = 'pending' or coalesce(l.payable_min, 0) > 0)
 order by l.staff_id, l.starts_at, l.booking_id;

revoke all on report_first_shifts_v from public, anon, authenticated;

create or replace function public.new_starter_rows(p_staff uuid[])
returns table (
  staff_id uuid, employee_id int, staff_name text, removed boolean, photo_path text,
  ni_number text, home_address text, postcode text, country text,
  date_of_birth date, gender text, first_shift_date date,
  hmrc_statement text, student_loan text
)
language sql stable security definer set search_path = public, extensions as $$
  select st.id, st.employee_id,
         case when st.removed_at is null then st.first_name || ' ' || st.last_name
              else deleted_account_label(st.employee_id) end,
         st.removed_at is not null,
         case when st.removed_at is null then st.photo_path end,
         st.ni_number,
         st.home_address,
         coalesce(st.home_postcode, new_starter_postcode(st.home_address)),
         st.home_country,
         -- A removed worker's dob is the 1900 placeholder, not a date of birth.
         case when st.removed_at is null then st.dob end,
         st.gender,
         f.first_shift_date,
         h.statement::text,
         case
           when h.staff_id is null then null
           when h.student_loan = 'none' and h.postgraduate_loan then 'Postgraduate'
           when h.student_loan = 'none' then 'No'
           else 'Plan ' || substring(h.student_loan::text from '[0-9]+')
                || case when h.postgraduate_loan then ' + Postgraduate' else '' end
         end
    from staff st
    join report_first_shifts_v f on f.staff_id = st.id
    left join hmrc_checklists h  on h.staff_id = st.id
   where st.id = any(p_staff)
   order by st.removed_at is not null, st.last_name, st.first_name, st.employee_id
$$;

revoke execute on function public.new_starter_rows(uuid[]) from public, anon, authenticated;

create or replace function public.new_starter_report(p_date date)
returns table (
  staff_id uuid, employee_id int, staff_name text, removed boolean, photo_path text,
  ni_number text, home_address text, postcode text, country text,
  date_of_birth date, gender text, first_shift_date date,
  hmrc_statement text, student_loan text,
  period_start date, period_end date
)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_start date := date_trunc('week', p_date)::date - 7;
begin
  perform assert_reports_caller();
  return query
  select n.*, v_start, v_start + 6
    from new_starter_rows(array(
           select f.staff_id from report_first_shifts_v f
            where f.first_shift_date between v_start and v_start + 6)) n;
end $$;

comment on function public.new_starter_report(date) is
  '§9.9 Tab 3: the people whose first paid shift fell in the Mon–Sun week before the picked date''s week, with the HMRC columns (Staff · Employee ID · NI · address · postcode · country · DOB · gender · first shift · statement · student loan). Role and salutation are deliberately absent.';

-- ---------------------------------------------------------------------
-- 7 · BG-08 · the Monday 09:00 send
--
-- Due from Monday 09:00 UK until last week's email is queued. pg_cron is
-- UTC, so the schedule is every five minutes and this decides; a run that
-- missed Monday (a deploy, an outage) catches up later in the week rather
-- than skipping a payroll.
-- ---------------------------------------------------------------------
create or replace function public.finance_reports_due(p_now timestamptz default now())
returns boolean language sql stable set search_path = public, extensions as $$
  select uk_local(p_now) >= date_trunc('week', uk_local(p_now)) + interval '9 hours'
     and not exists (
           select 1 from report_sends r
            where r.kind = 'payroll'
              and r.period_start = report_week_start(p_now) - 7
              and r.outbox_key is not null)
$$;

comment on function public.finance_reports_due(timestamptz) is
  'BG-08 gate: from Monday 09:00 Europe/London until last week''s payroll email has been queued. DST-proof because pg_cron is UTC and this reads the London clock.';

-- Stamp the week. Idempotent: the second call for the same week returns
-- the first call's run without touching a line.
create or replace function public.prepare_finance_reports(p_now timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_start date := report_week_start(p_now) - 7;
  v_end   date;
  v_pay   report_sends;
  v_ns    report_sends;
  v_rows  int;
  v_held  int;
  v_new   uuid[];
begin
  perform assert_reports_caller();
  v_end := v_start + 6;

  -- Two runners in the same five minutes serialise here; the second sees
  -- the first one's row and resumes it.
  perform pg_advisory_xact_lock(hashtext('bg08:' || v_start::text));

  select * into v_pay from report_sends where kind = 'payroll' and period_start = v_start;
  if v_pay.id is not null then
    select * into v_ns from report_sends where kind = 'new_starter' and period_start = v_start;
    return jsonb_build_object(
      'alreadyPrepared', true,
      'periodStart', v_start, 'periodEnd', v_end,
      'payrollSendId', v_pay.id, 'newStarterSendId', v_ns.id,
      'newStarterStatus', v_ns.status,
      'rows', v_pay.row_count, 'held', v_pay.held_count, 'newStarters', coalesce(v_ns.row_count, 0),
      'queued', v_pay.outbox_key is not null);
  end if;

  insert into report_sends (kind, period_start, period_end, status)
  values ('payroll', v_start, v_end, 'preparing')
  returning * into v_pay;

  -- This week's shifts, plus every shift an earlier run HELD that has not
  -- gone since (BG-08: "rolls forward and goes out with the following
  -- Monday's run"). Each is exported with its figures or held again.
  insert into payroll_export_lines
    (report_send_id, booking_id, staff_id, event_id, state, shift_date, payable_min, rate, base, holiday)
  select v_pay.id, l.booking_id, l.staff_id, l.event_id,
         case when l.status = 'pending' then 'held' else 'exported' end,
         l.shift_date,
         l.payable_min, l.rate, l.base, l.holiday
    from report_payroll_lines_v l
   where l.kind in ('worked', 'turned_away', 'cancelled_on_day')
     and (l.status = 'pending' or coalesce(l.payable_min, 0) > 0)
     and not exists (select 1 from payroll_export_lines x
                      where x.booking_id = l.booking_id and x.state = 'exported')
     and (l.shift_date between v_start and v_end
          or exists (select 1 from payroll_export_lines h
                      where h.booking_id = l.booking_id and h.state = 'held'));

  select count(*) filter (where state = 'exported'), count(*) filter (where state = 'held')
    into v_rows, v_held
    from payroll_export_lines where report_send_id = v_pay.id;

  update report_sends set row_count = v_rows, held_count = v_held where id = v_pay.id;

  -- §3.3: the No-show / Get-back warnings read this. Set once, never moved.
  update events e
     set payroll_exported_at = now()
   where e.payroll_exported_at is null
     and e.id in (select x.event_id from payroll_export_lines x
                   where x.report_send_id = v_pay.id and x.state = 'exported');

  -- New starters: whoever's FIRST paid shift is going out in this run. A
  -- first shift that was held goes out — with its HMRC row — the Monday it
  -- is finally exported, which is when the person is first paid (§9.9).
  v_new := array(
    select f.staff_id
      from report_first_shifts_v f
      join payroll_export_lines x on x.booking_id = f.booking_id
                                 and x.report_send_id = v_pay.id and x.state = 'exported');

  if coalesce(array_length(v_new, 1), 0) > 0 then
    insert into report_sends (kind, period_start, period_end, status, row_count)
    values ('new_starter', v_start, v_end, 'preparing', array_length(v_new, 1))
    returning * into v_ns;
  else
    -- "No new: [date], [time]" — nothing was due, which is not a failure.
    insert into report_sends (kind, period_start, period_end, status, row_count, sent_at)
    values ('new_starter', v_start, v_end, 'no_new', 0, now())
    returning * into v_ns;
  end if;

  return jsonb_build_object(
    'alreadyPrepared', false,
    'periodStart', v_start, 'periodEnd', v_end,
    'payrollSendId', v_pay.id, 'newStarterSendId', v_ns.id,
    'newStarterStatus', v_ns.status,
    'rows', v_rows, 'held', v_held, 'newStarters', coalesce(array_length(v_new, 1), 0),
    'queued', false);
end $$;

comment on function public.prepare_finance_reports(timestamptz) is
  'BG-08 step 1: stamps last week''s payroll — exported lines with their figures as sent, held lines for unresolved No check-outs (rolled forward to the next run) — sets events.payroll_exported_at, and decides whether there is a New Starter report. Idempotent per week.';

-- The CSV rows for a stamped run, from the figures AS EXPORTED. Descriptive
-- columns (names, times) are read live; the money never is.
create or replace function public.payroll_export_rows(p_send bigint)
returns table (
  booking_id uuid, employee_id int, staff_name text, event_title text, client_name text,
  role_name text, shift_date date, starts_at timestamptz, ends_at timestamptz,
  check_in_at timestamptz, check_out_at timestamptz, kind text,
  unpaid_break_min int, payable_min int, rate numeric, base numeric, holiday numeric,
  total numeric, in_export boolean
)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
begin
  perform assert_reports_caller();
  return query
  select x.booking_id, l.employee_id, l.staff_name, l.event_title, l.client_name,
         l.role_name, x.shift_date, l.starts_at, l.ends_at,
         l.check_in_at, l.check_out_at, l.kind,
         l.unpaid_break_min, x.payable_min, x.rate, x.base, x.holiday,
         x.base + x.holiday, true
    from payroll_export_lines x
    join report_payroll_lines_v l on l.booking_id = x.booking_id
   where x.report_send_id = p_send and x.state = 'exported'
   order by l.removed, l.sort_surname nulls last, l.staff_name, l.staff_id, l.starts_at;
end $$;

create or replace function public.new_starter_export_rows(p_send bigint)
returns table (
  staff_id uuid, employee_id int, staff_name text, removed boolean, photo_path text,
  ni_number text, home_address text, postcode text, country text,
  date_of_birth date, gender text, first_shift_date date,
  hmrc_statement text, student_loan text
)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_ns report_sends;
  v_pay report_sends;
begin
  perform assert_reports_caller();
  select * into v_ns from report_sends where id = p_send and kind = 'new_starter';
  select * into v_pay from report_sends where kind = 'payroll' and period_start = v_ns.period_start;
  return query
  select * from new_starter_rows(array(
    select f.staff_id
      from report_first_shifts_v f
      join payroll_export_lines x on x.booking_id = f.booking_id
                                 and x.report_send_id = v_pay.id and x.state = 'exported'));
end $$;

-- Step 3: the email. One row in notification_outbox, keyed on the week, so
-- a re-run is a no-op. The CSVs are in the private `reports` bucket and the
-- row carries their paths, never their content — an outbox payload is not
-- where a list of NI numbers should live.
create or replace function public.queue_finance_report_email(
  p_payroll_send     bigint,
  p_payroll_path     text,
  p_new_starter_path text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_pay report_sends;
  v_ns  report_sends;
  v_key text;
  v_attachments jsonb;
begin
  perform assert_reports_caller();
  select * into v_pay from report_sends where id = p_payroll_send and kind = 'payroll';
  if v_pay.id is null then raise exception 'unknown_report_send' using errcode = 'P0002'; end if;
  if p_payroll_path is null or p_payroll_path = '' then
    raise exception 'payroll_csv_required' using errcode = '22023';
  end if;
  select * into v_ns from report_sends where kind = 'new_starter' and period_start = v_pay.period_start;

  if v_ns.status = 'preparing' and (p_new_starter_path is null or p_new_starter_path = '') then
    raise exception 'new_starter_csv_required' using errcode = '22023';
  end if;

  v_key := 'BG08:' || v_pay.period_start::text;
  v_attachments := jsonb_build_array(jsonb_build_object(
    'bucket', 'reports', 'path', p_payroll_path,
    'filename', 'THC payroll ' || to_char(v_pay.period_start, 'YYYY-MM-DD') || ' to '
                || to_char(v_pay.period_end, 'YYYY-MM-DD') || '.csv'));
  if v_ns.status = 'preparing' then
    v_attachments := v_attachments || jsonb_build_array(jsonb_build_object(
      'bucket', 'reports', 'path', p_new_starter_path,
      'filename', 'THC new starters (HMRC) ' || to_char(v_pay.period_start, 'YYYY-MM-DD') || ' to '
                  || to_char(v_pay.period_end, 'YYYY-MM-DD') || '.csv'));
  end if;

  insert into notification_outbox (key, channel, template, payload)
  values (v_key, 'email', 'BG08', jsonb_build_object(
            'periodStart', to_char(v_pay.period_start, 'DD/MM/YYYY'),
            'periodEnd',   to_char(v_pay.period_end, 'DD/MM/YYYY'),
            'rows',        coalesce(v_pay.row_count, 0)::text,
            'held',        coalesce(v_pay.held_count, 0)::text,
            'newStarters', coalesce(v_ns.row_count, 0)::text,
            'attachments', v_attachments::text))
  on conflict (key) do nothing;

  update report_sends
     set status = 'queued', outbox_key = v_key, storage_path = p_payroll_path
   where id = v_pay.id and status in ('preparing', 'queued');
  if v_ns.status in ('preparing', 'queued') then
    update report_sends
       set status = 'queued', outbox_key = v_key, storage_path = p_new_starter_path
     where id = v_ns.id;
  end if;

  return jsonb_build_object('key', v_key, 'attachments', jsonb_array_length(v_attachments));
end $$;

comment on function public.queue_finance_report_email(bigint, text, text) is
  'BG-08 step 3: one email to finance (§9.9 — payroll CSV always, New Starter CSV only if there were any), queued in notification_outbox under BG08:<week> with storage paths as attachments. The drain (P2) sends it from admin@.';

-- "Retry send" (§9.9 send status, wireframe) for a failed run: the same
-- attachments under a fresh outbox key, so the drain picks it up again.
create or replace function public.retry_finance_report(p_send bigint)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v    report_sends;
  v_old notification_outbox;
  v_key text;
  v_n  int;
begin
  perform assert_reports_caller();
  select * into v from report_sends where id = p_send;
  if v.id is null or v.outbox_key is null then
    raise exception 'unknown_report_send' using errcode = 'P0002';
  end if;
  if v.status <> 'failed' then
    raise exception 'not_failed' using errcode = 'P0001';
  end if;
  select * into v_old from notification_outbox where key = v.outbox_key;
  select count(*) into v_n from notification_outbox where key like 'BG08:' || v.period_start::text || '%';
  v_key := 'BG08:' || v.period_start::text || ':retry:' || v_n;

  insert into notification_outbox (key, channel, template, payload)
  values (v_key, 'email', 'BG08', v_old.payload);

  update report_sends
     set status = 'queued', outbox_key = v_key, error = null
   where outbox_key = v.outbox_key and status = 'failed';

  return jsonb_build_object('key', v_key);
end $$;

-- ---------------------------------------------------------------------
-- 8 · Send status follows the outbox
--
-- The drain (P2) settles outbox rows through complete_outbox_send(); this
-- carries the verdict onto report_sends, so "Last sent" and "Failed to send
-- report" (§9.9) are what actually happened to the email rather than what
-- the job hoped. Also used by event_documents (next migration).
-- ---------------------------------------------------------------------
create or replace function public.report_sends_follow_outbox()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.sent_at is not null and old.sent_at is null then
    update report_sends
       set status = 'sent', sent_at = new.sent_at, error = null
     where outbox_key = new.key and status in ('queued', 'failed');
  elsif new.failed_at is not null and old.failed_at is null then
    update report_sends
       set status = 'failed', error = new.error
     where outbox_key = new.key and status = 'queued';
  end if;
  return new;
end $$;

drop trigger if exists report_sends_follow_outbox on notification_outbox;
create trigger report_sends_follow_outbox
  after update of sent_at, failed_at on notification_outbox
  for each row execute function public.report_sends_follow_outbox();

-- ---------------------------------------------------------------------
-- 9 · The job registry row (reserved in 20260921130927)
--
-- Deploy order, as for every job: `supabase functions deploy
-- finance-reports` BEFORE `select install_job_schedules()`.
-- ---------------------------------------------------------------------
update job_schedules
   set enabled = true,
       note = 'BG-08 Monday 09:00 UK finance send (§9.9). Every 5 min; finance_reports_due() picks the UK minute and catches up a missed Monday. Rules in prepare_finance_reports(); CSVs from packages/pdf/src/csv.ts. Deploy functions before running install_job_schedules().'
 where job = 'finance-reports';

-- ---------------------------------------------------------------------
-- 10 · Grants
--
-- The read functions and retry are for the admin (and guard themselves);
-- the three BG-08 steps are the service role's. anon holds nothing.
-- ---------------------------------------------------------------------
revoke execute on function
  public.payroll_report(date, date),
  public.payroll_report_people(date, date),
  public.finance_report(date, date, text),
  public.new_starter_report(date),
  public.retry_finance_report(bigint),
  public.booking_payroll_exported(uuid),
  public.finance_reports_due(timestamptz),
  public.prepare_finance_reports(timestamptz),
  public.payroll_export_rows(bigint),
  public.new_starter_export_rows(bigint),
  public.queue_finance_report_email(bigint, text, text),
  public.assert_reports_caller(),
  public.report_sends_follow_outbox(),
  public.staff_wipe_report_fields()
from public, anon;

grant execute on function
  public.payroll_report(date, date),
  public.payroll_report_people(date, date),
  public.finance_report(date, date, text),
  public.new_starter_report(date),
  public.retry_finance_report(bigint),
  public.booking_payroll_exported(uuid),
  public.assert_reports_caller()
to authenticated;

revoke execute on function
  public.finance_reports_due(timestamptz),
  public.prepare_finance_reports(timestamptz),
  public.payroll_export_rows(bigint),
  public.new_starter_export_rows(bigint),
  public.queue_finance_report_email(bigint, text, text)
from authenticated;

grant execute on function
  public.payroll_report(date, date),
  public.payroll_report_people(date, date),
  public.finance_report(date, date, text),
  public.new_starter_report(date),
  public.finance_reports_due(timestamptz),
  public.prepare_finance_reports(timestamptz),
  public.payroll_export_rows(bigint),
  public.new_starter_export_rows(bigint),
  public.queue_finance_report_email(bigint, text, text),
  public.assert_reports_caller()
to service_role;
