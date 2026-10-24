-- =====================================================================
-- 20261027100000 · Timesheet invoicing in the Back Office; invoices to Xero
--                   — ADR-0210 (THC, 24.10.2026)
--
-- The invoicing tool at thc.northerncodes.com is brought under the Back
-- Office. Its three clients (Leonardo Hotel St Paul's M&E, Taster, All
-- Taster) do not schedule here: their hours arrive as a timesheet the
-- office uploads. The invoices it issues use the SAME numbers (the one
-- invoice_counter, from 4000) and the SAME invoices table as ADR-0176.
--
-- What it adds
--   clients                 invoicing_mode (events | timesheet) and the
--                           card's timesheet-invoice settings
--   set_client_timesheet_invoicing()  the card's setter (finance, audited)
--   timesheet_rates         role name / aliases -> charge rate, per client
--   timesheet_jobs/_files/_shifts     upload -> review -> confirm
--   invoices.source, .timesheet_job_id; status generated | void
--   invoice_lines           no longer needs an event, a booking or times
--   timesheet_po_duplicates / timesheet_job_confirm / issue_timesheet_invoice
--   invoice_mark_generated / invoice_void / invoice_sends
--   queue_timesheet_invoice_email   (INV2, the office-composed email)
--   xero_connection / xero_sync / settings.xero   (the push is a job)
--
-- Forward-only. Nothing already issued is touched.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The client card
-- ---------------------------------------------------------------------
alter table public.clients
  add column if not exists invoicing_mode text not null default 'events',
  add column if not exists invoice_format text not null default 'named',
  add column if not exists invoice_display_name text,
  add column if not exists invoice_venue text,
  add column if not exists invoice_venue_address text,
  add column if not exists invoice_date_label text,
  add column if not exists omit_event_dates_in_subject boolean not null default false,
  add column if not exists timesheet_default_role text,
  add column if not exists timesheet_excluded_staff text[] not null default '{}'::text[],
  add column if not exists po_required boolean not null default false,
  add column if not exists payment_terms_days int,
  add column if not exists xero_contact_id text;

alter table public.clients
  add constraint clients_invoicing_mode_check check (invoicing_mode in ('events', 'timesheet')),
  add constraint clients_invoice_format_check check (invoice_format in ('named', 'aggregated')),
  add constraint clients_payment_terms_days_check check (payment_terms_days is null or payment_terms_days between 0 and 120);

comment on column public.clients.invoicing_mode is
  'ADR-0210: events = invoiced from the sign-in log of its events (ADR-0176); timesheet = invoiced from an uploaded timesheet, outside scheduling. A timesheet client is also exclude_from_invoicing (ADR-0203).';
comment on column public.clients.invoice_format is
  'ADR-0210: named = one line per staff member (Date, Staff name, Role, ...); aggregated = the same lines without staff names, with No. of staff.';
comment on column public.clients.payment_terms_days is
  'ADR-0210: this client''s terms; null = settings.invoicing.payment_terms_days. Printed as the due date.';
comment on column public.clients.xero_contact_id is
  'ADR-0210: the Xero contact this client maps to; set by the Xero job on first push.';

-- The existing guard covered the ADR-0176 details; it now covers these too.
create or replace function public.clients_invoice_details_guard()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.accounts_contact_name is null and coalesce(array_length(new.invoice_emails, 1), 0) = 0
       and new.billing_address is null
       and new.invoicing_mode = 'events' and new.invoice_format = 'named'
       and new.invoice_display_name is null and new.invoice_venue is null
       and new.invoice_venue_address is null and new.invoice_date_label is null
       and not new.omit_event_dates_in_subject and new.timesheet_default_role is null
       and coalesce(array_length(new.timesheet_excluded_staff, 1), 0) = 0
       and not new.po_required and new.payment_terms_days is null
       and new.xero_contact_id is null then
      return new;
    end if;
  elsif (new.accounts_contact_name, new.invoice_emails, new.billing_address,
         new.invoicing_mode, new.invoice_format, new.invoice_display_name, new.invoice_venue,
         new.invoice_venue_address, new.invoice_date_label, new.omit_event_dates_in_subject,
         new.timesheet_default_role, new.timesheet_excluded_staff, new.po_required,
         new.payment_terms_days, new.xero_contact_id)
        is not distinct from
        (old.accounts_contact_name, old.invoice_emails, old.billing_address,
         old.invoicing_mode, old.invoice_format, old.invoice_display_name, old.invoice_venue,
         old.invoice_venue_address, old.invoice_date_label, old.omit_event_dates_in_subject,
         old.timesheet_default_role, old.timesheet_excluded_staff, old.po_required,
         old.payment_terms_days, old.xero_contact_id) then
    return new;
  end if;
  if not office_can('finance') then
    raise exception 'not_permitted' using errcode = '42501', detail = 'finance';
  end if;
  return new;
end $$;

create or replace function public.set_client_timesheet_invoicing(
  p_client uuid, p_mode text, p_format text, p_display_name text, p_venue text,
  p_venue_address text, p_date_label text, p_omit_dates boolean, p_default_role text,
  p_excluded_staff text[], p_po_required boolean, p_terms_days int)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_excluded text[];
begin
  perform assert_finance_caller();
  if not office_can('write') then
    raise exception 'not_permitted' using errcode = '42501', detail = 'write';
  end if;
  if p_mode not in ('events', 'timesheet') then
    raise exception 'invalid_invoicing_mode' using errcode = '22023';
  end if;
  if p_format not in ('named', 'aggregated') then
    raise exception 'invalid_invoice_format' using errcode = '22023';
  end if;
  if p_terms_days is not null and p_terms_days not between 0 and 120 then
    raise exception 'invalid_payment_terms' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct btrim(x)) filter (where btrim(x) <> ''), '{}')
    into v_excluded from unnest(coalesce(p_excluded_staff, '{}')) x;

  update clients
     set invoicing_mode = p_mode,
         invoice_format = p_format,
         invoice_display_name = nullif(btrim(coalesce(p_display_name, '')), ''),
         invoice_venue = nullif(btrim(coalesce(p_venue, '')), ''),
         invoice_venue_address = nullif(btrim(coalesce(p_venue_address, '')), ''),
         invoice_date_label = nullif(btrim(coalesce(p_date_label, '')), ''),
         omit_event_dates_in_subject = coalesce(p_omit_dates, false),
         timesheet_default_role = nullif(btrim(coalesce(p_default_role, '')), ''),
         timesheet_excluded_staff = v_excluded,
         po_required = coalesce(p_po_required, false),
         payment_terms_days = p_terms_days,
         -- ADR-0203: a timesheet client never gets an event invoice.
         exclude_from_invoicing = case when p_mode = 'timesheet' then true else exclude_from_invoicing end
   where id = p_client;
  if not found then
    raise exception 'unknown_client' using errcode = 'P0002';
  end if;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'client.timesheet_invoicing', 'client', p_client,
          jsonb_build_object('mode', p_mode, 'format', p_format, 'termsDays', p_terms_days,
                             'poRequired', coalesce(p_po_required, false)));
end $$;

revoke execute on function public.set_client_timesheet_invoicing(uuid, text, text, text, text, text, text, boolean, text, text[], boolean, int) from public, anon;
grant execute on function public.set_client_timesheet_invoicing(uuid, text, text, text, text, text, text, boolean, text, text[], boolean, int) to authenticated, service_role;
comment on function public.set_client_timesheet_invoicing(uuid, text, text, text, text, text, text, boolean, text, text[], boolean, int) is
  'ADR-0210: the client card''s timesheet-invoicing settings. A timesheet client is also left out of event invoicing (ADR-0203). Finance callers that may write; audited as client.timesheet_invoicing.';

-- ---------------------------------------------------------------------
-- 2 · The rate card of a timesheet client (role name or alias -> £/h)
-- ---------------------------------------------------------------------
create table public.timesheet_rates (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  role_name   text not null check (btrim(role_name) <> ''),
  aliases     text[] not null default '{}'::text[],
  charge_rate numeric(8,2) not null check (charge_rate >= 0),
  created_at  timestamptz not null default now()
);
create unique index timesheet_rates_client_role_idx
  on public.timesheet_rates (client_id, lower(btrim(role_name)));

comment on table public.timesheet_rates is
  'ADR-0210: what a timesheet client is charged per hour for a role. The role on the timesheet is matched to role_name or an alias (case and spacing ignored); the invoice prints the timesheet''s own wording.';

create or replace function public.timesheet_rate_for(p_client uuid, p_role text)
returns numeric
language sql stable set search_path = public, extensions as $$
  select coalesce(
    (select r.charge_rate
       from timesheet_rates r
      where r.client_id = p_client
        and (lower(btrim(r.role_name)) = lower(btrim(coalesce(p_role, '')))
             or exists (select 1 from unnest(r.aliases) a
                         where lower(btrim(a)) = lower(btrim(coalesce(p_role, '')))))
      order by (lower(btrim(r.role_name)) = lower(btrim(coalesce(p_role, '')))) desc
      limit 1),
    -- a client charged one rate for every role (Leonardo M&E: "all roles can be
    -- called Waiting") needs no alias for each wording on the sheet
    (select min(r.charge_rate) from timesheet_rates r
      where r.client_id = p_client
     having count(distinct r.charge_rate) = 1))
$$;
revoke execute on function public.timesheet_rate_for(uuid, text) from public, anon;
grant execute on function public.timesheet_rate_for(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3 · Upload -> review -> confirm
-- ---------------------------------------------------------------------
create table public.timesheet_jobs (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid references public.clients(id),
  status           text not null default 'uploaded'
                   check (status in ('uploaded', 'extracting', 'reviewing', 'confirmed', 'complete', 'error')),
  notes            text,
  error            text,
  confirmed_groups jsonb,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index timesheet_jobs_client_idx on public.timesheet_jobs (client_id);
create index timesheet_jobs_status_idx on public.timesheet_jobs (status) where status <> 'complete';

comment on table public.timesheet_jobs is
  'ADR-0210: one upload of timesheet file(s) for a client. uploaded -> extracting -> reviewing -> confirmed -> complete (every approved row invoiced or the job discarded), or error (retry -> extracting).';

create table public.timesheet_files (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references public.timesheet_jobs(id) on delete cascade,
  storage_path text not null,
  file_name    text not null,
  mime_type    text not null,
  size_bytes   bigint not null check (size_bytes >= 0),
  created_at   timestamptz not null default now()
);
create index timesheet_files_job_idx on public.timesheet_files (job_id);

comment on table public.timesheet_files is
  'ADR-0210: the uploaded source files, in the private timesheets bucket under timesheet-jobs/<job>/. Attached to the invoice email.';

create table public.timesheet_shifts (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.timesheet_jobs(id) on delete cascade,
  file_id       uuid references public.timesheet_files(id) on delete set null,
  sort          int not null default 0,
  kind          text not null default 'shift' check (kind in ('shift', 'custom')),
  status        text not null default 'extracted'
                check (status in ('extracted', 'flagged', 'approved', 'rejected')),
  staff_name    text not null default '',
  staff_ref     text,
  work_date     date,
  role_name     text,
  start_time    time,
  end_time      time,
  break_min     int not null default 0 check (break_min >= 0),
  hours         numeric(8,2) check (hours is null or hours >= 0),
  staff_count   int not null default 1 check (staff_count >= 1),
  quantity      numeric(10,2) check (quantity is null or quantity > 0),
  description   text,
  rate          numeric(8,2) check (rate is null or rate >= 0),
  amount        numeric(12,2),
  issues        text[] not null default '{}'::text[],
  confidence    numeric(3,2) check (confidence is null or confidence between 0 and 1),
  original      jsonb,
  source        jsonb,
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  invoice_id    uuid references public.invoices(id),
  created_at    timestamptz not null default now()
);
create index timesheet_shifts_job_idx on public.timesheet_shifts (job_id, sort);
create index timesheet_shifts_invoice_idx on public.timesheet_shifts (invoice_id) where invoice_id is not null;

comment on table public.timesheet_shifts is
  'ADR-0210: one extracted row. kind shift: hours x rate x staff_count; kind custom: an expense line, quantity x rate with a description. hours, rate, amount and issues are computed by timesheet_shift_compute(); a row with issues cannot be approved; an invoiced row cannot change.';

-- Job states (packages/domain/state.ts TIMESHEET_JOB_TRANSITIONS).
create or replace function public.timesheet_job_transitions()
returns table (from_status text, to_status text)
language sql immutable set search_path = public, extensions as $$
  select * from (values
    ('uploaded', 'extracting'), ('uploaded', 'error'),
    ('extracting', 'reviewing'), ('extracting', 'error'),
    ('error', 'extracting'),
    ('reviewing', 'confirmed'), ('reviewing', 'complete'),
    ('confirmed', 'reviewing'), ('confirmed', 'complete'),
    ('complete', 'reviewing')) v(from_status, to_status)
$$;
revoke execute on function public.timesheet_job_transitions() from public, anon, authenticated;
grant execute on function public.timesheet_job_transitions() to service_role;

create or replace function public.timesheet_jobs_state_guard()
returns trigger
language plpgsql set search_path = public, extensions as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status
     and not exists (select 1 from timesheet_job_transitions() t
                      where t.from_status = old.status and t.to_status = new.status) then
    raise exception 'illegal_timesheet_job_transition' using errcode = 'P0001',
          detail = old.status || ' -> ' || new.status;
  end if;
  return new;
end $$;
revoke execute on function public.timesheet_jobs_state_guard() from public, anon, authenticated;
create trigger timesheet_jobs_state_guard
  before update on public.timesheet_jobs
  for each row execute function public.timesheet_jobs_state_guard();

-- The row's arithmetic and its approval gate, in one place.
create or replace function public.timesheet_shift_compute()
returns trigger
language plpgsql set search_path = public, extensions as $$
declare
  j        timesheet_jobs;
  v_min    int;
  v_issues text[] := '{}';
  v_issuing boolean := coalesce(current_setting('thc.issuing', true), '') = '1';
begin
  select * into j from timesheet_jobs where id = new.job_id;
  if tg_op = 'UPDATE' and old.invoice_id is not null and not (v_issuing and new.invoice_id is null) then
    raise exception 'shift_invoiced' using errcode = 'P0001';
  end if;
  if not v_issuing and j.status <> 'reviewing' and j.status <> 'extracting' then
    raise exception 'job_not_reviewing' using errcode = 'P0001', detail = j.status;
  end if;

  if new.kind = 'shift' then
    if new.start_time is not null and new.end_time is not null then
      -- to the minute; a finish at or before the start is the next day
      v_min := (((extract(epoch from (new.end_time - new.start_time)) / 60)::int + 1440) % 1440);
      v_min := greatest(v_min - coalesce(new.break_min, 0), 0);
      new.hours := round(v_min / 60.0, 2);
    end if;
    if new.rate is null and j.client_id is not null then
      new.rate := timesheet_rate_for(j.client_id, coalesce(nullif(btrim(new.role_name), ''),
                   (select c.timesheet_default_role from clients c where c.id = j.client_id)));
    end if;
    new.amount := case when new.hours is not null and new.rate is not null
                       then round(new.hours * new.rate * new.staff_count, 2) end;
    if new.hours is null or new.hours <= 0 then v_issues := array_append(v_issues, 'no_hours'); end if;
    if new.rate is null then v_issues := array_append(v_issues, 'no_rate'); end if;
    if btrim(new.staff_name) = '' then v_issues := array_append(v_issues, 'no_name'); end if;
  else
    new.amount := case when new.quantity is not null and new.rate is not null
                       then round(new.quantity * new.rate, 2) end;
    if new.quantity is null then v_issues := array_append(v_issues, 'no_quantity'); end if;
    if new.rate is null then v_issues := array_append(v_issues, 'no_rate'); end if;
    if btrim(coalesce(new.description, '')) = '' then v_issues := array_append(v_issues, 'no_description'); end if;
  end if;
  if new.work_date is null then v_issues := array_append(v_issues, 'no_date'); end if;
  new.issues := v_issues;

  if new.status = 'approved' and coalesce(array_length(v_issues, 1), 0) > 0 then
    raise exception 'shift_incomplete' using errcode = 'P0001', detail = array_to_string(v_issues, ',');
  end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.reviewed_by := auth.uid();
    new.reviewed_at := case when auth.uid() is null then null else now() end;
  end if;
  return new;
end $$;
revoke execute on function public.timesheet_shift_compute() from public, anon, authenticated;
create trigger timesheet_shift_compute
  before insert or update on public.timesheet_shifts
  for each row execute function public.timesheet_shift_compute();

create or replace function public.timesheet_shift_delete_guard()
returns trigger
language plpgsql set search_path = public, extensions as $$
begin
  if old.invoice_id is not null then
    raise exception 'shift_invoiced' using errcode = 'P0001';
  end if;
  return old;
end $$;
revoke execute on function public.timesheet_shift_delete_guard() from public, anon, authenticated;
create trigger timesheet_shift_delete_guard
  before delete on public.timesheet_shifts
  for each row execute function public.timesheet_shift_delete_guard();

-- ---------------------------------------------------------------------
-- 4 · The invoices table learns the second source
-- ---------------------------------------------------------------------
alter table public.invoices
  add column if not exists source text not null default 'events',
  add column if not exists timesheet_job_id uuid references public.timesheet_jobs(id),
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text,
  add column if not exists sent_at timestamptz;

alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices
  add constraint invoices_status_check
    check (status in ('drawing', 'failed', 'queued', 'generated', 'void')),
  add constraint invoices_source_check check (source in ('events', 'timesheet'));

comment on column public.invoices.source is
  'ADR-0210: events = ADR-0176 (sign-in log, emailed by the job); timesheet = from an uploaded timesheet (drawn on Generate, emailed by the office).';

-- The states (packages/domain/state.ts INVOICE_TRANSITIONS):
--   drawing   -> queued     events invoice: files stored, INV1 in the outbox
--   drawing   -> generated  timesheet invoice: PDF stored, not yet sent
--   drawing   -> failed     a run failed; the next run (events) or the office retries it
--   failed    -> drawing | queued | generated
--   generated -> queued     the office sent it
--   generated | queued -> void   the number is never reused
create or replace function public.invoice_status_transitions()
returns table (from_status text, to_status text)
language sql immutable set search_path = public, extensions as $$
  select * from (values
    ('drawing', 'queued'), ('drawing', 'generated'), ('drawing', 'failed'),
    ('failed', 'drawing'), ('failed', 'queued'), ('failed', 'generated'),
    ('generated', 'queued'), ('generated', 'void'), ('queued', 'void')) v(from_status, to_status)
$$;

create or replace function public.invoices_state_guard()
returns trigger
language plpgsql set search_path = public, extensions as $$
begin
  if new.status is distinct from old.status
     and not exists (select 1 from invoice_status_transitions() t
                      where t.from_status = old.status and t.to_status = new.status) then
    raise exception 'illegal_invoice_transition' using errcode = 'P0001',
          detail = old.status || ' -> ' || new.status;
  end if;
  -- What was issued is final: number, money, bill-to and seller.
  if (new.number, new.client_id, new.net, new.vat, new.total, new.vat_rate, new.bill_to, new.seller)
     is distinct from (old.number, old.client_id, old.net, old.vat, old.total, old.vat_rate, old.bill_to, old.seller)
     and old.status in ('queued', 'generated', 'void') then
    raise exception 'invoice_issued' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- invoice_lines: an event, a booking and clock times belong to event
-- invoices only. A weekly timesheet row has a date and an amount.
alter table public.invoice_lines
  alter column event_id drop not null,
  alter column booking_id drop not null,
  alter column starts_at drop not null,
  alter column ends_at drop not null;
alter table public.invoice_lines
  add column if not exists hours numeric(8,2),
  add column if not exists staff_count int,
  add column if not exists quantity numeric(10,2),
  add column if not exists timesheet_shift_id uuid references public.timesheet_shifts(id);
create index if not exists invoice_lines_timesheet_shift_idx
  on public.invoice_lines (timesheet_shift_id) where timesheet_shift_id is not null;

-- GDPR removal also reaches a timesheet line / row for the same Employee ID.
create or replace function public.staff_removed_purge_invoices()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  update invoice_lines l
     set staff_name = deleted_account_label(new.employee_id)
   where l.booking_id in (select b.id from bookings b where b.staff_id = new.id)
      or (l.booking_id is null and l.employee_id = new.employee_id);
  update timesheet_shifts s
     set staff_name = deleted_account_label(new.employee_id), staff_ref = null
   where s.staff_ref = new.employee_id::text and s.invoice_id is null;
  return new;
end $$;

-- The document: the existing body, plus what a timesheet line carries.
create or replace function public.invoice_document_data(p_invoice uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  i invoices;
begin
  select * into i from invoices where id = p_invoice;
  if i.id is null then raise exception 'invoice_not_found' using errcode = 'P0002'; end if;

  return jsonb_build_object(
    'id', i.id, 'number', i.number, 'source', i.source,
    'invoiceDate', i.invoice_date, 'dueDate', i.due_date,
    'periodFrom', i.period_from, 'periodTo', i.period_to, 'poNumber', i.po_number,
    'payableMin', i.payable_min, 'net', i.net, 'vatRate', i.vat_rate, 'vat', i.vat,
    'total', i.total, 'termsDays', i.terms_days, 'billTo', i.bill_to, 'seller', i.seller,
    'recipients', to_jsonb(i.recipients),
    'events', (select coalesce(jsonb_agg(jsonb_build_object(
                         'id', e.id, 'title', e.title, 'date', e.event_date, 'venue', e.venue_name)
                       order by e.event_date, e.title), '[]'::jsonb)
                 from invoice_event_links k join events e on e.id = k.event_id
                where k.invoice_id = i.id),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                        'date', l.line_date, 'staffName', l.staff_name, 'employeeId', l.employee_id,
                        'role', l.role_name, 'startsAt', l.starts_at, 'endsAt', l.ends_at,
                        'breakMin', l.break_min, 'payableMin', l.payable_min, 'rate', l.rate,
                        'amount', l.amount, 'kind', l.kind,
                        'hours', l.hours, 'staffCount', l.staff_count, 'quantity', l.quantity)
                        order by l.sort), '[]'::jsonb)
                from invoice_lines l where l.invoice_id = i.id));
end $$;
revoke execute on function public.invoice_document_data(uuid) from public, anon, authenticated;
grant execute on function public.invoice_document_data(uuid) to service_role;

-- The event invoices' job must never pick up a timesheet invoice.
create or replace function public.invoices_unfinished(p_now timestamptz default now(), p_limit int default 5)
returns setof uuid
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not ((invoicing_config() ->> 'enabled')::boolean and notification_switched_on('INV1')) then
    return;
  end if;
  return query
  with pick as (
    select i.id from invoices i
     where i.source = 'events'
       and i.status in ('drawing', 'failed')
       and i.attempts < 24
       and (i.lease_until is null or i.lease_until < p_now)
     order by i.number
     limit greatest(p_limit, 0)
     for update skip locked
  ), upd as (
    update invoices i
       set lease_until = p_now + interval '10 minutes', status = 'drawing'
      from pick where i.id = pick.id
    returning i.id, i.number
  )
  select upd.id from upd order by upd.number;
end $$;
revoke execute on function public.invoices_unfinished(timestamptz, int) from public, anon, authenticated;
grant execute on function public.invoices_unfinished(timestamptz, int) to service_role;

-- ---------------------------------------------------------------------
-- 5 · Confirm, issue, void
-- ---------------------------------------------------------------------
create or replace function public.timesheet_po_duplicates(p_client uuid, p_pos text[])
returns table (po_number text, invoice_number int, invoice_date date, status text)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform assert_finance_caller();
  return query
  select i.po_number, i.number, i.invoice_date, i.status
    from invoices i
   where i.client_id = p_client
     and i.status <> 'void'
     and upper(btrim(coalesce(i.po_number, ''))) in
         (select upper(btrim(x)) from unnest(coalesce(p_pos, '{}')) x where btrim(x) <> '')
   order by i.number;
end $$;
revoke execute on function public.timesheet_po_duplicates(uuid, text[]) from public, anon;
grant execute on function public.timesheet_po_duplicates(uuid, text[]) to authenticated, service_role;

-- Confirm: the approved rows are split into invoices. p_groups is
-- [{poNumber, invoiceDate, eventDateStart, eventDateEnd, format, shiftIds[]}].
create or replace function public.timesheet_job_confirm(p_job uuid, p_groups jsonb)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  j       timesheet_jobs;
  c       clients;
  g       jsonb;
  v_ids   uuid[];
  v_all   uuid[] := '{}';
  v_n     int;
begin
  perform assert_finance_caller();
  if not office_can('write') then
    raise exception 'not_permitted' using errcode = '42501', detail = 'write';
  end if;
  select * into j from timesheet_jobs where id = p_job for update;
  if j.id is null then raise exception 'job_not_found' using errcode = 'P0002'; end if;
  if j.status not in ('reviewing', 'confirmed') then
    raise exception 'job_not_reviewing' using errcode = 'P0001', detail = j.status;
  end if;
  if j.client_id is null then raise exception 'job_has_no_client' using errcode = 'P0001'; end if;
  select * into c from clients where id = j.client_id;
  if c.invoicing_mode <> 'timesheet' then
    raise exception 'client_not_timesheet' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) = 0 then
    raise exception 'no_invoice_groups' using errcode = '22023';
  end if;

  for g in select * from jsonb_array_elements(p_groups) loop
    v_ids := array(select jsonb_array_elements_text(g -> 'shiftIds')::uuid);
    if coalesce(array_length(v_ids, 1), 0) = 0 then
      raise exception 'empty_invoice_group' using errcode = '22023';
    end if;
    if c.po_required and btrim(coalesce(g ->> 'poNumber', '')) = '' then
      raise exception 'po_required' using errcode = 'P0001';
    end if;
    if v_ids && v_all then
      raise exception 'shift_in_two_groups' using errcode = '22023';
    end if;
    v_all := v_all || v_ids;
    select count(*) into v_n from timesheet_shifts s
     where s.id = any (v_ids) and s.job_id = p_job and s.status = 'approved' and s.invoice_id is null;
    if v_n <> array_length(v_ids, 1) then
      raise exception 'shift_not_approved' using errcode = 'P0001';
    end if;
  end loop;

  update timesheet_jobs set confirmed_groups = p_groups, status = 'confirmed' where id = p_job;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'timesheet.confirmed', 'timesheet_job', p_job,
          jsonb_build_object('groups', jsonb_array_length(p_groups), 'shifts', array_length(v_all, 1)));
end $$;
revoke execute on function public.timesheet_job_confirm(uuid, jsonb) from public, anon;
grant execute on function public.timesheet_job_confirm(uuid, jsonb) to authenticated, service_role;

-- Issue ONE confirmed group: the next number (the shared counter), the
-- bill-to / seller / VAT / terms snapshotted, the lines as printed. The PDF
-- is drawn afterwards (status drawing -> generated).
create or replace function public.issue_timesheet_invoice(p_job uuid, p_group jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  j        timesheet_jobs;
  c        clients;
  cfg      jsonb := invoicing_config();
  v_ids    uuid[];
  v_number int;
  v_id     uuid;
  v_date   date;
  v_terms  int;
  v_rate   numeric := (cfg ->> 'vat_rate')::numeric;
  v_net    numeric;
  v_min    int;
  v_from   date;
  v_to     date;
  v_po     text;
  v_format text;
  v_n      int;
  v_left   int;
begin
  perform assert_finance_caller();
  if not office_can('write') then
    raise exception 'not_permitted' using errcode = '42501', detail = 'write';
  end if;
  select * into j from timesheet_jobs where id = p_job for update;
  if j.id is null then raise exception 'job_not_found' using errcode = 'P0002'; end if;
  if j.status <> 'confirmed' then
    raise exception 'job_not_confirmed' using errcode = 'P0001', detail = j.status;
  end if;
  select * into c from clients where id = j.client_id;

  v_ids := array(select jsonb_array_elements_text(p_group -> 'shiftIds')::uuid);
  perform 1 from timesheet_shifts s where s.id = any (v_ids) for update;
  select count(*) into v_n from timesheet_shifts s
   where s.id = any (v_ids) and s.job_id = p_job and s.status = 'approved' and s.invoice_id is null;
  if coalesce(array_length(v_ids, 1), 0) = 0 or v_n <> array_length(v_ids, 1) then
    raise exception 'shift_not_approved' using errcode = 'P0001';
  end if;
  -- only a group Confirm recorded may be issued
  if not exists (select 1 from jsonb_array_elements(j.confirmed_groups) cg
                  where array(select jsonb_array_elements_text(cg -> 'shiftIds')::uuid order by 1)
                        = array(select unnest(v_ids) order by 1)) then
    raise exception 'group_not_confirmed' using errcode = 'P0001';
  end if;

  v_po := nullif(btrim(coalesce(p_group ->> 'poNumber', '')), '');
  if c.po_required and v_po is null then
    raise exception 'po_required' using errcode = 'P0001';
  end if;
  v_format := coalesce(nullif(p_group ->> 'format', ''), c.invoice_format);
  if v_format not in ('named', 'aggregated') then
    raise exception 'invalid_invoice_format' using errcode = '22023';
  end if;
  v_date := coalesce(nullif(p_group ->> 'invoiceDate', '')::date,
                     (now() at time zone 'Europe/London')::date);
  v_terms := coalesce(c.payment_terms_days, (cfg ->> 'payment_terms_days')::int);
  select min(s.work_date), max(s.work_date) into v_from, v_to
    from timesheet_shifts s where s.id = any (v_ids);
  v_from := coalesce(nullif(p_group ->> 'eventDateStart', '')::date, v_from);
  v_to   := coalesce(nullif(p_group ->> 'eventDateEnd', '')::date, v_to);

  update invoice_counter set next_number = next_number + 1 where id
  returning next_number - 1 into v_number;

  insert into invoices (number, client_id, po_number, group_key, invoice_date, due_date,
                        period_from, period_to, payable_min, net, vat_rate, vat, total,
                        terms_days, bill_to, seller, recipients, status, source, timesheet_job_id)
  values (v_number, j.client_id, v_po, 'ts:' || gen_random_uuid()::text, v_date, v_date + v_terms,
          v_from, v_to, 0, 0, v_rate, 0, 0, v_terms,
          jsonb_build_object('name', coalesce(c.invoice_display_name, c.name),
                             'contact', coalesce(c.accounts_contact_name, c.contact_name),
                             'emails', to_jsonb(case when coalesce(array_length(c.invoice_emails, 1), 0) > 0
                                                     then c.invoice_emails else c.contact_emails end),
                             'address', coalesce(c.billing_address, ''),
                             'venue', coalesce(c.invoice_venue, ''),
                             'venueAddress', coalesce(c.invoice_venue_address, ''),
                             'format', v_format,
                             'dateLabel', coalesce(c.invoice_date_label, 'Date')),
          jsonb_build_object('company', cfg -> 'company', 'bank', cfg -> 'bank',
                             'late_payment_note', cfg ->> 'late_payment_note'),
          case when coalesce(array_length(c.invoice_emails, 1), 0) > 0
               then c.invoice_emails else c.contact_emails end,
          'drawing', 'timesheet', p_job)
  returning id into v_id;

  insert into invoice_lines (invoice_id, event_id, booking_id, sort, line_date, staff_name,
                             employee_id, role_name, starts_at, ends_at, break_min, payable_min,
                             rate, amount, kind, hours, staff_count, quantity, timesheet_shift_id)
  select v_id, null, null,
         row_number() over (order by s.work_date, s.kind desc, s.role_name nulls last,
                                     s.staff_name, s.sort, s.id)::int,
         s.work_date,
         case when s.kind = 'shift' then s.staff_name else '' end,
         case when s.kind = 'shift' and s.staff_ref ~ '^\d{1,9}$' then s.staff_ref::int end,
         case when s.kind = 'shift' then coalesce(nullif(btrim(s.role_name), ''), c.timesheet_default_role, '')
              else s.description end,
         case when s.kind = 'shift' and s.start_time is not null
              then (s.work_date + s.start_time) at time zone 'Europe/London' end,
         case when s.kind = 'shift' and s.end_time is not null and s.start_time is not null
              then (s.work_date + s.end_time
                    + case when s.end_time <= s.start_time then interval '1 day' else interval '0' end)
                   at time zone 'Europe/London' end,
         s.break_min,
         case when s.kind = 'shift' then round(s.hours * 60)::int else 0 end,
         s.rate, s.amount,
         case when s.kind = 'shift' then 'timesheet' else 'custom' end,
         s.hours, s.staff_count, s.quantity, s.id
    from timesheet_shifts s
   where s.id = any (v_ids);

  select coalesce(sum(amount), 0), coalesce(sum(payable_min), 0)::int
    into v_net, v_min from invoice_lines where invoice_id = v_id;

  update invoices
     set net = v_net, payable_min = v_min,
         vat = round(v_net * v_rate / 100, 2),
         total = v_net + round(v_net * v_rate / 100, 2)
   where id = v_id;

  perform set_config('thc.issuing', '1', true);
  update timesheet_shifts set invoice_id = v_id where id = any (v_ids);
  perform set_config('thc.issuing', '', true);

  select count(*) into v_left from timesheet_shifts
   where job_id = p_job and status = 'approved' and invoice_id is null;
  if v_left = 0 then
    update timesheet_jobs set status = 'complete' where id = p_job;
  end if;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'invoice.issued', 'invoice', v_id,
          jsonb_build_object('number', v_number, 'source', 'timesheet', 'job', p_job,
                             'shifts', array_length(v_ids, 1), 'net', v_net));
  return jsonb_build_object('id', v_id, 'number', v_number);
end $$;
revoke execute on function public.issue_timesheet_invoice(uuid, jsonb) from public, anon;
grant execute on function public.issue_timesheet_invoice(uuid, jsonb) to authenticated, service_role;
comment on function public.issue_timesheet_invoice(uuid, jsonb) is
  'ADR-0210: issues one confirmed group of a timesheet job as an invoice: the next number from the shared counter (gapless), bill-to / seller / VAT / terms snapshotted, lines rounded to the penny, rows marked invoiced. Finance callers that may write. The PDF is drawn afterwards.';

-- The PDF is stored: drawing | failed -> generated. Service role (the
-- Generate action draws with the admin client after issue_timesheet_invoice).
create or replace function public.invoice_mark_generated(p_invoice uuid)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  update invoices set status = 'generated', lease_until = null, last_error = null
   where id = p_invoice and source = 'timesheet' and status in ('drawing', 'failed')
     and storage_path is not null;
  if not found then raise exception 'invoice_not_open' using errcode = 'P0001'; end if;
end $$;
revoke execute on function public.invoice_mark_generated(uuid) from public, anon, authenticated;
grant execute on function public.invoice_mark_generated(uuid) to service_role;

-- Void: the number is retired, never reused; the rows go back to review.
create or replace function public.invoice_void(p_invoice uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  i invoices;
begin
  perform assert_finance_caller();
  if not office_can('write') then
    raise exception 'not_permitted' using errcode = '42501', detail = 'write';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'void_reason_required' using errcode = '22023';
  end if;
  select * into i from invoices where id = p_invoice for update;
  if i.id is null then raise exception 'invoice_not_found' using errcode = 'P0002'; end if;
  if i.status not in ('generated', 'queued') then
    raise exception 'invoice_not_voidable' using errcode = 'P0001', detail = i.status;
  end if;
  update invoices set status = 'void', voided_at = now(), void_reason = btrim(p_reason)
   where id = i.id;
  if i.source = 'timesheet' then
    -- the rows are free to be invoiced again, on a new number
    perform set_config('thc.issuing', '1', true);
    update timesheet_shifts set invoice_id = null where invoice_id = i.id;
    perform set_config('thc.issuing', '', true);
    update timesheet_jobs set status = 'reviewing' where id = i.timesheet_job_id and status = 'complete';
  end if;
  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'invoice.voided', 'invoice', i.id,
          jsonb_build_object('number', i.number, 'reason', btrim(p_reason)));
end $$;
revoke execute on function public.invoice_void(uuid, text) from public, anon;
grant execute on function public.invoice_void(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6 · Sending a timesheet invoice (INV2, composed by the office)
-- ---------------------------------------------------------------------
create table public.invoice_sends (
  id         bigint generated always as identity primary key,
  invoice_id uuid not null references public.invoices(id),
  sent_by    uuid default auth.uid(),
  to_emails  text[] not null,
  cc_emails  text[] not null default '{}'::text[],
  bcc_emails text[] not null default '{}'::text[],
  subject    text not null,
  outbox_key text not null,
  created_at timestamptz not null default now()
);
create index invoice_sends_invoice_idx on public.invoice_sends (invoice_id, created_at desc);

comment on table public.invoice_sends is
  'ADR-0210: who sent which timesheet invoice to whom (the send history the old tool showed). The email itself is the INV2 outbox row.';

-- p_attachments: [{path, name}] in the timesheets bucket (the invoice PDF,
-- the Excel, the original timesheet files).
create or replace function public.queue_timesheet_invoice_email(
  p_invoice uuid, p_to text[], p_cc text[], p_bcc text[], p_subject text, p_body_html text,
  p_reply_to text, p_attachments jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  i invoices;
  v_n int;
  v_key text;
  v_to  text[];
  v_cc  text[];
  v_bcc text[];
  e text;
begin
  perform assert_finance_caller();
  if not office_can('write') then
    raise exception 'not_permitted' using errcode = '42501', detail = 'write';
  end if;
  select * into i from invoices where id = p_invoice for update;
  if i.id is null then raise exception 'invoice_not_found' using errcode = 'P0002'; end if;
  if i.source <> 'timesheet' or i.status not in ('generated', 'queued') then
    raise exception 'invoice_not_sendable' using errcode = 'P0001', detail = i.source || '/' || i.status;
  end if;
  if i.storage_path is null then
    raise exception 'invoice_has_no_files' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct lower(btrim(x))) filter (where btrim(x) <> ''), '{}') into v_to  from unnest(coalesce(p_to,  '{}')) x;
  select coalesce(array_agg(distinct lower(btrim(x))) filter (where btrim(x) <> ''), '{}') into v_cc  from unnest(coalesce(p_cc,  '{}')) x;
  select coalesce(array_agg(distinct lower(btrim(x))) filter (where btrim(x) <> ''), '{}') into v_bcc from unnest(coalesce(p_bcc, '{}')) x;
  if coalesce(array_length(v_to, 1), 0) = 0 then
    raise exception 'invoice_has_no_recipients' using errcode = 'P0001';
  end if;
  foreach e in array v_to || v_cc || v_bcc loop
    if e !~ '^[^\s@<>",]+@[^\s@<>",]+\.[^\s@<>",]{2,}$' then
      raise exception 'invalid_invoice_email' using errcode = '22023', detail = e;
    end if;
  end loop;
  if btrim(coalesce(p_subject, '')) = '' then
    raise exception 'subject_required' using errcode = '22023';
  end if;

  select count(*) + 1 into v_n from invoice_sends where invoice_id = i.id;
  v_key := 'INV2:' || i.number::text || ':' || v_n::text;
  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values (v_key, 'email', 'INV2', v_to,
          jsonb_build_object('invoiceNumber', i.number::text, 'subject', btrim(p_subject),
                             'bodyHtml', coalesce(p_body_html, ''), 'cc', to_jsonb(v_cc),
                             'bcc', to_jsonb(v_bcc), 'replyTo', coalesce(p_reply_to, ''),
                             'attachments', coalesce(p_attachments, '[]'::jsonb)));

  insert into invoice_sends (invoice_id, to_emails, cc_emails, bcc_emails, subject, outbox_key)
  values (i.id, v_to, v_cc, v_bcc, btrim(p_subject), v_key);

  update invoices
     set status = 'queued', outbox_key = v_key, queued_at = clock_timestamp(),
         sent_at = coalesce(sent_at, clock_timestamp()), recipients = v_to
   where id = i.id;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'invoice.sent', 'invoice', i.id,
          jsonb_build_object('number', i.number, 'key', v_key, 'to', to_jsonb(v_to)));
  return jsonb_build_object('key', v_key);
end $$;
revoke execute on function public.queue_timesheet_invoice_email(uuid, text[], text[], text[], text, text, text, jsonb) from public, anon;
grant execute on function public.queue_timesheet_invoice_email(uuid, text[], text[], text[], text, text, text, jsonb) to authenticated, service_role;
comment on function public.queue_timesheet_invoice_email(uuid, text[], text[], text[], text, text, text, jsonb) is
  'ADR-0210: the office sends (or re-sends) a timesheet invoice: an INV2 outbox row keyed INV2:<number>:<n>, a send-history row, generated -> queued on the first send. Finance callers that may write.';

-- ---------------------------------------------------------------------
-- 7 · Xero
-- ---------------------------------------------------------------------
insert into settings (key, value) values
  ('xero', jsonb_build_object(
     'enabled', false,
     'from_number', 4000,
     'invoice_status', 'DRAFT',
     'sales_account_code', '200',
     'tax_type', 'OUTPUT2',
     'attach_pdf', true))
on conflict (key) do nothing;

-- One row: the connected organisation and its tokens. Service role only —
-- no policy, no grant to the API roles.
create table public.xero_connection (
  id             boolean primary key default true check (id),
  tenant_id      text not null,
  tenant_name    text,
  access_token   text not null,
  refresh_token  text not null,
  expires_at     timestamptz not null,
  scopes         text,
  connected_by   uuid,
  connected_at   timestamptz not null default now()
);
alter table public.xero_connection enable row level security;
revoke all on table public.xero_connection from public, anon, authenticated;
grant all on table public.xero_connection to service_role;
comment on table public.xero_connection is
  'ADR-0210: the Xero organisation THC connected from /settings and its OAuth tokens. Service role only; the office sees the organisation name through xero_status().';

create table public.xero_sync (
  invoice_id      uuid primary key references public.invoices(id),
  status          text not null default 'pending'
                  check (status in ('pending', 'syncing', 'synced', 'mismatch', 'failed', 'skipped')),
  attempts        int not null default 0,
  lease_until     timestamptz,
  xero_invoice_id text,
  xero_status     text,
  xero_total      numeric(12,2),
  last_error      text,
  synced_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index xero_sync_open_idx on public.xero_sync (status) where status in ('pending', 'syncing', 'failed');

comment on table public.xero_sync is
  'ADR-0210: one row per invoice that has to reach Xero. pending -> syncing -> synced (Xero''s total equals ours) | mismatch (it differs; the office checks) | failed (retried by the job up to 24 times, then the office retries). skipped: below settings.xero.from_number.';

-- Every invoice that is final enough to bill is queued for Xero.
create or replace function public.xero_sync_enqueue()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.status in ('generated', 'queued') then
    insert into xero_sync (invoice_id, status)
    values (new.id, case when new.number < coalesce((select (value ->> 'from_number')::int from settings where key = 'xero'), 4000)
                         then 'skipped' else 'pending' end)
    on conflict (invoice_id) do nothing;
  end if;
  return new;
end $$;
revoke execute on function public.xero_sync_enqueue() from public, anon, authenticated;
create trigger xero_sync_enqueue
  after insert or update of status on public.invoices
  for each row execute function public.xero_sync_enqueue();

-- A voided invoice that already reached Xero is for the office to void there
-- (Xero keeps the audit trail); the sync row says so.
create or replace function public.xero_sync_on_void()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.status = 'void' and old.status <> 'void' then
    update xero_sync
       set last_error = case when status in ('synced', 'mismatch')
                             then 'Void this invoice in Xero too.' else last_error end,
           status = case when status in ('pending', 'failed') then 'skipped' else status end,
           updated_at = now()
     where invoice_id = new.id;
  end if;
  return new;
end $$;
revoke execute on function public.xero_sync_on_void() from public, anon, authenticated;
create trigger xero_sync_on_void
  after update of status on public.invoices
  for each row execute function public.xero_sync_on_void();

-- The job's steps (service role).
create or replace function public.xero_claim_batch(p_now timestamptz default now(), p_limit int default 10)
returns setof uuid
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not coalesce((select (value ->> 'enabled')::boolean from settings where key = 'xero'), false)
     or not exists (select 1 from xero_connection) then
    return;
  end if;
  return query
  with pick as (
    select x.invoice_id from xero_sync x join invoices i on i.id = x.invoice_id
     where x.status in ('pending', 'syncing', 'failed')
       and x.attempts < 24
       and (x.lease_until is null or x.lease_until < p_now)
       and i.status in ('generated', 'queued')
       and i.storage_path is not null
     order by i.number
     limit greatest(p_limit, 0)
     for update of x skip locked
  ), upd as (
    update xero_sync x
       set status = 'syncing', attempts = x.attempts + 1,
           lease_until = p_now + interval '10 minutes', updated_at = now()
      from pick where x.invoice_id = pick.invoice_id
    returning x.invoice_id
  )
  select invoice_id from upd;
end $$;
revoke execute on function public.xero_claim_batch(timestamptz, int) from public, anon, authenticated;
grant execute on function public.xero_claim_batch(timestamptz, int) to service_role;

create or replace function public.xero_record_result(
  p_invoice uuid, p_ok boolean, p_xero_invoice_id text, p_xero_status text,
  p_xero_total numeric, p_error text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  i invoices;
begin
  select * into i from invoices where id = p_invoice;
  update xero_sync
     set status = case when not p_ok then 'failed'
                       when p_xero_total is distinct from i.total then 'mismatch'
                       else 'synced' end,
         xero_invoice_id = coalesce(p_xero_invoice_id, xero_invoice_id),
         xero_status = coalesce(p_xero_status, xero_status),
         xero_total = coalesce(p_xero_total, xero_total),
         last_error = case when p_ok and p_xero_total is distinct from i.total
                           then format('Xero total %s differs from ours %s.', p_xero_total, i.total)
                           when p_ok then null
                           else left(coalesce(p_error, 'failed'), 300) end,
         synced_at = case when p_ok then now() else synced_at end,
         lease_until = null, updated_at = now()
   where invoice_id = p_invoice;
end $$;
revoke execute on function public.xero_record_result(uuid, boolean, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.xero_record_result(uuid, boolean, text, text, numeric, text) to service_role;

-- The office's "Try again": a failed (or given-up) row goes back to pending.
create or replace function public.xero_retry(p_invoice uuid)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform assert_finance_caller();
  if not office_can('write') then
    raise exception 'not_permitted' using errcode = '42501', detail = 'write';
  end if;
  update xero_sync set status = 'pending', attempts = 0, lease_until = null, updated_at = now()
   where invoice_id = p_invoice and status in ('failed', 'mismatch', 'pending');
  if not found then raise exception 'xero_nothing_to_retry' using errcode = 'P0001'; end if;
end $$;
revoke execute on function public.xero_retry(uuid) from public, anon;
grant execute on function public.xero_retry(uuid) to authenticated, service_role;

-- What /settings shows: connected or not, to which organisation. Never the tokens.
create or replace function public.xero_status()
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  c xero_connection;
begin
  perform assert_finance_caller();
  select * into c from xero_connection;
  return jsonb_build_object(
    'connected', c.id is not null, 'tenantName', c.tenant_name, 'connectedAt', c.connected_at,
    'enabled', coalesce((select (value ->> 'enabled')::boolean from settings where key = 'xero'), false),
    'open', (select count(*) from xero_sync where status in ('pending', 'syncing', 'failed', 'mismatch')));
end $$;
revoke execute on function public.xero_status() from public, anon;
grant execute on function public.xero_status() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 8 · Row level security: finance reads; writes through the functions
--     (rates, files and review rows are the office's to edit directly)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['timesheet_rates', 'timesheet_jobs', 'timesheet_files',
                           'timesheet_shifts', 'invoice_sends', 'xero_sync'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format($p$create policy admin_finance_read on public.%I for select to authenticated
                      using ((select current_app_role()) = 'admin'::app_role and (select office_can('finance')))$p$, t);
    execute format('create trigger office_read_only before insert or update or delete or truncate on public.%I
                    for each statement execute function public.office_read_only_guard()', t);
  end loop;

  foreach t in array array['timesheet_rates', 'timesheet_files', 'timesheet_shifts'] loop
    execute format('grant insert, update, delete on table public.%I to authenticated', t);
    execute format($p$create policy admin_finance_write on public.%I for all to authenticated
                      using ((select current_app_role()) = 'admin'::app_role and (select office_can('finance')) and (select office_can('write')))
                      with check ((select current_app_role()) = 'admin'::app_role and (select office_can('finance')) and (select office_can('write')))$p$, t);
  end loop;

  -- a job is created by the office; every later change is the Upload / Review /
  -- Confirm actions (state guard above)
  execute 'grant insert, update on table public.timesheet_jobs to authenticated';
  execute $p$create policy admin_finance_write on public.timesheet_jobs for insert to authenticated
             with check ((select current_app_role()) = 'admin'::app_role and (select office_can('finance')) and (select office_can('write')))$p$;
  execute $p$create policy admin_finance_update on public.timesheet_jobs for update to authenticated
             using ((select current_app_role()) = 'admin'::app_role and (select office_can('finance')) and (select office_can('write')))
             with check ((select current_app_role()) = 'admin'::app_role and (select office_can('finance')) and (select office_can('write')))$p$;
end $$;

-- ---------------------------------------------------------------------
-- 9 · The four clients, where a card of that name exists (ADR-0203's
--     match: lower-case letters and digits only). Rates are the old tool's.
-- ---------------------------------------------------------------------
do $$
declare
  c record;
  v_count int := 0;
begin
  for c in
    select id, name,
           regexp_replace(lower(name), '[^a-z0-9]', '', 'g') as k
      from clients
  loop
    if c.k in ('leonardohotelstpaulsmande', 'leonardohotelstpaulsme') then
      update clients set invoicing_mode = 'timesheet', invoice_format = 'aggregated',
             po_required = true, exclude_from_invoicing = true,
             invoice_display_name = coalesce(invoice_display_name,
               'Jurys Inn & Leonardo Hotels UK & Ire St Paul''s M & E'),
             timesheet_default_role = coalesce(timesheet_default_role, 'Waiting')
       where id = c.id;
      insert into timesheet_rates (client_id, role_name, aliases, charge_rate)
      select c.id, r.role_name, r.aliases, 18.98
        from (values
          ('Waiting', array['Food Waiting Staff M&E', 'Wine Waiting Staff M&E', 'Waiting Staff']),
          ('Bar Staff', array['Bar Staff (St Paul''s M&E) MINUS 1']),
          ('Cloakroom Staff', array['Cloakroom Support Staff']),
          ('Kitchen Porter', array['KP']),
          ('TEAM LEAD', array['Team Lead'])) r(role_name, aliases)
      on conflict do nothing;
      v_count := v_count + 1;
    elsif c.k like '%taster%' and c.k not like '%alltaster%' then
      update clients set invoicing_mode = 'timesheet', invoice_format = 'named',
             po_required = true, exclude_from_invoicing = true,
             omit_event_dates_in_subject = true, invoice_date_label = 'W/C Date',
             timesheet_default_role = coalesce(timesheet_default_role, 'Service Staff')
       where id = c.id;
      insert into timesheet_rates (client_id, role_name, aliases, charge_rate)
      values (c.id, 'Service Staff', '{}', 17.77), (c.id, 'Shift Leader', array['Shift Lead'], 19.52)
      on conflict do nothing;
      v_count := v_count + 1;
    elsif c.k like '%alltaster%' then
      update clients set invoicing_mode = 'timesheet', invoice_format = 'named',
             po_required = false, exclude_from_invoicing = true,
             omit_event_dates_in_subject = true, invoice_date_label = 'W/C Date',
             timesheet_default_role = coalesce(timesheet_default_role, 'Kitchen Porter')
       where id = c.id;
      insert into timesheet_rates (client_id, role_name, aliases, charge_rate)
      values (c.id, 'Kitchen Porter', array['KP'], 17.77), (c.id, 'Shift Lead', array['Shift Leader'], 19.52)
      on conflict do nothing;
      v_count := v_count + 1;
    end if;
  end loop;
  raise notice 'timesheet invoicing: % client card(s) set up', v_count;
end $$;
