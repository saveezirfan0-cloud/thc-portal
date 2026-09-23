-- =====================================================================
-- 420 · Feedback (§9.10, §11.5, §6) — 20260923140000_feedback_inbox.sql
--
-- The weight of this file is on the rating, because that is the part of
-- §9.10 a screen cannot show is wrong:
--
--   · submission alone does NOT move the rating — not the portal's, and
--     not a customer inserting straight into the table;
--   · Mark as read DOES, at that moment;
--   · an office entry counts from submission, and editing or deleting it
--     moves the rating again;
--   · a worker with nothing counted has no rating (NULL), not a stale one.
--
-- Then the editing rules §9.10 states (client entries read-only, the one
-- §1.7 exception, Mark as read not undone), and who can reach any of it.
-- =====================================================================
begin;
select plan(65);
\ir _shared/fixtures.psql

\set event_c   'eeeeeeee-0000-4000-8000-0000000004c0'
\set shift_c   'ffffffff-0000-4000-8000-0000000004c0'
\set booking_c '0a0a0a0a-0000-4000-8000-0000000004c0'
\set fb_c      '1a1a1a1a-0000-4000-8000-0000000004c0'

-- A past event at Client A that Staff Alpha worked, so there is a second
-- event to hang a client entry on (one client entry per worker per event,
-- §11.5) and a real event for an office entry to name.
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  (:'event_c', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Feedback Fixture Past Event', current_date - 3, true, true);
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'shift_c', :'event_c', :'role_id', now() - interval '3 days',
   now() - interval '3 days' + interval '8 hours', 4, 0, 22.97, 14.00, 4);
insert into bookings (id, shift_id, staff_id, status, source) values
  (:'booking_c', :'shift_c', :'staffa', 'confirmed', 'manual');

-- =====================================================================
-- Structure
-- =====================================================================
select has_column('feedback', 'read_by', '"Read · Gisela M. · 07 Sep" needs the reader');
select col_is_null('feedback', 'event_id',
  'event_id is optional: an office entry may be "Not tied to an event"');
select has_view('feedback_entries_v', 'one list for /feedback and the profile tab');
select ok(not (coalesce((select reloptions from pg_class where relname = 'feedback_entries_v'), '{}')
               @> '{security_invoker=true}'),
  'feedback_entries_v runs with owner rights, so it can name the author from profiles (ADR-0016)');
select ok(not has_table_privilege('anon', 'feedback_entries_v', 'select'),
  'anon has no privilege on feedback_entries_v: an owner-rights view must not rely on auth.uid() being null');
select ok(not has_table_privilege('anon', 'feedback_authors_v', 'select'),
  'nor on feedback_authors_v');
select ok(not has_function_privilege('authenticated', 'recompute_staff_rating(uuid)', 'execute'),
  'nobody calls recompute_staff_rating() directly: a rating moves only through feedback');
select ok(not has_function_privilege('anon', 'mark_feedback_read(uuid)', 'execute'),
  'anon cannot mark anything read');
select ok(not has_function_privilege('anon', 'add_office_feedback(uuid, int, text, uuid)', 'execute'),
  'or write office feedback');

-- =====================================================================
-- The rating (§9.10 → §6)
-- =====================================================================
-- A rating from before any feedback counted — the seed's, or an import.
update staff set rating = 4.60 where id = :'staffa';
update staff set rating = 4.20 where id = :'staffb';

-- The fixtures' client entry on (staffa, event_a) arrived unread and has
-- not moved anything.
select is((select rating from staff where id = :'staffa'), 4.60::numeric,
  '§9.10 an unread client entry is not in the rating: the fixture entry changed nothing');

-- A client submits on the past event. Straight into the table, as the
-- portal's definer RPC does.
insert into feedback (id, author_kind, author_id, staff_id, event_id, rating, text)
values (:'fb_c', 'client', :'clienta_uid', :'staffa', :'event_c', 1, 'Did not turn up on the terrace');
select is((select rating from staff where id = :'staffa'), 4.60::numeric,
  '§9.10 "submission alone does not affect the rating" — a 1-star client entry arrives and the rating stands');

-- ---- as the office --------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);

select is((select unread from feedback_entries_v where id = :'fb_c'), true,
  'the office sees it as unread');
select is((select counts_toward_rating from feedback_entries_v where id = :'fb_c'), false,
  'and not in the rating');
select is((select author_name from feedback_entries_v where id = :'fb_c'), 'Client A user',
  'a client entry names the portal user who left it');
select is((select client_name from feedback_entries_v where id = :'fb_c'), 'RLS Fixture Client A',
  'and the client');
select is((select role_names from feedback_entries_v where id = :'fb_c'), 'RLS Fixture Role',
  'and what the worker was there as');
select is((select staff_name from feedback_entries_v where id = :'fb_c'), 'Staff Alpha',
  'and the worker by name');

-- Mark as read.
select is((mark_feedback_read(:'feedback_a') ->> 'rating')::numeric, 5.00::numeric,
  '§9.10 Mark as read puts the entry into the rating at once: the 5-star entry is now the whole of it');
select is((select rating from staff where id = :'staffa'), 5.00::numeric,
  'staff.rating is what the §6 scorer reads, and it has moved');
select is((select read_by_name from feedback_entries_v where id = :'feedback_a'), 'Gisela M.',
  'the reader is recorded by name');
select is((select counts_toward_rating from feedback_entries_v where id = :'feedback_a'), true,
  'and the row now says it counts');

select is((mark_feedback_read(:'fb_c') ->> 'rating')::numeric, 3.00::numeric,
  'marking the 1-star entry read brings the mean to 3.00');

-- Idempotent, first reader kept.
select lives_ok(format($$ select mark_feedback_read(%L) $$, :'fb_c'),
  'pressing Mark as read twice is not an error');
select is((select read_by from feedback where id = :'fb_c'), :'admin_uid'::uuid,
  'and the first reader stays on the row');

-- Office feedback counts immediately, with no event.
select lives_ok(format($$ select add_office_feedback(%L, 2, '  Phoned in: left the bar unattended  ', null) $$, :'staffa'),
  'the office leaves feedback that is not tied to an event');
select is((select rating from staff where id = :'staffa'), 2.67::numeric,
  '§9.10 an office entry counts toward the rating immediately on submission: (5 + 1 + 2) / 3');

select is((select author_name from feedback_entries_v where author_kind = 'office' and staff_id = :'staffa'),
  'Gisela M.', '§9.10 the author of an office entry is the manager''s own name, never "Office"');
select is((select text from feedback where author_kind = 'office' and staff_id = :'staffa'),
  'Phoned in: left the bar unattended', 'the comment is trimmed');
select is((select event_title from feedback_entries_v where author_kind = 'office' and staff_id = :'staffa'),
  null::text, 'and carries no event');
select is((select count(*)::int from staff_feedback_v where author_kind = 'office' and staff_id = :'staffa'), 1,
  'staff_feedback_v still lists an entry with no event (it inner-joined events before)');
select is((select editable and deletable from feedback_entries_v where author_kind = 'office' and staff_id = :'staffa'),
  true, 'an office entry is editable and deletable');
select is((select editable or deletable from feedback_entries_v where id = :'feedback_a'),
  false, 'a client entry on a worker who is still here is neither');

-- Edit moves the rating again, and is stamped.
select is((update_office_feedback((select id from feedback where author_kind = 'office' and staff_id = :'staffa'),
                                  5, 'Spoke to him, it was glassware. Fine.', :'event_c') ->> 'rating')::numeric,
  3.67::numeric, 'editing the stars of an office entry recomputes the rating: (5 + 1 + 5) / 3');
select isnt((select updated_at from feedback where author_kind = 'office' and staff_id = :'staffa'), null::timestamptz,
  'and the edit is stamped, for the "edited" line');
select is((select event_title from feedback_entries_v where author_kind = 'office' and staff_id = :'staffa'),
  'Feedback Fixture Past Event', 'the entry can be tied to an event the worker was booked on');

-- Delete moves it back.
select is((delete_feedback((select id from feedback where author_kind = 'office' and staff_id = :'staffa')) ->> 'rating')::numeric,
  3.00::numeric, 'deleting an office entry takes it out of the rating');

-- Marking read through the table rather than the RPC counts the same.
reset role;
insert into feedback (author_kind, author_id, staff_id, event_id, rating)
values ('client', :'clienta_uid', :'staffb', :'event_c', 2);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);
select is((select rating from staff where id = :'staffb'), 4.20::numeric,
  'Staff Bravo''s rating stands while both of their client entries are unread');
update feedback set read_at = now() where staff_id = :'staffb' and rating = 2;
select is((select rating from staff where id = :'staffb'), 2.00::numeric,
  'the rating hook is on the table, so a read_at written any other way counts too');

-- ---- §9.10 the editing rules, enforced ------------------------------
select throws_ok(format($$ update feedback set rating = 1 where id = %L $$, :'feedback_a'),
  '42501', null, '§9.10 client feedback is read-only: not even the office can change its stars');
select throws_ok(format($$ update feedback set text = 'redacted' where id = %L $$, :'feedback_a'),
  '42501', null, 'or its comment');
select throws_ok(format($$ update feedback set read_at = null, read_by = null where id = %L $$, :'feedback_a'),
  '42501', null, 'Mark as read is not undone');
select throws_ok(format($$ select update_office_feedback(%L, 1, 'x', null) $$, :'feedback_a'),
  '42501', null, 'the edit RPC refuses a client entry');
select throws_ok(format($$ select delete_feedback(%L) $$, :'feedback_a'),
  '42501', null, 'a client entry cannot be deleted while the worker is still on the books');
select throws_ok(format($$ update feedback set read_at = now() - interval '1 day' where id = %L $$,
                        (select id from feedback where staff_id = :'staffb' and rating = 2)),
  '42501', null, 'a read entry cannot have its read time rewritten');

select lives_ok(format($$ select add_office_feedback(%L, 4, 'Good night', null) $$, :'staffa'),
  'a second office entry, for the next checks');
select throws_ok(format($$ select mark_feedback_read(%L) $$,
                        (select id from feedback where author_kind = 'office' and staff_id = :'staffa')),
  '22023', null, '§9.10 "Mark as read" exists only on client feedback');
select throws_ok(format($$ update feedback set read_at = now() where author_kind = 'office' and staff_id = %L $$, :'staffa'),
  '23514', null, 'and an office row cannot carry a read state at all');
select throws_ok(format($$ update feedback set staff_id = %L where author_kind = 'office' and staff_id = %L $$, :'staffb', :'staffa'),
  '42501', null, 'an entry cannot be moved to another worker');
select throws_ok(format($$ select add_office_feedback(%L, 4, 'Was great', %L) $$, :'staffa', :'event_b'),
  '22023', null, 'an office entry can only name an event the worker was booked on');
select throws_ok(format($$ select add_office_feedback(%L, 4, '   ', null) $$, :'staffa'),
  '22023', null, 'the comment is required');
select throws_ok(format($$ select add_office_feedback(%L, 6, 'Too good', null) $$, :'staffa'),
  '22023', null, 'stars are 1 to 5');

-- ---- §1.7: the one exception ---------------------------------------
reset role;
update staff set removed_at = now(), status = 'removed' where id = :'staffb';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);
select is((select staff_name from feedback_entries_v where id = :'feedback_b'), 'Deleted account #90002',
  '§1.7 a removed worker is "Deleted account #id" in the feedback list');
select is((select deletable from feedback_entries_v where id = :'feedback_b'), true,
  'and their client entries become deletable, to redact a name if asked');
select lives_ok(format($$ select delete_feedback(%L) $$, :'feedback_b'),
  '§1.7 the office deletes a client entry about a removed worker');
select lives_ok(format($$ select delete_feedback(%L) $$,
                       (select id from feedback where staff_id = :'staffb' and rating = 2)),
  'and the other one');
select is((select rating from staff where id = :'staffb'), null::numeric,
  'nothing left to count means no rating, not the last one it had');

reset role;
set local role service_role;
select throws_ok(format($$ update feedback set rating = 1 where id = %L $$, :'feedback_a'),
  '42501', null, 'the guard binds the service role too, which bypasses RLS and so meets no policy');
reset role;

select throws_ok(format($$ insert into feedback (author_kind, author_id, staff_id, rating)
                           values ('client', %L, %L, 5) $$, :'clienta_uid', :'staffa'),
  '23514', null, 'a client entry must name its event');

-- =====================================================================
-- Who can reach it
-- =====================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid')::text, true);
select is((select count(*)::int from feedback_entries_v), 0,
  'a client reads nothing from feedback_entries_v — not even its own entries');
select throws_ok(format($$ select mark_feedback_read(%L) $$, :'feedback_a'),
  'P0002', null, 'a client cannot mark an entry read: it cannot see one');
select throws_ok(format($$ select add_office_feedback(%L, 5, 'Pretending', null) $$, :'staffa'),
  'P0002', null, 'or leave office feedback: it cannot see the worker');
select throws_ok(format($$ insert into feedback (author_kind, author_id, staff_id, event_id, rating, read_at)
                           values ('client', %L, %L, %L, 5, now()) $$, :'clienta_uid', :'staffb', :'event_c'),
  '42501', null, 'a client cannot insert an entry that is already read — it would count with nobody in the office seeing it');
select throws_ok(format($$ insert into feedback (author_kind, author_id, staff_id, event_id, rating)
                           values ('client', %L, %L, %L, 5) $$, :'clientb_uid', :'staffb', :'event_c'),
  '42501', null, 'or one under somebody else''s name');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid')::text, true);
select is((select count(*)::int from feedback_entries_v), 0,
  'a worker reads nothing from feedback_entries_v, including what was written about them');
select throws_ok(format($$ select add_office_feedback(%L, 5, 'I was brilliant', null) $$, :'staffa'),
  '42501', null, 'and cannot write feedback about themselves, even though they can see their own staff row');

reset role;
select * from finish();
rollback;
