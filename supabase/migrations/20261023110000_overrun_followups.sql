-- =====================================================================
-- 20261023110000 · ADR-0184 follow-ups (THC's owner, 21.10.2026)
--
-- The four items 20261022200100 left for later, done now:
--
--   1 · RULE-20's weekly cap counts the PAID overrun. The cap is judged on
--       "booked" hours — each counted booking's scheduled length. A shift
--       signed out more than 15 minutes late was worked (and paid) longer,
--       so the hours counted against the cap for its Mon–Sun week now add
--       its paid overrun minutes: payable_minutes()' overrunMin (capped at
--       end + 4 h, nothing before 21.10.2026 UK), once its pay is settled.
--       cap_overrun_minutes() is the rule (pay.vectors.json `capOverrun`,
--       070); booking_overrun_hours() reads one booking's; it is added
--       wherever the week's hours are summed: weekly_booked_hours(),
--       weekly_booked_hours_except() (rota guard), series_hours_blocked(),
--       auto_assign_candidates_pool_pairs() and staff_directory_v (and so
--       staff_profile_v and student_visa_v).
--       The office sees it: late_check_outs() and checkin_monitor_v carry
--       the week's counted hours and cap for a late sign-out, and /checkin
--       warns "Over weekly limit: 21 h 15 of 20 h".
--   2 · Each invoice line is priced from its own minutes: a shift's
--       `invoicing` is round(main minutes × rate / 60, 2) + round(overrun
--       minutes × rate / 60, 2), so the invoice's two lines are each
--       minutes × rate and still add up to the shift — and everything that
--       sums `invoicing` (ready to invoice, the invoice net, the CSV, the
--       financial report) agrees. Pay stays one figure (payroll never shows
--       the split). The overrun line ends at the paid end — the actual
--       finish, or end + 4 h for a finish entered later.
--   3 · The office's ready-to-invoice review shows the split:
--       invoice_event_lines() gains overrun_min, overrun_invoicing,
--       late_check_out and late_check_out_verified. The fingerprint needs
--       nothing new: it already covers each line's check-out, payable
--       minutes and amount, from which the split follows.
--   4 · check_logs is written only through functions. `authenticated` held
--       UPDATE (and INSERT, DELETE) under admin_all with no column guard,
--       so an office login could PATCH a check-in, a check-out, a manager's
--       finish or a Verify through PostgREST without audit. A row trigger
--       now refuses any write whose current_user is an API role (anon,
--       authenticated): 42501 not_permitted. Every legitimate writer runs
--       as the function owner — attempt_check_in(), check_out(),
--       record_ping(), remove_worker(), verify_late_check_out() were
--       already SECURITY DEFINER; resolve_violation() (and through it
--       get_back()) was the one invoker writer and becomes a definer here,
--       with its own admin check unchanged. Jobs use the service role.
--
-- Functions and views edited in place are re-created from their LIVE
-- definitions with checked replacements (docs/10 §3b). Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1a · The rule, and one booking's reading of it
-- ---------------------------------------------------------------------
create or replace function public.cap_overrun_minutes(
  p_starts_at        timestamptz,
  p_ends_at          timestamptz,
  p_check_in_at      timestamptz,
  p_finish_at        timestamptz,
  p_unpaid_break_min int  default 0,
  p_no_check_out     text default 'none'
) returns int
language plpgsql
immutable
set search_path = public, extensions
as $$
begin
  -- Not settled: no recorded finish, or a No check-out still open.
  if p_finish_at is null or coalesce(p_no_check_out, 'none') = 'unresolved' then
    return 0;
  end if;
  return coalesce((payable_minutes(p_starts_at, p_ends_at, p_check_in_at, p_finish_at,
                                   p_unpaid_break_min, false, 'none') ->> 'overrunMin')::int, 0);
end $$;

comment on function public.cap_overrun_minutes(timestamptz, timestamptz, timestamptz, timestamptz, int, text) is
  'RULE-20 with ADR-0184: the paid overrun minutes a shift adds to the hours counted against the weekly cap — payable_minutes()'' overrunMin once its pay is settled, else 0. Mirrored by capOverrunMinutes() in packages/domain/pay.ts; both held to pay.vectors.json (capOverrun).';

-- One booking's paid overrun, in hours, for summing into a week. Called
-- once per counted booking by every weekly sum, so it answers WITHOUT a
-- read for every section that cannot have one — before the cutoff, or not
-- yet 15 minutes past its end, i.e. every future booking a cap check reads
-- — and plpgsql keeps its one query's plan for the session (ADR-0155).
-- Invoker: it reads check_logs as the caller, which is the owner inside
-- the definer paths a worker takes and the office everywhere else.
create or replace function public.booking_overrun_hours(p_booking uuid, p_ends_at timestamptz)
returns numeric
language plpgsql
stable
set search_path = public, extensions
as $$
begin
  if p_ends_at < timestamptz '2026-10-20 23:00:00+00'
     or p_ends_at > now() - interval '15 minutes' then
    return 0;
  end if;
  return coalesce((
    select cap_overrun_minutes(
             sr.starts_at, sr.ends_at, cl.check_in_at, cl.finish,
             unpaid_break_minutes(p_booking),
             case when exists (select 1 from violations v
                                where v.booking_id = p_booking
                                  and v.type = 'no_checkout' and not v.resolved)
                  then 'unresolved' else 'none' end)
      from (select c.check_in_at, coalesce(c.manager_finish_at, c.check_out_at) as finish
              from check_logs c
             where c.booking_id = p_booking and c.check_in_at is not null
             order by c.check_in_at
             limit 1) cl
      join bookings b on b.id = p_booking
      join shift_requirements sr on sr.id = b.shift_id
     where cl.finish > sr.ends_at + interval '15 minutes'), 0)::numeric / 60;
end $$;

comment on function public.booking_overrun_hours(uuid, timestamptz) is
  'RULE-20 with ADR-0184: one booking''s paid overrun in hours (cap_overrun_minutes on its accepted check log), added to its scheduled hours wherever a week''s hours are counted against the weekly cap. p_ends_at is its section''s end, so sections that cannot carry one are answered without a read.';

-- ---------------------------------------------------------------------
-- 1b · Everywhere a week's hours are summed
-- ---------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  -- weekly_booked_hours(staff, date)
  v_def := pg_get_functiondef('public.weekly_booked_hours(uuid, date)'::regprocedure);
  if (length(v_def) - length(replace(v_def, 'select sr.starts_at, sr.ends_at, b.status, b.cancelled_at, b.cancel_cause', ''))) /
     length('select sr.starts_at, sr.ends_at, b.status, b.cancelled_at, b.cancel_cause') <> 1
     or (length(v_def) - length(replace(v_def, 'coalesce(sum(extract(epoch from (w.ends_at - w.starts_at)) / 3600.0), 0)::numeric', ''))) /
        length('coalesce(sum(extract(epoch from (w.ends_at - w.starts_at)) / 3600.0), 0)::numeric') <> 1 then
    raise exception '20261023110000: weekly_booked_hours - fragments not found exactly once';
  end if;
  v_def := replace(v_def, 'select sr.starts_at, sr.ends_at, b.status, b.cancelled_at, b.cancel_cause',
                          'select b.id as booking_id, sr.starts_at, sr.ends_at, b.status, b.cancelled_at, b.cancel_cause');
  v_def := replace(v_def, 'coalesce(sum(extract(epoch from (w.ends_at - w.starts_at)) / 3600.0), 0)::numeric',
                          'coalesce(sum(extract(epoch from (w.ends_at - w.starts_at)) / 3600.0
                         + booking_overrun_hours(w.booking_id, w.ends_at)), 0)::numeric');
  execute v_def;

  -- weekly_booked_hours_except(staff, date, shift) — the rota guard's.
  v_def := pg_get_functiondef('public.weekly_booked_hours_except(uuid, date, uuid)'::regprocedure);
  if (length(v_def) - length(replace(v_def, 'coalesce(sum(extract(epoch from (sr.ends_at - sr.starts_at)) / 3600.0), 0)::numeric', ''))) /
     length('coalesce(sum(extract(epoch from (sr.ends_at - sr.starts_at)) / 3600.0), 0)::numeric') <> 1 then
    raise exception '20261023110000: weekly_booked_hours_except - sum not found exactly once';
  end if;
  execute replace(v_def, 'coalesce(sum(extract(epoch from (sr.ends_at - sr.starts_at)) / 3600.0), 0)::numeric',
                         'coalesce(sum(extract(epoch from (sr.ends_at - sr.starts_at)) / 3600.0
                         + booking_overrun_hours(b.id, sr.ends_at)), 0)::numeric');

  -- series_hours_blocked(staff, shift) — ADR-0117's projection.
  v_def := pg_get_functiondef('public.series_hours_blocked(uuid, uuid)'::regprocedure);
  if (length(v_def) - length(replace(v_def, 'coalesce(sum(extract(epoch from (sr.ends_at - sr.starts_at)) / 3600.0), 0)::numeric', ''))) /
     length('coalesce(sum(extract(epoch from (sr.ends_at - sr.starts_at)) / 3600.0), 0)::numeric') <> 1 then
    raise exception '20261023110000: series_hours_blocked - sum not found exactly once';
  end if;
  execute replace(v_def, 'coalesce(sum(extract(epoch from (sr.ends_at - sr.starts_at)) / 3600.0), 0)::numeric',
                         'coalesce(sum(extract(epoch from (sr.ends_at - sr.starts_at)) / 3600.0
                         + booking_overrun_hours(b.id, sr.ends_at)), 0)::numeric');
end $$;

-- The auto-assign pool's one body (ADR-0170): the week's hours per
-- section and worker. Each week_src row now carries its booking.
do $$
declare
  v_def text := pg_get_functiondef('public.auto_assign_candidates_pool_pairs(uuid[], uuid[], boolean)'::regprocedure);
  a1 text := 'select sec.shift_id as for_shift, sec.week_start, x.staff_id, x.shift_id,';
  b1 text := 'select sec.shift_id as for_shift, sec.week_start, x.booking_id, x.staff_id, x.shift_id,';
  a2 text := 'select b.staff_id, b.shift_id, b.status, b.cancelled_at, b.cancel_cause, sr2.starts_at, sr2.ends_at';
  b2 text := 'select b.id as booking_id, b.staff_id, b.shift_id, b.status, b.cancelled_at, b.cancel_cause, sr2.starts_at, sr2.ends_at';
  a3 text := 'select ps.shift_id as for_shift, ps.week_start, wb.staff_id, wb.shift_id,';
  b3 text := 'select ps.shift_id as for_shift, ps.week_start, wb.id as booking_id, wb.staff_id, wb.shift_id,';
  a4 text := 'coalesce(sum(extract(epoch from (w.ends_at - w.starts_at)) / 3600.0), 0)::numeric as booked';
  b4 text := 'coalesce(sum(extract(epoch from (w.ends_at - w.starts_at)) / 3600.0
                    + booking_overrun_hours(w.booking_id, w.ends_at)), 0)::numeric as booked';
  f text;
begin
  foreach f in array array[a1, a2, a3, a4] loop
    if (length(v_def) - length(replace(v_def, f, ''))) / length(f) <> 1 then
      raise exception '20261023110000: auto_assign_candidates_pool_pairs - expected one match of: %', f;
    end if;
  end loop;
  execute replace(replace(replace(replace(v_def, a1, b1), a2, b2), a3, b3), a4, b4);
end $$;

-- staff_directory_v's "this week" (and staff_profile_v, student_visa_v on it).
do $$
declare
  v_def text := pg_get_viewdef('public.staff_directory_v'::regclass, true);
  v_n   int;
  p1 constant text := $re$SELECT bb\.staff_id,(\s+)bb\.status,$re$;
  r1 constant text := $sql$SELECT bb.id,\1bb.staff_id,\1bb.status,$sql$;
  p2 constant text := $re$sum\(EXTRACT\(epoch FROM sr\.ends_at - sr\.starts_at\) / 3600\.0\) FILTER \(WHERE booking_counts_toward_cap\(b\.status, b\.cancelled_at, b\.cancel_cause\)\) AS booked_hours$re$;
  r2 constant text := $sql$sum(EXTRACT(epoch FROM sr.ends_at - sr.starts_at) / 3600.0 + booking_overrun_hours(b.id, sr.ends_at)) FILTER (WHERE booking_counts_toward_cap(b.status, b.cancelled_at, b.cancel_cause)) AS booked_hours$sql$;
  -- The week's worked hours beside it: the same overrun, actually worked.
  p3 constant text := $re$sum\(EXTRACT\(epoch FROM sr\.ends_at - sr\.starts_at\) / 3600\.0\) FILTER \(WHERE b\.status = 'worked'::booking_status\) AS worked_hours$re$;
  r3 constant text := $sql$sum(EXTRACT(epoch FROM sr.ends_at - sr.starts_at) / 3600.0 + booking_overrun_hours(b.id, sr.ends_at)) FILTER (WHERE b.status = 'worked'::booking_status) AS worked_hours$sql$;
begin
  -- Both laterals (booked, worked) carry the booking id.
  select count(*) into v_n from regexp_matches(v_def, p1, 'g');
  if v_n <> 2 then raise exception '20261023110000: staff_directory_v - pattern 1 matched % times', v_n; end if;
  select count(*) into v_n from regexp_matches(v_def, p2, 'g');
  if v_n <> 1 then raise exception '20261023110000: staff_directory_v - pattern 2 matched % times', v_n; end if;
  select count(*) into v_n from regexp_matches(v_def, p3, 'g');
  if v_n <> 1 then raise exception '20261023110000: staff_directory_v - pattern 3 matched % times', v_n; end if;
  execute 'create or replace view public.staff_directory_v with (security_invoker = true) as '
          || regexp_replace(regexp_replace(regexp_replace(v_def, p1, r1, 'g'), p2, r2), p3, r3);
end $$;

-- ---------------------------------------------------------------------
-- 2 · Each line priced from its own minutes
-- ---------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_viewdef('public.report_payroll_lines_v'::regclass, true);
  v_n   int;
  p1 constant text := $re$WHEN x\.kind = ANY \(ARRAY\['worked'::text, 'cancelled_on_day'::text\]\) THEN round\(x\.payable_min::numeric \* x\.charge_rate / 60::numeric, 2\)$re$;
  r1 constant text := $sql$WHEN x.kind = ANY (ARRAY['worked'::text, 'cancelled_on_day'::text]) THEN round((x.payable_min - x.overrun_min)::numeric * x.charge_rate / 60::numeric, 2) + round(x.overrun_min::numeric * x.charge_rate / 60::numeric, 2)$sql$;
begin
  select count(*) into v_n from regexp_matches(v_def, p1, 'g');
  if v_n <> 1 then
    raise exception '20261023110000: report_payroll_lines_v - expected one match of the invoicing price, found %', v_n;
  end if;
  execute 'create or replace view public.report_payroll_lines_v with (security_barrier = true) as '
          || regexp_replace(v_def, p1, r1);
end $$;

revoke all on public.report_payroll_lines_v from public, anon, authenticated;

comment on view public.report_payroll_lines_v is
  'One row per shift that can carry money (§9.9): worked, turned away, no-show (0) and §3.3 same-day cancellations (full scheduled hours). Pay from payable_shifts_v only; base and holiday priced separately; pending has no figure. Pending = the pay is undetermined OR a No check-out on the booking is unresolved, including one raised on a stale fix with a recorded finish (ADR-0174). overrun_min / overrun_invoicing: of payable_min / invoicing, the part past the scheduled end of a shift signed out more than 15 minutes late (ADR-0184) — the invoice''s separate Overrun line. invoicing = the main minutes priced + the overrun minutes priced, each rounded on its own, so each invoice line is its minutes × rate. Owner-rights and granted to nobody: read through the report functions.';

-- The overrun line ends where the pay does: the actual finish, or end + 4 h
-- for a finish entered later than that (20261022200100). Not quite "always
-- its minutes": when breaks are longer than the shift's main part the
-- overrun gives way, so 20261023110100 ends it at the scheduled end plus
-- its own minutes instead — the rule the office's review uses.
do $$
declare
  a text := 'select 2, ''overrun'', l.ends_at, l.check_out_at, 0, l.overrun_min, l.overrun_invoicing';
  b text := 'select 2, ''overrun'', l.ends_at, least(l.check_out_at, l.ends_at + interval ''4 hours''), 0, l.overrun_min, l.overrun_invoicing';
  f regprocedure;
  v_def text;
begin
  foreach f in array array['public.invoice_claim(text, timestamptz)'::regprocedure,
                           'public.invoice_export_rows(date, date, uuid)'::regprocedure] loop
    v_def := pg_get_functiondef(f);
    if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then
      raise exception '20261023110000: % - expected one overrun line', f;
    end if;
    execute replace(v_def, a, b);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3 · The office's review shows the split
-- ---------------------------------------------------------------------
drop function public.invoice_event_lines(uuid);

create function public.invoice_event_lines(p_event uuid)
returns table (
  booking_id              uuid,
  staff_name              text,
  employee_id             int,
  removed                 boolean,
  role_name               text,
  shift_date              date,
  starts_at               timestamptz,
  ends_at                 timestamptz,
  check_in_at             timestamptz,
  check_out_at            timestamptz,
  kind                    text,
  status                  text,
  late_check_in           boolean,
  early_check_out         boolean,
  no_check_out_unresolved boolean,
  unpaid_break_min        int,
  payable_min             int,
  floor_applied           boolean,
  charge_rate             numeric,
  invoicing               numeric,
  overrun_min             int,
  overrun_invoicing       numeric,
  late_check_out          boolean,
  late_check_out_verified boolean
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
         l.floor_applied, l.charge_rate, l.invoicing,
         case when l.status = 'settled' then coalesce(l.overrun_min, 0) else 0 end,
         case when l.status = 'settled' then coalesce(l.overrun_invoicing, 0) end,
         -- §9.5's flag: the clock, whichever side of ADR-0184's cutoff.
         coalesce(l.kind = 'worked' and l.check_out_at > l.ends_at + interval '15 minutes', false),
         cl.late_check_out_verified_at is not null
    from report_payroll_lines_v l
    left join lateral (
      select c.late_check_out_verified_at from check_logs c
       where c.booking_id = l.booking_id and c.check_in_at is not null
       order by c.check_in_at limit 1
    ) cl on true
   where l.event_id = p_event
   -- §11.3's order: by role section, then surname.
   order by l.starts_at, l.role_name, l.removed, l.sort_surname nulls last, l.staff_name, l.booking_id;
end $$;

comment on function public.invoice_event_lines(uuid) is
  'ADR-0172: every shift line of one event with payable minutes, charge rate and invoice amount (report_payroll_lines_v); pending lines carry no amount. ADR-0184: of them, the overrun minutes and amount (its own line on the invoice), whether the shift was signed out more than 15 minutes late, and whether the office has verified that. Finance callers only.';

revoke execute on function public.invoice_event_lines(uuid) from public, anon;
grant execute on function public.invoice_event_lines(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1c · The office's list carries the week against the cap
-- ---------------------------------------------------------------------
drop function public.late_check_outs(int, boolean);

create function public.late_check_outs(p_days int default 14, p_include_verified boolean default false)
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
  note              text,
  week_hours        numeric,
  week_cap_hours    int
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
         cl.late_check_out_verified_at, p.full_name, cl.late_check_out_note,
         -- RULE-20: the Mon–Sun week the section starts in, overrun counted.
         round(weekly_booked_hours(b.staff_id, (sr.starts_at at time zone 'Europe/London')::date), 2),
         weekly_cap_hours(b.staff_id, (sr.starts_at at time zone 'Europe/London')::date)
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
     -- ADR-0184's effective date: earlier sections were paid to their end.
     and sr.ends_at >= timestamptz '2026-10-20 23:00:00+00'
     and coalesce(cl.manager_finish_at, cl.check_out_at) > sr.ends_at + interval '15 minutes'
     and (p_include_verified or cl.late_check_out_verified_at is null)
     -- A No check-out still open is the violation log's to settle first.
     and not exists (select 1 from violations v
                      where v.booking_id = b.id and v.type = 'no_checkout' and not v.resolved)
   order by coalesce(cl.manager_finish_at, cl.check_out_at) desc, b.id
   limit 200;
end $$;

comment on function public.late_check_outs(int, boolean) is
  'ADR-0184: shifts signed out more than 15 minutes past their section end, on sections ended in the last p_days days (1–92, default 14) and on or after 21.10.2026 00:00 UK, newest first, unverified only unless p_include_verified; with the worker''s hours counted against the weekly cap for that Mon–Sun week (overrun included) and the cap, for the "Over weekly limit" warning. No money. Office only.';

revoke execute on function public.late_check_outs(int, boolean) from public, anon;
grant execute on function public.late_check_outs(int, boolean) to authenticated, service_role;

-- The monitor: the same two figures, for a late sign-out only.
do $$
declare
  v_def text := pg_get_viewdef('public.checkin_monitor_v'::regclass, true);
  v_n   int;
  p1 constant text := $re$cl\.late_check_out_note(\s+)FROM bookings b$re$;
  r1 constant text := $sql$cl.late_check_out_note,
        CASE
            WHEN COALESCE(cl.manager_finish_at, cl.check_out_at) > (sr.ends_at + '00:15:00'::interval) THEN round(weekly_booked_hours(b.staff_id, (sr.starts_at AT TIME ZONE 'Europe/London'::text)::date), 2)
            ELSE NULL::numeric
        END AS week_hours,
        CASE
            WHEN COALESCE(cl.manager_finish_at, cl.check_out_at) > (sr.ends_at + '00:15:00'::interval) THEN weekly_cap_hours(b.staff_id, (sr.starts_at AT TIME ZONE 'Europe/London'::text)::date)
            ELSE NULL::integer
        END AS week_cap_hours\1FROM bookings b$sql$;
begin
  select count(*) into v_n from regexp_matches(v_def, p1, 'g');
  if v_n <> 1 then
    raise exception '20261023110000: checkin_monitor_v - expected one match of the last column, found %', v_n;
  end if;
  execute 'create or replace view public.checkin_monitor_v with (security_invoker = true) as '
          || regexp_replace(v_def, p1, r1);
end $$;

-- ---------------------------------------------------------------------
-- 4 · check_logs is written only through functions
-- ---------------------------------------------------------------------
-- The one invoker writer becomes a definer. Its body already refuses any
-- caller but the office (current_app_role() = 'admin'), and office_read_only
-- still refuses a viewer (it reads auth.uid(), not the role).
alter function public.resolve_violation(uuid, text, timestamptz, timestamptz) security definer;
revoke execute on function public.resolve_violation(uuid, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.resolve_violation(uuid, text, timestamptz, timestamptz) to authenticated, service_role;

create or replace function public.check_logs_write_guard()
returns trigger
language plpgsql
-- Invoker on purpose: current_user is the API role on a direct write and
-- the function owner inside a SECURITY DEFINER writer.
set search_path = public, extensions
as $$
begin
  if current_user in ('authenticated', 'anon') then
    raise exception 'not_permitted' using errcode = '42501',
      detail = format('check_logs is written only by the check-in, check-out and correction functions (%s refused, ADR-0184).', tg_op);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

revoke execute on function public.check_logs_write_guard() from public, anon, authenticated;

create trigger check_logs_write_guard
  before insert or update or delete on public.check_logs
  for each row execute function public.check_logs_write_guard();

comment on function public.check_logs_write_guard() is
  'ADR-0184 follow-up: refuses an insert, update or delete on check_logs made directly by an API role (anon, authenticated) — e.g. an office login PATCHing a check-in, check-out, finish or Verify through PostgREST without audit. attempt_check_in, check_out, record_ping, remove_worker, resolve_violation (get_back) and verify_late_check_out are SECURITY DEFINER; jobs use the service role.';
