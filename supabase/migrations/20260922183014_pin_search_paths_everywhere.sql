-- =====================================================================
-- Migration 20260922183014 · pin every remaining search_path (§1.7)
--
-- 20260921123503 pinned three functions and 20260921130156 pinned the
-- rest of what existed that morning. Fourteen have landed since:
--
--   20260921141500_auto_assign      booked_elsewhere_conflict,
--                                   booked_elsewhere_gap_minutes,
--                                   shift_fill, auto_assign_candidates,
--                                   ready_deadline, auto_assign_due_shifts
--   20260921153100_roles_directory  assert_role_input, create_role,
--                                   update_role, delete_role
--   20260922091447_clients_directory assert_client_input, create_client,
--                                   update_client
--   20260922095200_client_card      assert_charge_rate
--
-- All fourteen are invoker-rights, so this is hardening debt rather than
-- a live hole: an unpinned invoker function resolves its body against
-- the caller's search_path, and the caller already has the caller's own
-- privileges. It still matters, for two reasons that are not theoretical
-- here:
--
--   · They are called from inside `security definer` bodies. The
--     auto-assign engine's definer functions call shift_fill() and
--     booked_elsewhere_conflict(); an unpinned callee resolves `staff`,
--     `bookings` and `settings` against whatever path the definer
--     carries. Today every definer in the repo pins its own path so the
--     callee inherits a safe one — which is to say the safety of these
--     fourteen is a property of their callers, not of themselves.
--   · A SQL function with no SET clause is inlinable, and an inlined
--     body is resolved at the call site. `booked_elsewhere_gap_minutes()`
--     reads `settings`; inlined into a query run with a hostile path it
--     reads whichever `settings` that path finds, and the answer is the
--     2-hour gap that decides whether a worker may be double-booked
--     (RULE-17).
--
-- `public, extensions` and not bare `public`: several of these reach
-- PostGIS or pgcrypto, and that is the pairing every other pinned
-- function in the repo uses.
--
-- `alter function ... set` changes the execution environment only. No
-- body is touched, so no behaviour moves — with one deliberate exception
-- noted above: the SQL functions stop being inlinable, which is what
-- makes the pin binding at all (002_schema_hardening assertion 2 has
-- relied on exactly that since weekly_cap_hours was pinned). None of the
-- fourteen appears in an index expression, so nothing needs reindexing.
--
-- The name list that used to live in 002_schema_hardening has been
-- replaced by the invariant it asked for: no function in `public` that
-- this repo owns may be left unpinned. That assertion, not this
-- migration, is what keeps the fifteenth from happening.
--
-- Forward-only.
-- =====================================================================

-- §6 / RULE-17 · the auto-assign engine (20260921141500)
alter function public.booked_elsewhere_conflict(timestamptz, timestamptz, uuid, timestamptz, timestamptz, uuid, int)
  set search_path = public, extensions;
alter function public.booked_elsewhere_gap_minutes()
  set search_path = public, extensions;
alter function public.shift_fill(uuid)
  set search_path = public, extensions;
alter function public.auto_assign_candidates(uuid)
  set search_path = public, extensions;
alter function public.ready_deadline(timestamptz)
  set search_path = public, extensions;
alter function public.auto_assign_due_shifts(text, timestamptz)
  set search_path = public, extensions;

-- §9.10 · the roles directory (20260921153100)
alter function public.assert_role_input(text, numeric)
  set search_path = public, extensions;
alter function public.create_role(text, numeric, text)
  set search_path = public, extensions;
alter function public.update_role(uuid, text, numeric, text)
  set search_path = public, extensions;
alter function public.delete_role(uuid)
  set search_path = public, extensions;

-- §9.7 · the clients directory (20260922091447)
alter function public.assert_client_input(text, text, text, text, text[])
  set search_path = public, extensions;
alter function public.create_client(text, text, text, text, text[], boolean, boolean)
  set search_path = public, extensions;
alter function public.update_client(uuid, text, text, text, text, text[], boolean, boolean)
  set search_path = public, extensions;

-- §9.7 · the client card's rate lines (20260922095200)
alter function public.assert_charge_rate(numeric)
  set search_path = public, extensions;
