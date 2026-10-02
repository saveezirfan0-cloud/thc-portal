-- =====================================================================
-- Migration 20261002109000 · Name badges with the Allocation Timesheet
--                            (ADR-0081, THC 02.10.2026)
--
-- What changes
-- ------------
-- Leonardo Hotel St Paul's M and E puts THC's staff in its own badge
-- holders. It needs THC name badges, the THC logo at the top and the
-- worker's name under it, sent with the staff timesheet so it can print
-- them before the team arrives.
--
--   1 · clients.name_badges: a per-client switch, off by default, set on the
--       client card (set_client_name_badges). This migration switches it on
--       for Leonardo Hotel St Paul's M and E.
--   2 · event_documents.badges_*: an Allocation Timesheet copy can carry a
--       second stored PDF, the badges, drawn by the same generateDocument()
--       call that draws the sheet (manual Send, manual Download and the
--       automatic 14:00 send alike), and attached here by
--       attach_event_document_badges().
--   3 · event_document_data() says whether the client wants badges
--       (`event.nameBadges`), so the Back Office knows to draw them.
--   4 · event_document_email_payload() lists the badges as a second D1
--       attachment, and adds `nameBadges` (the number of badges) for the
--       copy, so the email says they are attached. Both queue paths
--       (queue_event_document_email and queue_event_document_autosend)
--       build their payload through it, so neither is restated.
--
-- Only the Allocation Timesheet (D1) carries badges. It goes the day before
-- the event, when the client can still print them. The Completed
-- Allocation Timesheet (D2) goes after the event, when a badge is no use.
--
-- Nothing here reaches the client role: the client holds no table policy
-- (ADR-0026), and client_event_documents_v names its columns, so it does
-- not gain the new ones.
--
-- Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The switch on the client card
-- ---------------------------------------------------------------------
alter table clients add column if not exists name_badges boolean not null default false;

comment on column clients.name_badges is
  'ADR-0081: true when this client wants THC name badges (THC logo + first name, 86 × 54 mm, ten to an A4 page) emailed as a second PDF with every Allocation Timesheet (D1). Set on the client card through set_client_name_badges().';

-- THC asked for it for this client on 02.10.2026. Matched on the name with
-- the punctuation and spaces taken out, so "St Paul's", "St Paul’s",
-- "St Pauls", "M and E" and "M&E" all match. If the card is named some
-- other way, the switch on the client card does the same thing.
do $$
declare
  v_count int;
begin
  update clients set name_badges = true
   where regexp_replace(lower(name), '[^a-z0-9]', '', 'g')
         in ('leonardohotelstpaulsmande', 'leonardohotelstpaulsme');
  get diagnostics v_count = row_count;
  raise notice 'name badges switched on for % client card(s) named Leonardo Hotel St Paul''s M and E', v_count;
end $$;

create or replace function public.set_client_name_badges(p_client uuid, p_on boolean)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_was boolean;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'admins_only' using errcode = '42501';
  end if;
  if p_on is null then
    raise exception 'name_badges_must_be_on_or_off' using errcode = '22004';
  end if;

  select name_badges into v_was from clients where id = p_client for update;
  if not found then
    raise exception 'No client %', p_client using errcode = 'no_data_found';
  end if;
  if v_was = p_on then return; end if;

  -- A viewer (ADR-0060) is refused here by the office_read_only trigger on
  -- clients, before the audit row is written.
  update clients set name_badges = p_on where id = p_client;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'client.name_badges', 'client', p_client,
          jsonb_build_object('from', v_was, 'to', p_on));
end $$;

comment on function public.set_client_name_badges(uuid, boolean) is
  'ADR-0081: the client card''s Name badges switch. Office only; a viewer is refused by the read-only guard. Audited as client.name_badges on the client''s History.';

revoke all on function public.set_client_name_badges(uuid, boolean) from public, anon;
grant execute on function public.set_client_name_badges(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 2 · An Allocation Timesheet copy can carry the badges
-- ---------------------------------------------------------------------
alter table event_documents
  add column if not exists badges_storage_path text unique,
  add column if not exists badges_file_name    text,
  add column if not exists badges_count        int check (badges_count >= 1);

alter table event_documents drop constraint if exists event_documents_badges_whole;
alter table event_documents add constraint event_documents_badges_whole check (
  (badges_storage_path is null) = (badges_file_name is null)
  and (badges_storage_path is null) = (badges_count is null)
  and (badges_storage_path is null or kind = 'allocation'));

comment on column event_documents.badges_storage_path is
  'ADR-0081: the name badges PDF drawn with this Allocation Timesheet copy, in the timesheets bucket; attached to its D1 email. Null when the client has no name badges.';

-- The Back Office draws the PDF and stores it, then records it here,
-- before the email is queued. A copy whose email is queued is fixed: what
-- the client was sent is never changed afterwards.
create or replace function public.attach_event_document_badges(
  p_document     uuid,
  p_storage_path text,
  p_file_name    text,
  p_count        int
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  d event_documents;
  v_badges boolean;
begin
  perform assert_reports_caller();
  select * into d from event_documents where id = p_document for update;
  if d.id is null then raise exception 'document_not_found' using errcode = 'P0002'; end if;
  if d.kind <> 'allocation' then
    raise exception 'badges_only_with_allocation' using errcode = '22023';
  end if;
  select c.name_badges into v_badges
    from events ev join clients c on c.id = ev.client_id
   where ev.id = d.event_id;
  if not coalesce(v_badges, false) then
    raise exception 'client_has_no_name_badges' using errcode = 'P0001';
  end if;
  if p_storage_path is null or p_storage_path not like d.event_id::text || '/%' then
    raise exception 'storage_path_outside_event' using errcode = '22023';
  end if;
  if coalesce(btrim(p_file_name), '') = '' then
    raise exception 'badges_need_a_file_name' using errcode = '22023';
  end if;
  if p_count is null or p_count < 1 then
    raise exception 'badges_need_someone_on_them' using errcode = '22023';
  end if;
  if d.queued_at is not null or d.outbox_key is not null then
    raise exception 'document_already_queued' using errcode = 'P0001';
  end if;
  if d.badges_storage_path is not null then
    raise exception 'badges_already_attached' using errcode = 'P0001';
  end if;

  update event_documents
     set badges_storage_path = p_storage_path,
         badges_file_name    = p_file_name,
         badges_count        = p_count
   where id = d.id;
end $$;

comment on function public.attach_event_document_badges(uuid, text, text, int) is
  'ADR-0081: records the name badges PDF drawn with one Allocation Timesheet copy, for a client with name badges on, before its D1 email is queued. Office (manual Send/Download) or the service role (the event-documents job).';

revoke all on function public.attach_event_document_badges(uuid, text, text, int) from public, anon;
grant execute on function public.attach_event_document_badges(uuid, text, text, int) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3 · event_document_data — says whether the client wants badges
--
-- 20260923130100's body (its only one) with one key added to `event`:
-- nameBadges.
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
      'contactEmails', to_jsonb(v_client.contact_emails),
      -- ADR-0081: draw name badges with the Allocation Timesheet.
      'nameBadges', coalesce(v_client.name_badges, false)),
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

-- ---------------------------------------------------------------------
-- 4 · event_document_email_payload — the badges travel with the sheet
--
-- 20261002100000's body (its only one) with the attachments list built
-- here instead of inline, the badges added as its second entry with their
-- own note, and `nameBadges` added: the number of badges, or '' for none.
-- Every other key and value is unchanged.
-- ---------------------------------------------------------------------
create or replace function public.event_document_email_payload(p_document uuid)
returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
  d  event_documents;
  ev events;
  v_client clients;
  t  record;
  v_files jsonb;
  v_payload jsonb;
begin
  select * into d from event_documents where id = p_document;
  select * into ev from events where id = d.event_id;
  select * into v_client from clients where id = ev.client_id;

  v_files := jsonb_build_array(jsonb_build_object(
               'bucket', 'timesheets', 'path', d.storage_path, 'filename', d.file_name));
  if d.badges_storage_path is not null then
    v_files := v_files || jsonb_build_array(jsonb_build_object(
                 'bucket', 'timesheets', 'path', d.badges_storage_path,
                 'filename', d.badges_file_name,
                 'note', 'Name badges · ' || d.badges_count::text || ' to print'));
  end if;

  v_payload := jsonb_build_object(
    'event',      ev.title,
    'client',     v_client.name,
    'date',       trim(to_char(ev.event_date, 'FMDay FMDD FMMonth YYYY')),
    'poNumber',   coalesce(ev.po_number, ''),
    'poSuffix',   case when coalesce(ev.po_number, '') = '' then ''
                       else ' (PO ' || ev.po_number || ')' end,
    'staffCount', d.row_count::text,
    'attachments', v_files::text,
    'documentName', case d.kind when 'allocation' then 'Allocation Timesheet'
                                else 'Completed Allocation Timesheet' end,
    'schedule',   event_document_schedule(ev.id),
    'nameBadges', coalesce(d.badges_count::text, ''));

  if d.kind = 'signout' then
    select * into t from event_document_tally(ev.id);
    v_payload := v_payload || jsonb_build_object(
      'totalHours', case when t.undetermined > 0 then '' else document_hours_label(t.worked_min) end);
  end if;
  return v_payload;
end $$;
