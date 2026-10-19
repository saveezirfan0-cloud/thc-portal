-- =====================================================================
-- attempt_check_in: a lighter section lock, held for less, and no
-- No-show beside an accepted check-in (ADR-0157; go-live database audit
-- F7, concurrency audit M1)
--
-- 1 · FOR NO KEY UPDATE, not FOR UPDATE. The section row is locked so the
--     RULE-15 slot count ("the first `headcount` check-ins work") is read
--     by one press at a time; nothing here deletes the row or changes its
--     key. FOR UPDATE also conflicted with the FOR KEY SHARE every booking
--     insert takes on its section (the foreign key), so an invite round
--     and the check-ins of a section starting now queued behind each
--     other. NO KEY UPDATE still conflicts with itself and with the FOR
--     UPDATE of accept_invite / accept_application / invite_worker, so the
--     count is exactly as serialised as before.
--
-- 2 · The compliance stop (D16, 20261012121200) is EVALUATED before the
--     lock — it reads only the worker's own rows: status,
--     compliance_blockers(), can_roster_staff() — and still RAISED where
--     it was, after the idempotent already_checked_in, event_cancelled and
--     booking_not_confirmed answers, so every press gets the answer it got
--     before. The right-to-work day is the section's start date read
--     before the lock; if the section moved in between, it is asked again
--     for the new date under the lock.
--
-- 3 · A No-show raised while this press waited for the lock. booking_tick
--     (BG-03) now takes the same section lock before it raises a No-show
--     and re-checks the check-in under it (20261019194300), so a check-in
--     that holds the lock first is always seen. The other order — the tick
--     holds the lock at start + 30, this press began a moment before and
--     waited — would accept the press beside the tick's fresh No-show. A
--     No-show recorded after this press began (detected_at > its time)
--     therefore answers `locked`, as the press would a second later: one
--     outcome, never both. A No-show the office recorded BEFORE the press
--     is untouched (the worker is still let in, and Get back resolves it,
--     resolve_violation()).
--
-- Re-created from the LIVE body with targeted replacements (docs/10 §3b);
-- each pattern must match exactly once or the migration stops.
-- =====================================================================
do $$
declare
  p     record;
  v_def text := pg_get_functiondef('public.attempt_check_in(uuid,double precision,double precision,double precision)'::regprocedure);
  v_n   int;
begin
  for p in
    select * from (values
      ('(\n\s*)v_suspect(\s+)boolean;',
       '\1v_suspect\2boolean;\1v_roster_day date;\1v_roster_ok boolean;\1v_doc_block boolean;'),

      ('(-- Lock the role section: the slot count below has to be read under it\.\n\s*)select \* into sr from shift_requirements where id = b\.shift_id for update;',
       '-- D16, evaluated before the lock and raised below, where it always was
  -- (20261019194200): it reads only this worker''s rows.
  select s.status into v_status from staff s where s.id = b.staff_id;
  v_doc_block := exists (
    select 1 from compliance_blockers(b.staff_id, (v_now at time zone ''Europe/London'')::date) x
     where x.reason like ''document_expired:%'' or x.reason = ''conviction_unreviewed'');
  select (s.starts_at at time zone ''Europe/London'')::date into v_roster_day
    from shift_requirements s where s.id = b.shift_id;
  v_roster_ok := can_roster_staff(b.staff_id, v_roster_day);

  \1-- NO KEY UPDATE (20261019194200): serialises the presses and the
  -- Accepts on this section without blocking the foreign-key share lock
  -- of a booking being added to it.
  select * into sr from shift_requirements where id = b.shift_id for no key update;'),

      ('select s\.status into v_status from staff s where s\.id = b\.staff_id;\n\s*(if v_status is distinct from ''compliant'' then)',
       '\1'),

      ('if exists \(select 1 from compliance_blockers\(b\.staff_id, \(v_now at time zone ''Europe/London''\)::date\) x\s+where x\.reason like ''document_expired:%'' or x\.reason = ''conviction_unreviewed''\)\s+or not can_roster_staff\(b\.staff_id, \(sr\.starts_at at time zone ''Europe/London''\)::date\) then',
       'if v_doc_block
     or not (case when (sr.starts_at at time zone ''Europe/London'')::date = v_roster_day then v_roster_ok
                  else can_roster_staff(b.staff_id, (sr.starts_at at time zone ''Europe/London'')::date) end) then'),

      ('(d := check_in_decision\([^;]*\);)',
       '\1

  -- One outcome, never both (20261019194200): a No-show recorded while
  -- this press waited for the section lock — BG-03 at start + 30 — makes
  -- it the locked press it would have been a moment later.
  if (d->>''accepted'')::boolean
     and exists (select 1 from violations
                  where booking_id = b.id and type = ''no_show'' and not resolved
                    and detected_at > v_now) then
    d := d || jsonb_build_object(''decision'', ''locked'', ''accepted'', false, ''logOutcome'', null,
                                 ''turnAwayPayMin'', null, ''messageKey'', ''no_show_locked'');
  end if;')
    ) as x(pattern, replacement)
  loop
    select count(*) into v_n from regexp_matches(v_def, p.pattern, 'g');
    if v_n <> 1 then
      raise exception '20261019194200: attempt_check_in - expected one match of %, found %', p.pattern, v_n;
    end if;
    v_def := regexp_replace(v_def, p.pattern, p.replacement);
  end loop;
  execute v_def;
end;
$$;
