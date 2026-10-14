-- =====================================================================
-- Migration 20261014170200 · two emails to the customer about their
--                            line-up (§8, §11.4, §3.2; ADR-0020,
--                            ADR-0074, ADR-0088, ADR-0089, ADR-0135 §3)
--
-- The product owner, 14.10.2026 ("Request again / notifications", P3 in
-- docs/20 Part B). Two new register emails to the customer's contacts:
--
--   CP2 · "Line-up fully confirmed" — once per event, when every role
--         section of an UPCOMING event holds its headcount of confirmed
--         workers (the count the portal shows: confirmed or worked, held
--         to the headcount — never a buffer number).
--   CP3 · "Line-up changed after your Allocation Timesheet was sent" —
--         when a confirmed worker leaves the line-up (withdrawn,
--         cancelled, released) or a new one is confirmed, on an upcoming
--         event whose Allocation Timesheet (D1) has already been queued
--         (event_documents kind 'allocation' with queued_at, by the office
--         or the automatic send — ADR-0074/0088).
--
-- Who receives them: the event's timesheet recipients —
-- coalesce(events.document_recipients, clients.contact_emails), the rule
-- of event_document_recipients() (ADR-0089), written inline. A Client
-- Portal login is NOT a recipient unless its address is on that list.
--
-- When:
--   · never between 23:00 and 07:00 UK: a send that would fall there is
--     queued for 07:00 UK (client_email_send_time);
--   · CP3 is debounced to one email per event per hour: a change is sent
--     at the top of the next hour (then the quiet-hours rule), and every
--     change before then refreshes that one queued row, so the email says
--     where the line-up stands when it goes. The key is the send time —
--     `CP3:event:<id>:<send epoch>` — so two changes in one hour, or a
--     night of changes, are one email;
--   · CP2's key is `CP2:event:<id>`: once per event, ever. If the line-up
--     drops below full before the queued row is sent, the row is
--     withdrawn (failed_at + "withdrawn: …") and revived when it is full
--     again, so the customer is never told "fully confirmed" about a
--     line-up that is not;
--   · nothing is queued whose send time would be at or after the event's
--     first start (the customer is on site; the office phones), nothing
--     for a cancelled event, and cancelling an event withdraws whatever is
--     still queued for it.
--
-- Per-client switches, both ON by default, set on the client card:
-- clients.lineup_confirmed_emails / lineup_changed_emails, through
-- set_client_lineup_emails() (admin only, audited client.lineup_emails).
-- The global /settings → Notifications switch still applies to each code
-- (claim_outbox_batch). client_account_v shows the customer which of the
-- two they receive (read-only).
--
-- The payload is values only — event title, UK date and window, venue,
-- one line per role section "Role · 17:00–23:30 · N of M confirmed", and
-- the event id, from which the drain builds the Client Portal link
-- (CLIENT_PORTAL_URL, packages/notifications). No money, no names.
--
-- Everything is decided in the database by triggers on bookings,
-- shift_requirements and events, through one function that takes its
-- clock as a parameter (client_lineup_notices, internal), so pgTAP can
-- hold the quiet hours and the debounce. A failure there is logged as a
-- WARNING and never blocks the booking change that triggered it.
--
-- Forward-only. 833_client_lineup_emails pins it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The per-client switches
-- ---------------------------------------------------------------------
alter table clients
  add column if not exists lineup_confirmed_emails boolean not null default true,
  add column if not exists lineup_changed_emails   boolean not null default true;

comment on column clients.lineup_confirmed_emails is
  'ADR-0135 §3: CP2 "Line-up fully confirmed" goes to this client''s timesheet recipients. On by default; set on the client card (set_client_lineup_emails).';
comment on column clients.lineup_changed_emails is
  'ADR-0135 §3: CP3 "Line-up changed after your Allocation Timesheet was sent" goes to this client''s timesheet recipients. On by default; set on the client card (set_client_lineup_emails).';

create or replace function public.set_client_lineup_emails(p_client uuid, p_kind text, p_on boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_was boolean;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'admins_only' using errcode = '42501';
  end if;
  if p_on is null then
    raise exception 'lineup_emails_must_be_on_or_off' using errcode = '22004';
  end if;
  if p_kind is null or p_kind not in ('confirmed', 'changed') then
    raise exception 'unknown_lineup_email' using errcode = '22023';
  end if;

  select case p_kind when 'confirmed' then lineup_confirmed_emails else lineup_changed_emails end
    into v_was
    from clients where id = p_client for update;
  if not found then
    raise exception 'unknown_client' using errcode = 'P0002';
  end if;
  if v_was = p_on then return; end if;

  -- A viewer (ADR-0060) is refused here by the office_read_only trigger.
  if p_kind = 'confirmed' then
    update clients set lineup_confirmed_emails = p_on where id = p_client;
  else
    update clients set lineup_changed_emails = p_on where id = p_client;
  end if;

  -- Off means off from now: a queued, unsent email of that kind goes too.
  if not p_on then
    update notification_outbox o
       set failed_at = now(),
           error     = 'withdrawn: switched off on the client card'
     where o.template = case p_kind when 'confirmed' then 'CP2' else 'CP3' end
       and o.sent_at is null and o.failed_at is null
       and o.payload ->> 'eventId' in (select e.id::text from events e where e.client_id = p_client);
  end if;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'client.lineup_emails', 'client', p_client,
          jsonb_build_object('email', p_kind, 'from', v_was, 'to', p_on));
end $$;

comment on function public.set_client_lineup_emails(uuid, text, boolean) is
  'ADR-0135 §3: the client card''s two line-up email switches — ''confirmed'' (CP2) and ''changed'' (CP3). Office only; a viewer is refused by the read-only guard. Audited as client.lineup_emails.';

revoke all on function public.set_client_lineup_emails(uuid, text, boolean) from public, anon;
grant execute on function public.set_client_lineup_emails(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 2 · Quiet hours: 23:00–07:00 UK goes at 07:00 UK
-- ---------------------------------------------------------------------
create or replace function public.client_email_send_time(p_at timestamptz)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select case
           when (p_at at time zone 'Europe/London')::time >= time '23:00'
             then (((p_at at time zone 'Europe/London')::date + 1) + time '07:00') at time zone 'Europe/London'
           when (p_at at time zone 'Europe/London')::time < time '07:00'
             then (((p_at at time zone 'Europe/London')::date) + time '07:00') at time zone 'Europe/London'
           else p_at
         end
$$;

comment on function public.client_email_send_time(timestamptz) is
  'ADR-0135 §3: when a customer email due at p_at may go — p_at itself between 07:00 and 23:00 UK, otherwise 07:00 UK the next morning (or the same morning before 07:00).';

revoke all on function public.client_email_send_time(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3 · The decision: client_lineup_notices(event, change?, now)
-- ---------------------------------------------------------------------
create or replace function public.client_lineup_notices(
  p_event  uuid,
  p_change boolean default false,
  p_now    timestamptz default now()
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title      text;
  v_venue      text;
  v_cancelled  timestamptz;
  v_client     uuid;
  v_recipients text[];
  v_on_full    boolean;
  v_on_change  boolean;
  v_starts     timestamptz;
  v_ends       timestamptz;
  v_sections   int;
  v_full       boolean;
  v_lines      text;
  v_payload    jsonb;
  v_send       timestamptz;
  v_d1         boolean;
begin
  select e.title, e.venue_name, e.cancelled_at, e.client_id,
         coalesce(e.document_recipients, c.contact_emails),
         c.lineup_confirmed_emails, c.lineup_changed_emails,
         w.starts_at, w.ends_at
    into v_title, v_venue, v_cancelled, v_client, v_recipients,
         v_on_full, v_on_change, v_starts, v_ends
    from events e
    join clients c        on c.id = e.client_id
    join event_windows w  on w.event_id = e.id
   where e.id = p_event;

  -- Upcoming, not cancelled, with somebody to tell.
  if not found or v_cancelled is not null or v_starts is null or p_now >= v_starts
     or coalesce(cardinality(v_recipients), 0) = 0 then
    return;
  end if;

  -- Each section's fill as the portal counts it: confirmed or worked,
  -- held to the headcount (client_role_sections_v). Never the buffer.
  select count(*)::int,
         coalesce(bool_and(s.filled >= s.headcount), false),
         string_agg(s.line, E'\n' order by s.starts_at, s.role, s.id)
    into v_sections, v_full, v_lines
    from (
      select sr.id, sr.starts_at, r.name as role, sr.headcount,
             least((select count(*) from bookings b
                     where b.shift_id = sr.id and b.status in ('confirmed', 'worked')),
                   sr.headcount)::int as filled,
             r.name || ' · '
               || to_char(sr.starts_at at time zone 'Europe/London', 'HH24:MI') || '–'
               || to_char(sr.ends_at   at time zone 'Europe/London', 'HH24:MI') || ' · '
               || least((select count(*) from bookings b
                          where b.shift_id = sr.id and b.status in ('confirmed', 'worked')),
                        sr.headcount)::int
               || ' of ' || sr.headcount || ' confirmed' as line
        from shift_requirements sr
        join roles r on r.id = sr.role_id
       where sr.event_id = p_event
    ) s;

  if v_sections = 0 then
    return;
  end if;

  v_payload := jsonb_build_object(
    'eventId',  p_event::text,
    'event',    v_title,
    'date',     to_char(v_starts at time zone 'Europe/London', 'Dy DD Mon YYYY'),
    'time',     to_char(v_starts at time zone 'Europe/London', 'HH24:MI') || '–'
                  || to_char(v_ends at time zone 'Europe/London', 'HH24:MI'),
    'venue',    coalesce(v_venue, '—'),
    'sections', v_lines);

  -- -------------------------------------------------------------------
  -- CP2 · fully confirmed, once per event
  -- -------------------------------------------------------------------
  if v_on_full and v_full then
    v_send := client_email_send_time(p_now);
    if v_send < v_starts then
      insert into notification_outbox (key, channel, template, recipient_emails, payload, send_after)
      values ('CP2:event:' || p_event::text, 'email', 'CP2', v_recipients, v_payload, v_send)
      on conflict (key) do update
         set payload          = excluded.payload,
             recipient_emails = excluded.recipient_emails,
             -- A withdrawn row comes back with the new send time; a queued
             -- one keeps its own.
             send_after       = case when notification_outbox.failed_at is not null
                                     then excluded.send_after
                                     else notification_outbox.send_after end,
             failed_at        = null,
             error            = null
       where notification_outbox.sent_at is null
         and (notification_outbox.failed_at is null
              or notification_outbox.error like 'withdrawn:%');
    end if;
  elsif not v_full then
    -- Not full any more and not sent yet: never tell them it is.
    update notification_outbox
       set failed_at = p_now,
           error     = 'withdrawn: the line-up is no longer fully confirmed'
     where key = 'CP2:event:' || p_event::text
       and sent_at is null and failed_at is null;
  end if;

  -- -------------------------------------------------------------------
  -- CP3 · changed after the Allocation Timesheet went, one an hour
  -- -------------------------------------------------------------------
  if p_change and v_on_change then
    select exists (select 1 from event_documents d
                    where d.event_id = p_event and d.kind = 'allocation'
                      and d.queued_at is not null and d.queued_at <= p_now)
      into v_d1;
    if v_d1 then
      v_send := client_email_send_time(date_trunc('hour', p_now) + interval '1 hour');
      if v_send < v_starts then
        insert into notification_outbox (key, channel, template, recipient_emails, payload, send_after)
        values ('CP3:event:' || p_event::text || ':' || extract(epoch from v_send)::bigint::text,
                'email', 'CP3', v_recipients, v_payload, v_send)
        on conflict (key) do update
           set payload          = excluded.payload,
               recipient_emails = excluded.recipient_emails
         where notification_outbox.sent_at is null
           and notification_outbox.failed_at is null;
      end if;
    end if;
  end if;
end $$;

comment on function public.client_lineup_notices(uuid, boolean, timestamptz) is
  'ADR-0135 §3: decides the two customer line-up emails for one event at p_now — CP2 "fully confirmed" (once per event; withdrawn while unsent if the line-up drops below full) and, when p_change, CP3 "changed after the Allocation Timesheet was sent" (one per event per hour, at the top of the next hour) — to coalesce(events.document_recipients, clients.contact_emails), never between 23:00 and 07:00 UK, never for a cancelled or started event, each behind its client card switch. Internal: called by the triggers on bookings and shift_requirements.';

revoke all on function public.client_lineup_notices(uuid, boolean, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4 · The triggers
-- ---------------------------------------------------------------------
create or replace function public.bookings_client_lineup_notices()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_on boolean := tg_op = 'UPDATE' and old.status in ('confirmed', 'worked');
  v_is_on  boolean := new.status in ('confirmed', 'worked');
  v_event  uuid;
begin
  -- Worked from confirmed is the day's end, not a change of who is coming.
  if v_was_on = v_is_on then
    return null;
  end if;
  select sr.event_id into v_event from shift_requirements sr where sr.id = new.shift_id;
  if v_event is null then
    return null;
  end if;
  begin
    perform client_lineup_notices(v_event, true, now());
  exception when others then
    raise warning 'client_lineup_notices(%) failed: % (%)', v_event, sqlerrm, sqlstate;
  end;
  return null;
end $$;

revoke all on function public.bookings_client_lineup_notices() from public, anon, authenticated;

drop trigger if exists bookings_client_lineup_notices on bookings;
create trigger bookings_client_lineup_notices
  after insert or update of status on bookings
  for each row execute function public.bookings_client_lineup_notices();

-- A headcount lowered, a section added or removed: "fully confirmed" may
-- start or stop being true. Not a change of who is coming, so no CP3.
create or replace function public.shift_requirements_client_lineup_notices()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event uuid := case when tg_op = 'DELETE' then old.event_id else new.event_id end;
begin
  if tg_op = 'UPDATE' and old.headcount is not distinct from new.headcount then
    return null;
  end if;
  begin
    perform client_lineup_notices(v_event, false, now());
  exception when others then
    raise warning 'client_lineup_notices(%) failed: % (%)', v_event, sqlerrm, sqlstate;
  end;
  return null;
end $$;

revoke all on function public.shift_requirements_client_lineup_notices() from public, anon, authenticated;

drop trigger if exists shift_requirements_client_lineup_notices on shift_requirements;
create trigger shift_requirements_client_lineup_notices
  after insert or update of headcount or delete on shift_requirements
  for each row execute function public.shift_requirements_client_lineup_notices();

-- Cancelling an event withdraws whatever is still queued for its customer.
create or replace function public.events_client_lineup_withdraw()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.cancelled_at is null and new.cancelled_at is not null then
    update notification_outbox
       set failed_at = now(),
           error     = 'withdrawn: the event was cancelled'
     where template in ('CP2', 'CP3')
       and payload ->> 'eventId' = new.id::text
       and sent_at is null and failed_at is null;
  end if;
  return null;
end $$;

revoke all on function public.events_client_lineup_withdraw() from public, anon, authenticated;

drop trigger if exists events_client_lineup_withdraw on events;
create trigger events_client_lineup_withdraw
  after update of cancelled_at on events
  for each row execute function public.events_client_lineup_withdraw();

-- ---------------------------------------------------------------------
-- 5 · "Your account" says which of the two the customer receives
--     (20261001100000's body with the two switches appended).
-- ---------------------------------------------------------------------
create or replace view client_account_v with (security_barrier = true) as
  select c.name,
         c.contact_emails,
         c.lineup_confirmed_emails,
         c.lineup_changed_emails
    from clients c
   where c.id = current_client_id()
     and client_portal_visible(c.id);

comment on view client_account_v is
  'The signed-in customer''s own company name, the addresses THC emails its allocation sheet and signed timesheet to (§9.7, §11.4), and whether its line-up emails are on (CP2 lineup_confirmed_emails, CP3 lineup_changed_emails — ADR-0135 §3), for the Client Portal''s Your account page (ADR-0051). Owner rights + current_client_id() + client_portal_visible() per ADR-0004: the client role holds no policy on clients and must not be given one. One row for a client user, none for anybody else. Read-only; no terms, no phone, no money, nothing about workers.';

revoke all on client_account_v from public, anon, authenticated;
grant select on client_account_v to authenticated;
