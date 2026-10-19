-- =====================================================================
-- 20261021100000 · Ready to invoice — ADR-0168 (THC, 19.10.2026)
--
-- §9.9 leaves invoicing to THC's own process: the Financial tab's
-- "Client invoicing" is a forecast, not the PO-based invoices. THC asked
-- on 19.10.2026 for the step in between: a per-EVENT list that says when
-- an event is safe to invoice, with the lines to key into their own
-- accounting tool. The system still issues no invoice — no number, no
-- VAT, no email to the client.
--
-- An event is READY TO INVOICE when all four hold, in this order (the
-- first that fails is the event's status):
--
--   1 · open         the check-out window is closed: now() is past the
--                    last section's end + 4 h (RULE-02). Before that a
--                    worker can still check out and change the hours.
--   2 · missing      no shift is pending and no No check-out is
--                    unresolved. A pending line has unknown hours and is
--                    never priced (report_payroll_lines_v); a No check-out
--                    raised on a stale fix (D15, ADR-0035) has a recorded
--                    finish but is still unresolved, and is never invoiced
--                    on that default (RULE-02).
--   3 · review       a manager has signed the event off for invoicing,
--                    with a note, AND nothing has changed since: the
--                    sign-off stores a fingerprint of every violation on
--                    the event (id, type, resolved, finish) and every
--                    line (booking, kind, status, payable minutes,
--                    amount). A violation raised, resolved or voided, or
--                    a corrected check-in/out, after the sign-off makes
--                    it stale and the event goes back to review.
--   4 · ready
--
-- Why a sign-off and not "every violation resolved": resolving a No-show
-- is "Get back" (§9.5) — it registers the worker as arrived, so a genuine
-- no-show would be invoiced and its show-rate penalty cleared. The
-- manager reviews every violation on the sign-off screen instead, and
-- only the No check-out, which leaves hours unknown, must be resolved.
--
-- The money is report_payroll_lines_v's `invoicing`, unchanged: payable
-- minutes (RULE-01, breaks deducted) × the section's charge rate; a
-- turn-away and a no-show are never invoiced; a section cancelled on the
-- day is (§3.3). Events cancelled before their day have no lines and are
-- left out, as in finance_report.
--
--   event_invoice_signoffs          one row per signed-off event
--   invoice_events(from, to)        the list, one row per event
--   invoice_event_lines(event)      the event's shift lines
--   invoice_event_violations(event) every violation on the event
--   sign_off_event_invoice(event, note, fingerprint)
--   invoice_export_rows(from, to, event)  the CSV: ready events only
--
-- Reads: assert_finance_caller() (owner, manager, viewer). The sign-off
-- also needs office_can('write') (owner, manager), and the viewer guard
-- on the table refuses a viewer's write regardless (ADR-0060). No client
-- or staff policy (ADR-0004, ADR-0026). Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The sign-off
-- ---------------------------------------------------------------------
create table public.event_invoice_signoffs (
  event_id      uuid primary key references public.events(id) on delete cascade,
  -- Null once that office account is deleted; audit_log keeps who it was.
  signed_off_by uuid references public.profiles(id) on delete set null,
  signed_off_at timestamptz not null default now(),
  note          text not null check (btrim(note) <> ''),
  -- invoice_event_fingerprint() at the moment of the sign-off.
  fingerprint   text not null,
  -- What was signed off, for the record: the amount and hours then.
  invoicing     numeric(12,2) not null,
  payable_min   int not null
);

comment on table public.event_invoice_signoffs is
  'ADR-0168: a manager''s sign-off that an event is ready to invoice. Stale once invoice_event_fingerprint() differs from the stored one. Written only by sign_off_event_invoice().';

-- Every foreign key is indexed (002).
create index event_invoice_signoffs_signed_off_by_idx on public.event_invoice_signoffs (signed_off_by);

alter table public.event_invoice_signoffs enable row level security;

revoke all on table public.event_invoice_signoffs from public, anon, authenticated;
grant select on table public.event_invoice_signoffs to authenticated;
grant all on table public.event_invoice_signoffs to service_role;

-- Money-only: a scheduler reads an empty table (ADR-0056).
create policy admin_finance_read on public.event_invoice_signoffs
  for select to authenticated
  using ((select current_app_role()) = 'admin'::app_role and (select office_can('finance')));

-- ADR-0060: a viewer can change nothing.
create trigger office_read_only
  before insert or update or delete or truncate on public.event_invoice_signoffs
  for each statement execute function public.office_read_only_guard();

-- ---------------------------------------------------------------------
-- 2 · The fingerprint — what a sign-off vouches for
-- ---------------------------------------------------------------------
create or replace function public.invoice_event_fingerprint(p_event uuid)
returns text
language sql
stable
-- row()::text writes a timestamptz in the session's zone and style; fixed
-- here so every session computes the same fingerprint.
set search_path = public, extensions
set timezone = 'UTC'
set datestyle = 'ISO, YMD'
as $$
  -- row(...)::text keeps every field positional, NULLs included, so a
  -- pending line can never encode the same as a settled one.
  select md5(
    coalesce((
      select string_agg(row(v.id, v.type, v.resolved, v.minutes_late, v.actual_finish_at,
                            v.resolved_by, v.resolution_note)::text, ',' order by v.id)
        from violations v
        join bookings b            on b.id = v.booking_id
        join shift_requirements sr on sr.id = b.shift_id
       where sr.event_id = p_event), '')
    || '|' ||
    coalesce((
      select string_agg(row(l.booking_id, l.kind, l.status, l.check_in_at, l.check_out_at,
                            l.unpaid_break_min, l.payable_min, l.charge_rate, l.invoicing)::text,
                        ',' order by l.booking_id)
        from report_payroll_lines_v l
       where l.event_id = p_event), ''))
$$;

comment on function public.invoice_event_fingerprint(uuid) is
  'ADR-0168: md5 over every violation (id, type, resolved, minutes late, finish, resolver, note) and every shift line (booking, kind, status, check-in, check-out, break, payable minutes, charge rate, amount) of an event. A sign-off stores it; a different value later means something changed. Internal: called from the definer functions below, which run it as the owner.';

revoke execute on function public.invoice_event_fingerprint(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3 · The list
-- ---------------------------------------------------------------------
create or replace function public.invoice_events(p_from date, p_to date)
returns table (
  event_id           uuid,
  event_date         date,
  event_title        text,
  client_name        text,
  po_number          text,
  venue_name         text,
  cancelled          boolean,
  last_end_at        timestamptz,
  check_out_closes_at timestamptz,
  shifts             int,
  billable_shifts    int,
  pending            int,
  no_shows           int,
  turned_away        int,
  payable_min        int,
  invoicing          numeric,
  violations         int,
  unresolved         int,
  no_checkouts       int,
  status             text,
  fingerprint        text,
  signed_off_at      timestamptz,
  signed_off_by_name text,
  signoff_note       text,
  signed_invoicing   numeric,
  signoff_stale      boolean
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  perform assert_finance_caller();
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'bad_range' using errcode = '22023';
  end if;

  return query
  with ev as (
    select e.id, e.event_date, e.title, c.name as client_name, e.po_number, e.venue_name,
           e.cancelled_at is not null as cancelled,
           (select max(sr.ends_at) from shift_requirements sr where sr.event_id = e.id) as last_end_at
      from events e
      join clients c on c.id = e.client_id
     where e.event_date between p_from and p_to
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
     -- = any(array(...)) is an init-plan parameter, so the filter reaches
     -- the bookings under the security-barrier view; `in (select …)` is a
     -- join, and the view would be computed for every booking ever made.
     where l.event_id = any (array(select id from ev))
     group by l.event_id
  ),
  viol as (
    select sr.event_id,
           count(*)::int                             as violations,
           count(*) filter (where not v.resolved)::int as unresolved,
           count(*) filter (where not v.resolved and v.type = 'no_checkout')::int
                                                     as no_checkouts
      from violations v
      join bookings b            on b.id = v.booking_id
      join shift_requirements sr on sr.id = b.shift_id
     where sr.event_id in (select id from ev)
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
           s.fingerprint as signed_fp
      from ev
      -- An event with no line (cancelled before its day, nobody confirmed)
      -- has nothing to invoice and is not listed.
      join lines li                     on li.event_id = ev.id
      left join viol vi                 on vi.event_id = ev.id
      left join event_invoice_signoffs s on s.event_id = ev.id
      left join profiles p              on p.id = s.signed_off_by
  )
  select x.id, x.event_date, x.title, x.client_name, x.po_number, x.venue_name, x.cancelled,
         x.last_end_at, x.closes_at,
         x.shifts, x.billable_shifts, x.pending, x.no_shows, x.turned_away,
         x.payable_min, x.invoicing, x.violations, x.unresolved, x.no_checkouts,
         case when now() < x.closes_at          then 'open'
              when x.pending > 0 or x.no_checkouts > 0 then 'missing'
              when x.signed_fp is distinct from x.fp then 'review'
              else 'ready' end,
         x.fp,
         x.signed_off_at, x.signer, x.note, x.signed_invoicing,
         (x.signed_fp is not null and x.signed_fp <> x.fp)
    from x
   order by x.event_date, x.client_name, x.title, x.id;
end $$;

comment on function public.invoice_events(date, date) is
  'ADR-0168: one row per event dated in the range that has shift lines, with its invoice amount (report_payroll_lines_v.invoicing), counts, violations and status: open (check-out window not closed) → missing (a pending line, or any unresolved No check-out, including a stale-fix one with a recorded finish) → review (not signed off, or changed since) → ready. Finance callers only.';

revoke execute on function public.invoice_events(date, date) from public, anon;
grant execute on function public.invoice_events(date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4 · The event's lines
-- ---------------------------------------------------------------------
create or replace function public.invoice_event_lines(p_event uuid)
returns table (
  booking_id       uuid,
  staff_name       text,
  employee_id      int,
  removed          boolean,
  role_name        text,
  shift_date       date,
  starts_at        timestamptz,
  ends_at          timestamptz,
  check_in_at      timestamptz,
  check_out_at     timestamptz,
  kind             text,
  status           text,
  late_check_in    boolean,
  early_check_out  boolean,
  no_check_out_unresolved boolean,
  unpaid_break_min int,
  payable_min      int,
  floor_applied    boolean,
  charge_rate      numeric,
  invoicing        numeric
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  perform assert_finance_caller();
  return query
  select l.booking_id, l.staff_name, l.employee_id, l.removed, l.role_name, l.shift_date,
         l.starts_at, l.ends_at, l.check_in_at, l.check_out_at, l.kind, l.status,
         l.late_check_in, l.early_check_out, l.no_check_out_unresolved, l.unpaid_break_min,
         case when l.status = 'settled' then l.payable_min end,
         l.floor_applied, l.charge_rate, l.invoicing
    from report_payroll_lines_v l
   where l.event_id = p_event
   -- §11.3's order: by role section, then surname.
   order by l.starts_at, l.role_name, l.removed, l.sort_surname nulls last, l.staff_name, l.booking_id;
end $$;

comment on function public.invoice_event_lines(uuid) is
  'ADR-0168: every shift line of one event with payable minutes, charge rate and invoice amount (report_payroll_lines_v); pending lines carry no amount. Finance callers only.';

revoke execute on function public.invoice_event_lines(uuid) from public, anon;
grant execute on function public.invoice_event_lines(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5 · The event's violations — what the manager reviews
-- ---------------------------------------------------------------------
create or replace function public.invoice_event_violations(p_event uuid)
returns table (
  violation_id     uuid,
  booking_id       uuid,
  staff_name       text,
  employee_id      int,
  role_name        text,
  type             text,
  detected_at      timestamptz,
  minutes_late     int,
  resolved         boolean,
  resolved_at      timestamptz,
  resolved_by_name text,
  resolution_note  text,
  actual_finish_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  perform assert_finance_caller();
  return query
  select v.id, v.booking_id,
         case when st.removed_at is null then st.first_name || ' ' || st.last_name
              else deleted_account_label(st.employee_id) end,
         st.employee_id, r.name, v.type::text, v.detected_at, v.minutes_late,
         v.resolved, v.resolved_at, p.full_name, v.resolution_note, v.actual_finish_at
    from violations v
    join bookings b            on b.id = v.booking_id
    join shift_requirements sr on sr.id = b.shift_id
    join roles r               on r.id = sr.role_id
    join staff st              on st.id = v.staff_id
    left join profiles p       on p.id = v.resolved_by
   where sr.event_id = p_event
   order by v.resolved, v.detected_at, v.id;
end $$;

comment on function public.invoice_event_violations(uuid) is
  'ADR-0168: every violation on one event, unresolved first, with who resolved it and their note — the list a manager reviews before signing the event off for invoicing. Finance callers only.';

revoke execute on function public.invoice_event_violations(uuid) from public, anon;
grant execute on function public.invoice_event_violations(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6 · The sign-off
-- ---------------------------------------------------------------------
-- p_fingerprint is the one the manager's screen showed: if anything
-- changed between reading the event and pressing the button, the sign-off
-- is refused rather than vouching for figures nobody looked at.
create or replace function public.sign_off_event_invoice(p_event uuid, p_note text, p_fingerprint text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
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

  -- The list's own verdict, so the two can never disagree.
  select i.* into v_row
    from invoice_events(v_date, v_date) i
   where i.event_id = p_event;
  if not found then
    raise exception 'nothing_to_invoice' using errcode = 'P0001';
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
     set signed_off_by = excluded.signed_off_by,
         signed_off_at = excluded.signed_off_at,
         note          = excluded.note,
         fingerprint   = excluded.fingerprint,
         invoicing     = excluded.invoicing,
         payable_min   = excluded.payable_min;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'invoice.signed_off', 'event', p_event,
          jsonb_build_object('note',        btrim(p_note),
                             'invoicing',   v_row.invoicing,
                             'payableMin',  v_row.payable_min,
                             'violations',  v_row.violations,
                             'unresolved',  v_row.unresolved,
                             'fingerprint', v_row.fingerprint));

  return jsonb_build_object('decision', 'signed_off',
                            'invoicing', v_row.invoicing,
                            'payableMin', v_row.payable_min);
end $$;

comment on function public.sign_off_event_invoice(uuid, text, text) is
  'ADR-0168: a manager signs an event off for invoicing, with a mandatory note, once its check-out window has closed and no No check-out is unresolved, and only for the figures they saw (the fingerprint). Re-signing replaces the sign-off; each one is written to audit_log as invoice.signed_off. Owners and managers.';

revoke execute on function public.sign_off_event_invoice(uuid, text, text) from public, anon;
grant execute on function public.sign_off_event_invoice(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7 · The export — only what is ready
-- ---------------------------------------------------------------------
-- One row per BILLABLE shift (worked, or cancelled on the day) of every
-- event in the range whose status is `ready`, or of one event when
-- p_event is given. An event that is not ready contributes nothing: the
-- CSV is what may be keyed into the accounting tool, nothing more.
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
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  perform assert_finance_caller();
  return query
  with ready as (
    select i.* from invoice_events(p_from, p_to) i
     where i.status = 'ready'
       and (p_event is null or i.event_id = p_event)
  )
  select i.event_id, i.event_date, i.event_title, i.client_name, i.po_number,
         l.booking_id, l.employee_id, l.staff_name, l.role_name, l.shift_date,
         l.starts_at, l.ends_at, l.check_in_at, l.check_out_at, l.kind,
         l.unpaid_break_min, l.payable_min, l.charge_rate, l.invoicing
    from ready i
    join report_payroll_lines_v l on l.event_id = i.event_id
   -- The same init-plan filter as invoice_events (see there).
   where l.event_id = any (array(select event_id from ready))
     and l.kind in ('worked', 'cancelled_on_day')
   order by i.event_date, i.client_name, i.event_title, i.event_id,
            l.starts_at, l.role_name, l.removed, l.sort_surname nulls last, l.staff_name, l.booking_id;
end $$;

comment on function public.invoice_export_rows(date, date, uuid) is
  'ADR-0168: the invoicing CSV — one row per billable shift (worked or cancelled on the day) of every READY event in the range, or of one event. Events not ready contribute nothing. Finance callers only.';

revoke execute on function public.invoice_export_rows(date, date, uuid) from public, anon;
grant execute on function public.invoice_export_rows(date, date, uuid) to authenticated, service_role;
