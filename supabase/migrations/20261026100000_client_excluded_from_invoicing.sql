-- =====================================================================
-- Migration 20261026100000 · a client can be left out of invoicing
--                            (ADR-0203)
--
-- THC (23.10.2026): "Can Leonardo Hotel St Paul's M+E be excluded from the
-- invoicing system". THC invoices that client outside the platform.
--
-- clients.exclude_from_invoicing: when true, none of that client's events
-- is listed on Ready to invoice, signed off, exported to the invoicing CSV
-- or issued as an invoice by the daily job. Invoicing only: payroll,
-- worker pay, the Financial tab and the reports are untouched (an event
-- still costs and earns what it did; the platform just never bills it).
--
--   set_client_exclude_from_invoicing(client, on)   admin; audited
--   invoice_events / _invoice_groups                skip an excluded client
--   (invoice_export_rows, sign_off_event_invoice and the invoices' own
--   email step read invoice_events, so they follow.)
--
-- An event that is ALREADY on an invoice stays listed as invoiced: only
-- un-invoiced events are left out, so no issued invoice disappears.
--
-- Switched on for the client card named Leonardo Hotel St Paul's M&E,
-- matched like ADR-0081 (punctuation and spaces ignored). Forward-only.
-- =====================================================================

alter table public.clients
  add column if not exists exclude_from_invoicing boolean not null default false;

comment on column public.clients.exclude_from_invoicing is
  'ADR-0203: true when THC invoices this client outside the platform. The client''s un-invoiced events are not listed on Ready to invoice, not exported and not issued as an invoice. Payroll and reports are unaffected. Set through set_client_exclude_from_invoicing().';

create or replace function public.set_client_exclude_from_invoicing(p_client uuid, p_on boolean)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_was boolean;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'admins_only' using errcode = '42501';
  end if;
  if p_on is null then
    raise exception 'exclude_from_invoicing_must_be_on_or_off' using errcode = '22004';
  end if;

  select exclude_from_invoicing into v_was from clients where id = p_client for update;
  if not found then
    raise exception 'No client %', p_client using errcode = 'no_data_found';
  end if;
  if v_was = p_on then return; end if;

  update clients set exclude_from_invoicing = p_on where id = p_client;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'client.exclude_from_invoicing', 'client', p_client,
          jsonb_build_object('from', v_was, 'to', p_on));
end $$;

comment on function public.set_client_exclude_from_invoicing(uuid, boolean) is
  'ADR-0203: leave a client out of invoicing (or put it back). Admin only; a viewer is refused by the read-only guard on clients. Audited as client.exclude_from_invoicing.';

revoke all on function public.set_client_exclude_from_invoicing(uuid, boolean) from public, anon;
grant execute on function public.set_client_exclude_from_invoicing(uuid, boolean) to authenticated;

do $$
declare
  v_count int;
begin
  update clients set exclude_from_invoicing = true
   where regexp_replace(lower(name), '[^a-z0-9]', '', 'g')
         in ('leonardohotelstpaulsmande', 'leonardohotelstpaulsme');
  get diagnostics v_count = row_count;
  raise notice 'excluded from invoicing: % client card(s) named Leonardo Hotel St Paul''s M&E', v_count;
end $$;

-- ---------------------------------------------------------------------
-- _invoice_groups — the job's candidates skip an excluded client
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
  -- Off in either place, nothing is issued: a number is never taken for an
  -- email claim_outbox_batch() would fail as switched off.
  v_on    boolean := (cfg ->> 'enabled')::boolean and notification_switched_on('INV1');
  v_ids   uuid[];
begin
  -- Candidates: on or after go-live, not on an invoice, not cancelled before
  -- their day, and not further ahead than a PO window could reach.
  select array_agg(e.id) into v_ids
    from events e
   where e.event_date >= v_first
     and e.event_date <= (p_now at time zone 'Europe/London')::date + v_win
     and not exists (select 1 from invoice_event_links k where k.event_id = e.id)
     and not exists (select 1 from clients xc where xc.id = e.client_id and xc.exclude_from_invoicing)
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
  -- finished one with something to charge or a check-out still to settle.
  -- A finished event with nothing to charge (nobody worked) is not
  -- invoiced and holds nothing, and an event with no section at all never
  -- finishes, so it is not a member.
  member as (
    select f.id, f.client_id, f.event_date, f.po, f.finished, r.status, r.invoicing,
           f.client_id::text || ':' || coalesce('po:' || upper(f.po), 'event:' || f.id::text) as pkey
      from fin f
      left join evr r on r.event_id = f.id
     where f.last_end is not null
       and (not f.finished or coalesce(r.invoicing, 0) > 0 or coalesce(r.pending, 0) > 0)
  ),
  anchored as (
    select m.*, min(m.event_date) over (partition by m.pkey) as anchor
      from member m
  ),
  -- A PO is cut into consecutive po_window_days windows from its earliest
  -- un-invoiced event, each its own invoice: an event the office has not
  -- signed off holds only its own window, never the PO's later dates.
  win as (
    select a.*,
           case when a.po is null then a.pkey
                else a.pkey || ':' || (a.anchor + ((a.event_date - a.anchor) / v_win) * v_win)::text
           end as gkey
      from anchored a
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
  'ADR-0176/0203: the invoices waiting to be issued at p_now — one per (client, PO, po_window_days window counted from its earliest un-invoiced event), or per event without a PO — with the events, the send time (10:00 UK the morning after the last), the net and the verdict: disabled (invoicing or INV1 switched off), waiting (an event still running or inside its check-out window), missing, review, nothing_to_invoice, scheduled, no_recipients, due. A client with exclude_from_invoicing is never a candidate. Internal.';
revoke execute on function public._invoice_groups(timestamptz) from public, anon, authenticated;
grant execute on function public._invoice_groups(timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- invoice_events — the list, minus an excluded client's un-invoiced events
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
  invoice_attempts    int,
  invoice_last_error  text,
  email_sent_at       timestamptz,
  email_failed_at     timestamptz,
  email_error         text,
  invoiced_amount     numeric,
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
         r.invoice_attempts, r.invoice_last_error, r.email_sent_at, r.email_failed_at, r.email_error,
         r.invoiced_amount, ge.due_at, ge.verdict
    from _invoice_event_rows(
           array(select e.id from events e
                  where e.event_date between p_from and p_to
                    and (not exists (select 1 from clients xc
                                      where xc.id = e.client_id and xc.exclude_from_invoicing)
                         or exists (select 1 from invoice_event_links k where k.event_id = e.id))),
           now()) r
    left join ge on ge.event_id = r.event_id
   order by r.event_date, r.client_name, r.event_title, r.event_id;
end $$;

comment on function public.invoice_events(date, date) is
  'ADR-0172/0176/0203: one row per event dated in the range that has shift lines, priced, with its status (invoiced → open → missing → ready / review), its invoice once issued, and — while it waits — when its PO''s invoice is due to send and why it waits. A client with exclude_from_invoicing contributes only events already on an invoice. Finance callers only.';
revoke execute on function public.invoice_events(date, date) from public, anon;
grant execute on function public.invoice_events(date, date) to authenticated, service_role;
