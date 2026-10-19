-- =====================================================================
-- One open No-show / No check-out / Late / Left-early per booking
-- (ADR-0157; go-live concurrency audit M1)
--
-- Every automatic writer guarded its insert with `where not exists (...)`
-- and nothing else: booking_tick (BG-03 No-show, BG-09 No check-out),
-- attempt_check_in (Late; the locked press's No-show), check_out (No
-- check-out, Left-early) and the office's office_mark_no_show. Two writers
-- that overlap — two booking-tick runs (it runs every minute with no lock
-- and has taken 70 s), or the tick and a worker's press at start + 30 —
-- each saw none and both inserted: two No-shows against one worker, twice
-- the show-rate penalty.
--
-- Now a partial unique index holds it: one UNRESOLVED row per (booking,
-- type) for the four kinds a booking can only earn once —
--   no_show      · one shift, one turn-up (BG-03, §3.3, §5.1)
--   no_checkout  · one check-out (BG-09, RULE-02)
--   late         · one accepted check-in (§5.1)
--   left_early   · one check-out (§9.5, RULE-14)
-- left_geofence is not in it: BG-07 records every exit.
--
-- UNRESOLVED only, on purpose. resolve_violation() turns a No-show into a
-- resolved Late in place (Get back, §3.3), which may sit beside the Late
-- of a worker who pressed after a manual No-show; and office_mark_no_show
-- may record a fresh No-show once the first was resolved. Neither is a
-- duplicate. Every automatic writer still refuses a second row of its kind
-- even when the first is resolved (its NOT EXISTS is kept); the index is
-- what stops the race the NOT EXISTS cannot see.
--
-- The writers now say `on conflict do nothing`, so the loser of the race
-- is a no-op rather than a unique_violation in the worker's face; the
-- office's press answers `already` as it does for a second press.
--
-- Existing duplicates: none on live as of the audit (17.10.2026). If any
-- exist where this runs, the EARLIEST open row of each (booking, type)
-- is kept (detected_at, then id) and the later open ones are deleted,
-- each recorded in audit_log as `violation.duplicate_removed` with the
-- whole row. Resolved rows are never touched.
--
-- Function bodies re-created from the LIVE bodies with targeted
-- replacements (docs/10 §3b); each pattern must match the stated number
-- of times or the migration stops.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · Duplicates, deterministically
-- ---------------------------------------------------------------------
do $$
declare
  v_n int;
begin
  with ranked as (
    select v.*, row_number() over (partition by v.booking_id, v.type
                                   order by v.detected_at, v.id) as rn
      from violations v
     where not v.resolved
       and v.type in ('no_show', 'no_checkout', 'late', 'left_early')
  ), gone as (
    delete from violations v
     using ranked r
     where r.id = v.id and r.rn > 1
    returning v.*
  ), logged as (
    insert into audit_log (at, actor, action, entity, entity_id, data)
    select now(), null, 'violation.duplicate_removed', 'violation', g.id,
           to_jsonb(g) || jsonb_build_object('staffId', g.staff_id, 'migration', '20261019194100')
      from gone g
    returning 1
  ) select count(*)::int into v_n from logged;
  raise notice '20261019194100: % duplicate open violation(s) removed', v_n;
end;
$$;

-- ---------------------------------------------------------------------
-- 2 · The index
-- ---------------------------------------------------------------------
create unique index if not exists violations_one_open_per_booking_type
  on public.violations (booking_id, type)
  where not resolved and type in ('no_show', 'no_checkout', 'late', 'left_early');

comment on index public.violations_one_open_per_booking_type is
  'ADR-0157: at most one unresolved No-show, No check-out, Late and Left-early per booking. The writers say ON CONFLICT DO NOTHING.';

-- ---------------------------------------------------------------------
-- 3 · The writers swallow the race
-- ---------------------------------------------------------------------
do $$
declare
  p     record;
  v_def text;
  v_n   int;
begin
  for p in
    select * from (values
      -- attempt_check_in: the Late of an accepted press, the No-show of a locked one.
      ('public.attempt_check_in(uuid,double precision,double precision,double precision)'::regprocedure,
       '(where not exists \(select 1 from violations where booking_id = b\.id and type = ''(late|no_show)''\));',
       '\1
     on conflict do nothing;', 2),

      -- check_out: No check-out and Left-early.
      ('public.check_out(uuid,double precision,double precision,double precision)'::regprocedure,
       '(where not exists \(select 1 from violations where booking_id = b\.id and type = ''(no_checkout|left_early)''\));',
       '\1
     on conflict do nothing;', 2),

      -- booking_tick: BG-03 and BG-09.
      ('public.booking_tick(timestamp with time zone)'::regprocedure,
       '(select staff_id, booking_id, ''(no_show|no_checkout)'', p_now from due)(\s+)returning 1',
       '\1\3on conflict do nothing\3returning 1', 2),

      -- office_mark_no_show: the press that loses to BG-03 (or another
      -- office user) answers as a second press does.
      ('public.office_mark_no_show(uuid)'::regprocedure,
       'values \(b\.staff_id, b\.id, ''no_show'', v_now\)\s+returning id into v_id;',
       'values (b.staff_id, b.id, ''no_show'', v_now)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    -- 20261019194100: BG-03 or another press recorded it a moment earlier.
    select id into v_id from violations
     where booking_id = b.id and type = ''no_show'' and not resolved
     limit 1;
    return jsonb_build_object(''ok'', true, ''already'', true, ''violationId'', v_id,
                              ''payrollExported'', booking_payroll_exported(b.id));
  end if;', 1)
    ) as x(fn, pattern, replacement, expected)
  loop
    v_def := pg_get_functiondef(p.fn);
    select count(*) into v_n from regexp_matches(v_def, p.pattern, 'g');
    if v_n <> p.expected then
      raise exception '20261019194100: % - expected % match(es) of %, found %', p.fn, p.expected, p.pattern, v_n;
    end if;
    execute regexp_replace(v_def, p.pattern, p.replacement, 'g');
  end loop;
end;
$$;
