-- =====================================================================
-- 854 · staff_bookings(): the weekly cap only on the rows that show it
--   20261019192100_staff_bookings_cap_only_where_read.sql · ADR-0155
--
-- The old staff_bookings() (and the old RULE-20 chain under it) is
-- recreated in `_old` and compared, row for row, with the new one for
-- every worker of a generated agency (_shared/cap_dataset: every cap
-- branch, ten weeks of history, six weeks ahead, invitations, applied,
-- confirmed, closed and cancelled rows, resolved and unresolved
-- No check-outs):
--
--   * every booking still comes back, in the same order — history is not
--     bounded (Past shifts, ADR-0048; a stale push finds its row);
--   * every column is the old value, except that hours_limit,
--     booked_hours and cap_hours are null on a row that is neither an
--     invitation nor a booking whose section is still to end — and on
--     every row that IS one of those they are the old values;
--   * the fill count is still confirmed bookings only.
--
-- Every row is created inside the transaction and rolled back.
-- =====================================================================
begin;
select plan(13);
\ir _shared/fixtures.psql
\set cap_n 60
\set cap_cands 5
\set cap_back 70
\set cap_ahead 42
\ir _shared/cap_dataset.psql
\ir _shared/rule20_before_20261019192000.psql

-- A fill count worth checking: some sections with several confirmed, and
-- invitations to sections that have already ended (the stale-push case,
-- which /invites/[id] still renders).
alter table bookings disable trigger user;
insert into bookings (shift_id, staff_id, status, source, created_at)
select ('ca9a0000-0000-4000-8000-' || lpad(((d + 100000) * 10 + 2)::text, 12, '0'))::uuid,
       ('ca9d0000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'invited', 'manual', now() - interval '20 days'
  from generate_series(-12, -9) d, generate_series(1, 60) g
on conflict (shift_id, staff_id) do nothing;
alter table bookings enable trigger user;

create temp table d854_w as select id from staff where email like 'cap%@capset.test';
grant select on d854_w to authenticated;

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

create temp table d854_old as
  select w.id as worker, o.ord, (o.r).*
    from d854_w w
    cross join lateral (select row_number() over () as ord, x as r from _old.staff_bookings(w.id) x) o;
create temp table d854_new as
  select w.id as worker, n.ord, (n.r).*
    from d854_w w
    cross join lateral (select row_number() over () as ord, x as r from public.staff_bookings(w.id) x) n;
reset role;

select is((select count(*) from d854_new), (select count(*) from bookings b join d854_w w on w.id = b.staff_id),
  'every booking of every worker is still returned — history is not bounded');
select is((select count(*) from d854_new), (select count(*) from d854_old), 'and as many rows as before');
select is_empty($$
  select worker, ord, booking_id from d854_old
  except all
  select worker, ord, booking_id from d854_new $$,
  'the same bookings, in the same order');

-- Every column but the three gated ones: identical on every row.
select is_empty($$
  select worker, booking_id, status, source, created_at, confirmed_at, day_before_confirmed_at, on_day_confirmed_at,
         reconfirm_required, reconfirm_reason, applied_at, cancelled_at, cancel_cause, shift_id, starts_at, ends_at,
         pay_rate, dress_code, headcount, buffer, confirmed_count, role, event_id, event_title, event_date, venue_name,
         venue_address, event_cancelled_at, distance_km, onsite_contact, notes, pays_breaks, no_checkout_open, week_start
    from d854_old
  except all
  select worker, booking_id, status, source, created_at, confirmed_at, day_before_confirmed_at, on_day_confirmed_at,
         reconfirm_required, reconfirm_reason, applied_at, cancelled_at, cancel_cause, shift_id, starts_at, ends_at,
         pay_rate, dress_code, headcount, buffer, confirmed_count, role, event_id, event_title, event_date, venue_name,
         venue_address, event_cancelled_at, distance_km, onsite_contact, notes, pays_breaks, no_checkout_open, week_start
    from d854_new $$,
  'every other column — the fill count, the withheld contact, No check-out, the week — is the old value on every row');

-- The three cap columns: the old values wherever a screen reads them.
select is_empty($$
  select o.booking_id from d854_old o join d854_new n using (worker, booking_id)
   where (o.status = 'invited' or o.ends_at > now())
     and (o.hours_limit, o.booked_hours, o.cap_hours) is distinct from (n.hours_limit, n.booked_hours, n.cap_hours) $$,
  'on an invitation, or a booking whose section has not ended, Limit Reached and its arithmetic are the old values');
select is_empty($$
  select n.booking_id from d854_new n
   where not (n.status = 'invited' or n.ends_at > now())
     and (n.hours_limit is not null or n.booked_hours is not null or n.cap_hours is not null) $$,
  'on the history behind them the three are null — computed for nobody');

-- Coverage: the comparison met each case it claims to.
select ok((select count(*) from d854_old where status = 'invited' and hours_limit) > 0
          and (select count(*) from d854_old where status = 'invited' and not hours_limit) > 0,
  'invitations both over and within the limit were compared');
select ok((select count(*) from d854_old where status = 'invited' and ends_at <= now()) > 0,
  'invitations to sections that have already ended were compared (the stale push /invites/[id] still renders)');
select ok((select count(*) from d854_old where status in ('confirmed', 'applied') and ends_at > now()) > 0,
  'confirmed and applied bookings still ahead were compared');
select ok((select count(*) from d854_new where no_checkout_open and ends_at < now() - interval '14 days') > 0,
  'RULE-02: a worked booking with an unresolved No check-out from weeks ago still comes back, flagged');
select ok((select count(*) from d854_new where cap_hours is null and (status = 'invited' or ends_at > now())
             and not exists (select 1 from staff s where s.id = d854_new.worker and s.wtr_optout)) = 0,
  'a computed cap is null only where the rule says "no ceiling" (an opt-out)');
select is((select max(confirmed_count) from d854_new n
            where confirmed_count <> (select count(*) from bookings b where b.shift_id = n.shift_id and b.status = 'confirmed')),
  null, 'the fill count is the section''s confirmed bookings, nothing else');

select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=%'
     from pg_proc p where p.oid = 'public.staff_bookings(uuid)'::regprocedure),
  'staff_bookings is still security definer with its search_path pinned');

select * from finish();
rollback;
