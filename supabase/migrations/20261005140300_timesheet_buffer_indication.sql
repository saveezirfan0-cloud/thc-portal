-- =====================================================================
-- Migration 20261005140300 · The timesheet says when buffer staff are on it
--                            (§3.2, §11.3; ADR-0089, THC 05.10.2026)
--
-- THC overbooks a role by its buffer (§3.2), and the Allocation Timesheet
-- lists everyone confirmed — so it can list more people than the client
-- asked for, and a client reading "9 staff" for a booking of 8 thinks too
-- many have been booked. The document and the email now say so:
--
--   event_document_data  each row gains `headcount` (the role section's
--                        headcount), so packages/pdf can print "7 staff
--                        (6 required + 1 buffer)" in the role's heading and
--                        one note on the last page.
--   event_document_buffer_count(event)
--                        people listed beyond the headcount, summed over the
--                        role sections (confirmed or worked, the sheet's own
--                        rows). 0 when nobody is.
--   event_document_email_payload
--                        gains `bufferStaff` ('' for none), which the D1/D2
--                        email turns into one sentence and "(incl. N
--                        buffer)" beside the staff count.
--
-- Nobody is singled out: who works is decided by check-in order (§3.2,
-- RULE-15), and for a client who pays for the buffer everyone works.
-- Restated from 20261002112000 (event_document_data) and 20261005140100
-- (event_document_email_payload); nothing else in either changes.
-- Forward-only.
-- =====================================================================

create or replace function public.event_document_buffer_count(p_event uuid)
returns int
language sql stable set search_path = public, extensions as $$
  select coalesce(sum(greatest(f.listed - sr.headcount, 0)), 0)::int
    from shift_requirements sr
    cross join lateral (
      select count(*)::int as listed
        from bookings b
       where b.shift_id = sr.id and b.status in ('confirmed', 'worked')
    ) f
   where sr.event_id = p_event
$$;

comment on function public.event_document_buffer_count(uuid) is
  'ADR-0089: people on the timesheet beyond what the client asked for — per role section, confirmed or worked bookings above the headcount, summed. 0 = none.';

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
               -- ADR-0089: what the client asked for in this role section; the sheet
               -- prints "7 staff (6 required + 1 buffer)" when more are listed.
               'headcount',    sr.headcount,
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
  v_update boolean;
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
                 -- Which file it is, not what to call it: the card's words
                 -- are packages/notifications' (the §8 register's home).
                 'role', 'badges'));
  end if;

  -- An automatic D1 that follows an earlier one that went out: it replaces it.
  v_update := d.kind = 'allocation' and d.automatic
              and exists (select 1 from event_documents o
                           where o.event_id = d.event_id and o.kind = 'allocation'
                             and o.queued_at is not null and o.id <> d.id);

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
    'nameBadges', coalesce(d.badges_count::text, ''),
    'updateTag',  case when v_update then ' (updated)' else '' end,
    -- ADR-0089: people listed beyond what the client asked for ('' = none).
    'bufferStaff', coalesce(nullif(event_document_buffer_count(ev.id), 0)::text, ''));

  if d.kind = 'signout' then
    select * into t from event_document_tally(ev.id);
    v_payload := v_payload || jsonb_build_object(
      'totalHours', case when t.undetermined > 0 then '' else document_hours_label(t.worked_min) end);
  end if;
  return v_payload;
end $$;

revoke execute on function public.event_document_buffer_count(uuid) from public, anon, authenticated;
grant execute on function public.event_document_buffer_count(uuid) to service_role;

-- Restated bodies keep their grants (create or replace).
