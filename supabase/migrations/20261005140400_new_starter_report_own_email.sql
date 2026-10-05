-- =====================================================================
-- Migration 20261005140400 · The New Starter (HMRC) report is emailed to
--                            Payroll and Gisela every Monday, on its own
--                            (§9.9; ADR-0090, THC 05.10.2026)
--
-- §9.9 sent the New Starter (HMRC) CSV only as a second attachment to the
-- weekly payroll email (BG08). The owner paused that email (ADR-0083), and
-- with it the New Starter report stopped too — it was never prepared, so no
-- new starter reached payroll. THC: "The New Starter Checklist report should
-- be emailed to Payroll and Gisela every Monday."
--
-- So it is now its own email, NS1, with its own switch (ON), to the same two
-- addresses as BG08 (thc_payroll@topsourceworldwide.com and
-- gisela@thehospitalitycompany.co.uk), from admin@. BG08 no longer carries it.
--
-- Who is in it (same rule as §9.9 Tab 3 and as BG08 had)
-- -----------------------------------------------------
-- A worker whose FIRST shift is settled — they turned up and the shift is
-- not waiting on an unresolved "No check-out" (RULE-02: a held shift is not
-- a settled one, so a first shift that is held waits, and the person goes
-- out the Monday after it is resolved) — and who has not been sent before.
-- `new_starter_reported` is that "sent before" ledger: one row per worker,
-- written when a week is prepared and tied to its send, so nobody is ever
-- sent twice and a week missed by an outage is caught up. Only first shifts
-- on or after settings.new_starter_report.not_before count, so switching it
-- on never reports every existing worker. The ledger is seeded from the
-- weeks BG08 had already sent.
--
-- The week is the Monday-to-Sunday before the send, as everywhere in §9.9.
-- A week with nobody new sends no email and reads "No new: [date], [time]"
-- on /reports (§9.9), not a failure.
--
-- Steps, each idempotent (the job is apps/office/app/api/jobs/new-starter-report):
--   new_starter_report_due()          Monday 09:00 UK until this week's is done
--   prepare_new_starter_report()      selects and records who is in it
--   new_starter_report_rows(send)     the CSV rows for it
--   queue_new_starter_report_email()  one outbox row, NS1:<week start>
--
-- BG08 restated without its New Starter half: prepare_finance_reports()
-- no longer creates a new_starter send, queue_finance_report_email() takes
-- the payroll file only, and new_starter_export_rows() (which read the
-- payroll run) is dropped. Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The ledger and the setting
-- ---------------------------------------------------------------------
create table if not exists new_starter_reported (
  staff_id       uuid primary key references staff(id),
  report_send_id bigint not null references report_sends(id),
  reported_at    timestamptz not null default now()
);
create index if not exists new_starter_reported_send_idx on new_starter_reported (report_send_id);

alter table new_starter_reported enable row level security;
create policy admin_read on new_starter_reported for select using ((select current_app_role()) = 'admin');
drop trigger if exists office_read_only on public.new_starter_reported;
create trigger office_read_only before insert or update or delete or truncate
  on public.new_starter_reported
  for each statement execute function public.office_read_only_guard();
revoke all on new_starter_reported from public, anon, authenticated;
grant select on new_starter_reported to authenticated;
grant all on new_starter_reported to service_role;

comment on table new_starter_reported is
  'ADR-0090: every worker already sent on a New Starter (HMRC) report — one row each, tied to the send. Written by prepare_new_starter_report() (service role); admin read only.';

-- Seed: whoever BG08's New Starter attachments already carried.
insert into new_starter_reported (staff_id, report_send_id)
select distinct on (f.staff_id) f.staff_id, ns.id
  from report_sends ns
  join report_sends p on p.kind = 'payroll' and p.period_start = ns.period_start
  join payroll_export_lines x on x.report_send_id = p.id and x.state = 'exported'
  join report_first_shifts_v f on f.booking_id = x.booking_id
 where ns.kind = 'new_starter' and ns.status in ('queued', 'sent')
 order by f.staff_id, ns.period_start
on conflict do nothing;

-- Nobody whose first shift is before last week's Monday is ever reported by
-- this job: those workers were onboarded before it existed.
insert into settings (key, value) values
  ('new_starter_report',
   jsonb_build_object('not_before', to_char(date_trunc('week', uk_local(now()))::date - 7, 'YYYY-MM-DD')))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2 · The four steps
-- ---------------------------------------------------------------------
create or replace function public.new_starter_report_due(p_now timestamptz default now())
returns boolean language sql stable set search_path = public, extensions as $$
  select notification_switched_on('NS1')
     and uk_local(p_now) >= date_trunc('week', uk_local(p_now)) + interval '9 hours'
     and not exists (
           select 1 from report_sends r
            where r.kind = 'new_starter'
              and r.period_start = report_week_start(p_now) - 7
              and (r.outbox_key is not null or r.status = 'no_new'))
$$;

comment on function public.new_starter_report_due(timestamptz) is
  'ADR-0090 gate: from Monday 09:00 Europe/London until last week''s New Starter (HMRC) email is queued (or the week had nobody new), and only while NS1 is switched on in /settings → Notifications. DST-proof: reads the London clock.';

create or replace function public.prepare_new_starter_report(p_now timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_start      date := report_week_start(p_now) - 7;
  v_end        date := report_week_start(p_now) - 1;
  v_not_before date;
  v_send       report_sends;
  v_staff      uuid[];
begin
  perform assert_reports_caller();
  perform pg_advisory_xact_lock(hashtext('ns1:' || v_start::text));

  select * into v_send from report_sends where kind = 'new_starter' and period_start = v_start;
  if v_send.id is not null then
    return jsonb_build_object('alreadyPrepared', true, 'periodStart', v_start, 'periodEnd', v_end,
                              'sendId', v_send.id, 'status', v_send.status,
                              'newStarters', coalesce(v_send.row_count, 0),
                              'queued', v_send.outbox_key is not null);
  end if;

  v_not_before := coalesce(
    nullif(coalesce((select value->>'not_before' from settings where key = 'new_starter_report'), ''), '')::date,
    v_start);

  -- First shift settled (not held for an unresolved No check-out), on or
  -- after the cut-in date, up to the end of last week, never sent before.
  v_staff := array(
    select f.staff_id
      from report_first_shifts_v f
      join report_payroll_lines_v l on l.booking_id = f.booking_id
     where f.first_shift_date between v_not_before and v_end
       and l.status is distinct from 'pending'
       and not exists (select 1 from new_starter_reported r where r.staff_id = f.staff_id));

  if coalesce(array_length(v_staff, 1), 0) = 0 then
    -- "No new: [date], [time]" (§9.9) — nothing was due, which is not a failure.
    insert into report_sends (kind, period_start, period_end, status, row_count, sent_at)
    values ('new_starter', v_start, v_end, 'no_new', 0, now())
    returning * into v_send;
  else
    insert into report_sends (kind, period_start, period_end, status, row_count)
    values ('new_starter', v_start, v_end, 'preparing', array_length(v_staff, 1))
    returning * into v_send;
    insert into new_starter_reported (staff_id, report_send_id)
    select unnest(v_staff), v_send.id;
  end if;

  return jsonb_build_object('alreadyPrepared', false, 'periodStart', v_start, 'periodEnd', v_end,
                            'sendId', v_send.id, 'status', v_send.status,
                            'newStarters', coalesce(array_length(v_staff, 1), 0), 'queued', false);
end $$;

comment on function public.prepare_new_starter_report(timestamptz) is
  'ADR-0090 step 1: records who is on last week''s New Starter (HMRC) report (first shift settled, not reported before, on or after settings.new_starter_report.not_before) or notes "no new". Idempotent per week. Service role.';

create or replace function public.new_starter_report_rows(p_send bigint)
returns table (
  staff_id uuid, employee_id int, staff_name text, removed boolean, photo_path text,
  ni_number text, home_address text, postcode text, country text,
  date_of_birth date, gender text, first_shift_date date,
  hmrc_statement text, student_loan text
)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform assert_reports_caller();
  return query
  select * from new_starter_rows(array(
    select r.staff_id from new_starter_reported r where r.report_send_id = p_send));
end $$;

comment on function public.new_starter_report_rows(bigint) is
  'ADR-0090 step 2: the CSV rows for a prepared New Starter (HMRC) send — the workers recorded against it, with the §9.9 Tab 3 columns.';

create or replace function public.queue_new_starter_report_email(p_send bigint, p_path text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v    report_sends;
  v_key text;
begin
  perform assert_reports_caller();
  select * into v from report_sends where id = p_send and kind = 'new_starter';
  if v.id is null then raise exception 'unknown_report_send' using errcode = 'P0002'; end if;
  if v.status = 'no_new' then raise exception 'nothing_to_send' using errcode = 'P0001'; end if;
  if p_path is null or p_path = '' or p_path like '%..%' or p_path like '/%' then
    raise exception 'new_starter_csv_required' using errcode = '22023';
  end if;

  v_key := 'NS1:' || v.period_start::text;
  insert into notification_outbox (key, channel, template, payload)
  values (v_key, 'email', 'NS1', jsonb_build_object(
            'periodStart', to_char(v.period_start, 'DD/MM/YYYY'),
            'periodEnd',   to_char(v.period_end, 'DD/MM/YYYY'),
            'newStarters', coalesce(v.row_count, 0)::text,
            'attachments', jsonb_build_array(jsonb_build_object(
               'bucket', 'reports', 'path', p_path,
               'filename', 'THC new starters (HMRC) ' || to_char(v.period_start, 'YYYY-MM-DD')
                           || ' to ' || to_char(v.period_end, 'YYYY-MM-DD') || '.csv'))::text))
  on conflict (key) do nothing;

  update report_sends
     set status = 'queued', outbox_key = v_key, storage_path = p_path
   where id = v.id and status in ('preparing', 'queued');

  return jsonb_build_object('key', v_key);
end $$;

comment on function public.queue_new_starter_report_email(bigint, text) is
  'ADR-0090 step 3: the New Starter (HMRC) email — one outbox row NS1:<week start>, the CSV as a storage path. The drain sends it from admin@ to Payroll and Gisela.';

-- ---------------------------------------------------------------------
-- 3 · BG08 without its New Starter half
-- ---------------------------------------------------------------------
drop function if exists public.queue_finance_report_email(bigint, text, text);
drop function if exists public.new_starter_export_rows(bigint);

create or replace function public.prepare_finance_reports(p_now timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_start date := report_week_start(p_now) - 7;
  v_end   date;
  v_pay   report_sends;
  v_rows  int;
  v_held  int;
begin
  perform assert_reports_caller();
  v_end := v_start + 6;

  -- Two runners in the same five minutes serialise here; the second sees
  -- the first one's row and resumes it.
  perform pg_advisory_xact_lock(hashtext('bg08:' || v_start::text));

  select * into v_pay from report_sends where kind = 'payroll' and period_start = v_start;
  if v_pay.id is not null then
    return jsonb_build_object(
      'alreadyPrepared', true,
      'periodStart', v_start, 'periodEnd', v_end,
      'payrollSendId', v_pay.id,
      'rows', v_pay.row_count, 'held', v_pay.held_count,
      'queued', v_pay.outbox_key is not null);
  end if;

  insert into report_sends (kind, period_start, period_end, status)
  values ('payroll', v_start, v_end, 'preparing')
  returning * into v_pay;

  -- This week's shifts, plus every shift an earlier run HELD that has not
  -- gone since (BG-08: "rolls forward and goes out with the following
  -- Monday's run"). Each is exported with its figures or held again.
  insert into payroll_export_lines
    (report_send_id, booking_id, staff_id, event_id, state, shift_date, payable_min, rate, base, holiday)
  select v_pay.id, l.booking_id, l.staff_id, l.event_id,
         case when l.status = 'pending' then 'held' else 'exported' end,
         l.shift_date,
         l.payable_min, l.rate, l.base, l.holiday
    from report_payroll_lines_v l
   where l.kind in ('worked', 'turned_away', 'cancelled_on_day')
     and (l.status = 'pending' or coalesce(l.payable_min, 0) > 0)
     and not exists (select 1 from payroll_export_lines x
                      where x.booking_id = l.booking_id and x.state = 'exported')
     and (l.shift_date between v_start and v_end
          or exists (select 1 from payroll_export_lines h
                      where h.booking_id = l.booking_id and h.state = 'held'));

  select count(*) filter (where state = 'exported'), count(*) filter (where state = 'held')
    into v_rows, v_held
    from payroll_export_lines where report_send_id = v_pay.id;

  update report_sends set row_count = v_rows, held_count = v_held where id = v_pay.id;

  -- §3.3: the No-show / Get-back warnings read this. Set once, never moved.
  update events e
     set payroll_exported_at = now()
   where e.payroll_exported_at is null
     and e.id in (select x.event_id from payroll_export_lines x
                   where x.report_send_id = v_pay.id and x.state = 'exported');

  return jsonb_build_object(
    'alreadyPrepared', false,
    'periodStart', v_start, 'periodEnd', v_end,
    'payrollSendId', v_pay.id,
    'rows', v_rows, 'held', v_held,
    'queued', false);
end $$;

create or replace function public.queue_finance_report_email(
  p_payroll_send bigint,
  p_payroll_path text
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_pay report_sends;
  v_key text;
  v_attachments jsonb;
begin
  perform assert_reports_caller();
  select * into v_pay from report_sends where id = p_payroll_send and kind = 'payroll';
  if v_pay.id is null then raise exception 'unknown_report_send' using errcode = 'P0002'; end if;
  if p_payroll_path is null or p_payroll_path = '' then
    raise exception 'payroll_csv_required' using errcode = '22023';
  end if;
  v_key := 'BG08:' || v_pay.period_start::text;
  v_attachments := jsonb_build_array(jsonb_build_object(
    'bucket', 'reports', 'path', p_payroll_path,
    'filename', 'THC payroll ' || to_char(v_pay.period_start, 'YYYY-MM-DD') || ' to '
                || to_char(v_pay.period_end, 'YYYY-MM-DD') || '.csv'));
  insert into notification_outbox (key, channel, template, payload)
  values (v_key, 'email', 'BG08', jsonb_build_object(
            'periodStart', to_char(v_pay.period_start, 'DD/MM/YYYY'),
            'periodEnd',   to_char(v_pay.period_end, 'DD/MM/YYYY'),
            'rows',        coalesce(v_pay.row_count, 0)::text,
            'held',        coalesce(v_pay.held_count, 0)::text,
            'attachments', v_attachments::text))
  on conflict (key) do nothing;

  update report_sends
     set status = 'queued', outbox_key = v_key, storage_path = p_payroll_path
   where id = v_pay.id and status in ('preparing', 'queued');
  return jsonb_build_object('key', v_key, 'attachments', jsonb_array_length(v_attachments));
end $$;

comment on function public.prepare_finance_reports(timestamptz) is
  'BG-08 step 1: stamps last week''s payroll — exported lines with their figures as sent, held lines for unresolved No check-outs (rolled forward to the next run) — and sets events.payroll_exported_at. Idempotent per week. The New Starter (HMRC) report is its own email (ADR-0090).';

comment on function public.queue_finance_report_email(bigint, text) is
  'BG-08 step 3: one email to finance with the payroll CSV, queued in notification_outbox under BG08:<week>. The drain sends it from admin@. The New Starter (HMRC) report goes separately (NS1, ADR-0090).';

-- ---------------------------------------------------------------------
-- 4 · The job, and who may call what
-- ---------------------------------------------------------------------
insert into job_schedules (job, cron_expression, edge_path, enabled, note, base_url_source, secret_name) values
  ('new-starter-report', '*/15 * * * *', 'api/jobs/new-starter-report', true,
   '§9.9 / ADR-0090 the New Starter (HMRC) report, emailed to Payroll and Gisela every Monday from 09:00 UK (a missed Monday is caught up). A Back Office Node route (apps/office/app/api/jobs/new-starter-report); new_starter_report_due() picks the UK minute. Shares rtw-check''s bearer (vault rtw_job_secret, env RTW_JOB_SECRET).',
   'office_base_url', 'rtw_job_secret')
on conflict (job) do nothing;

revoke execute on function
  public.new_starter_report_due(timestamptz),
  public.prepare_new_starter_report(timestamptz),
  public.new_starter_report_rows(bigint),
  public.queue_new_starter_report_email(bigint, text),
  public.queue_finance_report_email(bigint, text),
  public.prepare_finance_reports(timestamptz)
from public, anon, authenticated;
grant execute on function
  public.new_starter_report_due(timestamptz),
  public.prepare_new_starter_report(timestamptz),
  public.new_starter_report_rows(bigint),
  public.queue_new_starter_report_email(bigint, text),
  public.queue_finance_report_email(bigint, text),
  public.prepare_finance_reports(timestamptz)
to service_role;
