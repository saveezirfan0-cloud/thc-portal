-- =====================================================================
-- Migration 20260923130100 · The allocation sheet and the sign-out
--                            timesheet (§11.3, §11.4, §1.7)
--
-- What this exists for
-- --------------------
-- ONE document per event, all roles together, in two states: the blank
-- allocation sheet sent before the event and the sign-out timesheet filled
-- from check-in/out after it. The PDF is drawn by packages/pdf in a Back
-- Office route handler; this migration is the data it is drawn from, the
-- record of every copy that was generated, and the email that sends one.
--
-- The rules that live here rather than in the drawing:
--
--   · who is on the sheet: confirmed and worked bookings only — the
--     line-up the client was promised (§11.2), never invited or turned away;
--   · Hours Worked is RULE-01's payable window minus unpaid breaks, i.e.
--     payable_shifts_v's workedMin — the four-hour floor is a PAY rule and
--     does not belong on a record of hours worked. A shift whose figure is
--     undetermined (an unresolved No check-out, RULE-02) comes back with
--     no finish and no hours, so the sheet prints those two cells blank
--     rather than a guess, and everyone else generates normally;
--   · a removed worker (§1.7) is "Deleted account #id" with no photo on any
--     copy generated from now on. Copies already issued are rows in
--     `event_documents` pointing at files in the `timesheets` bucket, and
--     neither is ever rewritten — the historical record of what the client
--     received stays exactly as issued;
--   · a cancelled event has no document at all (§3.3 point 5): the data
--     function refuses, so no screen and no job can draw one.
--
-- Money: none. The sheet carries hours, never a rate (§11.1), and nothing
-- here selects pay_rate or charge_rate.
--
-- Forward-only.
-- =====================================================================

create table event_documents (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references events(id),
  kind           text not null check (kind in ('allocation', 'signout')),
  storage_path   text not null unique,              -- in the private `timesheets` bucket
  file_name      text not null,                     -- "Client – Event.pdf" (§11.3)
  row_count      int  not null check (row_count >= 0),
  page_count     int  not null check (page_count >= 1),
  generated_at   timestamptz not null default now(),
  generated_by   uuid references profiles(id),
  -- §11.4 send: filled when the email is queued, then by the outbox trigger.
  outbox_key     text unique,
  recipients     text[],
  queued_at      timestamptz,
  sent_at        timestamptz,
  send_failed_at timestamptz,
  send_error     text
);

create index event_documents_event_idx on event_documents (event_id, kind, generated_at desc);
create index event_documents_generated_by_idx on event_documents (generated_by);

alter table event_documents enable row level security;
create policy admin_read on event_documents for select using (current_app_role() = 'admin');

comment on table event_documents is
  '§11.3/§11.4: every allocation sheet and sign-out timesheet generated, with where the PDF is stored and whether it was emailed. Rows and files are never rewritten — a GDPR removal changes only copies generated afterwards (§1.7). Written only by record_event_document() / queue_event_document_email(); admin-read. The client reaches it through client_event_documents_v.';

-- ---------------------------------------------------------------------
-- event_document_data — everything one sheet is drawn from
-- ---------------------------------------------------------------------
create or replace function public.event_document_data(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  ev events;
  v_client clients;
begin
  perform assert_reports_caller();

  select * into ev from events where id = p_event;
  if ev.id is null then raise exception 'event_not_found' using errcode = 'P0002'; end if;
  if ev.cancelled_at is not null then
    -- §3.3 point 5 / §11.3: no allocation sheet or timesheet, ever.
    raise exception 'event_cancelled' using errcode = 'P0001';
  end if;
  select * into v_client from clients where id = ev.client_id;

  return jsonb_build_object(
    'event', jsonb_build_object(
      'id', ev.id,
      'title', ev.title,
      'clientName', v_client.name,
      'eventDate', ev.event_date,
      'poNumber', ev.po_number,
      'contactEmails', to_jsonb(v_client.contact_emails)),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'bookingId',    b.id,
               'employeeId',   st.employee_id,
               'name',         case when st.removed_at is null then st.first_name || ' ' || st.last_name
                                    else deleted_account_label(st.employee_id) end,
               'firstName',    case when st.removed_at is null then st.first_name end,
               'surname',      case when st.removed_at is null then st.last_name end,
               'removed',      st.removed_at is not null,
               'photoPath',    case when st.removed_at is null then st.photo_path end,
               'roleName',     r.name,
               'sectionId',    sr.id,
               'startsAt',     sr.starts_at,
               'endsAt',       sr.ends_at,
               'checkInAt',    ps.check_in_at,
               -- Finish and hours only when the figure is settled. An
               -- unresolved No check-out has neither (RULE-02, §11.3).
               'finishAt',     case when ps.pay->>'status' = 'settled' then ps.check_out_at end,
               'workedMin',    case when ps.pay->>'status' = 'settled'
                                    then (ps.pay->>'workedMin')::int end,
               'status',       case when ps.booking_id is null then 'scheduled'
                                    when ps.kind = 'no_show' then 'no_show'
                                    when ps.pay->>'status' = 'settled' then 'settled'
                                    else 'pending' end,
               'breakMin',     coalesce(ps.unpaid_break_min, 0))
             order by sr.starts_at, r.name, b.id)
        from bookings b
        join shift_requirements sr on sr.id = b.shift_id
        join roles r               on r.id = sr.role_id
        join staff st              on st.id = b.staff_id
        left join payable_shifts_v ps on ps.booking_id = b.id
       where sr.event_id = ev.id
         and b.status in ('confirmed', 'worked')), '[]'::jsonb));
end $$;

comment on function public.event_document_data(uuid) is
  '§11.3: the event header (client, title, date, PO number, contact emails) and one row per confirmed/worked booking with its role section window, the settled finish and hours worked (RULE-01 minus unpaid breaks, no floor) and the break total. Removed workers are anonymised with no photo (§1.7). Refuses a cancelled event. Admin or service role.';

-- ---------------------------------------------------------------------
-- record_event_document — one row per generated copy
-- ---------------------------------------------------------------------
create or replace function public.record_event_document(
  p_event        uuid,
  p_kind         text,
  p_storage_path text,
  p_file_name    text,
  p_rows         int,
  p_pages        int
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  ev events;
  v_id uuid;
begin
  perform assert_reports_caller();
  select * into ev from events where id = p_event;
  if ev.id is null then raise exception 'event_not_found' using errcode = 'P0002'; end if;
  if ev.cancelled_at is not null then raise exception 'event_cancelled' using errcode = 'P0001'; end if;
  if p_kind not in ('allocation', 'signout') then
    raise exception 'unknown_document_kind' using errcode = '22023';
  end if;
  if p_storage_path is null or p_storage_path not like p_event::text || '/%' then
    raise exception 'storage_path_outside_event' using errcode = '22023';
  end if;

  insert into event_documents (event_id, kind, storage_path, file_name, row_count, page_count, generated_by)
  values (p_event, p_kind, p_storage_path, p_file_name, p_rows, p_pages, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- queue_event_document_email — §11.4 "Send allocation sheet"
--
-- From timesheets@ (§9.12) to the contact emails on the client card
-- (§9.7) — "several recipients per event". One outbox row per document,
-- keyed on the document, so a double press on the same copy is one email.
-- ---------------------------------------------------------------------
create or replace function public.queue_event_document_email(p_document uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  d  event_documents;
  ev events;
  v_client clients;
  v_key text;
begin
  perform assert_reports_caller();
  select * into d from event_documents where id = p_document;
  if d.id is null then raise exception 'document_not_found' using errcode = 'P0002'; end if;
  select * into ev from events where id = d.event_id;
  if ev.cancelled_at is not null then raise exception 'event_cancelled' using errcode = 'P0001'; end if;
  select * into v_client from clients where id = ev.client_id;
  if coalesce(array_length(v_client.contact_emails, 1), 0) = 0 then
    raise exception 'client_has_no_contact_email' using errcode = 'P0001';
  end if;

  v_key := case d.kind when 'allocation' then 'D1' else 'D2' end || ':document:' || d.id::text;

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values (v_key, 'email', case d.kind when 'allocation' then 'D1' else 'D2' end,
          v_client.contact_emails,
          jsonb_build_object(
            'event',      ev.title,
            'client',     v_client.name,
            'date',       trim(to_char(ev.event_date, 'FMDay FMDD FMMonth YYYY')),
            'poNumber',   coalesce(ev.po_number, ''),
            'poSuffix',   case when coalesce(ev.po_number, '') = '' then ''
                               else ' (PO ' || ev.po_number || ')' end,
            'staffCount', d.row_count::text,
            'attachments', jsonb_build_array(jsonb_build_object(
                             'bucket', 'timesheets', 'path', d.storage_path,
                             'filename', d.file_name))::text))
  on conflict (key) do nothing;

  update event_documents
     set outbox_key = v_key, recipients = v_client.contact_emails, queued_at = coalesce(queued_at, now())
   where id = d.id;

  return jsonb_build_object('key', v_key, 'recipients', to_jsonb(v_client.contact_emails));
end $$;

comment on function public.queue_event_document_email(uuid) is
  '§11.4: queues one generated allocation sheet (D1) or sign-out timesheet (D2) for email from timesheets@ to every contact email on the client card, with the PDF as a storage-path attachment. Keyed on the document, so it is idempotent per copy.';

-- The outbox verdict lands on the document row too (see 20260923130000 §8).
create or replace function public.event_documents_follow_outbox()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.sent_at is not null and old.sent_at is null then
    update event_documents set sent_at = new.sent_at, send_failed_at = null, send_error = null
     where outbox_key = new.key;
  elsif new.failed_at is not null and old.failed_at is null then
    update event_documents set send_failed_at = new.failed_at, send_error = new.error
     where outbox_key = new.key;
  end if;
  return new;
end $$;

drop trigger if exists event_documents_follow_outbox on notification_outbox;
create trigger event_documents_follow_outbox
  after update of sent_at, failed_at on notification_outbox
  for each row execute function public.event_documents_follow_outbox();

-- ---------------------------------------------------------------------
-- client_event_documents_v — the Client Portal's two PDFs (§11.1, §11.2)
--
-- ADR-0004's shape: owner rights, the tenancy predicate in the body, the
-- columns named. The newest copy of each kind per event. The document
-- carries no money (§11.1), and a client sees the same names and photos on
-- it as on their own line-up (client_lineup_v).
-- ---------------------------------------------------------------------
-- `issued_at`, not `generated_at`: 050_client_views refuses any client-facing
-- column whose name contains "rate", and gene-RATE-d does.
create view client_event_documents_v with (security_barrier = true) as
select distinct on (d.event_id, d.kind)
       d.id,
       d.event_id,
       d.kind,
       d.file_name,
       d.storage_path,
       d.generated_at as issued_at
  from event_documents d
  join events e on e.id = d.event_id
 where client_portal_visible(e.client_id)
   and e.cancelled_at is null
 order by d.event_id, d.kind, d.generated_at desc;

comment on view client_event_documents_v is
  '§11.1/§11.2 downloads: the latest allocation sheet and sign-out timesheet per event, for the client whose event it is (client_portal_visible, ADR-0004). No money column. Signed URLs are made server-side from storage_path.';

revoke all on client_event_documents_v from public, anon;
grant select on client_event_documents_v to authenticated;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke execute on function
  public.event_document_data(uuid),
  public.record_event_document(uuid, text, text, text, int, int),
  public.queue_event_document_email(uuid),
  public.event_documents_follow_outbox()
from public, anon;

grant execute on function
  public.event_document_data(uuid),
  public.record_event_document(uuid, text, text, text, int, int),
  public.queue_event_document_email(uuid)
to authenticated, service_role;
