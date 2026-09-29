-- =====================================================================
-- A personal pay rate per worker (ADR-0072; §9.6, §9.8, §9.9, §1.5)
--
-- The product owner, 29.09.2026: "staff pay rate should be £12.71 for all
-- roles, but should be editable at event level and staff member level".
-- Role level is roles.pay_rate (/roles, §9.8); event level is each role
-- section's own shift_requirements.pay_rate (the Shift Builder, §3.2).
-- This adds the third level:
--
--   1. staff_pay_rates — ONE optional base rate per worker, used for every
--      role they work. No row = no personal rate. Its own table, not a
--      column on `staff`: every office role reads `staff`, and a scheduler
--      must never see money (ADR-0061). RLS: Back Office logins with
--      finance read it; nobody writes it but set_staff_pay_rate(). No
--      staff, client or anon policy — the worker learns their own rate
--      only through the definer RPCs that already hand them their base
--      rate.
--
--   2. effective_pay_rate(staff, section rate) — THE precedence rule,
--      stated once: coalesce(personal, section). Security INVOKER, so the
--      table's RLS decides what it may add: definer code (the pay engine,
--      the reports, the worker's RPCs — current_user is the owner) and the
--      service role always see the personal rate; an API session sees it
--      only with finance, and otherwise gets back exactly the section
--      rate it passed in — which, in every invoker view, is already NULL
--      for a scheduler (ADR-0061).
--
--   1b. office_rate_payloads — the one place definer code writes a
--      worker's rate where the office can read it: the "£x.xx" in N5 / OF1
--      push payloads on notification_outbox, whose admin_read every office
--      login holds, a scheduler included. A restrictive read fence, like
--      office_users_invite_links: a row whose payload carries `rate` is
--      read only with finance. It closes the section-rate leak ADR-0061
--      missed as well as the personal one.
--
--   3. set_staff_pay_rate(staff, rate) — the one write path. Null clears.
--      Validated like assert_role_input (not negative, to the penny),
--      finance-gated by assert_finance_caller(), refused on a removed
--      worker. Not written to audit_log: rate changes on roles and rate
--      cards are not audited either, and audit_log is readable by every
--      office login — a scheduler included — so an amount there would
--      leak. The row keeps who set it and when.
--
--   4. Everywhere a WORKER's rate is derived now asks effective_pay_rate():
--      payable_shifts_v (→ report_payroll_lines_v → payroll report,
--      payroll export, the financial report's actual lines), the
--      cancelled-on-the-day branch of report_payroll_lines_v, and the
--      nine definer functions that hand a worker their rate — My shifts,
--      Radar, offers, shift detail, check-out, earnings, and the N5 / OF1
--      push payloads. Figures that describe a SECTION rather than a person
--      stay section-based: the Shift Builder's rate, the event board's
--      rate line, the dashboard forecast (headcount × section rate), the
--      financial report's forecast for sections not yet worked, the client
--      card's margins.
--
-- Retroactivity (CLAUDE.md: payroll exports are never corrected
-- retroactively). The personal rate is read live, exactly as the section
-- rate is: a change applies to every figure computed from then on, and so
-- to any shift not yet exported. payroll_export_lines keeps what was
-- exported, and payroll_report's changed_since_export flags a line whose
-- live total no longer matches it — the existing warning, unchanged.
--
-- Nothing here edits an earlier migration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The table
-- ---------------------------------------------------------------------
create table public.staff_pay_rates (
  staff_id uuid primary key references public.staff (id) on delete cascade,
  -- 'NaN' passes `>= 0` and fits numeric(8,2); it is not a rate.
  pay_rate numeric(8,2) not null check (pay_rate >= 0 and pay_rate <> 'NaN'::numeric),
  set_by   uuid references public.profiles (id) on delete set null,
  set_at   timestamptz not null default now()
);

-- 002: every foreign key is covered by an index (staff_id is the key).
create index staff_pay_rates_set_by_idx on public.staff_pay_rates (set_by);

comment on table public.staff_pay_rates is
  'ADR-0072: a worker''s personal base pay rate (£/h), used for every role they work instead of the role section''s rate — effective_pay_rate(). No row = no personal rate. Back Office logins with finance read it (admin_finance_read); written only by set_staff_pay_rate(). Never on `staff`, which a scheduler reads (ADR-0061). Holiday +12.07% is derived (final_rate), never stored.';

alter table public.staff_pay_rates enable row level security;

-- SELECT for the signed-in role is what lets the invoker views and
-- effective_pay_rate() ask at all — the policy decides what comes back, so
-- a scheduler or a worker reads an empty table rather than an error. No
-- write grant: set_staff_pay_rate() is the only door.
revoke all on table public.staff_pay_rates from public, anon, authenticated;
grant select on table public.staff_pay_rates to authenticated;
grant all on table public.staff_pay_rates to service_role;

create policy admin_finance_read on public.staff_pay_rates
  for select to authenticated
  using ((select current_app_role()) = 'admin'::app_role and (select office_can('finance')));

-- ADR-0060: every public table carries the viewer's write guard (750 fails
-- otherwise). A viewer holds finance, so set_staff_pay_rate() lets them
-- through its own gate; this refuses the write.
create trigger office_read_only
  before insert or update or delete or truncate on public.staff_pay_rates
  for each statement execute function public.office_read_only_guard();

-- ---------------------------------------------------------------------
-- 1b · The outbox fence (security review, 29.09.2026)
--
-- N5 and OF1 pushes carry the recipient's rate ('rate' => '£x.xx', now
-- the personal one — section 6). notification_outbox's admin_read lets
-- every office login read every row; a scheduler must not see money
-- (ADR-0061). Restrictive, so it narrows admin_read and never widens it.
-- /inbox reads office-addressed email templates, which carry no `rate`,
-- so no screen changes; definer code (the drain, the jobs) is unaffected.
-- ---------------------------------------------------------------------
create policy office_rate_payloads on public.notification_outbox
  as restrictive
  for select
  to authenticated
  using (not (payload ? 'rate') or (select office_can('finance')));

comment on policy office_rate_payloads on public.notification_outbox is
  'ADR-0072 / ADR-0061: a row whose payload carries a worker''s pay rate (N5, OF1 pushes) is read only by a session with office_can(''finance''). 20261001215000.';

-- ---------------------------------------------------------------------
-- 2 · The precedence rule, once
-- ---------------------------------------------------------------------
create or replace function public.effective_pay_rate(p_staff uuid, p_section_rate numeric)
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce((select spr.pay_rate from staff_pay_rates spr where spr.staff_id = p_staff),
                  p_section_rate)
$$;

comment on function public.effective_pay_rate(uuid, numeric) is
  'ADR-0072: a worker''s base pay rate on a role section — their personal rate (staff_pay_rates) when set, otherwise the section''s. Security INVOKER: staff_pay_rates'' RLS decides whether the personal rate is visible, so definer code and service_role always apply it, a Back Office login with finance sees it, and anyone else gets back the section rate they passed in.';

revoke all on function public.effective_pay_rate(uuid, numeric) from public, anon;
grant execute on function public.effective_pay_rate(uuid, numeric) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3 · The one write path
-- ---------------------------------------------------------------------
create or replace function public.set_staff_pay_rate(p_staff uuid, p_pay_rate numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_removed timestamptz;
begin
  -- A Back Office login with finance, or the service role (ADR-0056).
  perform assert_finance_caller();

  -- assert_role_input's words: the rate is money and the column is to the
  -- penny, so a third decimal is refused, never rounded.
  if p_pay_rate = 'NaN'::numeric then
    raise exception 'A pay rate must be a number' using errcode = 'check_violation';
  end if;
  if p_pay_rate is not null and p_pay_rate < 0 then
    raise exception 'A pay rate cannot be negative' using errcode = 'check_violation';
  end if;
  if p_pay_rate is not null and p_pay_rate <> round(p_pay_rate, 2) then
    raise exception 'A pay rate is set to the penny' using errcode = 'check_violation';
  end if;

  select s.removed_at into v_removed from staff s where s.id = p_staff for update;
  if not found then
    raise exception 'No staff member %', p_staff using errcode = 'no_data_found';
  end if;
  -- §1.7: a removed worker works no more shifts; their history keeps the
  -- rate it was priced at.
  if v_removed is not null then
    raise exception 'staff_removed' using errcode = 'P0001',
      detail = 'This worker was removed under GDPR; their pay rate is kept as it was.';
  end if;

  if p_pay_rate is null then
    delete from staff_pay_rates where staff_id = p_staff;
  else
    insert into staff_pay_rates (staff_id, pay_rate, set_by, set_at)
    values (p_staff, p_pay_rate, auth.uid(), now())
    on conflict (staff_id) do update
      set pay_rate = excluded.pay_rate, set_by = excluded.set_by, set_at = excluded.set_at;
  end if;
end;
$$;

comment on function public.set_staff_pay_rate(uuid, numeric) is
  'ADR-0072: set (or, with null, clear) a worker''s personal base pay rate — /staff/:id. Back Office logins with finance and the service role only (assert_finance_caller); not negative, to the penny; refused on a removed worker. Applies to every figure computed from now on — payroll lines already exported keep their figures (payroll_report flags the difference). Not audited in audit_log, which every office role reads; the row records set_by / set_at.';

revoke all on function public.set_staff_pay_rate(uuid, numeric) from public, anon;
grant execute on function public.set_staff_pay_rate(uuid, numeric) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4 · payable_shifts_v — the pay engine's spine
--
-- 20261001203000's definition with ONE line changed: `rt.pay_rate` →
-- effective_pay_rate(b.staff_id, rt.pay_rate), cast back to the column's
-- numeric(8,2) (create or replace refuses a type change). The gate is
-- unchanged: a scheduler has no shift_rates_v row (rt.pay_rate NULL) and
-- no staff_pay_rates row either, so still reads NULL; a worker the same.
-- charge_rate stays the section's — it is what the CLIENT is charged.
-- ---------------------------------------------------------------------
create or replace view payable_shifts_v with (security_invoker = true) as
 WITH logs AS (
         SELECT cl_1.id,
            cl_1.booking_id,
            cl_1.attempted_at,
            cl_1.outcome,
            cl_1.location,
            cl_1.distance_m,
            cl_1.check_in_at,
            cl_1.check_out_at,
            cl_1.check_out_pressed_at,
            cl_1.check_out_on_site,
            cl_1.last_on_site_at,
            cl_1.manager_finish_at,
            cl_1.on_site_verified,
            row_number() OVER (PARTITION BY cl_1.booking_id ORDER BY cl_1.check_in_at, (cl_1.outcome = 'turned_away'::checklog_outcome) DESC, cl_1.attempted_at) AS rn
           FROM check_logs cl_1
        )
 SELECT b.id AS booking_id,
    b.staff_id,
    sr.id AS shift_id,
    sr.event_id,
    sr.starts_at,
    sr.ends_at,
    effective_pay_rate(b.staff_id, rt.pay_rate)::numeric(8,2) AS pay_rate,
    rt.charge_rate,
    cl.check_in_at,
    COALESCE(cl.manager_finish_at, cl.check_out_at) AS check_out_at,
    cl.attempted_at,
        CASE
            WHEN b.status = 'turned_away'::booking_status THEN 'turned_away'::text
            WHEN cl.check_in_at IS NOT NULL THEN 'worked'::text
            ELSE 'no_show'::text
        END AS kind,
    unpaid_break_minutes(b.id) AS unpaid_break_min,
        CASE
            WHEN b.status = 'turned_away'::booking_status THEN jsonb_build_object('status', 'settled', 'payableMin', turned_away_minutes(sr.starts_at, cl.attempted_at), 'workedMin', 0, 'floorApplied', false, 'lateCheckOutFlag', false)
            WHEN cl.check_in_at IS NULL THEN jsonb_build_object('status', 'settled', 'payableMin', 0, 'workedMin', 0, 'floorApplied', false, 'lateCheckOutFlag', false)
            ELSE payable_minutes(sr.starts_at, sr.ends_at, cl.check_in_at, COALESCE(cl.manager_finish_at, cl.check_out_at), unpaid_break_minutes(b.id), (EXISTS ( SELECT 1
               FROM violations v
              WHERE v.booking_id = b.id AND v.type = 'left_early'::violation_type)),
            CASE
                WHEN (EXISTS ( SELECT 1
                   FROM violations v
                  WHERE v.booking_id = b.id AND v.type = 'no_checkout'::violation_type AND NOT v.resolved)) THEN 'unresolved'::text
                WHEN (EXISTS ( SELECT 1
                   FROM violations v
                  WHERE v.booking_id = b.id AND v.type = 'no_checkout'::violation_type)) THEN 'resolved'::text
                ELSE 'none'::text
            END)
        END AS pay
   FROM bookings b
     JOIN shift_requirements sr ON sr.id = b.shift_id
     JOIN events e ON e.id = sr.event_id
     LEFT JOIN shift_rates_v rt ON rt.shift_id = sr.id
     LEFT JOIN logs cl ON cl.booking_id = b.id AND cl.rn = 1
  WHERE e.cancelled_at IS NULL AND ((b.status = ANY (ARRAY['worked'::booking_status, 'turned_away'::booking_status])) OR b.status = 'confirmed'::booking_status AND (sr.starts_at + '00:30:00'::interval) <= now());

-- ---------------------------------------------------------------------
-- 5 · report_payroll_lines_v — §3.3's same-day cancellations
--
-- 20260923130000's definition (its only one) with ONE line changed: the
-- cancelled-on-the-day branch reads the section's rate itself, so it asks
-- effective_pay_rate() too. The first branch reads payable_shifts_v's
-- pay_rate, which is already the effective rate. Owner-rights, granted to
-- nobody but the service role, exactly as before (revoked again below).
-- ---------------------------------------------------------------------
create or replace view report_payroll_lines_v with (security_barrier = true) as
with base as (
  select
    ps.booking_id,
    ps.shift_id,
    ps.event_id,
    ps.staff_id,
    ps.starts_at,
    ps.ends_at,
    ps.check_in_at,
    ps.check_out_at,
    ps.attempted_at,
    ps.kind,
    case when ps.pay->>'status' = 'settled' then 'settled' else 'pending' end as status,
    ps.unpaid_break_min,
    (ps.pay->>'workedMin')::int                        as worked_min,
    (ps.pay->>'payableMin')::int                       as payable_min,
    coalesce((ps.pay->>'floorApplied')::boolean, false) as floor_applied,
    ps.pay_rate,
    ps.charge_rate
  from payable_shifts_v ps
  union all
  select
    b.id, sr.id, e.id, b.staff_id, sr.starts_at, sr.ends_at,
    null::timestamptz, null::timestamptz, null::timestamptz,
    'cancelled_on_day', 'settled', 0,
    (extract(epoch from (sr.ends_at - sr.starts_at)) / 60)::int,
    (extract(epoch from (sr.ends_at - sr.starts_at)) / 60)::int,
    false,
    effective_pay_rate(b.staff_id, sr.pay_rate)::numeric(8,2),
    sr.charge_rate
  from bookings b
  join shift_requirements sr on sr.id = b.shift_id
  join events e              on e.id = sr.event_id
  where e.cancelled_at is not null
    and uk_local(e.cancelled_at)::date >= e.event_date
    and b.confirmed_at is not null
    and (b.status in ('confirmed', 'worked')
         or (b.status = 'cancelled' and b.cancel_cause = 'event_cancelled'))
)
select
  x.booking_id,
  x.shift_id,
  x.event_id,
  x.staff_id,
  st.employee_id,
  case when st.removed_at is null then st.first_name || ' ' || st.last_name
       else deleted_account_label(st.employee_id) end            as staff_name,
  case when st.removed_at is null then st.last_name end           as sort_surname,
  st.removed_at is not null                                       as removed,
  case when st.removed_at is null then st.photo_path end          as photo_path,
  e.title                                                         as event_title,
  c.name                                                          as client_name,
  r.name                                                          as role_name,
  uk_local(x.starts_at)::date                                     as shift_date,
  x.starts_at,
  x.ends_at,
  x.check_in_at,
  x.check_out_at,
  x.attempted_at,
  x.kind,
  x.status,
  exists (select 1 from violations v
           where v.booking_id = x.booking_id and v.type = 'no_checkout' and not v.resolved)
                                                                  as no_check_out_unresolved,
  (x.kind = 'worked' and x.check_in_at > x.starts_at)             as late_check_in,
  (x.kind = 'worked' and x.check_out_at is not null
                     and x.check_out_at < x.ends_at)              as early_check_out,
  x.unpaid_break_min,
  x.worked_min,
  x.payable_min,
  x.floor_applied,
  x.pay_rate                                                      as rate,
  x.charge_rate,
  case when x.status = 'settled' then shift_base_pay(x.payable_min, x.pay_rate) end as base,
  case when x.status = 'settled'
       then shift_holiday_pay(shift_base_pay(x.payable_min, x.pay_rate)) end        as holiday,
  case when x.status = 'settled'
       then shift_base_pay(x.payable_min, x.pay_rate)
          + shift_holiday_pay(shift_base_pay(x.payable_min, x.pay_rate)) end        as total,
  -- Invoicing at the section's charge rate for the same payable minutes
  -- (breaks deducted from both — §5.2b). A turn-away is RULE-15 money THC
  -- absorbs: the strict buffer policy exists because the client does not
  -- pay for the buffer, so it is never invoiced.
  case when x.status <> 'settled' then null
       when x.kind in ('worked', 'cancelled_on_day')
         then round(x.payable_min::numeric * x.charge_rate / 60, 2)
       else 0 end                                                 as invoicing
from base x
join staff st              on st.id = x.staff_id
join events e              on e.id = x.event_id
join clients c             on c.id = e.client_id
join shift_requirements sr on sr.id = x.shift_id
join roles r               on r.id = sr.role_id;

-- create or replace keeps a view's grants; restated so this file alone
-- shows who may read the two (20260923130000, 20261001203000).
revoke all on report_payroll_lines_v from public, anon, authenticated;
revoke all on payable_shifts_v from anon;

-- ---------------------------------------------------------------------
-- 6 · The worker's rate in the definer functions
--
-- Re-created from their LIVE bodies with one expression changed each
-- (docs/10 §3b: a hand-copied body is how a shipped rule gets dropped).
-- Each pattern must match exactly once or the migration stops. Security,
-- search_path, grants and comments are untouched (create or replace keeps
-- them; the security and search_path are in the definition itself).
--
--   staff_bookings(p_staff), staff_open_shifts(p_staff), check_out —
--     inside ADR-0061's finance gate, which still answers NULL to an
--     office login without finance;
--   staff_shift_detail, staff_open_offers, staff_earnings — the worker's
--     own screens;
--   booking_push_payload, queue_booking_push (N5 and the other booking
--     pushes), queue_offer_notice (OF1, to the colleague offered it) —
--     the "£x.xx" in the payload is the recipient's rate.
-- ---------------------------------------------------------------------
do $$
declare
  p     record;
  v_def text;
  v_n   int;
begin
  for p in
    select * from (values
      ('public.staff_bookings(uuid)'::regprocedure,
       'then sr\.pay_rate end',
       'then effective_pay_rate(b.staff_id, sr.pay_rate) end'),
      ('public.staff_open_shifts(uuid)'::regprocedure,
       'then sr\.pay_rate end',
       'then effective_pay_rate(me.id, sr.pay_rate) end'),
      ('public.check_out(uuid,double precision,double precision)'::regprocedure,
       'then sr\.pay_rate end',
       'then effective_pay_rate(b.staff_id, sr.pay_rate) end'),
      ('public.staff_shift_detail(uuid)'::regprocedure,
       'sr\.pay_rate, sr\.dress_code,',
       'effective_pay_rate(b.staff_id, sr.pay_rate), sr.dress_code,'),
      ('public.staff_open_offers(uuid)'::regprocedure,
       'sr\.pay_rate, sr\.dress_code,',
       'effective_pay_rate(me.id, sr.pay_rate), sr.dress_code,'),
      ('public.staff_earnings()'::regprocedure,
       'sr\.ends_at, sr\.pay_rate, sr\.role_id,',
       'sr.ends_at, effective_pay_rate(b.staff_id, sr.pay_rate) as pay_rate, sr.role_id,'),
      ('public.booking_push_payload(uuid)'::regprocedure,
       'to_char\(sr\.pay_rate, ''FM990\.00''\)',
       'to_char(effective_pay_rate(b.staff_id, sr.pay_rate), ''FM990.00'')'),
      ('public.queue_booking_push(text,uuid)'::regprocedure,
       'to_char\(sr\.pay_rate, ''FM990\.00''\)',
       'to_char(effective_pay_rate(b.staff_id, sr.pay_rate), ''FM990.00'')'),
      ('public.queue_offer_notice(text,uuid,uuid)'::regprocedure,
       'to_char\(sr\.pay_rate, ''FM990\.00''\)',
       'to_char(effective_pay_rate(p_staff, sr.pay_rate), ''FM990.00'')')
    ) as x(fn, pattern, replacement)
  loop
    v_def := pg_get_functiondef(p.fn);
    select count(*) into v_n from regexp_matches(v_def, p.pattern, 'g');
    if v_n <> 1 then
      raise exception '20261001215000: % — expected one match of %, found %', p.fn, p.pattern, v_n;
    end if;
    execute regexp_replace(v_def, p.pattern, p.replacement);
  end loop;
end;
$$;
