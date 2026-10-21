-- =====================================================================
-- 20261022200000 · A sign-out more than 15 minutes past the end is paid
--                  and charged to the actual finish — ADR-0184
--                  (THC, 21.10.2026; a deliberate change to RULE-01)
--
-- THC: "For the sign out between 16:15 and 20:00 we need to be able to pay
-- and charge for the time the staff actually finished their shift. It
-- should flag to say that this staff member signed out late. This then
-- needs to be verified by the office by speaking to the staff member to
-- find out the reason. [...] The shift doesn't need to be approved by the
-- office if the staff member's shift is overrunning. [...] The shift that
-- over ran should feature as it's own line on the invoice so it's clear.
-- The 15 minute period between 16:00 and 16:15 (pay and charge is to
-- 16:00 is correct)."
--
-- 16:00 is the ROLE SECTION's scheduled end (RULE-18). So:
--
--   · check-out at or before end+15 → paid and charged to the scheduled
--     end (unchanged);
--   · check-out MORE than 15 min past the end (up to end+4 h, when RULE-02
--     takes over as before) → paid and charged to the ACTUAL recorded
--     finish: the on-site press, or the last on-site fix when pressed off
--     site (check_out_decision, unchanged). A finish a manager enters when
--     resolving a No check-out is the check-out too, so the same rule
--     applies to it. Same hourly pay and charge rates; holiday 12.07% is
--     still broken out by the pricing functions, never blended.
--   · RULE-14's four-hour floor applies to the total, as before.
--   · Unpaid breaks are clipped to the paid window, which now runs to the
--     actual finish on an overrun, so a break during the overrun is unpaid
--     like any other. The deduction comes off the MAIN part: the overrun
--     is the clock time past the scheduled end, so the client can check it
--     against the sign-out on the log. Only when the breaks are longer than
--     the whole main part (not a real shift) does the excess come off the
--     overrun, so main + overrun is always the worked total.
--   · A check-in at or after the scheduled end still intersects nothing
--     (undetermined): the overrun extends a shift that reached its end.
--
-- "Signed out late" is a FLAG, never a hold. It is not a row in
-- `violations` — those feed the show-rate, the invoice sign-off and the
-- payroll holds — but three columns on the accepted check_logs row, the
-- row that already carries check_out_at and manager_finish_at (one row per
-- booking, `where check_in_at is not null order by check_in_at limit 1`).
-- check_logs is office-only (admin_all and nothing else), so the office's
-- note about the conversation is never readable by the worker, as a
-- violation's resolution note never is; bookings is readable by its worker
-- (staff_self_bookings). The office records who verified, when and a
-- short note through verify_late_check_out() (office_can('write'),
-- audited). Nothing reads those columns when deciding money, payroll,
-- invoice readiness or the invoice fingerprint.
--
-- What changes
--   1 payable_minutes()         the paid end; 'overrunMin' in its jsonb
--   2 break_window_minutes()    clipped to the new paid end
--   3 check_logs                late_check_out_verified_at / _by / _note
--   4 verify_late_check_out()   the office's Verify (definer, audited)
--   5 late_check_outs()         the office's list to verify (invoker)
--   6 checkin_monitor_v         + the verification, for the monitor
--   7 report_payroll_lines_v    + overrun_min, overrun_invoicing
--   8 invoice_claim()           an overrun is its own invoice line
--   9 invoice_document_data()   + bookingId per line (the log folds by it)
--  10 invoice_export_rows()     the CSV splits the overrun the same way
--
-- packages/domain/src/pay.ts mirrors 1 and 2; pay.vectors.json holds both
-- (supabase/tests/070). The rest is supabase/tests/921.
--
-- Views and functions edited in place are re-created from their LIVE
-- definitions with checked text replacements (docs/10 §3b): each pattern
-- must match exactly once or the migration stops. Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The pay window
-- ---------------------------------------------------------------------
create or replace function payable_minutes(
  p_starts_at         timestamptz,
  p_ends_at           timestamptz,
  p_check_in_at       timestamptz,
  p_check_out_at      timestamptz,
  p_unpaid_break_min  int     default 0,
  p_left_early        boolean default false,
  p_no_check_out      text    default 'none'      -- none | unresolved | resolved
) returns jsonb language plpgsql immutable as $$
declare
  v_late    boolean;
  v_from    timestamptz;
  v_to      timestamptz;
  v_worked  int;
  v_overrun int;
  v_floor   boolean;
  v_payable int;
begin
  if p_check_out_at is null or p_check_in_at is null then
    return jsonb_build_object('status','undetermined','payableMin',null,'workedMin',null,
      'floorApplied',false,'lateCheckOutFlag',false,'overrunMin',null);
  end if;

  -- ADR-0184: more than 15 minutes past the scheduled end is a late
  -- sign-out, paid to the actual finish; inside it, paid to the end.
  v_late := extract(epoch from (p_check_out_at - p_ends_at)) / 60 > 15;

  v_from := greatest(p_check_in_at, p_starts_at);  -- early is not paid; late is paid from the press
  v_to   := case when v_late then p_check_out_at
                 else least(p_check_out_at, p_ends_at) end;

  -- [check-in, check-out] ∩ [start, end] is empty: there is no shift to pay,
  -- and the floor must not manufacture one (RULE-02, RULE-14). A check-in at
  -- or after the end is empty too, however late the check-out.
  if v_to <= v_from or v_from >= p_ends_at then
    return jsonb_build_object('status','undetermined','payableMin',null,'workedMin',null,
      'floorApplied',false,'lateCheckOutFlag',false,'overrunMin',null);
  end if;

  -- Whole minutes, so a timesheet, the app and the payroll export cannot
  -- disagree in the seconds (and so SQL and TypeScript round identically).
  v_worked := round(greatest(0, greatest(0, extract(epoch from (v_to - v_from)) / 60)
                                - coalesce(p_unpaid_break_min, 0)))::int;

  -- The overrun: the clock past the scheduled end. Breaks come off the
  -- main part; the overrun gives way only to breaks longer than all of it.
  v_overrun := case when v_late
                    then least(v_worked, round(extract(epoch from (p_check_out_at - p_ends_at)) / 60)::int)
                    else 0 end;

  v_floor   := not p_left_early and coalesce(p_no_check_out,'none') <> 'unresolved';
  v_payable := case when v_floor then greatest(v_worked, 240) else v_worked end;

  return jsonb_build_object(
    'status','settled',
    'payableMin', v_payable,
    'workedMin',  v_worked,
    'floorApplied', v_floor and v_payable > v_worked,
    'lateCheckOutFlag', v_late,
    'overrunMin', v_overrun);
end $$;

-- create or replace drops the pinned search_path; put it back.
alter function public.payable_minutes(timestamptz, timestamptz, timestamptz, timestamptz, integer, boolean, text)
  set search_path = public, extensions;

comment on function payable_minutes is
  'RULE-01/02/14 pay window. Paid from the later of the scheduled start and the actual check-in (ADR-0095); to the scheduled end for a check-out up to end+15, to the actual finish for one later than that (ADR-0184), whose minutes past the end are overrunMin. Mirrored by payableMinutes() in packages/domain/pay.ts; both are held to pay.vectors.json.';

-- ---------------------------------------------------------------------
-- 2 · Breaks inside the paid window
-- ---------------------------------------------------------------------
create or replace function break_window_minutes(
  p_starts_at   timestamptz,
  p_ends_at     timestamptz,
  p_check_in_at timestamptz,
  p_finish_at   timestamptz,
  p_break_start timestamptz,
  p_break_end   timestamptz
) returns int
language sql
immutable
set search_path = public, extensions
as $$
  select greatest(0, round(extract(epoch from (
           least(coalesce(p_break_end, p_finish_at), p_finish_at,
                 -- ADR-0184: the paid end is the finish itself past end+15.
                 case when p_finish_at > p_ends_at + interval '15 minutes'
                      then p_finish_at else p_ends_at end)
           - greatest(p_break_start, p_check_in_at, p_starts_at))) / 60))::int
$$;

comment on function break_window_minutes(timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz) is
  '§5.2b, audit D49: one break''s minutes inside the paid window [max(check-in, start), paid end], the paid end being the scheduled end or, for a finish more than 15 minutes past it, the finish (ADR-0184). Mirrored by breakWindowMinutes() in packages/domain/pay.ts.';

-- ---------------------------------------------------------------------
-- 3 · The office's verification of a late sign-out
-- ---------------------------------------------------------------------
alter table public.check_logs
  add column if not exists late_check_out_verified_at timestamptz,
  -- Null once that office account is deleted; audit_log keeps who it was.
  add column if not exists late_check_out_verified_by uuid references public.profiles(id) on delete set null,
  add column if not exists late_check_out_note        text;

alter table public.check_logs
  add constraint check_logs_late_check_out_note_len
  check (late_check_out_note is null or (btrim(late_check_out_note) <> '' and length(late_check_out_note) <= 500));

-- Every foreign key is indexed (002).
create index if not exists check_logs_late_check_out_verified_by_idx
  on public.check_logs (late_check_out_verified_by);

comment on column public.check_logs.late_check_out_verified_at is
  'ADR-0184: when the office verified a late sign-out (recorded finish more than 15 min past the section end) with the worker. A flag only: nothing about pay, payroll or invoicing waits for it. Written by verify_late_check_out().';
comment on column public.check_logs.late_check_out_verified_by is
  'ADR-0184: the office user who verified the late sign-out.';
comment on column public.check_logs.late_check_out_note is
  'ADR-0184: the office''s note of why the worker signed out late (up to 500 characters). Office-only, like a violation''s resolution note.';

-- ---------------------------------------------------------------------
-- 4 · Verify
-- ---------------------------------------------------------------------
create or replace function public.verify_late_check_out(p_booking uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ends   timestamptz;
  cl       check_logs;
  v_finish timestamptz;
  v_note   text := btrim(coalesce(p_note, ''));
  v_over   int;
begin
  if current_app_role() is distinct from 'admin'::app_role then
    raise exception 'admins_only' using errcode = '42501';
  end if;
  -- Finance-free: a scheduler may verify (owner, manager, scheduler); a
  -- viewer may not.
  if not office_can('write') then
    raise exception 'not_permitted' using errcode = '42501', detail = 'write';
  end if;
  if v_note = '' then
    raise exception 'note_required' using errcode = 'P0001';
  end if;
  if length(v_note) > 500 then
    raise exception 'note_too_long' using errcode = '22023';
  end if;

  select sr.ends_at into v_ends
    from bookings b join shift_requirements sr on sr.id = b.shift_id
   where b.id = p_booking;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;

  -- The accepted check-in: the row check_out() and resolve_violation() write.
  select * into cl from check_logs
   where booking_id = p_booking and check_in_at is not null
   order by check_in_at limit 1 for update;
  v_finish := coalesce(cl.manager_finish_at, cl.check_out_at);
  if cl.id is null or v_finish is null or v_finish <= v_ends + interval '15 minutes' then
    raise exception 'not_signed_out_late' using errcode = 'P0001';
  end if;

  v_over := round(extract(epoch from (v_finish - v_ends)) / 60)::int;

  update check_logs
     set late_check_out_verified_at = now(),
         late_check_out_verified_by = auth.uid(),
         late_check_out_note        = v_note
   where id = cl.id;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'booking.late_check_out_verified', 'booking', p_booking,
          jsonb_build_object('note', v_note,
                             'finishAt', v_finish,
                             'endsAt', v_ends,
                             'minutesPastEnd', v_over,
                             'again', cl.late_check_out_verified_at is not null));

  return jsonb_build_object('decision', 'verified', 'verifiedAt', now(), 'minutesPastEnd', v_over);
end $$;

comment on function public.verify_late_check_out(uuid, text) is
  'ADR-0184: the office records that it spoke to a worker who signed out more than 15 minutes past the section end — who, when and a note (1–500 characters). Verifying again replaces the note; each is audited as booking.late_check_out_verified. Owners, managers and schedulers (office_can(''write'')). A flag only: pay, payroll and invoicing never wait for it.';

revoke execute on function public.verify_late_check_out(uuid, text) from public, anon;
grant execute on function public.verify_late_check_out(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5 · The list to verify
-- ---------------------------------------------------------------------
-- Every late sign-out on a section that ended in the last p_days days,
-- newest first. Invoker: it reads check_logs, which only the office can.
create or replace function public.late_check_outs(p_days int default 14, p_include_verified boolean default false)
returns table (
  booking_id        uuid,
  staff_id          uuid,
  staff_name        text,
  photo_path        text,
  event_id          uuid,
  event_title       text,
  venue_name        text,
  role_name         text,
  starts_at         timestamptz,
  ends_at           timestamptz,
  check_in_at       timestamptz,
  check_out_at      timestamptz,
  finish_by_office  boolean,
  minutes_past_end  int,
  verified_at       timestamptz,
  verified_by_name  text,
  note              text
)
language plpgsql
stable
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if current_app_role() is distinct from 'admin'::app_role then
    raise exception 'admins_only' using errcode = '42501';
  end if;
  return query
  select b.id, b.staff_id,
         case when s.removed_at is null then s.first_name || ' ' || s.last_name
              else deleted_account_label(s.employee_id) end,
         case when s.removed_at is null then s.photo_path end,
         e.id, e.title, e.venue_name, r.name, sr.starts_at, sr.ends_at,
         cl.check_in_at, coalesce(cl.manager_finish_at, cl.check_out_at),
         cl.manager_finish_at is not null,
         round(extract(epoch from (coalesce(cl.manager_finish_at, cl.check_out_at) - sr.ends_at)) / 60)::int,
         cl.late_check_out_verified_at, p.full_name, cl.late_check_out_note
    from bookings b
    join shift_requirements sr on sr.id = b.shift_id
    join events e              on e.id = sr.event_id
    join roles r               on r.id = sr.role_id
    join staff s               on s.id = b.staff_id
    join lateral (
      select c.* from check_logs c
       where c.booking_id = b.id and c.check_in_at is not null
       order by c.check_in_at limit 1
    ) cl on true
    left join profiles p on p.id = cl.late_check_out_verified_by
   where sr.ends_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 14), 1), 92))
     and sr.ends_at <= now()
     and e.cancelled_at is null
     and coalesce(cl.manager_finish_at, cl.check_out_at) > sr.ends_at + interval '15 minutes'
     and (p_include_verified or cl.late_check_out_verified_at is null)
     -- A No check-out still open is the violation log's to settle first.
     and not exists (select 1 from violations v
                      where v.booking_id = b.id and v.type = 'no_checkout' and not v.resolved)
   order by coalesce(cl.manager_finish_at, cl.check_out_at) desc, b.id
   limit 200;
end $$;

comment on function public.late_check_outs(int, boolean) is
  'ADR-0184: shifts signed out more than 15 minutes past their section end, on sections ended in the last p_days days (1–92, default 14), newest first, unverified only unless p_include_verified. For the office''s "Signed out late" list on /checkin. No money. Office only.';

revoke execute on function public.late_check_outs(int, boolean) from public, anon;
grant execute on function public.late_check_outs(int, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6 · The monitor carries the verification
-- ---------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_viewdef('public.checkin_monitor_v'::regclass, true);
  v_n   int;
  p1 constant text := $re$cl_1\.location_suspect,(\s+)row_number\(\)$re$;
  r1 constant text := $sql$cl_1.location_suspect,\1cl_1.late_check_out_verified_at,\1cl_1.late_check_out_verified_by,\1cl_1.late_check_out_note,\1row_number()$sql$;
  p2 constant text := $re$COALESCE\(cl\.location_suspect, false\) AS location_suspect(\s+)FROM bookings b$re$;
  r2 constant text := $sql$COALESCE(cl.location_suspect, false) AS location_suspect,
    cl.late_check_out_verified_at,
    ( SELECT vp.full_name
           FROM profiles vp
          WHERE vp.id = cl.late_check_out_verified_by) AS late_check_out_verified_by_name,
    cl.late_check_out_note\1FROM bookings b$sql$;
begin
  select count(*) into v_n from regexp_matches(v_def, p1, 'g');
  if v_n <> 1 then
    raise exception '20261022200000: checkin_monitor_v - expected one match of the logs columns, found %', v_n;
  end if;
  select count(*) into v_n from regexp_matches(v_def, p2, 'g');
  if v_n <> 1 then
    raise exception '20261022200000: checkin_monitor_v - expected one match of the last column, found %', v_n;
  end if;
  v_def := regexp_replace(regexp_replace(v_def, p1, r1), p2, r2);
  execute 'create or replace view public.checkin_monitor_v with (security_invoker = true) as ' || v_def;
end $$;

-- ---------------------------------------------------------------------
-- 7 · Payroll lines carry the overrun (what the invoice splits off)
-- ---------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_viewdef('public.report_payroll_lines_v'::regclass, true);
  v_n   int;
  p1 constant text := $re$ps\.charge_rate(\s+)FROM payable_shifts_v ps$re$;
  r1 constant text := $sql$ps.charge_rate,
            COALESCE((ps.pay ->> 'overrunMin'::text)::integer, 0) AS overrun_min\1FROM payable_shifts_v ps$sql$;
  p2 constant text := $re$sr_1\.charge_rate(\s+)FROM bookings b$re$;
  r2 constant text := $sql$sr_1.charge_rate,
            0\1FROM bookings b$sql$;
  p3 constant text := $re$END AS invoicing(\s+)FROM base x$re$;
  r3 constant text := $sql$END AS invoicing,
        CASE
            WHEN x.status = 'settled'::text AND x.kind = 'worked'::text THEN x.overrun_min
            ELSE 0
        END AS overrun_min,
        CASE
            WHEN x.status <> 'settled'::text THEN NULL::numeric
            WHEN x.kind = 'worked'::text THEN round(x.overrun_min::numeric * x.charge_rate / 60::numeric, 2)
            ELSE 0::numeric
        END AS overrun_invoicing\1FROM base x$sql$;
begin
  select count(*) into v_n from regexp_matches(v_def, p1, 'g');
  if v_n <> 1 then raise exception '20261022200000: report_payroll_lines_v - pattern 1 matched % times', v_n; end if;
  select count(*) into v_n from regexp_matches(v_def, p2, 'g');
  if v_n <> 1 then raise exception '20261022200000: report_payroll_lines_v - pattern 2 matched % times', v_n; end if;
  select count(*) into v_n from regexp_matches(v_def, p3, 'g');
  if v_n <> 1 then raise exception '20261022200000: report_payroll_lines_v - pattern 3 matched % times', v_n; end if;
  v_def := regexp_replace(regexp_replace(regexp_replace(v_def, p1, r1), p2, r2), p3, r3);
  execute 'create or replace view public.report_payroll_lines_v with (security_barrier = true) as ' || v_def;
end $$;

-- create or replace keeps a view's grants; restated so this file alone
-- shows who may read it (20261022090000).
revoke all on public.report_payroll_lines_v from public, anon, authenticated;

comment on view public.report_payroll_lines_v is
  'One row per shift that can carry money (§9.9): worked, turned away, no-show (0) and §3.3 same-day cancellations (full scheduled hours). Pay from payable_shifts_v only; base and holiday priced separately; pending has no figure. Pending = the pay is undetermined OR a No check-out on the booking is unresolved, including one raised on a stale fix with a recorded finish (ADR-0174). overrun_min / overrun_invoicing: of payable_min / invoicing, the part past the scheduled end of a shift signed out more than 15 minutes late (ADR-0184) — the invoice''s separate Overrun line. Owner-rights and granted to nobody: read through the report functions.';

-- ---------------------------------------------------------------------
-- 8 · The invoice: the overrun is its own line
-- ---------------------------------------------------------------------
-- Each billable shift is one line, as before; one signed out late gets a
-- second, kind 'overrun', straight after it: same worker, role and charge
-- rate, from the scheduled end to the actual finish, no break, the
-- overrun minutes and their charge. The main line keeps the rest, so the
-- two amounts add up to the shift's `invoicing` to the penny and the
-- invoice net is unchanged (invoice_claim checks it against the group's).
do $$
declare
  v_def   text := pg_get_functiondef('public.invoice_claim(text, timestamptz)'::regprocedure);
  v_start text := 'insert into invoice_lines (invoice_id';
  v_end   text := 'and l.status = ''settled'';';
  i       int;
  j       int;
  v_new   text := $sql$insert into invoice_lines (invoice_id, event_id, booking_id, sort, line_date, staff_name,
                             employee_id, role_name, starts_at, ends_at, break_min, payable_min,
                             rate, amount, kind, check_in_at, check_out_at, late, left_early,
                             finish_by_office, floor_applied)
  select v_id, l.event_id, l.booking_id,
         row_number() over (order by l.shift_date, l.starts_at, l.role_name, l.removed,
                                     l.sort_surname nulls last, l.staff_name, l.booking_id,
                                     part.n)::int,
         l.shift_date, l.staff_name, l.employee_id, l.role_name, part.starts_at, part.ends_at,
         part.break_min, part.payable_min, l.charge_rate, part.amount, part.kind,
         l.check_in_at, l.check_out_at,
         part.n = 1 and coalesce(l.late_check_in, false),
         part.n = 1 and coalesce(l.early_check_out, false),
         exists (select 1 from violations v
                  where v.booking_id = l.booking_id and v.type = 'no_checkout' and v.resolved),
         part.n = 1 and coalesce(l.floor_applied, false)
    from report_payroll_lines_v l
    -- ADR-0184: the main line, then the overrun past the scheduled end.
    cross join lateral (
      select 1 as n, l.kind as kind, l.starts_at as starts_at, l.ends_at as ends_at,
             coalesce(l.unpaid_break_min, 0) as break_min,
             coalesce(l.payable_min, 0) - coalesce(l.overrun_min, 0) as payable_min,
             coalesce(l.invoicing, 0) - coalesce(l.overrun_invoicing, 0) as amount
      union all
      select 2, 'overrun', l.ends_at, l.check_out_at, 0, l.overrun_min, l.overrun_invoicing
       where coalesce(l.overrun_min, 0) > 0
    ) part
   where l.event_id = any (g.event_ids)
     and l.kind in ('worked', 'cancelled_on_day')
     and l.status = 'settled';$sql$;
begin
  if (length(v_def) - length(replace(v_def, v_start, ''))) / length(v_start) <> 1
     or (length(v_def) - length(replace(v_def, v_end, ''))) / length(v_end) <> 1 then
    raise exception '20261022200000: invoice_claim - expected one invoice_lines insert';
  end if;
  i := position(v_start in v_def);
  j := position(v_end in v_def) + length(v_end);
  if j <= i then
    raise exception '20261022200000: invoice_claim - the insert''s end precedes its start';
  end if;
  execute substr(v_def, 1, i - 1) || v_new || substr(v_def, j);
end $$;

comment on function public.invoice_claim(text, timestamptz) is
  'ADR-0176: issues the invoice for a due group under an advisory lock — the next number from invoice_counter (gapless), the bill-to and seller snapshotted, the events linked (each once), the settled billable lines copied with the actual sign-in / sign-out, late, left-early, office-entered finish and 4-hour-minimum flags, net/VAT/total. A shift signed out more than 15 minutes late adds a second line, kind overrun, for the time past the scheduled end at the same charge rate (ADR-0184). Null when the group is no longer due. Service role.';

comment on column public.invoice_lines.kind is
  'worked · cancelled_on_day · overrun (ADR-0184: the time past the scheduled end of a shift signed out more than 15 minutes late, starts_at = the scheduled end, ends_at = the actual finish, directly after that shift''s own line).';

-- ---------------------------------------------------------------------
-- 9 · The document names each line's booking (the log folds the overrun)
-- ---------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_functiondef('public.invoice_document_data(uuid)'::regprocedure);
  a text := '''eventId'', l.event_id)';
  b text := '''eventId'', l.event_id, ''bookingId'', l.booking_id)';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then
    raise exception '20261022200000: invoice_document_data - expected one match of the line''s eventId';
  end if;
  execute replace(v_def, a, b);
end $$;

-- ---------------------------------------------------------------------
-- 10 · The invoicing CSV splits the overrun the same way
-- ---------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_functiondef('public.invoice_export_rows(date, date, uuid)'::regprocedure);
  a1 text := 'l.starts_at, l.ends_at, l.check_in_at, l.check_out_at, l.kind,
         l.unpaid_break_min, l.payable_min, l.charge_rate, l.invoicing
    from ready i
    join report_payroll_lines_v l on l.event_id = i.event_id';
  b1 text := 'part.starts_at, part.ends_at, l.check_in_at, l.check_out_at, part.kind,
         part.break_min, part.payable_min, l.charge_rate, part.amount
    from ready i
    join report_payroll_lines_v l on l.event_id = i.event_id
    -- ADR-0184: the main row, then the overrun past the scheduled end.
    cross join lateral (
      select 1 as n, l.kind as kind, l.starts_at as starts_at, l.ends_at as ends_at,
             l.unpaid_break_min as break_min,
             l.payable_min - coalesce(l.overrun_min, 0) as payable_min,
             l.invoicing - coalesce(l.overrun_invoicing, 0) as amount
      union all
      select 2, ''overrun'', l.ends_at, l.check_out_at, 0, l.overrun_min, l.overrun_invoicing
       where coalesce(l.overrun_min, 0) > 0
    ) part';
  a2 text := 'l.sort_surname nulls last, l.staff_name, l.booking_id;';
  b2 text := 'l.sort_surname nulls last, l.staff_name, l.booking_id, part.n;';
begin
  if (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1
     or (length(v_def) - length(replace(v_def, a2, ''))) / length(a2) <> 1 then
    raise exception '20261022200000: invoice_export_rows - expected one match of each fragment';
  end if;
  execute replace(replace(v_def, a1, b1), a2, b2);
end $$;
