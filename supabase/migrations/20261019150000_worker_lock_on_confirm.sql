-- =====================================================================
-- Every path to `confirmed` serialises on the WORKER first (ADR-0157)
--
-- Go-live concurrency audit, finding H2 (RULE-20 can be breached). The
-- three functions that move a booking to `confirmed` — accept_invite,
-- accept_application, take_offered_shift (no other function writes the
-- status; 870 pins that) — each locked only their own role section. The
-- overlap re-read, weekly_cap_would_breach() and the AFTER trigger
-- bookings_rota_guard all read committed state, so two confirmations for
-- ONE worker on TWO sections, in the same second, each saw the other
-- absent: a student visa at 14 h with two 5 h invitations could end the
-- second at 24 h, or with two overlapping confirmed shifts.
--
-- Now each takes a transaction-scoped advisory lock on the worker before
-- anything else — lock_worker(staff_id) — so the second waits for the
-- first to commit and its guard reads then see it (READ COMMITTED: every
-- statement after the lock takes a fresh snapshot). An advisory lock, not
-- the staff row: a profile edit, a document upload or a block must not
-- queue behind an Accept, and the row lock would.
--
-- The order, everywhere: WORKER, then SECTION, then BOOKING row(s).
-- Nothing takes the worker lock after a section or booking lock, so no
-- wait cycle can form through it. It also removes one that existed: two
-- Accepts by one worker on two overlapping sections each held their own
-- booking and wanted the other's (the §3.4 overlap withdrawal).
--
-- accept_invite double tap (audit M2): the booking was read before the
-- section lock and judged on that stale copy, so the second tap of a
-- confirmed worker on the last slot ran `confirmed -> closed` and raised
-- illegal_booking_transition, and on any other slot re-ran the gates
-- against its own new confirmation (`hours_limit`, `overlap`). It is now
-- re-read FOR UPDATE under the locks, and a booking already confirmed
-- returns the success it already had ({ok:true, already:true}).
-- mark_ready / confirm_on_day are not the same shape (no lock, no status
-- change, coalesce on the stamp): a second tap already answers ok.
--
-- Re-created from the LIVE bodies with targeted replacements (docs/10
-- §3b); each pattern must match exactly once or the migration stops.
-- Security, search_path and grants are untouched.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The lock
-- ---------------------------------------------------------------------
create or replace function public.worker_lock_key(p_staff uuid)
returns bigint
language sql
immutable
set search_path = public, extensions
as $$ select hashtextextended('staff:' || p_staff::text, 0) $$;

comment on function public.worker_lock_key(uuid) is
  'The advisory-lock key of one worker (ADR-0157). A hash: two workers sharing a key only queue behind each other, never wrongly pass.';

create or replace function public.lock_worker(p_staff uuid)
returns void
language plpgsql
volatile
set search_path = public, extensions
as $$
begin
  -- ADR-0157: worker, then section, then booking. Held to the end of the
  -- transaction; never take it after a section or booking lock.
  perform pg_advisory_xact_lock(worker_lock_key(p_staff));
end $$;

comment on function public.lock_worker(uuid) is
  'Serialises every change that can add hours or an overlap to one worker (ADR-0157). Taken FIRST — before any section or booking lock — by accept_invite, accept_application and take_offered_shift.';

-- Diagnostics and pgTAP: is this session holding the worker's lock?
create or replace function public.worker_lock_held(p_staff uuid)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select exists (
    select 1 from pg_locks l
     where l.locktype = 'advisory'
       and l.pid = pg_backend_pid()
       and l.granted
       and l.objsubid = 1
       and l.classid = ((worker_lock_key(p_staff) >> 32) & 4294967295)::oid
       and l.objid   = (worker_lock_key(p_staff) & 4294967295)::oid)
$$;

revoke execute on function public.worker_lock_key(uuid)  from public, anon, authenticated;
revoke execute on function public.lock_worker(uuid)      from public, anon, authenticated;
revoke execute on function public.worker_lock_held(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2 · accept_invite: worker lock, then a fresh read of the booking
-- ---------------------------------------------------------------------
do $$
declare
  p     record;
  v_def text := pg_get_functiondef('public.accept_invite(uuid)'::regprocedure);
  v_n   int;
begin
  for p in
    select * from (values
      ('select \* into sr from shift_requirements where id = b\.shift_id for update;',
       '-- ADR-0157 (20261019150000): the worker first, then the section, so a
  -- second confirmation for this worker on another section waits and its
  -- cap and overlap reads below see this one.
  perform lock_worker(b.staff_id);
  \&
  -- Re-read under the locks: the copy above was taken before them, and a
  -- double tap judged on it closed or re-gated a booking already won.
  select * into b from bookings where id = p_booking for update;'),

      ('if b\.status <> ''invited'' then',
       '-- A second tap finds the first one''s answer (20261019150000).
  if b.status = ''confirmed'' then
    return jsonb_build_object(''ok'', true, ''already'', true, ''withdrawn'', 0, ''closedApplications'', 0);
  end if;
  \&')
    ) as x(pattern, replacement)
  loop
    select count(*) into v_n from regexp_matches(v_def, p.pattern, 'g');
    if v_n <> 1 then
      raise exception '20261019150000: accept_invite - expected one match of %, found %', p.pattern, v_n;
    end if;
    v_def := regexp_replace(v_def, p.pattern, p.replacement);
  end loop;
  execute v_def;
end;
$$;

-- ---------------------------------------------------------------------
-- 3 · accept_application: learn the worker, lock them, then the section
-- ---------------------------------------------------------------------
do $$
declare
  p     record;
  v_def text := pg_get_functiondef('public.accept_application(uuid)'::regprocedure);
  v_n   int;
begin
  for p in
    select * from (values
      ('(\n\s*)v_shift(\s+)uuid;',
       '\1v_shift\2uuid;\1v_staff\2uuid;'),

      ('select shift_id into v_shift from bookings where id = p_booking;',
       '-- Unlocked: only to learn the section and the worker, neither of which
  -- a booking ever changes.
  select shift_id, staff_id into v_shift, v_staff from bookings where id = p_booking;'),

      ('select \* into sr from shift_requirements where id = v_shift for update;',
       '-- ADR-0157 (20261019150000): the worker first, then the section.
  perform lock_worker(v_staff);
  \&')
    ) as x(pattern, replacement)
  loop
    select count(*) into v_n from regexp_matches(v_def, p.pattern, 'g');
    if v_n <> 1 then
      raise exception '20261019150000: accept_application - expected one match of %, found %', p.pattern, v_n;
    end if;
    v_def := regexp_replace(v_def, p.pattern, p.replacement);
  end loop;
  execute v_def;
end;
$$;

-- ---------------------------------------------------------------------
-- 4 · take_offered_shift: the taker is the worker gaining hours
-- ---------------------------------------------------------------------
do $$
declare
  p     record;
  v_def text := pg_get_functiondef('public.take_offered_shift(uuid)'::regprocedure);
  v_n   int;
begin
  for p in
    select * from (values
      ('select \* into sr from shift_requirements where id = o\.shift_id for update;',
       '-- ADR-0157 (20261019150000): the taker first — the one worker whose
  -- hours and overlaps change — then the section, booking, offer below.
  perform lock_worker(v_me);
  \&')
    ) as x(pattern, replacement)
  loop
    select count(*) into v_n from regexp_matches(v_def, p.pattern, 'g');
    if v_n <> 1 then
      raise exception '20261019150000: take_offered_shift - expected one match of %, found %', p.pattern, v_n;
    end if;
    v_def := regexp_replace(v_def, p.pattern, p.replacement);
  end loop;
  execute v_def;
end;
$$;
