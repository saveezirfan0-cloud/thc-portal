-- =====================================================================
-- 20261022100000 · Invoices, sent with the completed timesheet — ADR-0175
--                   (THC, 20.10.2026; builds on ADR-0172 Ready to invoice)
--
-- THC decided on 20.10.2026 that the system issues the invoice itself:
--
--   · ONE invoice per PO Number (per client); an event with no PO Number
--     is invoiced on its own. A PO's invoice covers its events within
--     `po_window_days` (7) of the earliest one not yet invoiced, so a PO a
--     client reuses next month starts a new invoice rather than holding
--     this one.
--   · Sent at 10:00 UK the morning after the LAST event on it, with the
--     completed sign-in / sign-out timesheet of every event attached, to
--     the client card's accounts contact (falling back to the client's
--     contact emails), from timesheets@.
--   · Numbered from 4000, sequentially, with no gaps: the number is taken
--     in the same transaction that creates the invoice.
--   · 20% VAT; payable within 7 days; THC's company and bank details and
--     late-payment wording as on THC's own invoice — all in
--     settings.invoicing, editable on /settings.
--   · An event with NO violations needs no manager's sign-off: it is ready
--     once its check-outs are settled. An event with any violation waits
--     for the ADR-0172 sign-off (and is sent on the first run after it).
--     A missing check-out always holds it.
--   · The separate D2 timesheet email is unchanged (both are sent).
--   · Nothing is invoiced for an event dated before
--     settings.invoicing.first_event_date (go-live, 26.10.2026), so
--     switching this on never emails invoices for past events.
--
-- What it adds
--   clients: accounts_contact_name, invoice_emails, billing_address,
--            set by set_client_invoice_details() (audited).
--   invoice_counter      the next number (4000), one row
--   invoices             one per issued invoice, with the bill-to, seller,
--                        VAT and terms snapshotted as issued
--   invoice_event_links  which events an invoice covers (each event once)
--   invoice_lines        the shift lines as issued (immutable)
--   _invoice_event_rows  ADR-0172's per-event verdict, now internal and
--                        taking its clock; invoice_events() wraps it and
--                        gains the invoice columns and the send time
--   _invoice_groups      the PO groups and their verdicts
--   invoice_claim / invoice_document_data / invoice_record_files /
--   queue_invoice_email / invoice_release / invoices_unfinished
--                        the job's steps (service role)
--   invoice_file         the office's download (finance callers)
--
-- The job: the event-documents route (every 15 min, ADR-0074) runs the
-- invoices after D1/D2, so no new pg_cron row has to be installed.
--
-- Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The client card's accounts contact
-- ---------------------------------------------------------------------
alter table public.clients
  add column if not exists accounts_contact_name text,
  add column if not exists invoice_emails text[] not null default '{}'::text[],
  add column if not exists billing_address text;

alter table public.clients
  add constraint clients_invoice_emails_max check (coalesce(array_length(invoice_emails, 1), 0) <= 5);

comment on column public.clients.accounts_contact_name is
  'ADR-0175: who the invoice is addressed to ("Invoice to"). Set by set_client_invoice_details().';
comment on column public.clients.invoice_emails is
  'ADR-0175: where the invoice is emailed (up to 5). Empty: the client''s contact_emails.';
comment on column public.clients.billing_address is
  'ADR-0175: the postal address printed under "Invoice to".';

create or replace function public.set_client_invoice_details(
  p_client uuid, p_contact_name text, p_emails text[], p_address text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_emails text[];
  e text;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'admins_only' using errcode = '42501';
  end if;
  if not office_can('write') then
    raise exception 'not_permitted' using errcode = '42501', detail = 'write';
  end if;

  select coalesce(array_agg(distinct lower(btrim(x))) filter (where btrim(x) <> ''), '{}')
    into v_emails from unnest(coalesce(p_emails, '{}')) x;
  if coalesce(array_length(v_emails, 1), 0) > 5 then
    raise exception 'too_many_invoice_emails' using errcode = '22023';
  end if;
  foreach e in array v_emails loop
    if e !~ '^[^\s@<>",]+@[^\s@<>",]+\.[^\s@<>",]{2,}$' then
      raise exception 'invalid_invoice_email' using errcode = '22023', detail = e;
    end if;
  end loop;

  update clients
     set accounts_contact_name = nullif(btrim(coalesce(p_contact_name, '')), ''),
         invoice_emails = v_emails,
         billing_address = nullif(btrim(coalesce(p_address, '')), '')
   where id = p_client;
  if not found then
    raise exception 'unknown_client' using errcode = 'P0002';
  end if;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'client.invoice_details', 'client', p_client,
          jsonb_build_object('accountsContactName', nullif(btrim(coalesce(p_contact_name, '')), ''),
                             'invoiceEmails', to_jsonb(v_emails),
                             'billingAddress', nullif(btrim(coalesce(p_address, '')), '')));
end $$;

comment on function public.set_client_invoice_details(uuid, text, text[], text) is
  'ADR-0175: the client card''s accounts contact, invoice emails (up to 5, validated, lower-cased) and billing address. Office callers that may write; audited as client.invoice_details.';

revoke execute on function public.set_client_invoice_details(uuid, text, text[], text) from public, anon;
grant execute on function public.set_client_invoice_details(uuid, text, text[], text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2 · The settings THC's own invoice carries (editable on /settings)
-- ---------------------------------------------------------------------
insert into settings (key, value) values
  ('invoicing', jsonb_build_object(
     'enabled', true,
     'time', '10:00',
     'first_event_date', '2026-10-26',
     'po_window_days', 7,
     'vat_rate', 20,
     'payment_terms_days', 7,
     'company', jsonb_build_object(
        'name', 'THE HOSPITALITY COMPANY (London) Ltd',
        'company_reg', '12411407',
        'vat_reg', '388046760',
        'email', 'info@thehospitalitycompany.co.uk',
        'website', 'www.thehospitalitycompany.co.uk'),
     'bank', jsonb_build_object(
        'account_name', 'THE HOSPITALITY COMPANY (London) Ltd',
        'bank', 'Lloyds Bank',
        'account_number', '14076660',
        'sort_code', '30-15-99'),
     'late_payment_note',
       'Invoices exceeding these payment terms will be passed to International Commercial Investigation Services for collection. A £35.00 late payment fee will be automatically added and the invoice will be subject to statutory interest and additional costs, including any costs incurred during the recovery process.'))
on conflict (key) do nothing;

-- The settings row as the functions below read it, every value defaulted.
create or replace function public.invoicing_config()
returns jsonb
language sql stable set search_path = public, extensions as $$
  select jsonb_build_object(
    'enabled',            coalesce((s.value ->> 'enabled')::boolean, false),
    'time',               coalesce(nullif(s.value ->> 'time', ''), '10:00'),
    'first_event_date',   coalesce(nullif(s.value ->> 'first_event_date', ''), '2026-10-26'),
    'po_window_days',     greatest(1, coalesce((s.value ->> 'po_window_days')::int, 7)),
    'vat_rate',           coalesce((s.value ->> 'vat_rate')::numeric, 20),
    'payment_terms_days', coalesce((s.value ->> 'payment_terms_days')::int, 7),
    'company',            coalesce(s.value -> 'company', '{}'::jsonb),
    'bank',               coalesce(s.value -> 'bank', '{}'::jsonb),
    'late_payment_note',  coalesce(s.value ->> 'late_payment_note', ''))
  from (select (select value from settings where key = 'invoicing') as value) s
$$;

comment on function public.invoicing_config() is
  'ADR-0175: settings.invoicing with every value defaulted (disabled when the row is missing). Internal.';
revoke execute on function public.invoicing_config() from public, anon, authenticated;
grant execute on function public.invoicing_config() to service_role;

-- ---------------------------------------------------------------------
-- 3 · The tables
-- ---------------------------------------------------------------------
create table public.invoice_counter (
  id          boolean primary key default true check (id),
  next_number int not null check (next_number > 0)
);
insert into public.invoice_counter (id, next_number) values (true, 4000) on conflict do nothing;

comment on table public.invoice_counter is
  'ADR-0175: the next invoice number (THC: from 4000). Taken under a row lock in the transaction that creates the invoice, so numbers never skip.';

create table public.invoices (
  id            uuid primary key default gen_random_uuid(),
  number        int not null unique,
  client_id     uuid not null references public.clients(id),
  po_number     text,
  group_key     text not null,
  invoice_date  date not null,
  due_date      date not null,
  period_from   date not null,
  period_to     date not null,
  payable_min   int not null,
  net           numeric(12,2) not null,
  vat_rate      numeric(5,2) not null,
  vat           numeric(12,2) not null,
  total         numeric(12,2) not null,
  terms_days    int not null,
  bill_to       jsonb not null,
  seller        jsonb not null,
  recipients    text[] not null,
  status        text not null default 'drawing' check (status in ('drawing', 'failed', 'queued')),
  attempts      int not null default 0,
  lease_until   timestamptz,
  last_error    text,
  storage_path  text,
  file_name     text,
  attachments   jsonb,
  outbox_key    text unique,
  queued_at     timestamptz,
  created_at    timestamptz not null default now()
);

create index invoices_client_idx on public.invoices (client_id);
create index invoices_status_idx on public.invoices (status) where status <> 'queued';

comment on table public.invoices is
  'ADR-0175: one row per issued invoice, numbered from 4000 without gaps. Bill-to, seller, VAT and terms are snapshotted as issued; the lines are in invoice_lines. drawing → queued (the INV1 email is in the outbox), or failed and retried by the job.';

create table public.invoice_event_links (
  event_id   uuid primary key references public.events(id),
  invoice_id uuid not null references public.invoices(id)
);
create index invoice_event_links_invoice_idx on public.invoice_event_links (invoice_id);

comment on table public.invoice_event_links is
  'ADR-0175: the events an invoice covers. The primary key is the event: an event is invoiced once.';

create table public.invoice_lines (
  id          bigint generated always as identity primary key,
  invoice_id  uuid not null references public.invoices(id),
  event_id    uuid not null references public.events(id),
  booking_id  uuid not null,
  sort        int not null,
  line_date   date not null,
  staff_name  text not null,
  employee_id int,
  role_name   text not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  break_min   int not null,
  payable_min int not null,
  rate        numeric(8,2) not null,
  amount      numeric(12,2) not null,
  kind        text not null
);
create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id, sort);
create index invoice_lines_event_idx on public.invoice_lines (event_id);

comment on table public.invoice_lines is
  'ADR-0175: one row per charged shift as issued (report_payroll_lines_v at the moment of issue). Never updated.';

do $$
declare t text;
begin
  foreach t in array array['invoice_counter', 'invoices', 'invoice_event_links', 'invoice_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format($p$create policy admin_finance_read on public.%I for select to authenticated
                      using ((select current_app_role()) = 'admin'::app_role and (select office_can('finance')))$p$, t);
    -- ADR-0060: a viewer writes nothing.
    execute format('create trigger office_read_only before insert or update or delete or truncate on public.%I
                    for each statement execute function public.office_read_only_guard()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4 · One event's verdict, with its clock (ADR-0172 §3, made internal)
--
-- ADR-0175 changes one rule: an event with NO violation is ready once its
-- check-outs are settled — the sign-off is for reviewing violations, and
-- there is none. An event already on an invoice is `invoiced`.
-- ---------------------------------------------------------------------
create or replace function public._invoice_event_rows(p_ids uuid[], p_now timestamptz)
returns table (
  event_id            uuid,
  event_date          date,
  event_title         text,
  client_id           uuid,
  client_name         text,
  po_number           text,
  venue_name          text,
  cancelled           boolean,
  last_end_at         timestamptz,
  check_out_closes_at timestamptz,
  shifts              int,
  billable_shifts     int,
  pending             int,
  no_shows            int,
  turned_away         int,
  payable_min         int,
  invoicing           numeric,
  violations          int,
  unresolved          int,
  no_checkouts        int,
  status              text,
  fingerprint         text,
  signed_off_at       timestamptz,
  signed_off_by_name  text,
  signoff_note        text,
  signed_invoicing    numeric,
  signoff_stale       boolean,
  needs_signoff       boolean,
  invoice_id          uuid,
  invoice_number      int,
  invoice_status      text,
  invoice_queued_at   timestamptz
)
language plpgsql stable set search_path = public, extensions as $$
#variable_conflict use_column
begin
  return query
  with ev as (
    select e.id, e.event_date, e.title, e.client_id, c.name as client_name, e.po_number, e.venue_name,
           e.cancelled_at is not null as cancelled,
           (select max(sr.ends_at) from shift_requirements sr where sr.event_id = e.id) as last_end_at
      from events e
      join clients c on c.id = e.client_id
     where e.id = any (p_ids)
  ),
  lines as (
    select l.event_id,
           count(*)::int                                                         as shifts,
           count(*) filter (where l.kind in ('worked', 'cancelled_on_day'))::int as billable_shifts,
           count(*) filter (where l.status = 'pending')::int                     as pending,
           count(*) filter (where l.kind = 'no_show')::int                       as no_shows,
           count(*) filter (where l.kind = 'turned_away')::int                   as turned_away,
           coalesce(sum(l.payable_min) filter (where l.status = 'settled'
                                                 and l.kind in ('worked', 'cancelled_on_day')), 0)::int
                                                                                 as payable_min,
           coalesce(sum(l.invoicing), 0)                                         as invoicing
      from report_payroll_lines_v l
     -- = any(array(...)): an init-plan parameter reaches the bookings under
     -- the security-barrier view (ADR-0172).
     where l.event_id = any (array(select id from ev))
     group by l.event_id
  ),
  viol as (
    select sr.event_id,
           count(*)::int                               as violations,
           count(*) filter (where not v.resolved)::int as unresolved,
           count(*) filter (where not v.resolved and v.type = 'no_checkout')::int as no_checkouts
      from violations v
      join bookings b            on b.id = v.booking_id
      join shift_requirements sr on sr.id = b.shift_id
     where sr.event_id = any (array(select id from ev))
     group by sr.event_id
  ),
  x as (
    select ev.*, li.shifts, li.billable_shifts, li.pending, li.no_shows, li.turned_away,
           li.payable_min, li.invoicing,
           coalesce(vi.violations, 0) as violations, coalesce(vi.unresolved, 0) as unresolved,
           coalesce(vi.no_checkouts, 0) as no_checkouts,
           ev.last_end_at + interval '4 hours' as closes_at,
           invoice_event_fingerprint(ev.id) as fp,
           s.signed_off_at, p.full_name as signer, s.note, s.invoicing as signed_invoicing,
           s.fingerprint as signed_fp,
           k.invoice_id, i.number as inv_number, i.status as inv_status, i.queued_at as inv_queued_at
      from ev
      join lines li                      on li.event_id = ev.id
      left join viol vi                  on vi.event_id = ev.id
      left join event_invoice_signoffs s on s.event_id = ev.id
      left join profiles p               on p.id = s.signed_off_by
      left join invoice_event_links k    on k.event_id = ev.id
      left join invoices i               on i.id = k.invoice_id
  )
  select x.id, x.event_date, x.title, x.client_id, x.client_name, x.po_number, x.venue_name, x.cancelled,
         x.last_end_at, x.closes_at,
         x.shifts, x.billable_shifts, x.pending, x.no_shows, x.turned_away,
         x.payable_min, x.invoicing, x.violations, x.unresolved, x.no_checkouts,
         case when x.invoice_id is not null                then 'invoiced'
              when p_now < x.closes_at                     then 'open'
              when x.pending > 0 or x.no_checkouts > 0     then 'missing'
              when x.violations = 0                        then 'ready'
              when x.signed_fp is distinct from x.fp       then 'review'
              else 'ready' end,
         x.fp,
         x.signed_off_at, x.signer, x.note, x.signed_invoicing,
         (x.signed_fp is not null and x.signed_fp <> x.fp),
         x.violations > 0,
         x.invoice_id, x.inv_number, x.inv_status, x.inv_queued_at
    from x
   order by x.event_date, x.client_name, x.title, x.id;
end $$;

comment on function public._invoice_event_rows(uuid[], timestamptz) is
  'ADR-0172/0175: each listed event that has shift lines, priced, with its status at p_now: invoiced → open (check-out window) → missing (a pending line or an unresolved No check-out) → ready (no violation at all, or signed off and unchanged) / review. Internal: callers check their own caller.';
revoke execute on function public._invoice_event_rows(uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public._invoice_event_rows(uuid[], timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- 5 · The groups: one invoice per (client, PO), or per event without one
-- ---------------------------------------------------------------------
create or replace function public._invoice_groups(p_now timestamptz)
returns table (
  group_key   text,
  client_id   uuid,
  po_number   text,
  event_ids   uuid[],
  first_date  date,
  last_date   date,
  due_at      timestamptz,
  net         numeric,
  recipients  text[],
  verdict     text
)
language plpgsql stable set search_path = public, extensions as $$
#variable_conflict use_column
declare
  cfg     jsonb := invoicing_config();
  v_first date  := (cfg ->> 'first_event_date')::date;
  v_win   int   := (cfg ->> 'po_window_days')::int;
  v_time  text  := cfg ->> 'time';
  v_on    boolean := (cfg ->> 'enabled')::boolean;
  v_ids   uuid[];
begin
  -- Candidates: on or after go-live, not on an invoice, not cancelled before
  -- their day, and not further ahead than a PO window could reach.
  select array_agg(e.id) into v_ids
    from events e
   where e.event_date >= v_first
     and e.event_date <= (p_now at time zone 'Europe/London')::date + v_win
     and not exists (select 1 from invoice_event_links k where k.event_id = e.id)
     and (e.cancelled_at is null or uk_local(e.cancelled_at)::date >= e.event_date);

  return query
  with cand as (
    select e.id, e.client_id, e.event_date,
           nullif(btrim(coalesce(e.po_number, '')), '') as po,
           (select max(sr.ends_at) from shift_requirements sr where sr.event_id = e.id) as last_end
      from events e
     where e.id = any (coalesce(v_ids, '{}'))
  ),
  fin as (
    select c.*, (c.last_end is not null and p_now >= c.last_end + interval '4 hours') as finished
      from cand c
  ),
  evr as (
    select r.* from _invoice_event_rows(
      array(select f.id from fin f where f.finished), p_now) r
  ),
  -- A member holds or joins its group: an event still running, or a
  -- finished one with something to charge. A finished event with nothing
  -- to charge (nobody worked) is not invoiced and holds nothing.
  member as (
    select f.id, f.client_id, f.event_date, f.po, f.finished, r.status, r.invoicing,
           f.client_id::text || ':' || coalesce('po:' || upper(f.po), 'event:' || f.id::text) as gkey
      from fin f
      left join evr r on r.event_id = f.id
     where not f.finished or coalesce(r.billable_shifts, 0) > 0
  ),
  anchored as (
    select m.*, min(m.event_date) over (partition by m.gkey) as anchor
      from member m
  ),
  win as (
    select a.* from anchored a
     where a.po is null or a.event_date <= a.anchor + (v_win - 1)
  ),
  g as (
    select w.gkey,
           min(w.client_id::text)::uuid                       as client_id,
           min(w.po)                                          as po,
           array_agg(w.id order by w.event_date, w.id)        as ids,
           min(w.event_date)                                  as first_date,
           max(w.event_date)                                  as last_date,
           bool_or(not w.finished)                            as running,
           bool_or(w.status = 'missing')                      as missing,
           bool_or(w.status = 'review')                       as review,
           coalesce(sum(w.invoicing) filter (where w.finished), 0) as net
      from win w
     group by w.gkey
  )
  select g.gkey, g.client_id, g.po, g.ids, g.first_date, g.last_date,
         ((g.last_date + 1)::text || ' ' || v_time)::timestamp at time zone 'Europe/London',
         g.net,
         case when coalesce(array_length(c.invoice_emails, 1), 0) > 0 then c.invoice_emails
              else c.contact_emails end,
         case when not v_on                 then 'disabled'
              when g.running                then 'waiting'
              when g.missing                then 'missing'
              when g.review                 then 'review'
              when g.net <= 0               then 'nothing_to_invoice'
              when p_now < ((g.last_date + 1)::text || ' ' || v_time)::timestamp at time zone 'Europe/London'
                                            then 'scheduled'
              when coalesce(array_length(case when coalesce(array_length(c.invoice_emails, 1), 0) > 0
                                              then c.invoice_emails else c.contact_emails end, 1), 0) = 0
                                            then 'no_recipients'
              else 'due' end
    from g
    join clients c on c.id = g.client_id
   order by g.last_date, g.gkey;
end $$;

comment on function public._invoice_groups(timestamptz) is
  'ADR-0175: the invoices waiting to be issued at p_now — one per (client, PO) within po_window_days of its earliest un-invoiced event, or per event without a PO — with the events, the send time (10:00 UK the morning after the last), the net and the verdict: disabled, waiting (an event still running or inside its check-out window), missing, review, nothing_to_invoice, scheduled, no_recipients, due. Internal.';
revoke execute on function public._invoice_groups(timestamptz) from public, anon, authenticated;
grant execute on function public._invoice_groups(timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- 6 · invoice_events — ADR-0172's list, with the invoice columns
--     (a changed result shape cannot be create-or-replaced)
-- ---------------------------------------------------------------------
drop function if exists public.invoice_events(date, date);
create function public.invoice_events(p_from date, p_to date)
returns table (
  event_id            uuid,
  event_date          date,
  event_title         text,
  client_name         text,
  po_number           text,
  venue_name          text,
  cancelled           boolean,
  last_end_at         timestamptz,
  check_out_closes_at timestamptz,
  shifts              int,
  billable_shifts     int,
  pending             int,
  no_shows            int,
  turned_away         int,
  payable_min         int,
  invoicing           numeric,
  violations          int,
  unresolved          int,
  no_checkouts        int,
  status              text,
  fingerprint         text,
  signed_off_at       timestamptz,
  signed_off_by_name  text,
  signoff_note        text,
  signed_invoicing    numeric,
  signoff_stale       boolean,
  needs_signoff       boolean,
  invoice_id          uuid,
  invoice_number      int,
  invoice_status      text,
  invoice_queued_at   timestamptz,
  sends_at            timestamptz,
  send_verdict        text
)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
begin
  perform assert_finance_caller();
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'bad_range' using errcode = '22023';
  end if;

  return query
  with g as (select * from _invoice_groups(now())),
  ge as (select unnest(g.event_ids) as event_id, g.due_at, g.verdict from g)
  select r.event_id, r.event_date, r.event_title, r.client_name, r.po_number, r.venue_name,
         r.cancelled, r.last_end_at, r.check_out_closes_at, r.shifts, r.billable_shifts,
         r.pending, r.no_shows, r.turned_away, r.payable_min, r.invoicing, r.violations,
         r.unresolved, r.no_checkouts, r.status, r.fingerprint, r.signed_off_at,
         r.signed_off_by_name, r.signoff_note, r.signed_invoicing, r.signoff_stale,
         r.needs_signoff, r.invoice_id, r.invoice_number, r.invoice_status, r.invoice_queued_at,
         ge.due_at, ge.verdict
    from _invoice_event_rows(
           array(select e.id from events e where e.event_date between p_from and p_to), now()) r
    left join ge on ge.event_id = r.event_id
   order by r.event_date, r.client_name, r.event_title, r.event_id;
end $$;

comment on function public.invoice_events(date, date) is
  'ADR-0172/0175: one row per event dated in the range that has shift lines, priced, with its status (invoiced → open → missing → ready / review), its invoice (number, status) once issued, and — while it waits — when its PO''s invoice is due to send and why it waits. Finance callers only.';
revoke execute on function public.invoice_events(date, date) from public, anon;
grant execute on function public.invoice_events(date, date) to authenticated, service_role;

-- invoice_export_rows: an invoiced event is as ready as a signed-off one.
create or replace function public.invoice_export_rows(p_from date, p_to date, p_event uuid default null)
returns table (
  event_id         uuid,
  event_date       date,
  event_title      text,
  client_name      text,
  po_number        text,
  booking_id       uuid,
  employee_id      int,
  staff_name       text,
  role_name        text,
  shift_date       date,
  starts_at        timestamptz,
  ends_at          timestamptz,
  check_in_at      timestamptz,
  check_out_at     timestamptz,
  kind             text,
  unpaid_break_min int,
  payable_min      int,
  charge_rate      numeric,
  invoicing        numeric
)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
begin
  perform assert_finance_caller();
  return query
  with ready as (
    select i.* from invoice_events(p_from, p_to) i
     where i.status in ('ready', 'invoiced')
       and (p_event is null or i.event_id = p_event)
  )
  select i.event_id, i.event_date, i.event_title, i.client_name, i.po_number,
         l.booking_id, l.employee_id, l.staff_name, l.role_name, l.shift_date,
         l.starts_at, l.ends_at, l.check_in_at, l.check_out_at, l.kind,
         l.unpaid_break_min, l.payable_min, l.charge_rate, l.invoicing
    from ready i
    join report_payroll_lines_v l on l.event_id = i.event_id
   where l.event_id = any (array(select event_id from ready))
     and l.kind in ('worked', 'cancelled_on_day')
   order by i.event_date, i.client_name, i.event_title, i.event_id,
            l.starts_at, l.role_name, l.removed, l.sort_surname nulls last, l.staff_name, l.booking_id;
end $$;

-- sign_off_event_invoice: unchanged rules, restated over the new list. An
-- invoiced event is closed: there is nothing left to sign off.
create or replace function public.sign_off_event_invoice(p_event uuid, p_note text, p_fingerprint text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_date date;
  v_row  record;
begin
  perform assert_finance_caller();
  if not office_can('write') then
    raise exception 'not_permitted' using errcode = '42501', detail = 'write';
  end if;
  if p_note is null or btrim(p_note) = '' then
    raise exception 'note_required' using errcode = 'P0001';
  end if;

  select e.event_date into v_date from events e where e.id = p_event;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;

  select i.* into v_row from invoice_events(v_date, v_date) i where i.event_id = p_event;
  if not found then
    raise exception 'nothing_to_invoice' using errcode = 'P0001';
  end if;
  if v_row.status = 'invoiced' then
    raise exception 'already_invoiced' using errcode = 'P0001';
  end if;
  if v_row.status = 'open' then
    raise exception 'check_out_open' using errcode = 'P0001';
  end if;
  if v_row.status = 'missing' then
    raise exception 'check_out_missing' using errcode = 'P0001';
  end if;
  if p_fingerprint is distinct from v_row.fingerprint then
    raise exception 'changed_since_viewed' using errcode = 'P0001';
  end if;

  insert into event_invoice_signoffs as s
         (event_id, signed_off_by, signed_off_at, note, fingerprint, invoicing, payable_min)
  values (p_event, auth.uid(), now(), btrim(p_note), v_row.fingerprint, v_row.invoicing, v_row.payable_min)
  on conflict (event_id) do update
     set signed_off_by = excluded.signed_off_by, signed_off_at = excluded.signed_off_at,
         note = excluded.note, fingerprint = excluded.fingerprint,
         invoicing = excluded.invoicing, payable_min = excluded.payable_min;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'invoice.signed_off', 'event', p_event,
          jsonb_build_object('note', btrim(p_note), 'invoicing', v_row.invoicing,
                             'payableMin', v_row.payable_min, 'violations', v_row.violations,
                             'unresolved', v_row.unresolved, 'fingerprint', v_row.fingerprint));

  return jsonb_build_object('decision', 'signed_off', 'invoicing', v_row.invoicing,
                            'payableMin', v_row.payable_min);
end $$;

-- ---------------------------------------------------------------------
-- 7 · The job's steps (service role)
-- ---------------------------------------------------------------------

-- The groups the job looks at, with their verdicts (its counts say why
-- nothing went).
create or replace function public.invoice_groups_due(p_now timestamptz default now())
returns table (group_key text, verdict text, event_count int, due_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select g.group_key, g.verdict, coalesce(array_length(g.event_ids, 1), 0), g.due_at
    from _invoice_groups(p_now) g
$$;

-- Issue one invoice: re-check the group under a lock, take the next
-- number, snapshot the lines. Returns the invoice id, or null when the
-- group is no longer due (another run took it, something changed).
create or replace function public.invoice_claim(p_group_key text, p_now timestamptz default now())
returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  g        record;
  cfg      jsonb := invoicing_config();
  c        clients;
  v_number int;
  v_id     uuid;
  v_date   date := (p_now at time zone 'Europe/London')::date;
  v_rate   numeric := (cfg ->> 'vat_rate')::numeric;
  v_terms  int := (cfg ->> 'payment_terms_days')::int;
  v_net    numeric;
  v_min    int;
begin
  perform pg_advisory_xact_lock(hashtext('invoice-group:' || p_group_key));

  select * into g from _invoice_groups(p_now) x where x.group_key = p_group_key;
  if not found or g.verdict <> 'due' then
    return null;
  end if;
  -- An event taken by a concurrent claim is linked already; the lock above
  -- and the links' primary key make a double invoice impossible.
  if exists (select 1 from invoice_event_links k where k.event_id = any (g.event_ids)) then
    return null;
  end if;

  select * into c from clients where id = g.client_id;

  update invoice_counter set next_number = next_number + 1 where id
  returning next_number - 1 into v_number;

  insert into invoices (number, client_id, po_number, group_key, invoice_date, due_date,
                        period_from, period_to, payable_min, net, vat_rate, vat, total,
                        terms_days, bill_to, seller, recipients, status, lease_until)
  values (v_number, g.client_id, g.po_number, g.group_key, v_date, v_date + v_terms,
          g.first_date, g.last_date, 0, 0, v_rate, 0, 0, v_terms,
          jsonb_build_object('name', c.name,
                             'contact', coalesce(c.accounts_contact_name, c.contact_name),
                             'emails', to_jsonb(g.recipients),
                             'address', coalesce(c.billing_address, '')),
          jsonb_build_object('company', cfg -> 'company', 'bank', cfg -> 'bank',
                             'late_payment_note', cfg ->> 'late_payment_note'),
          g.recipients, 'drawing', p_now + interval '10 minutes')
  returning id into v_id;

  insert into invoice_event_links (event_id, invoice_id)
  select unnest(g.event_ids), v_id;

  insert into invoice_lines (invoice_id, event_id, booking_id, sort, line_date, staff_name,
                             employee_id, role_name, starts_at, ends_at, break_min, payable_min,
                             rate, amount, kind)
  select v_id, l.event_id, l.booking_id,
         row_number() over (order by l.shift_date, l.starts_at, l.role_name, l.removed,
                                     l.sort_surname nulls last, l.staff_name, l.booking_id)::int,
         l.shift_date, l.staff_name, l.employee_id, l.role_name, l.starts_at, l.ends_at,
         coalesce(l.unpaid_break_min, 0), coalesce(l.payable_min, 0), l.charge_rate,
         coalesce(l.invoicing, 0), l.kind
    from report_payroll_lines_v l
   where l.event_id = any (g.event_ids)
     and l.kind in ('worked', 'cancelled_on_day')
     and l.status = 'settled';

  select coalesce(sum(amount), 0), coalesce(sum(payable_min), 0)::int
    into v_net, v_min from invoice_lines where invoice_id = v_id;

  update invoices
     set net = v_net, payable_min = v_min,
         vat = round(v_net * v_rate / 100, 2),
         total = v_net + round(v_net * v_rate / 100, 2)
   where id = v_id;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), null, 'invoice.issued', 'invoice', v_id,
          jsonb_build_object('number', v_number, 'groupKey', p_group_key,
                             'events', to_jsonb(g.event_ids), 'net', v_net));
  return v_id;
end $$;

-- Everything the PDF and the email need, as one document.
create or replace function public.invoice_document_data(p_invoice uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  i invoices;
begin
  select * into i from invoices where id = p_invoice;
  if i.id is null then raise exception 'invoice_not_found' using errcode = 'P0002'; end if;

  return jsonb_build_object(
    'id', i.id, 'number', i.number, 'invoiceDate', i.invoice_date, 'dueDate', i.due_date,
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
                        'amount', l.amount, 'kind', l.kind) order by l.sort), '[]'::jsonb)
                from invoice_lines l where l.invoice_id = i.id));
end $$;

-- The stored files: the invoice PDF and the timesheets beside it.
create or replace function public.invoice_record_files(
  p_invoice uuid, p_storage_path text, p_file_name text, p_attachments jsonb)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  update invoices
     set storage_path = p_storage_path, file_name = p_file_name, attachments = p_attachments
   where id = p_invoice and status <> 'queued';
  if not found then raise exception 'invoice_not_open' using errcode = 'P0001'; end if;
end $$;

-- The INV1 email, once per invoice (key INV1:<number>).
create or replace function public.queue_invoice_email(p_invoice uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  i invoices;
  v_key text;
  v_events jsonb;
  v_n int;
  v_inserted int;
begin
  select * into i from invoices where id = p_invoice for update;
  if i.id is null then raise exception 'invoice_not_found' using errcode = 'P0002'; end if;
  if i.storage_path is null or i.attachments is null then
    raise exception 'invoice_has_no_files' using errcode = 'P0001';
  end if;
  if coalesce(array_length(i.recipients, 1), 0) = 0 then
    raise exception 'invoice_has_no_recipients' using errcode = 'P0001';
  end if;

  select count(*), jsonb_agg(jsonb_build_object('title', e.title, 'date', e.event_date)
                             order by e.event_date, e.title)
    into v_n, v_events
    from invoice_event_links k join events e on e.id = k.event_id where k.invoice_id = i.id;

  v_key := 'INV1:' || i.number::text;
  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values (v_key, 'email', 'INV1', i.recipients, jsonb_build_object(
    'invoiceNumber', i.number::text,
    'client', i.bill_to ->> 'name',
    'contact', coalesce(i.bill_to ->> 'contact', ''),
    'poNumber', coalesce(i.po_number, ''),
    'poSuffix', case when coalesce(i.po_number, '') = '' then '' else ' (PO ' || i.po_number || ')' end,
    'eventsLine', case when v_n = 1
                       then (v_events -> 0 ->> 'title') || ' on '
                            || trim(to_char((v_events -> 0 ->> 'date')::date, 'FMDay FMDD FMMonth YYYY'))
                       else v_n::text || ' events, ' || to_char(i.period_from, 'FMDD FMMonth')
                            || ' to ' || to_char(i.period_to, 'FMDD FMMonth YYYY') end,
    'total', to_char(i.total, 'FM999,999,990.00'),
    'dueDate', to_char(i.due_date, 'DD/MM/YYYY'),
    'termsDays', i.terms_days::text,
    'attachments', i.attachments::text))
  on conflict (key) do nothing;
  get diagnostics v_inserted = row_count;

  update invoices
     set status = 'queued', outbox_key = v_key, queued_at = coalesce(queued_at, clock_timestamp()),
         lease_until = null, last_error = null
   where id = i.id;
  return jsonb_build_object('key', v_key, 'queued', v_inserted = 1);
end $$;

-- A run that failed hands the invoice back for the next one.
create or replace function public.invoice_release(p_invoice uuid, p_error text)
returns void
language sql security definer set search_path = public, extensions as $$
  update invoices
     set status = 'failed', lease_until = null, attempts = attempts + 1,
         last_error = left(coalesce(p_error, 'failed'), 300)
   where id = p_invoice and status <> 'queued';
$$;

-- Issued but not yet sent (a failed or abandoned run): the job finishes
-- these first, under a fresh lease, so an invoice number is never left
-- without its email. After 24 attempts it stops and the office sees it.
create or replace function public.invoices_unfinished(p_now timestamptz default now())
returns setof uuid
language plpgsql security definer set search_path = public, extensions as $$
begin
  return query
  update invoices
     set lease_until = p_now + interval '10 minutes', status = 'drawing'
   where status in ('drawing', 'failed')
     and attempts < 24
     and (lease_until is null or lease_until < p_now)
  returning id;
end $$;

-- The office's download (and the event page's link).
create or replace function public.invoice_file(p_invoice uuid)
returns table (storage_path text, file_name text, number int)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
begin
  perform assert_finance_caller();
  return query select i.storage_path, i.file_name, i.number from invoices i where i.id = p_invoice;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.invoice_groups_due(timestamptz)',
    'public.invoice_claim(text, timestamptz)',
    'public.invoice_document_data(uuid)',
    'public.invoice_record_files(uuid, text, text, jsonb)',
    'public.queue_invoice_email(uuid)',
    'public.invoice_release(uuid, text)',
    'public.invoices_unfinished(timestamptz)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

revoke execute on function public.invoice_file(uuid) from public, anon;
grant execute on function public.invoice_file(uuid) to authenticated, service_role;

comment on function public.invoice_claim(text, timestamptz) is
  'ADR-0175: issues the invoice for a due group under an advisory lock — the next number from invoice_counter (gapless), the bill-to and seller snapshotted, the events linked (each once), the settled billable lines copied, net/VAT/total. Null when the group is no longer due. Service role.';
comment on function public.queue_invoice_email(uuid) is
  'ADR-0175: the INV1 email for an issued invoice, keyed INV1:<number>, to the snapshotted recipients, with the invoice PDF and each event''s completed timesheet attached. Service role.';
comment on function public.invoice_file(uuid) is
  'ADR-0175: the stored invoice PDF''s path and name, for the office''s download. Finance callers only.';
