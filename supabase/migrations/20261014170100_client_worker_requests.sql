-- =====================================================================
-- Migration 20261014170100 · "Request this person again" (§11.2, §9.7,
--                            §8; ADR-0004, ADR-0026, ADR-0020,
--                            ADR-0135 §2)
--
-- The product owner, 14.10.2026 ("Request again / notifications", P1 in
-- docs/20 Part B): on a finished event the customer can ask THC for a
-- worker again, with an optional note. It is a MESSAGE to THC, never a
-- booking: nothing here writes bookings, client_qualifications or any
-- staffing state.
--
-- 1 · client_worker_requests — one row per request.
--       client_id, staff_id     who asked for whom (the staff id never
--                               leaves the database towards the client)
--       booking_id, event_id    the line-up row it was asked from
--       note                    the customer's words, at most 500
--       requested_by(_name)     the portal login, and its name as it was
--       handled_at / handled_by the office's "Mark handled"
--     At most one OPEN request per client and worker (a partial unique
--     index). RLS on, admin_read for the office, NO client or staff
--     policy (ADR-0026 — 001_rls_guard pins the client set empty); the
--     office_read_only guard (ADR-0060). Written only by the two
--     functions below.
--
-- 2 · client_request_worker(p_booking_id, p_note) — the portal's call.
--     SECURITY DEFINER, authenticated only; refuses, in order:
--       · anyone but a client login (42501);
--       · a note over 500 characters (22023 request_note_too_long);
--       · a booking that is not on the caller's visible line-up — read
--         from client_lineup_v itself, so tenancy, the confirmed status
--         and ADR-0134's headcount trim are the view's own rules, and a
--         buffer worker the customer never saw cannot be asked for — or
--         on a cancelled event: one sentence for all of them (42501);
--       · an event that has not finished (22023 request_after_event);
--       · a GDPR-removed worker (§1.7, 22023 worker_removed);
--     then answers an open request for the same worker with
--     {already: true} (no new row, no new email), refuses a 21st request
--     from the same client inside 24 hours (P0001 request_limit_reached),
--     inserts one row and queues CP1 — one office email, key
--     `CP1:request:<id>` — through notification_outbox.
--
-- 3 · mark_client_worker_request_handled(p_id) — the office's button on
--     the client card. Admin only; a viewer is refused by the read-only
--     guard. Idempotent. Audited by a trigger (the 20261014093200
--     pattern): `client.worker_request_handled`, filed under the client,
--     ids only in `data`.
--
-- 4 · client_worker_requests_v — the customer's OPEN requests, for
--     "Feedback you've given" (/client/feedback). Owner rights,
--     security_barrier, client_portal_visible() in its own body, named
--     columns, SELECT to authenticated only (ADR-0004). The worker's name
--     reads "Deleted account #id" once removed, and the note is withheld
--     then (as feedback_text is, ADR-0134 N4). No staff id.
--
-- 5 · client_lineup_v.worker_requested — true when the customer has an
--     open request for that worker, so every row of theirs reads
--     "✓ Requested". Body restated from 20261014170000 with the column
--     appended.
--
-- 6 · clients_worker_requests_v — the office's read for the client card:
--     security_invoker (the admin's own policies apply), worker name and
--     employee id, event, role, note, who asked and when, handled.
--
-- Forward-only. 832_client_worker_requests pins it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The table
-- ---------------------------------------------------------------------
create table if not exists client_worker_requests (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references clients(id),
  staff_id          uuid not null references staff(id),
  booking_id        uuid references bookings(id) on delete set null,
  event_id          uuid references events(id) on delete set null,
  note              text check (note is null or (char_length(note) between 1 and 500)),
  requested_by      uuid references profiles(id) on delete set null,
  requested_by_name text,
  created_at        timestamptz not null default now(),
  handled_at        timestamptz,
  handled_by        uuid references profiles(id) on delete set null
);

comment on table client_worker_requests is
  'ADR-0135 §2: "Request this person again" from the Client Portal — a message to THC, never a booking. One open request per client and worker. Written only by client_request_worker() and mark_client_worker_request_handled(); admin_read; no client or staff policy (ADR-0026).';

create unique index if not exists client_worker_requests_one_open
  on client_worker_requests (client_id, staff_id) where handled_at is null;
create index if not exists client_worker_requests_client_created
  on client_worker_requests (client_id, created_at desc);
create index if not exists client_worker_requests_staff_id_idx on client_worker_requests (staff_id);
create index if not exists client_worker_requests_booking_id_idx on client_worker_requests (booking_id);
create index if not exists client_worker_requests_event_id_idx on client_worker_requests (event_id);
create index if not exists client_worker_requests_requested_by_idx on client_worker_requests (requested_by);
create index if not exists client_worker_requests_handled_by_idx on client_worker_requests (handled_by);

alter table client_worker_requests enable row level security;

drop policy if exists admin_read on client_worker_requests;
create policy admin_read on client_worker_requests
  for select using ((select current_app_role()) = 'admin');

drop trigger if exists office_read_only on public.client_worker_requests;
create trigger office_read_only before insert or update or delete or truncate
  on public.client_worker_requests
  for each statement execute function public.office_read_only_guard();

revoke all on client_worker_requests from public, anon, authenticated;
grant select on client_worker_requests to authenticated;
grant all on client_worker_requests to service_role;

-- ---------------------------------------------------------------------
-- 3a · The audit trigger (20261014093200's pattern): a person's edit only.
-- ---------------------------------------------------------------------
create or replace function public.audit_client_worker_request_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.handled_at is null and new.handled_at is not null then
    insert into audit_log (actor, action, entity, entity_id, data)
    values (auth.uid(), 'client.worker_request_handled', 'client', new.client_id,
            jsonb_build_object('requestId', new.id::text,
                               'staffId', new.staff_id::text,
                               'eventId', new.event_id::text));
  end if;
  return null;
end $$;

revoke all on function public.audit_client_worker_request_change() from public, anon, authenticated;

drop trigger if exists client_worker_requests_audit on client_worker_requests;
create trigger client_worker_requests_audit
  after update on client_worker_requests
  for each row execute function public.audit_client_worker_request_change();

-- ---------------------------------------------------------------------
-- 5 · client_lineup_v.worker_requested (restated from 20261014170000)
-- ---------------------------------------------------------------------
create or replace view client_lineup_v with (security_barrier = true) as
  select l.booking_id,
         l.event_id,
         l.role,
         l.starts_at,
         l.ends_at,
         l.name,
         l.photo_path,
         l.sort_key,
         l.feedback_given,
         l.shift_id,
         l.feedback_rating,
         l.feedback_sent_at,
         l.feedback_text,
         -- ADR-0135 §1: only for a seated row of a live, uncancelled event.
         case when l.seat <= l.headcount then l.arrival_status end as arrival_status,
         case when l.seat <= l.headcount and l.arrival_status = 'arrived' then l.first_in end as arrived_at,
         -- ADR-0135 §2: the customer has an open request for this worker.
         l.worker_requested
    from (
      select b.id as booking_id,
             sr.event_id,
             r.name as role,
             sr.starts_at,
             sr.ends_at,
             case when s.removed_at is null then s.first_name || ' ' || s.last_name
                  else deleted_account_label(s.employee_id) end as name,
             case when s.removed_at is null then s.photo_path end as photo_path,
             -- §11.3's order. A removed worker sorts under their anonymised
             -- label: surfacing the real surname as an order would undo §1.7.
             case when s.removed_at is null then lower(s.last_name)
                  else 'zzzz-deleted-' || coalesce(s.employee_id::text, 'unknown') end as sort_key,
             -- §11.2 "✓ Feedback sent": the customer's own entry only.
             exists (select 1
                       from feedback f
                      where f.event_id = sr.event_id
                        and f.staff_id = b.staff_id
                        and f.author_kind = 'client') as feedback_given,
             sr.id as shift_id,
             cf.rating     as feedback_rating,
             cf.created_at as feedback_sent_at,
             -- The customer's own words on that entry (ADR-0134 N4); withheld
             -- once the worker is removed (§1.7).
             case when s.removed_at is null then cf.text end as feedback_text,
             sr.headcount,
             ci.first_in,
             -- ADR-0135 §1: what the door would tell the customer, only
             -- while the event is live and never for a cancelled one.
             case
               when e.cancelled_at is not null
                 or w.starts_at is null
                 or not (now() between w.starts_at and w.ends_at) then null
               when ci.first_in is not null or b.status = 'worked' then 'arrived'
               when now() >= sr.starts_at + interval '30 minutes'
                and coalesce(b.confirmed_at, b.created_at) <= sr.starts_at then 'not_arrived'
               else 'expected'
             end as arrival_status,
             -- ADR-0135 §2: an open request by THIS event's customer.
             exists (select 1
                       from client_worker_requests q
                      where q.client_id = e.client_id
                        and q.staff_id = b.staff_id
                        and q.handled_at is null) as worker_requested,
             -- The seat this booking takes in its section (RULE-15). The
             -- event id leads the partition so a caller's event filter can
             -- be applied before the ranking rather than after it.
             row_number() over (
               partition by sr.event_id, sr.id
               order by (ci.first_in is not null or b.status = 'worked') desc,
                        ci.first_in asc nulls last,
                        coalesce(b.confirmed_at, b.created_at) asc,
                        b.id asc
             ) as seat
        from bookings b
        join shift_requirements sr on sr.id = b.shift_id
        join events e              on e.id  = sr.event_id
        join roles r               on r.id  = sr.role_id
        join staff s               on s.id  = b.staff_id
        left join event_windows w  on w.event_id = e.id
        left join lateral (
          select min(cl.check_in_at) as first_in
            from check_logs cl
           where cl.booking_id = b.id
             and cl.outcome = 'checked_in'
             and cl.check_in_at is not null
        ) ci on true
        left join lateral (
          select f.rating, f.created_at, f.text
            from feedback f
           where f.event_id = sr.event_id
             and f.staff_id = b.staff_id
             and f.author_kind = 'client'
           order by f.created_at desc
           limit 1
        ) cf on true
       where b.status in ('confirmed', 'worked')
         and client_portal_visible(e.client_id)
    ) l
   where l.seat <= l.headcount
      or l.feedback_given;

comment on view client_lineup_v is
  'The confirmed line-up a customer sees (§11.2), at most the headcount they booked per role section (20261014140000, ADR-0134): seats go first to whoever has checked in (or worked), by first check-in time, then by when the booking was confirmed, then by booking id (RULE-15); a worker the customer has already rated stays visible whatever their seat. THC''s buffer never reaches the customer. Owner rights + client_portal_visible() per ADR-0004; the client role holds no policy on bookings, shift_requirements, roles, staff, check_logs, feedback or client_worker_requests and must not be given one. Photo, name and role only: never a rate, never the selection process (Invited / Potential pool / Unavailable). shift_id names the role section (the key client_role_sections_v returns). feedback_given / feedback_rating / feedback_sent_at / feedback_text describe the customer''s OWN entry (author_kind = client) — never the office''s entries or words (20261014140200, ADR-0134 N4). arrival_status (arrived / expected / not_arrived) and arrived_at (first check-in) are set only for a seated row while the event is live and not cancelled, NULL otherwise (20261014170000, ADR-0135 §1). worker_requested: the customer has an open "Request again" for this worker (20261014170100, ADR-0135 §2). photo_path''s first segment is staff.id (ADR-0026: it reaches nothing). A removed worker reads deleted_account_label() (§1.7).';

revoke all on client_lineup_v from public, anon, authenticated;
grant select on client_lineup_v to authenticated;

-- ---------------------------------------------------------------------
-- 4 · client_worker_requests_v — the customer's open requests
-- ---------------------------------------------------------------------
create or replace view client_worker_requests_v with (security_barrier = true) as
  select q.id,
         q.booking_id,
         q.event_id,
         case when s.removed_at is null then s.first_name || ' ' || s.last_name
              else deleted_account_label(s.employee_id) end as name,
         r.name as role,
         case when s.removed_at is null then q.note end as note,
         q.created_at as requested_at
    from client_worker_requests q
    join staff s                    on s.id = q.staff_id
    left join bookings b            on b.id = q.booking_id
    left join shift_requirements sr on sr.id = b.shift_id
    left join roles r               on r.id = sr.role_id
   where q.handled_at is null
     and client_portal_visible(q.client_id);

comment on view client_worker_requests_v is
  'ADR-0135 §2: the customer''s OPEN "Request again" messages to THC, for /client/feedback. Owner rights + client_portal_visible() per ADR-0004: the client role holds no policy on client_worker_requests and must not be given one. Name (deleted_account_label once removed, §1.7), role, the event and booking it was asked from, the customer''s own note (withheld once removed) and when. No staff id, no money, nothing about the office''s handling.';

revoke all on client_worker_requests_v from public, anon, authenticated;
grant select on client_worker_requests_v to authenticated;

-- ---------------------------------------------------------------------
-- 6 · clients_worker_requests_v — the office's read (invoker rights)
-- ---------------------------------------------------------------------
create or replace view clients_worker_requests_v with (security_invoker = true) as
  select q.id,
         q.client_id,
         q.staff_id,
         case when s.removed_at is null then s.first_name || ' ' || s.last_name
              else deleted_account_label(s.employee_id) end as worker_name,
         s.employee_id,
         s.removed_at is not null as worker_removed,
         q.event_id,
         e.title as event_title,
         e.event_date,
         r.name as role,
         q.note,
         q.requested_by_name,
         q.created_at,
         q.handled_at
    from client_worker_requests q
    join staff s                    on s.id = q.staff_id
    left join events e              on e.id = q.event_id
    left join bookings b            on b.id = q.booking_id
    left join shift_requirements sr on sr.id = b.shift_id
    left join roles r               on r.id = sr.role_id;

comment on view clients_worker_requests_v is
  'ADR-0135 §2: "Request again" messages for the client card (/clients/:id). security_invoker — the admin''s own policies on client_worker_requests, staff, events, bookings, shift_requirements and roles apply; nobody else reads a row.';

revoke all on clients_worker_requests_v from public, anon, authenticated;
grant select on clients_worker_requests_v to authenticated;

-- ---------------------------------------------------------------------
-- 2 · client_request_worker()
-- ---------------------------------------------------------------------
create or replace function public.client_request_worker(p_booking_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client    uuid := current_client_id();
  v_note      text := nullif(btrim(coalesce(p_note, '')), '');
  v_event     uuid;
  v_ends      timestamptz;
  v_event_cid uuid;
  v_cancelled timestamptz;
  v_staff     uuid;
  v_removed   timestamptz;
  v_existing  uuid;
  v_recent    int;
  v_id        uuid;
  v_now       timestamptz := now();
  v_payload   jsonb;
begin
  -- The caller first, so a non-client learns nothing about the row.
  if current_app_role() is distinct from 'client' or v_client is null then
    raise exception 'Only the Client Portal asks for a worker again' using errcode = '42501';
  end if;

  if char_length(v_note) > 500 then
    raise exception 'request_note_too_long' using errcode = '22023',
      detail = 'A note to THC is at most 500 characters.';
  end if;

  select sr.event_id into v_event
    from bookings b
    join shift_requirements sr on sr.id = b.shift_id
   where b.id = p_booking_id;

  -- The customer's own line-up, by the view's own rules (tenancy, confirmed,
  -- the headcount trim of ADR-0134): a booking the customer was never shown
  -- cannot be asked for. The event filter lets the view rank one event.
  if v_event is null
     or not exists (select 1 from client_lineup_v l
                     where l.event_id = v_event and l.booking_id = p_booking_id) then
    raise exception 'That booking is not on your line-up' using errcode = '42501';
  end if;

  select e.client_id, e.cancelled_at, w.ends_at, b.staff_id, s.removed_at
    into v_event_cid, v_cancelled, v_ends, v_staff, v_removed
    from bookings b
    join shift_requirements sr on sr.id = b.shift_id
    join events e              on e.id = sr.event_id
    join event_windows w       on w.event_id = e.id
    join staff s               on s.id = b.staff_id
   where b.id = p_booking_id;

  if v_event_cid is distinct from v_client or v_cancelled is not null then
    raise exception 'That booking is not on your line-up' using errcode = '42501';
  end if;

  if v_ends is null or v_now <= v_ends then
    raise exception 'request_after_event' using errcode = '22023',
      detail = 'Request again opens once the event has finished.';
  end if;

  if v_removed is not null then
    raise exception 'worker_removed' using errcode = '22023',
      detail = 'This worker has been removed (§1.7).';
  end if;

  -- One request at a time per client: the dedupe and the daily ceiling are
  -- read and written under the same lock.
  perform pg_advisory_xact_lock(hashtextextended('client_worker_requests:' || v_client::text, 0));

  select q.id into v_existing
    from client_worker_requests q
   where q.client_id = v_client and q.staff_id = v_staff and q.handled_at is null;
  if v_existing is not null then
    return jsonb_build_object('id', v_existing, 'already', true);
  end if;

  select count(*)::int into v_recent
    from client_worker_requests q
   where q.client_id = v_client and q.created_at > v_now - interval '24 hours';
  if v_recent >= 20 then
    raise exception 'request_limit_reached' using errcode = 'P0001',
      detail = 'At most 20 requests a day from one company.';
  end if;

  insert into client_worker_requests
    (client_id, staff_id, booking_id, event_id, note, requested_by, requested_by_name, created_at)
  values
    (v_client, v_staff, p_booking_id, v_event, v_note, auth.uid(),
     (select nullif(btrim(p.full_name), '') from profiles p where p.id = auth.uid()), v_now)
  returning id into v_id;

  -- CP1 to the office (admin@, like every office notice). The payload is
  -- values only; the copy is the register's (packages/notifications).
  select jsonb_build_object(
           'client',      c.name,
           'name',        s.first_name || ' ' || s.last_name,
           'employeeId',  coalesce(s.employee_id::text, '—'),
           'event',       e.title,
           'date',        to_char(w.starts_at at time zone 'Europe/London', 'Dy DD Mon YYYY'),
           'role',        coalesce(r.name, '—'),
           'clientNote',  coalesce(v_note, '(no note)'),
           'requestedBy', coalesce(q.requested_by_name, 'A Client Portal login')
                            || coalesce(' (' || u.email || ')', ''),
           'requestedAt', to_char(v_now at time zone 'Europe/London', 'DD.MM.YYYY HH24:MI'),
           'requestId',   q.id::text,
           'clientId',    c.id::text,
           'staffId',     s.id::text)
    into v_payload
    from client_worker_requests q
    join clients c              on c.id = q.client_id
    join staff s                on s.id = q.staff_id
    join events e               on e.id = q.event_id
    join event_windows w        on w.event_id = e.id
    join bookings b             on b.id = q.booking_id
    join shift_requirements sr  on sr.id = b.shift_id
    left join roles r           on r.id = sr.role_id
    left join auth.users u      on u.id = q.requested_by
   where q.id = v_id;

  -- The register's own address on the row too, as E10 and CR3 write it,
  -- so /inbox shows who it went to.
  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values ('CP1:request:' || v_id::text, 'email', 'CP1',
          array['admin@thehospitalitycompany.co.uk'], v_payload)
  on conflict (key) do nothing;

  return jsonb_build_object('id', v_id, 'already', false);
end $$;

comment on function public.client_request_worker(uuid, text) is
  'ADR-0135 §2: "Request this person again" from the Client Portal — a message to THC, never a booking. Client role only; the booking must be on the caller''s visible line-up (client_lineup_v: tenancy, confirmed, the headcount trim), the event finished and not cancelled, the worker not removed; an open request for the same worker answers {already: true}; at most 20 a day per client; one client_worker_requests row and one CP1 office email (key CP1:request:<id>). Writes no booking, qualification or staffing state.';

revoke all on function public.client_request_worker(uuid, text) from public, anon;
grant execute on function public.client_request_worker(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3b · mark_client_worker_request_handled()
-- ---------------------------------------------------------------------
create or replace function public.mark_client_worker_request_handled(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handled timestamptz;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'admins_only' using errcode = '42501';
  end if;
  select handled_at into v_handled from client_worker_requests where id = p_id for update;
  if not found then
    raise exception 'unknown_worker_request' using errcode = 'P0002';
  end if;
  if v_handled is not null then
    return;
  end if;
  -- A viewer (ADR-0060) is refused by the office_read_only trigger here,
  -- before the audit row (the client_worker_requests_audit trigger).
  update client_worker_requests
     set handled_at = now(), handled_by = auth.uid()
   where id = p_id;
end $$;

comment on function public.mark_client_worker_request_handled(uuid) is
  'ADR-0135 §2: the client card''s "Mark handled" on a Client Portal request. Office only; a viewer is refused by the read-only guard; idempotent. Audited as client.worker_request_handled on the client''s History.';

revoke all on function public.mark_client_worker_request_handled(uuid) from public, anon;
grant execute on function public.mark_client_worker_request_handled(uuid) to authenticated;
