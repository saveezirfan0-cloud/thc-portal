-- =====================================================================
-- ADR-0083 · The Completed Allocation Timesheet goes to the client with
-- the invoice, not straight after the event
--
-- THC, 02.10.2026: "Signed timesheets after the event with completed
-- worked timings should not be emailed out to the client yet. This needs
-- to be linked into the invoicing part."
--
-- Until now the filled-in sheet (kind 'signout', D2) reached the client
-- three ways the morning after the event, before THC had invoiced:
--
--   a. the event-documents job emailed it at 10:00 UK (ADR-0074, D2);
--   b. anyone in the office could press "Send Completed Timesheet" on the
--      event page, a scheduler included;
--   c. the Client Portal served any copy drawn after the event's last role
--      ended (20260923193100) — so an office Download, made only to check
--      the hours, published it.
--
-- Now:
--
-- 1 · D2 is switched OFF in `document_autosend`. The machinery stays
--     (verdict, claim, record, queue — 760 still exercises it with the
--     switch on), so THC can turn it back on later with one SQL edit.
-- 2 · queue_event_document_email() sends a Completed Timesheet only for a
--     finance login (owner, manager — ADR-0056; a viewer is still refused
--     by office_read_only), and never while a row would print blank Finish
--     and Hours (an unresolved No check-out, RULE-02): a sheet that goes
--     with an invoice carries every hour. Invoicing is a finance job; a
--     scheduler keeps the Allocation Timesheet's Send and both Downloads.
-- 3 · client_event_documents_v serves a sign-out copy only once it was
--     SENT. A Download no longer publishes anything. Copies already sent
--     (manual or automatic) stay exactly as they were.
-- 4 · invoicing_timesheets(from, to) — the list the Reports › Financial
--     tab shows beside the invoicing figure: every finished event in the
--     period with its line-up count, Total Hours, open No check-outs, the
--     client's contact count and where its Completed Timesheet stands.
--     Finance only.
--
-- Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · No automatic Completed Allocation Timesheet
-- ---------------------------------------------------------------------
update settings
   set value = jsonb_set(value, '{completed,enabled}', 'false'::jsonb, true)
 where key = 'document_autosend';

-- ---------------------------------------------------------------------
-- 2 · Only invoicing sends the Completed Timesheet
--
-- 20261002100000's body with two additions, marked ADR-0083. Caller check,
-- lock, key, recipients, payload and the document-row update unchanged.
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
  -- ADR-0083: the Completed Allocation Timesheet goes to the client with
  -- the invoice, from Reports › Financial — a finance login's job.
  if d.kind = 'signout' then perform assert_finance_caller(); end if;
  -- The job's lock for this event and kind (ADR-0074): a manual Send and
  -- an automatic one queue one after the other, and the job, re-checking
  -- after it, sees this copy and stands down (manual_sent).
  perform pg_advisory_xact_lock(hashtext('document-autosend:' || d.event_id::text || ':' || d.kind));
  select * into ev from events where id = d.event_id;
  if ev.cancelled_at is not null then raise exception 'event_cancelled' using errcode = 'P0001'; end if;
  select * into v_client from clients where id = ev.client_id;
  if coalesce(array_length(v_client.contact_emails, 1), 0) = 0 then
    raise exception 'client_has_no_contact_email' using errcode = 'P0001';
  end if;
  -- ADR-0083: not with a blank Finish Time and Hours Worked on it — the
  -- manager resolves the No check-out first (RULE-02, §11.3).
  if d.kind = 'signout'
     and (select t.undetermined from event_document_tally(d.event_id) t) > 0 then
    raise exception 'timesheet_has_blank_hours' using errcode = 'P0001';
  end if;

  v_key := case d.kind when 'allocation' then 'D1' else 'D2' end || ':document:' || d.id::text;

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values (v_key, 'email', case d.kind when 'allocation' then 'D1' else 'D2' end,
          v_client.contact_emails, event_document_email_payload(d.id))
  on conflict (key) do nothing;

  update event_documents
     set outbox_key = v_key, recipients = v_client.contact_emails, queued_at = coalesce(queued_at, now())
   where id = d.id;

  return jsonb_build_object('key', v_key, 'recipients', to_jsonb(v_client.contact_emails));
end $$;

comment on function public.queue_event_document_email(uuid) is
  '§11.4: queues one generated Allocation Timesheet (D1) or Completed Allocation Timesheet (D2) for email from timesheets@ to every contact email on the client card, with the PDF as a storage-path attachment. Keyed on the document, so it is idempotent per copy. Payload: event_document_email_payload() (ADR-0074 adds schedule, totalHours, documentName). ADR-0083: a D2 goes with the invoice, so only a finance login (assert_finance_caller) queues one, and never while a row prints blank Finish and Hours (timesheet_has_blank_hours).';

-- ---------------------------------------------------------------------
-- 3 · The client sees a Completed Timesheet once it was sent, not before
--
-- 20260923193100's view with the "drawn after the last role ended"
-- branch removed. Same columns, same owner rights, same filter.
-- ---------------------------------------------------------------------
create or replace view client_event_documents_v with (security_barrier = true) as
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
   and (d.kind = 'allocation' or d.sent_at is not null)
 order by d.event_id, d.kind, d.generated_at desc;

comment on view client_event_documents_v is
  '§11.1/§11.2 downloads for the client whose event it is (client_portal_visible, ADR-0004): the latest Allocation Timesheet, and the latest Completed Allocation Timesheet THC has SENT — it goes with the invoice (ADR-0083), so an office Download never publishes one. No money column. Signed URLs are made server-side from storage_path.';

-- ADR-0004 rule (d): SELECT to authenticated and nothing else, to anybody.
revoke all on client_event_documents_v from public, anon, authenticated;
grant select on client_event_documents_v to authenticated;

-- ---------------------------------------------------------------------
-- 4 · invoicing_timesheets — the Completed Timesheets to go with the
--     invoices for a period (Reports › Financial)
--
-- One row per event dated in [p_from, p_to] that is not cancelled (§3.3:
-- no document at all), whose last role has ended (RULE-18) and that had
-- somebody confirmed — exactly the events a Completed Timesheet can be
-- drawn for. The tally is the sheet's own (event_document_tally):
-- `undetermined` rows print blank Finish and Hours (an unresolved No
-- check-out, RULE-02); `worked_min` is its Total Hours. The send columns
-- are the latest Completed Timesheet that was queued, whoever queued it.
-- ---------------------------------------------------------------------
create or replace function public.invoicing_timesheets(p_from date, p_to date)
returns table (
  event_id       uuid,
  event_title    text,
  event_date     date,
  client_name    text,
  po_number      text,
  last_end       timestamptz,
  confirmed      int,
  undetermined   int,
  worked_min     int,
  contacts       int,
  queued_at      timestamptz,
  sent_at        timestamptz,
  send_failed_at timestamptz,
  automatic      boolean
)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
begin
  perform assert_finance_caller();
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'bad_period' using errcode = '22023';
  end if;

  return query
  with ev as (
    select e.id, e.title, e.event_date, c.name as client_name, e.po_number,
           coalesce(array_length(c.contact_emails, 1), 0) as contacts,
           (select max(sr.ends_at) from shift_requirements sr where sr.event_id = e.id) as last_end
      from events e
      join clients c on c.id = e.client_id
     where e.event_date between p_from and p_to
       and e.cancelled_at is null
  )
  select ev.id, ev.title, ev.event_date, ev.client_name, ev.po_number, ev.last_end,
         t.confirmed, t.undetermined, t.worked_min, ev.contacts,
         s.queued_at, s.sent_at, s.send_failed_at, coalesce(s.automatic, false)
    from ev
    cross join lateral event_document_tally(ev.id) t
    left join lateral (
      select d.queued_at, d.sent_at, d.send_failed_at, d.automatic
        from event_documents d
       where d.event_id = ev.id and d.kind = 'signout' and d.queued_at is not null
       order by d.queued_at desc
       limit 1) s on true
   where ev.last_end is not null
     and ev.last_end <= now()
     and t.confirmed > 0
   order by lower(ev.client_name), ev.event_date, ev.last_end, ev.id;
end $$;

comment on function public.invoicing_timesheets(date, date) is
  'ADR-0083: the Completed Allocation Timesheets that go to clients with the invoices — every finished, uncancelled event in the period with confirmed staff, its sheet tally (confirmed, undetermined = blank Finish/Hours from an unresolved No check-out, worked_min = Total Hours), the client''s contact-email count, and the latest queued Completed Timesheet (queued_at, sent_at, send_failed_at, automatic). Finance only (assert_finance_caller).';

revoke all on function public.invoicing_timesheets(date, date) from public, anon;
grant execute on function public.invoicing_timesheets(date, date) to authenticated, service_role;
