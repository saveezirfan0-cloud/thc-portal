-- =====================================================================
-- 705 · The worker's availability RPCs (ADR-0042, docs/19 §1)
--   my_unavailability · add_my_unavailability · remove_my_unavailability
--   20260930202000
--
--   A. Shape: security definer, search_path pinned, not for anon or
--      PUBLIC, callable by a signed-in worker. The staff role still has
--      no policy on the table — not even a read of its own rows.
--   B. Add → read: an all-day entry; a time window; weekly repeats share
--      a series and count "n of N".
--   C. Every refusal by name, in validateUnavailability()'s order:
--      bad_window, in_past, too_far (> 365 d), too_long (> 31 d),
--      too_many (> 26 repeats, and > 200 future rows).
--   D. Conflicts: an entry over a confirmed shift is saved, the shift is
--      returned for the warning, and the booking is untouched.
--   E. Delete one, delete the rest of a series; another worker's rows
--      can be neither read nor deleted.
--   F. A leaver and a removed worker are refused; so is admin (no staff
--      row) and a client.
--   G. (20260930205100) Editable only when appLock() would be 'none': a
--      manual hold, a documents block, and a compliant worker with an
--      expired document are all refused add AND remove; their entries
--      are kept; once the lock lifts, editing works again.
-- =====================================================================
begin;
select plan(55);
\ir _shared/fixtures.psql

-- UK today, as the RPC reads it.
select (now() at time zone 'Europe/London')::date as uk_today \gset
-- The UK date the fixture's confirmed booking_a (shift_a) starts on.
select (sr.starts_at at time zone 'Europe/London')::date as shift_a_day
  from shift_requirements sr where sr.id = :'shift_a' \gset

-- =====================================================================
-- A · Shape
-- =====================================================================
select ok(
  (select bool_and(p.prosecdef) from pg_proc p
    where p.oid in ('public.my_unavailability(timestamptz, timestamptz)'::regprocedure,
                    'public.add_my_unavailability(date, date, time, time, int)'::regprocedure,
                    'public.remove_my_unavailability(uuid, boolean)'::regprocedure)),
  'A: all three are security definer');

select ok(
  (select bool_and(p.proconfig @> array['search_path=public, extensions']) from pg_proc p
    where p.oid in ('public.my_unavailability(timestamptz, timestamptz)'::regprocedure,
                    'public.add_my_unavailability(date, date, time, time, int)'::regprocedure,
                    'public.remove_my_unavailability(uuid, boolean)'::regprocedure)),
  'A: and pin search_path = public, extensions');

select ok(
  not has_function_privilege('anon', 'public.my_unavailability(timestamptz, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.add_my_unavailability(date, date, time, time, int)', 'execute')
  and not has_function_privilege('anon', 'public.remove_my_unavailability(uuid, boolean)', 'execute')
  and not has_function_privilege('public', 'public.add_my_unavailability(date, date, time, time, int)', 'execute'),
  'A: anon and PUBLIC cannot call them');

select ok(
  has_function_privilege('authenticated', 'public.my_unavailability(timestamptz, timestamptz)', 'execute')
  and has_function_privilege('authenticated', 'public.add_my_unavailability(date, date, time, time, int)', 'execute')
  and has_function_privilege('authenticated', 'public.remove_my_unavailability(uuid, boolean)', 'execute'),
  'A: a signed-in worker can');

select is_empty(
  $$ select polname from pg_policy where polrelid = 'public.staff_unavailability'::regclass
      and polname <> 'admin_read' $$,
  'A: staff_unavailability still carries admin_read only — no staff policy (docs/19 §0.2)');

-- Staff Bravo already has an entry the worker must never see or delete.
insert into staff_unavailability (id, staff_id, period, all_day) values
  ('65500000-0000-4000-8000-0000000000b1', :'staffb', unavailability_range(:'uk_today'::date + 20), true);

-- =====================================================================
-- B · Add → read (as Staff Alpha)
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (add_my_unavailability(:'uk_today'::date + 20) ->> 'ok')::boolean, true,
  'B: an all-day entry is saved');

select results_eq(
  format($$ select all_day, starts_at, ends_at, series_id is null from my_unavailability()
             where starts_at = (%L::date)::timestamp at time zone 'Europe/London' $$, :'uk_today'::date + 20),
  format($$ values (true, (%L::date)::timestamp at time zone 'Europe/London',
                          (%L::date)::timestamp at time zone 'Europe/London', true) $$,
         :'uk_today'::date + 20, :'uk_today'::date + 21),
  'B: and read back as UK midnight → UK midnight, not in a series');

select is(
  (add_my_unavailability(:'uk_today'::date + 22, null, '18:00', '23:00') -> 'ids' ->> 0) is not null, true,
  'B: a time window on one day is saved');

select is(
  (select count(*)::int from my_unavailability()
    where not all_day and starts_at = (:'uk_today'::date + 22 + time '18:00') at time zone 'Europe/London'
      and ends_at = (:'uk_today'::date + 22 + time '23:00') at time zone 'Europe/London'),
  1, 'B: 18:00–23:00 UK, exactly');

select is(
  jsonb_array_length(add_my_unavailability(:'uk_today'::date + 30, null, '09:00', '13:00', 3) -> 'ids'),
  4, 'B: repeat weekly ×3 makes four entries');

select results_eq(
  format($$ select series_index, series_count from my_unavailability()
             where starts_at >= (%L::date)::timestamp at time zone 'Europe/London' and series_id is not null
             order by starts_at $$, :'uk_today'::date + 30),
  $$ values (1, 4), (2, 4), (3, 4), (4, 4) $$,
  'B: sharing one series, counted "n of 4"');

select is(
  (select count(distinct series_id)::int from my_unavailability() where series_id is not null),
  1, 'B: one series id for the four');

select is(
  (select count(*)::int from my_unavailability(now(), now() + interval '21 days')),
  1, 'B: p_to bounds the list (only the day-20 entry starts before day 21)');

-- =====================================================================
-- C · Refusals
-- =====================================================================
select is(
  add_my_unavailability(:'uk_today'::date + 40, null, '10:00', '10:00') ->> 'reason',
  'bad_window', 'C: from == to is bad_window');
select is(
  add_my_unavailability(:'uk_today'::date + 40, null, '10:00', null) ->> 'reason',
  'bad_window', 'C: one time without the other is bad_window');
select is(
  add_my_unavailability(:'uk_today'::date + 40, :'uk_today'::date + 39) ->> 'reason',
  'bad_window', 'C: a range ending before it starts is bad_window');
select is(
  add_my_unavailability(:'uk_today'::date - 1) ->> 'reason',
  'in_past', 'C: yesterday (UK) is in_past');
select is(
  add_my_unavailability(:'uk_today'::date + 366) ->> 'reason',
  'too_far', 'C: 366 days ahead is too_far');
select is(
  add_my_unavailability(:'uk_today'::date + 300, null, null, null, 10) ->> 'reason',
  'too_far', 'C: a repeat whose last copy lands past 365 days is too_far');
select is(
  add_my_unavailability(:'uk_today'::date + 40, :'uk_today'::date + 71) ->> 'reason',
  'too_long', 'C: a 32-day range is too_long');
select is(
  (add_my_unavailability(:'uk_today'::date + 40, :'uk_today'::date + 70) ->> 'ok')::boolean,
  true, 'C: 31 days is allowed');
select is(
  add_my_unavailability(:'uk_today'::date + 2, null, null, null, 27) ->> 'reason',
  'too_many', 'C: 27 repeats is too_many');
select is(
  add_my_unavailability(:'uk_today'::date + 2, null, null, null, -1) ->> 'reason',
  'bad_window', 'C: a negative repeat count is bad_window');

reset role;
-- Staff Bravo at 199 future rows: one more is fine, two is too many.
insert into staff_unavailability (staff_id, period, all_day)
select :'staffb', unavailability_range(:'uk_today'::date + 100 + g), true
  from generate_series(1, 198) g;
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  add_my_unavailability(:'uk_today'::date + 50, null, null, null, 1) ->> 'reason',
  'too_many', 'C: more than 200 future rows is too_many');
select is(
  (add_my_unavailability(:'uk_today'::date + 50) ->> 'ok')::boolean,
  true, 'C: exactly 200 is allowed');

-- =====================================================================
-- D · Conflicts with a confirmed booking
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select add_my_unavailability(:'shift_a_day'::date) as conflict_save \gset
select is((:'conflict_save'::jsonb ->> 'ok')::boolean, true,
  'D: an entry over a confirmed shift is still saved');
select is(:'conflict_save'::jsonb -> 'conflicts' -> 0 ->> 'bookingId', :'booking_a',
  'D: and the shift comes back as a conflict, for the warning');
select is(:'conflict_save'::jsonb -> 'conflicts' -> 0 ->> 'event', 'Fixture Event A',
  'D: named by its event');
select is(
  (select jsonb_array_length(add_my_unavailability(:'uk_today'::date + 23) -> 'conflicts')),
  0, 'D: an entry on a free day has no conflicts');

reset role;
select results_eq(
  format($$ select status::text, cancelled_at from bookings where id = %L $$, :'booking_a'),
  $$ values ('confirmed'::text, null::timestamptz) $$,
  'D: the booking is untouched — a calendar entry never cancels a shift');
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

-- =====================================================================
-- E · Delete, and the wall between workers
-- =====================================================================
select is(
  (select count(*)::int from my_unavailability() u
    join staff_unavailability x on x.id = u.id),
  0, 'E: the staff role reads no rows of the table directly, not even its own');

select throws_ok(
  format($$ insert into staff_unavailability (staff_id, period) values (%L, unavailability_range(%L::date)) $$,
         :'staffa', :'uk_today'::date + 60),
  '42501', null, 'E: nor can it insert directly');

select is(
  (select count(*)::int from my_unavailability() where id = '65500000-0000-4000-8000-0000000000b1'),
  0, 'E: Staff Bravo''s entry is not in Staff Alpha''s list');

select is(
  remove_my_unavailability('65500000-0000-4000-8000-0000000000b1') ->> 'reason',
  'not_found', 'E: and Staff Alpha cannot delete it');

select is(
  (remove_my_unavailability(
     (select id from my_unavailability() where series_index = 2)) ->> 'removed')::int,
  1, 'E: "Just this one" deletes one copy of a series');

select is(
  (remove_my_unavailability(
     (select id from my_unavailability() where series_index = 1), true) ->> 'removed')::int,
  3, 'E: "All" deletes the rest of the series');

select is(
  (select count(*)::int from my_unavailability() where series_id is not null),
  0, 'E: the series is gone');

reset role;
select is(
  (select count(*)::int from staff_unavailability where id = '65500000-0000-4000-8000-0000000000b1'),
  1, 'E: Staff Bravo''s entry survived');

-- =====================================================================
-- F · Leavers, removed workers, admin, client
-- =====================================================================
update staff set status = 'inactive', left_at = now() where id = :'staffa';
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select * from my_unavailability() $$,
  'P0001', 'not_editable', 'F: a leaver cannot read their calendar');
select throws_ok(format($$ select add_my_unavailability(%L::date) $$, :'uk_today'::date + 25),
  'P0001', 'not_editable', 'F: nor add to it');

reset role;
update staff set status = 'removed' where id = :'staffa';
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select remove_my_unavailability(gen_random_uuid()) $$,
  'P0001', 'account_closed', 'F: a removed worker is refused');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select throws_ok($$ select * from my_unavailability() $$,
  'P0001', 'unknown_staff', 'F: admin has no staff row, so no calendar of its own here');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select throws_ok(format($$ select add_my_unavailability(%L::date) $$, :'uk_today'::date + 25),
  'P0001', 'unknown_staff', 'F: a client is refused');

reset role;

-- =====================================================================
-- G · Only when the app would show the screen (20260930205100)
--
-- Staff Bravo (compliant, 200 future rows from C, plus the entry Staff
-- Alpha could not delete). The UI shows /profile/availability only for
-- appLock() === 'none'; the RPCs now say the same.
-- =====================================================================
select count(*)::int as bravo_rows from staff_unavailability where staff_id = :'staffb' \gset

-- G1 · A manual hold (§10.1 case 2): nothing behind the hold screen.
update staff set status = 'blocked', block_kind = 'manual', block_reason = 'Conduct review'
 where id = :'staffb';
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select add_my_unavailability(%L::date) $$, :'uk_today'::date + 26),
  'P0001', 'not_editable', 'G: a manual hold cannot add');
select throws_ok($$ select remove_my_unavailability('65500000-0000-4000-8000-0000000000b1') $$,
  'P0001', 'not_editable', 'G: nor remove');
select isnt_empty($$ select 1 from my_unavailability() $$,
  'G: but can still read their own entries (the read is not a write)');

-- G2 · A documents block (§10.1 case 1, blocked on the row).
reset role;
update staff set block_kind = 'auto_document', block_reason = null where id = :'staffb';
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select add_my_unavailability(%L::date) $$, :'uk_today'::date + 26),
  'P0001', 'not_editable', 'G: a documents-blocked worker cannot add (the UI shows them Documents only)');
select throws_ok($$ select remove_my_unavailability('65500000-0000-4000-8000-0000000000b1') $$,
  'P0001', 'not_editable', 'G: nor remove');

-- G3 · A conviction under review (blocked, block_kind conviction_review).
reset role;
update staff set block_kind = 'conviction_review' where id = :'staffb';
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select add_my_unavailability(%L::date) $$, :'uk_today'::date + 26),
  'P0001', 'not_editable', 'G: a conviction-review block cannot add');

-- G4 · Compliant on the row, but the passport expired yesterday (UK):
-- appLock() is 'documents' before the nightly job gets to it.
reset role;
update staff set status = 'compliant', block_kind = null, block_reason = null where id = :'staffb';
update compliance_docs set expiry_date = :'uk_today'::date - 1, right_to_work_until = null
 where id = :'doc_b';
select ok(
  exists (select 1 from compliance_blockers(:'staffb', :'uk_today'::date) where reason = 'document_expired:passport'),
  'G: (precondition) Staff Bravo''s passport has expired');
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select add_my_unavailability(%L::date) $$, :'uk_today'::date + 26),
  'P0001', 'not_editable', 'G: a compliant worker with an expired document cannot add');
select throws_ok($$ select remove_my_unavailability('65500000-0000-4000-8000-0000000000b1') $$,
  'P0001', 'not_editable', 'G: nor remove');

reset role;
select is((select count(*)::int from staff_unavailability where staff_id = :'staffb'), :bravo_rows,
  'G: every refusal left the entries as they were — a lock keeps them, it does not delete them');

-- G5 · The lock lifts: editing works again.
update compliance_docs set expiry_date = null where id = :'doc_b';
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  (remove_my_unavailability('65500000-0000-4000-8000-0000000000b1') ->> 'removed')::int, 1,
  'G: compliant again, the worker removes an entry');
select is(
  (add_my_unavailability(:'uk_today'::date + 26) ->> 'ok')::boolean, true,
  'G: and adds one');

reset role;
select * from finish();
rollback;
