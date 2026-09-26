-- =====================================================================
-- Schedulers see no money — the rate columns themselves (ADR-0061;
-- closes ADR-0056 "Residual gaps" 1–3; §9.7, §9.8, §3.2, §3.3, §11.1)
--
-- 20261001200100 gated every money-ONLY object behind office_can('finance')
-- but left the rate columns on rows scheduling needs readable to every
-- Back Office login: roles.pay_rate, shift_requirements.pay_rate /
-- charge_rate, client_rate_cards.charge_rate, and their copies on
-- payable_shifts_v. RLS filters rows, not columns, and every signed-in
-- session is the one database role `authenticated`, so no policy can tell a
-- manager's read of those columns from a scheduler's.
--
-- The design, and why this one (ADR-0061 has the comparison):
--
--   1. `authenticated` and `anon` lose SELECT on exactly those four
--      columns. Every other column of the three tables stays readable
--      (and writes stay as they were: INSERT / UPDATE need no SELECT on
--      the column written). A direct API read of a rate — select, filter,
--      order, RETURNING — is now "permission denied" for EVERY session.
--      Airtight by construction: there is no policy to get wrong.
--
--   2. The rates come back, to finance roles only, through three
--      owner-rights views — shift_rates_v, role_rates_v,
--      rate_card_rates_v — whose body carries the one gate,
--      office_rates_visible(): a signed-in or anonymous API session sees
--      rows only with office_can('finance'); every other database role
--      (the owner, i.e. every security definer function; service_role,
--      i.e. the Edge Functions and cron) sees them as before.
--
--   3. Every security-INVOKER reader of the columns (six views) now reads
--      them from those views instead, so a manager's screen is unchanged
--      and a scheduler's reads NULL / no row exactly where ADR-0056
--      already promised. Every security DEFINER reader — the pay engine,
--      the reports, the §11.3 documents, the worker's own RPCs — runs as
--      the owner and is untouched. Four invoker functions that did
--      `select *` / read `excluded.<rate>` are re-created from their live
--      bodies with that one statement changed; three definer RPCs that an
--      office login can point at any worker (staff_bookings(p_staff),
--      staff_open_shifts(p_staff), check_out) withhold pay_rate from an
--      office login without finance, and nobody else.
--
--   4. A scheduler still builds role sections (§3.2): the trigger now SETS
--      the catalogue rates on their sections instead of refusing a
--      mismatch. A refusal that depends on the value typed is an oracle —
--      "is it 14.00? is it 14.50?" — and a scheduler who can no longer read
--      a rate must not be able to binary-search it either.
--
-- Nothing here edits an earlier migration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The gate
--
-- Security INVOKER on purpose: current_user must be the caller's role.
-- In an owner-rights view current_user is still the querying role (a
-- view checks table privileges as its owner but does not switch user);
-- inside a security definer function it is the function's owner, which
-- is exactly the "trusted caller" case.
-- ---------------------------------------------------------------------
create or replace function public.office_rates_visible()
returns boolean
language sql
stable
set search_path = public
as $$
  select current_user::text not in ('anon', 'authenticated') or office_can('finance')
$$;

comment on function public.office_rates_visible() is
  'ADR-0061: may this query see pay and charge rates? An API session (anon / authenticated) only with office_can(''finance''); any other database role — the owner inside a security definer function, service_role — always. Evaluated in the body of shift_rates_v, role_rates_v and rate_card_rates_v.';

revoke all on function public.office_rates_visible() from public, anon;
grant execute on function public.office_rates_visible() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2 · The rates, for finance roles only
--
-- Owner rights (no security_invoker), so they can read the columns the
-- caller no longer may; security_barrier, so no caller-supplied condition
-- is evaluated before the gate. Rows are otherwise every row of the base
-- table — for the only API callers who pass the gate (Back Office logins
-- with finance), admin_all already returned every row.
-- ---------------------------------------------------------------------
create view public.shift_rates_v with (security_barrier = true) as
  select sr.id as shift_id, sr.event_id, sr.pay_rate, sr.charge_rate
    from shift_requirements sr
   where (select office_rates_visible());

create view public.role_rates_v with (security_barrier = true) as
  select r.id as role_id, r.pay_rate
    from roles r
   where (select office_rates_visible());

create view public.rate_card_rates_v with (security_barrier = true) as
  select rc.id, rc.client_id, rc.role_id, rc.charge_rate
    from client_rate_cards rc
   where (select office_rates_visible());

comment on view public.shift_rates_v is
  'ADR-0061: a role section''s base pay rate and charge rate. Office logins with finance (and definer / service code) only — a scheduler reads no row. Read-only.';
comment on view public.role_rates_v is
  'ADR-0061: the Roles catalogue base pay rate (§9.8). Office logins with finance (and definer / service code) only. Read-only.';
comment on view public.rate_card_rates_v is
  'ADR-0061: a client rate card''s charge rate (§9.7). Office logins with finance (and definer / service code) only. Read-only.';

-- Simple owner-rights views are auto-updatable: a write through one would
-- run with the OWNER's privileges and skip RLS. So SELECT only, and never
-- anon (an owner-rights view must not rely on auth.uid() being null).
revoke all on public.shift_rates_v, public.role_rates_v, public.rate_card_rates_v
  from public, anon, authenticated, service_role;
grant select on public.shift_rates_v, public.role_rates_v, public.rate_card_rates_v
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3 · The security-invoker readers read the rates from those views
--
-- Live definitions (pg_get_viewdef after 20261001200100), each changed
-- only where it read a rate column: `sr.pay_rate` → `rt.pay_rate` over a
-- LEFT JOIN, so the row set is exactly what it was. Column names, order
-- and types are unchanged (create or replace would refuse otherwise), so
-- the dependants — dashboard_upcoming_v, dashboard_week_finance_v,
-- dashboard_kpis_v, clients_directory_v, staff_shift_history_v,
-- report_payroll_lines_v — keep working without being touched.
-- ---------------------------------------------------------------------

-- 3a · payable_shifts_v (RULE-01/02/14/15). Its readers: the payroll and
-- finance reports and the §11.3 documents (definer — they see the rates),
-- staff_shift_history_v and resolve_violation() (read `pay`, the minutes,
-- only). pay_rate / charge_rate are NULL to an office login without finance.
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
    rt.pay_rate,
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

-- 3b · dashboard_sections_v — the office_can CASE of 20261001200100 is
-- now the view's own gate; the result is the same NULLs.
create or replace view dashboard_sections_v with (security_invoker = true, security_barrier = true) as
 SELECT sr.id AS shift_id,
    sr.event_id,
    e.client_id,
    e.title AS event_title,
    e.event_date,
    e.venue_name,
    e.po_number,
    e.cancelled_at,
    c.name AS client_name,
    r.name AS role_name,
    sr.starts_at,
    sr.ends_at,
    sr.headcount,
    sr.buffer,
    rt.charge_rate::numeric(8,2) AS charge_rate,
    rt.pay_rate::numeric(8,2) AS base_rate,
    final_rate(rt.pay_rate) AS final_pay_rate,
    rt.charge_rate - final_rate(rt.pay_rate) AS margin_per_hour,
    EXTRACT(epoch FROM sr.ends_at - sr.starts_at) / 3600::numeric AS section_hours,
    COALESCE(f.confirmed, 0) AS confirmed,
    GREATEST(sr.headcount - COALESCE(f.confirmed, 0), 0) AS open_positions,
    e.cancelled_at IS NOT NULL AND (e.cancelled_at AT TIME ZONE 'Europe/London'::text)::date >= e.event_date AS cancelled_on_day
   FROM shift_requirements sr
     JOIN events e ON e.id = sr.event_id
     JOIN clients c ON c.id = e.client_id
     JOIN roles r ON r.id = sr.role_id
     LEFT JOIN shift_rates_v rt ON rt.shift_id = sr.id
     LEFT JOIN LATERAL ( SELECT count(*)::integer AS confirmed
           FROM bookings b
          WHERE b.shift_id = sr.id AND (b.status = ANY (ARRAY['confirmed'::booking_status, 'worked'::booking_status]))) f ON true
  WHERE current_app_role() = 'admin'::app_role;

-- 3c · clients_margins_v (money only — its own gate is kept).
create or replace view clients_margins_v with (security_invoker = true) as
 SELECT e.client_id,
    count(DISTINCT e.id)::integer AS completed_events,
    sum(rt.charge_rate * s.headcount::numeric * EXTRACT(epoch FROM s.ends_at - s.starts_at) / 3600::numeric) AS charge_total,
    sum(final_rate(rt.pay_rate) * s.headcount::numeric * EXTRACT(epoch FROM s.ends_at - s.starts_at) / 3600::numeric) AS pay_total
   FROM events e
     JOIN shift_requirements s ON s.event_id = e.id
     LEFT JOIN shift_rates_v rt ON rt.shift_id = s.id
  WHERE e.cancelled_at IS NULL AND e.event_date < (now() AT TIME ZONE 'Europe/London'::text)::date
    AND (SELECT current_app_role() IS DISTINCT FROM 'admin'::app_role OR office_can('finance'))
  GROUP BY e.client_id;

-- 3d · clients_rate_card_v (money only — its own gate is kept).
create or replace view clients_rate_card_v with (security_invoker = true) as
 SELECT rc.id,
    rc.client_id,
    rc.role_id,
    r.name AS role_name,
    r.description AS role_description,
    cr.charge_rate,
    rr.pay_rate AS base_pay_rate,
    final_rate(rr.pay_rate) AS final_pay_rate,
    cr.charge_rate - final_rate(rr.pay_rate) AS margin_per_hour,
        CASE
            WHEN cr.charge_rate > 0::numeric THEN round((1::numeric - final_rate(rr.pay_rate) / cr.charge_rate) * 100::numeric, 1)
            ELSE NULL::numeric
        END AS margin_pct,
    rc.dress_codes,
    (( SELECT count(*) AS count
           FROM shift_requirements s
             JOIN events e ON e.id = s.event_id
          WHERE e.client_id = rc.client_id AND s.role_id = rc.role_id))::integer AS section_count
   FROM client_rate_cards rc
     JOIN roles r ON r.id = rc.role_id
     LEFT JOIN rate_card_rates_v cr ON cr.id = rc.id
     LEFT JOIN role_rates_v rr ON rr.role_id = r.id
  WHERE (SELECT current_app_role() IS DISTINCT FROM 'admin'::app_role OR office_can('finance'));

-- 3e · role_directory_v (money only — its own gate is kept).
create or replace view role_directory_v with (security_invoker = true) as
 SELECT r.id,
    r.name,
    r.description,
    rr.pay_rate,
    round(rr.pay_rate * 0.1207, 2) AS holiday_rate,
    final_rate(rr.pay_rate) AS final_rate,
    r.created_at,
    (( SELECT count(*) AS count
           FROM client_rate_cards c
          WHERE c.role_id = r.id))::integer AS rate_card_count,
    (( SELECT count(*) AS count
           FROM shift_requirements s
          WHERE s.role_id = r.id))::integer AS section_count
   FROM roles r
     LEFT JOIN role_rates_v rr ON rr.role_id = r.id
  WHERE (SELECT current_app_role() IS DISTINCT FROM 'admin'::app_role OR office_can('finance'));

-- 3f · clients_event_list_v (mixed — the margin gate is kept).
create or replace view clients_event_list_v with (security_invoker = true) as
 SELECT e.id,
    e.client_id,
    e.title,
    e.po_number,
    e.event_date,
    w.starts_at,
    w.ends_at,
    e.venue_name,
    e.cancelled_at,
    event_status(e.*, w.starts_at, w.ends_at) AS status,
    (( SELECT count(*) AS count
           FROM shift_requirements s
          WHERE s.event_id = e.id))::integer AS section_count,
    ( SELECT string_agg(((((r.name || ' '::text) || s.headcount) || ' (+'::text) || s.buffer) || ')'::text, ' · '::text ORDER BY r.name) AS string_agg
           FROM shift_requirements s
             JOIN roles r ON r.id = s.role_id
          WHERE s.event_id = e.id) AS roles_summary,
        CASE
            WHEN e.cancelled_at IS NULL AND (SELECT current_app_role() IS DISTINCT FROM 'admin'::app_role OR office_can('finance')) THEN ( SELECT round(sum((rt.charge_rate - final_rate(rt.pay_rate)) * s.headcount::numeric * EXTRACT(epoch FROM s.ends_at - s.starts_at) / 3600::numeric), 2) AS round
               FROM shift_requirements s
                 LEFT JOIN shift_rates_v rt ON rt.shift_id = s.id
              WHERE s.event_id = e.id)
            ELSE NULL::numeric
        END AS margin_gbp,
        CASE
            WHEN e.cancelled_at IS NULL AND (SELECT current_app_role() IS DISTINCT FROM 'admin'::app_role OR office_can('finance')) THEN ( SELECT
                    CASE
                        WHEN sum(rt.charge_rate * s.headcount::numeric * EXTRACT(epoch FROM s.ends_at - s.starts_at) / 3600::numeric) > 0::numeric THEN round((1::numeric - sum(final_rate(rt.pay_rate) * s.headcount::numeric * EXTRACT(epoch FROM s.ends_at - s.starts_at) / 3600::numeric) / sum(rt.charge_rate * s.headcount::numeric * EXTRACT(epoch FROM s.ends_at - s.starts_at) / 3600::numeric)) * 100::numeric, 1)
                        ELSE NULL::numeric
                    END AS "case"
               FROM shift_requirements s
                 LEFT JOIN shift_rates_v rt ON rt.shift_id = s.id
              WHERE s.event_id = e.id)
            ELSE NULL::numeric
        END AS margin_pct
   FROM events e
     JOIN LATERAL ( SELECT min(s.starts_at) AS starts_at,
            max(s.ends_at) AS ends_at
           FROM shift_requirements s
          WHERE s.event_id = e.id) w ON w.starts_at IS NOT NULL;

-- payable_shifts_v and staff_shift_history_v kept Supabase's default anon
-- grant; anon never read a row through either (bookings and
-- shift_requirements have no anon policy), and the rates view under them is
-- not anon's, so the grant would now be an error instead of an empty set.
revoke all on payable_shifts_v, staff_shift_history_v from anon;

-- ---------------------------------------------------------------------
-- 4 · The columns. SELECT on the table is replaced by SELECT on every
-- column except the rates. Computed from the catalogue so the grant is
-- exactly "all but these four"; 753 asserts it column by column, so a
-- column added later without its grant fails a test rather than a screen.
-- ---------------------------------------------------------------------
do $$
declare
  t record;
  v_cols text;
begin
  for t in
    select * from (values
      ('roles',              array['pay_rate']),
      ('shift_requirements', array['pay_rate', 'charge_rate']),
      ('client_rate_cards',  array['charge_rate'])
    ) as x(tbl, money)
  loop
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
      into v_cols
      from pg_attribute a
     where a.attrelid = format('public.%I', t.tbl)::regclass
       and a.attnum > 0 and not a.attisdropped
       and a.attname <> all (t.money);
    execute format('revoke select on public.%I from anon, authenticated', t.tbl);
    execute format('grant select (%s) on public.%I to anon, authenticated', v_cols, t.tbl);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 5 · A scheduler's role sections carry the catalogue rates
--
-- Same rule as 20261001200100 §6 — a new section carries the role's
-- pay_rate and the client's rate-card charge (0 when the client has none,
-- the builder's own default); an edit keeps the rates unless the role
-- changes, when the new role's catalogue rates apply — but SET, not
-- checked, so no error ever depends on a rate the caller cannot see.
--
-- Now security definer: it must read roles.pay_rate and
-- client_rate_cards.charge_rate, which the caller no longer may. As
-- definer, current_user is the owner, so "a signed-in session wrote this"
-- is read from the `role` setting PostgREST (and a test's SET ROLE) sets
-- instead. That also holds a scheduler's write made through a definer
-- function to the catalogue — none exists that writes rates today.
--
-- The trigger is renamed so it fires BEFORE shift_requirements_edit_lock
-- (triggers fire in name order): the edit lock compares the rates to the
-- stored ones, and must compare the normalised values, or "is the started
-- event's rate X?" would be answerable by its error.
-- ---------------------------------------------------------------------
create or replace function public.shift_rates_office_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay    numeric;
  v_charge numeric;
begin
  if current_setting('role', true) is distinct from 'authenticated'
     or current_app_role() is distinct from 'admin'
     or office_can('finance') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.role_id is not distinct from old.role_id then
    new.pay_rate    := old.pay_rate;
    new.charge_rate := old.charge_rate;
    return new;
  end if;
  select r.pay_rate into v_pay from roles r where r.id = new.role_id;
  select coalesce(max(rc.charge_rate), 0) into v_charge
    from client_rate_cards rc join events e on e.client_id = rc.client_id
   where e.id = new.event_id and rc.role_id = new.role_id;
  new.pay_rate    := v_pay;
  new.charge_rate := v_charge;
  return new;
end;
$$;

comment on function public.shift_rates_office_guard() is
  'ADR-0056 / ADR-0061: on a direct write by a Back Office login without finance, a role section carries the catalogue rates — set here, never checked against what was sent (a value-dependent refusal would reveal the rate).';

revoke all on function public.shift_rates_office_guard() from public, anon, authenticated;

drop trigger if exists shift_requirements_rates_office on shift_requirements;
create trigger shift_requirements_catalogue_rates
  before insert or update of role_id, pay_rate, charge_rate on shift_requirements
  for each row execute function public.shift_rates_office_guard();

-- ---------------------------------------------------------------------
-- 6 · Functions re-created from their LIVE bodies with one statement
-- changed each (docs/10 §3b: a hand-copied body is how a shipped rule
-- gets dropped). Each pattern must match exactly once or the migration
-- stops.
--
--   invoker, would now be refused for EVERY office login:
--     resolve_violation, office_mark_no_show — `select * into sr from
--       shift_requirements` reads the rate columns; now the four columns
--       they use.
--     remove_client_role — `select * into v from client_rate_cards`; now
--       the id, the only field it uses.
--     add_client_role — ON CONFLICT … SET charge_rate =
--       excluded.charge_rate reads the column; now the parameters
--       themselves, which are what `excluded` held.
--
--   definer, callable by an office login for ANY worker, returned the
--   worker's base rate — to a scheduler too:
--     staff_bookings(p_staff), staff_open_shifts(p_staff) — pay_rate;
--     check_out — the payRate in its reply.
--   Each now answers NULL there to an office login without finance, and
--   exactly what it did to everyone else (a worker's own base rate).
-- ---------------------------------------------------------------------
do $$
declare
  p     record;
  v_def text;
  v_n   int;
  v_gate constant text :=
    'case when (select current_app_role() is distinct from ''admin''::app_role or office_can(''finance'')) then sr.pay_rate end';
begin
  for p in
    select * from (values
      ('public.resolve_violation(uuid,text,timestamp with time zone,timestamp with time zone)'::regprocedure,
       'select \* into sr from shift_requirements where id = b\.shift_id;',
       'select s.id, s.event_id, s.starts_at, s.ends_at into sr.id, sr.event_id, sr.starts_at, sr.ends_at from shift_requirements s where s.id = b.shift_id;'),
      ('public.office_mark_no_show(uuid)'::regprocedure,
       'select \* into sr from shift_requirements where id = b\.shift_id;',
       'select s.id, s.event_id, s.starts_at, s.ends_at into sr.id, sr.event_id, sr.starts_at, sr.ends_at from shift_requirements s where s.id = b.shift_id;'),
      ('public.remove_client_role(uuid)'::regprocedure,
       'select \* into v from client_rate_cards where id = p_id;',
       'select c.id into v.id from client_rate_cards c where c.id = p_id;'),
      ('public.add_client_role(uuid,uuid,numeric,text[])'::regprocedure,
       'set charge_rate = excluded\.charge_rate,(\s*)dress_codes = excluded\.dress_codes',
       'set charge_rate = p_charge_rate,\1dress_codes = coalesce(p_dress_codes, ''{}'')'),
      ('public.staff_bookings(uuid)'::regprocedure,
       'sr\.pay_rate,',
       v_gate || ','),
      ('public.staff_open_shifts(uuid)'::regprocedure,
       'sr\.pay_rate,',
       v_gate || ','),
      ('public.check_out(uuid,double precision,double precision)'::regprocedure,
       '''payRate'',(\s*)sr\.pay_rate,',
       '''payRate'',\1' || v_gate || ',')
    ) as x(fn, pattern, replacement)
  loop
    v_def := pg_get_functiondef(p.fn);
    select count(*) into v_n from regexp_matches(v_def, p.pattern, 'g');
    if v_n <> 1 then
      raise exception '20261001203000: % — expected one match of %, found %', p.fn, p.pattern, v_n;
    end if;
    execute regexp_replace(v_def, p.pattern, p.replacement);
  end loop;
end;
$$;
