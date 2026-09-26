-- =====================================================================
-- Migration 20260930205100 · review fixes for the worker's self-service
--   additions (docs/19 §1 and §3, Phase 1 Agent B · staff-pwa)
--
-- Three functions RESTATED, each in full from its latest (and only)
-- definition — grep: nothing after these files touches them — with the
-- clauses named below and nothing else changed. Same signatures, so
-- `create or replace` replaces rather than overloads; grants re-issued
-- exactly as before.
--
--   1 · request_profile_change   (from 20260930202200)
--       + too_many_requests: refused when the worker already has THREE
--         requests of that kind created in the last 24 hours, whatever
--         became of them. request → withdraw → request … could otherwise
--         queue an RC1 email to admin@ per loop, without limit (security
--         review #1). Every request counts, withdrawn and decided ones
--         included — the email was sent either way. The staff row is
--         already locked `for update` for the whole call, so two submits
--         in flight cannot both pass the count. Refused before anything
--         is written, so a refusal queues no RC1.
--
--   2 · add_my_unavailability    (from 20260930202000)
--   3 · remove_my_unavailability (from 20260930202000)
--       - the `status in ('compliant', 'blocked')` test
--       + editable only when the Staff App would show the screen at all:
--         `appLock() === 'none'` (apps/staff/app/profile/lock.ts). That is
--         status `compliant` AND none of the blockers that lock a compliant
--         worker to Documents — an expired document, or a criminal
--         declaration still under review — read from compliance_blockers()
--         on the UK date, as staff_me() reads them.
--
--       Decision (QA review): a MANUAL hold (block_kind = 'manual') is
--       refused, and so is every other block. A manual hold is a static
--       screen with nothing behind it (§10.1 case 2), so an RPC that still
--       wrote for it was a door the UI had closed. A documents-blocked
--       worker (auto_document, conviction_review) is refused too: they
--       are not in auto-assign's pool (blocked is a hard gate), the app
--       gives them one thing to do — Documents — and there is no reason
--       for the database to accept what no screen can send. Their entries
--       are kept, not deleted, and the office still reads them; once the
--       block lifts the worker edits them again. my_unavailability() (the
--       read) is not restated: reading one's own rows harms nothing, and
--       the screen that would show them is already closed.
--
-- Refusals raise as before: not_editable (P0001), which the Staff App
-- already turns into a sentence; too_many_requests (P0001), new, with its
-- sentence in apps/staff/app/profile/change-requests.ts.
--
-- Re-stamped after main's 20260930100000–20260930140100 (docs/10 §3b):
-- request_profile_change()'s photo path now also takes exactly
-- `<own id>/<name>.jpg`, the shape main's 20260930120200 gave
-- staff_set_photo(), since an approved request sets the same avatar.
--
-- Forward-only. pgTAP: 705 (G), 715 (G).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · request_profile_change — 20260930202200 + the 24-hour ceiling.
-- ---------------------------------------------------------------------
create or replace function public.request_profile_change(
  p_kind          text,
  p_first         text default null,
  p_last          text default null,
  p_photo_path    text default null,
  p_evidence_path text default null,
  p_note          text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id    uuid := staff_caller();
  s       staff;
  v_first text := nullif(btrim(coalesce(p_first, '')), '');
  v_last  text := nullif(btrim(coalesce(p_last, '')), '');
  v_photo text := nullif(btrim(coalesce(p_photo_path, '')), '');
  v_evid  text := nullif(btrim(coalesce(p_evidence_path, '')), '');
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_problem text;
  v_req   uuid;
  v_created timestamptz;
begin
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  select * into s from staff where id = v_id for update;
  if s.status = 'removed' then
    raise exception 'account_closed' using errcode = 'P0001';
  end if;
  -- The locks are §10.1's, on a worker who has a profile to correct. A
  -- leaver's details are frozen (§10.6 step 7); a candidate still in the
  -- wizard sets their own name and selfie there.
  if s.status not in ('compliant', 'blocked') then
    raise exception 'not_editable' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('name', 'photo') then
    raise exception 'bad_kind' using errcode = 'P0001';
  end if;
  if exists (select 1 from profile_change_requests r
              where r.staff_id = v_id and r.kind = p_kind and r.status = 'pending') then
    raise exception 'already_pending' using errcode = 'P0001',
      hint = 'ADR-0044: one pending request per kind. Withdraw it to ask again.';
  end if;
  -- 20260930205100: at most three of a kind in any 24 hours, any status.
  -- Each one emailed admin@ (RC1); withdrawing does not un-send it.
  if (select count(*) from profile_change_requests r
       where r.staff_id = v_id and r.kind = p_kind
         and r.created_at > now() - interval '24 hours') >= 3 then
    raise exception 'too_many_requests' using errcode = 'P0001',
      hint = 'At most three change requests of a kind in 24 hours (RC1 flood guard).';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'note_too_long' using errcode = 'P0001';
  end if;

  if p_kind = 'name' then
    -- validateNameChange() in packages/domain, in its order.
    if v_first is null then raise exception 'first_required' using errcode = 'P0001'; end if;
    if v_last  is null then raise exception 'last_required'  using errcode = 'P0001'; end if;
    if char_length(v_first) > 100 then raise exception 'first_too_long' using errcode = 'P0001'; end if;
    if char_length(v_last)  > 100 then raise exception 'last_too_long'  using errcode = 'P0001'; end if;
    -- Exact after trimming: a capitalisation fix IS a change.
    if v_first = btrim(s.first_name) and v_last = btrim(s.last_name) then
      raise exception 'unchanged' using errcode = 'P0001';
    end if;
    if v_evid is null then
      raise exception 'evidence_required' using errcode = 'P0001',
        hint = 'ADR-0044 / Q13: a name change needs evidence.';
    end if;
    select e.problem into v_problem
      from evidence_upload_problem(v_id, 'change-requests', v_evid) e;
    if v_problem is not null then
      raise exception '%', v_problem using errcode = 'P0001';
    end if;
    v_photo := null;
  else
    if v_photo is null then
      raise exception 'photo_required' using errcode = 'P0001';
    end if;
    -- The worker's own folder only; the table CHECK says the same. And
    -- exactly `<own id>/<name>.jpg`, one level deep — the shape main's
    -- 20260930120200 gave staff_set_photo(), because an approved request
    -- becomes the same locked avatar (re-checked when this file was
    -- re-stamped after it; the Staff App uploads <id>/selfie-<epoch>.jpg).
    if not starts_with(v_photo, v_id::text || '/')
       or char_length(v_photo) <= char_length(v_id::text) + 1
       or strpos(v_photo, '..') > 0
       or v_photo !~ ('^' || v_id::text || '/[A-Za-z0-9][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*\.jpg$') then
      raise exception 'wrong_path' using errcode = 'P0001';
    end if;
    if not exists (select 1 from storage.objects o
                    where o.bucket_id = 'photos' and o.name = v_photo) then
      raise exception 'file_not_found' using errcode = 'P0001';
    end if;
    if v_photo = s.photo_path then
      raise exception 'unchanged' using errcode = 'P0001';
    end if;
    v_first := null;
    v_last  := null;
    v_evid  := null;
  end if;

  begin
    insert into profile_change_requests
      (staff_id, kind, proposed_first_name, proposed_last_name,
       proposed_photo_path, evidence_path, worker_note)
    values (v_id, p_kind, v_first, v_last, v_photo, v_evid, v_note)
    returning id, created_at into v_req, v_created;
  exception when unique_violation then
    -- Two submits racing past the check above: the partial unique index
    -- keeps one, and the other is told what the first was.
    raise exception 'already_pending' using errcode = 'P0001';
  end;

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values ('RC1:request:' || v_req, 'email', 'RC1',
          array['admin@thehospitalitycompany.co.uk'],
          jsonb_build_object(
            'name',        s.first_name || ' ' || s.last_name,
            'employeeId',  coalesce(s.employee_id::text, '(not yet issued)'),
            'change',      p_kind,
            'requestedAt', to_char(v_created at time zone 'Europe/London', 'DD Mon YYYY HH24:MI'),
            'current',     case when p_kind = 'name' then s.first_name || ' ' || s.last_name
                                when s.photo_path is null then 'No photo on file'
                                else 'The current profile photo' end,
            'proposed',    case when p_kind = 'name' then v_first || ' ' || v_last
                                else 'A new photo, shown side by side in Staff → Change requests' end,
            'note',        coalesce(v_note, '—')))
  on conflict (key) do nothing;

  return jsonb_build_object('ok', true, 'id', v_req);
end $$;

comment on function public.request_profile_change(text, text, text, text, text, text) is
  'ADR-0044: the calling worker asks the office to change their locked name (first/last + evidence in documents/<id>/change-requests/) or photo (a fresh object in photos/<id>/). One pending per kind, and at most three of a kind created in any 24 hours whatever their status (too_many_requests — each queued an RC1; 20260930205100); the uploaded object must exist; a name equal to the current one is refused. Queues RC1 to admin@ in the same transaction. Never writes staff.';

-- ---------------------------------------------------------------------
-- 2 · add_my_unavailability — 20260930202000, editable only when
--     appLock() would be 'none'.
-- ---------------------------------------------------------------------
create or replace function public.add_my_unavailability(
  p_from_date    date,
  p_to_date      date default null,
  p_from_time    time default null,
  p_to_time      time default null,
  p_repeat_weeks int  default 0
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  v_status staff_status;
  v_today date := (now() at time zone 'Europe/London')::date;
  v_to_date date := coalesce(p_to_date, p_from_date);
  v_repeats int := coalesce(p_repeat_weeks, 0);
  v_first tstzrange;
  v_end_date date;
  v_span interval;
  v_existing int;
  v_series uuid;
  v_ids uuid[] := '{}';
  v_new uuid;
  v_conflicts jsonb;
begin
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  select s.status into v_status from staff s where s.id = v_id for update;
  if v_status = 'removed' then
    raise exception 'account_closed' using errcode = 'P0001';
  end if;
  -- Availability steers auto-assign, whose pool is rostered workers only.
  -- /profile/availability is reachable only when appLock() is 'none'
  -- (apps/staff/app/profile/lock.ts), and this says the same: compliant,
  -- and none of the blockers that lock a compliant worker to Documents.
  -- A leaver, a candidate, and every block — a manual hold included —
  -- are refused (20260930205100).
  if v_status is distinct from 'compliant'
     or exists (select 1 from compliance_blockers(v_id, v_today) b
                 where b.reason like 'document_expired:%'
                    or b.reason = 'conviction_unreviewed') then
    raise exception 'not_editable' using errcode = 'P0001';
  end if;

  -- 1 · bad_window. The builder raises 22023 for from == to, one time
  -- alone or to before from; the repeat count must be a whole number ≥ 0.
  if p_from_date is null or v_repeats < 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad_window');
  end if;
  begin
    v_first := unavailability_range(p_from_date, p_to_date, p_from_time, p_to_time);
  exception when sqlstate '22023' then
    return jsonb_build_object('ok', false, 'reason', 'bad_window');
  end;

  -- 2 · in_past: starts on a UK date before today, or has already ended.
  if p_from_date < v_today or upper(v_first) <= now() then
    return jsonb_build_object('ok', false, 'reason', 'in_past');
  end if;

  -- 3 · too_far: the LAST copy starts more than 365 days after today (UK).
  -- least() only keeps an absurd count from overflowing the date type; any
  -- count that large is too far regardless.
  if p_from_date + 7 * least(v_repeats, 100000) > v_today + 365 then
    return jsonb_build_object('ok', false, 'reason', 'too_far');
  end if;

  -- 4 · too_long: more than 31 UK calendar days, read on the wall clock
  -- exactly as the table's CHECK reads it (so 31 days across the October
  -- changeover is still 31 days).
  if p_from_time is null then
    v_end_date := v_to_date + 1;
  elsif v_to_date = p_from_date and p_to_time < p_from_time then
    v_end_date := p_from_date + 1;
  else
    v_end_date := v_to_date;
  end if;
  v_span := (v_end_date + coalesce(p_to_time, time '00:00'))
          - (p_from_date + coalesce(p_from_time, time '00:00'));
  if v_span > interval '31 days' then
    return jsonb_build_object('ok', false, 'reason', 'too_long');
  end if;

  -- 5 · too_many: more than 26 repeats, or more than 200 future rows.
  select count(*)::int into v_existing
    from staff_unavailability u
   where u.staff_id = v_id and upper(u.period) > now();
  if v_repeats > 26 or v_existing + v_repeats + 1 > 200 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;

  v_series := case when v_repeats > 0 then gen_random_uuid() end;
  for w in 0 .. v_repeats loop
    insert into staff_unavailability (staff_id, period, all_day, series_id)
    values (v_id,
            unavailability_range(p_from_date + 7 * w,
                                 case when p_to_date is null then null else p_to_date + 7 * w end,
                                 p_from_time, p_to_time),
            p_from_time is null,
            v_series)
    returning staff_unavailability.id into v_new;
    v_ids := v_ids || v_new;
  end loop;

  -- The warning: this worker's confirmed bookings whose ROLE SECTION
  -- (RULE-18) overlaps any entry just saved. Nothing is cancelled.
  select coalesce(jsonb_agg(jsonb_build_object(
           'bookingId', c.booking_id,
           'event',     c.title,
           'role',      c.role_name,
           'venue',     c.venue_name,
           'startsAt',  c.starts_at,
           'endsAt',    c.ends_at) order by c.starts_at), '[]'::jsonb)
    into v_conflicts
    from (
      select distinct b.id as booking_id, e.title, r.name as role_name, e.venue_name,
             sr.starts_at, sr.ends_at
        from bookings b
        join shift_requirements sr on sr.id = b.shift_id
        join events e              on e.id = sr.event_id
        join roles r               on r.id = sr.role_id
        join staff_unavailability u
          on u.id = any (v_ids)
         and u.period && tstzrange(sr.starts_at, sr.ends_at, '[)')
       where b.staff_id = v_id
         and b.status = 'confirmed'
         and b.cancelled_at is null
         and e.cancelled_at is null
    ) c;

  return jsonb_build_object('ok', true, 'ids', to_jsonb(v_ids), 'conflicts', v_conflicts);
end $$;

comment on function public.add_my_unavailability(date, date, time, time, int) is
  'ADR-0042: saves one availability entry for the calling worker (UK dates/times; all day when both times are null) plus p_repeat_weeks weekly copies sharing a series_id. {ok:false, reason} for bad_window › in_past › too_far › too_long › too_many (validateUnavailability() in packages/domain). Returns the worker''s confirmed bookings the entries overlap (by role section, RULE-18) as conflicts — never cancels them. Only for a worker the Staff App would show the screen to (appLock() none: compliant, no expired document, no declaration under review); every block, a manual hold included, raises not_editable (20260930205100).';

-- ---------------------------------------------------------------------
-- 3 · remove_my_unavailability — 20260930202000, the same gate.
-- ---------------------------------------------------------------------
create or replace function public.remove_my_unavailability(
  p_id           uuid,
  p_whole_series boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  v_status staff_status;
  v_series uuid;
  v_removed int;
begin
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  select s.status into v_status from staff s where s.id = v_id;
  if v_status = 'removed' then
    raise exception 'account_closed' using errcode = 'P0001';
  end if;
  -- The same gate as add_my_unavailability (20260930205100): only when
  -- appLock() would be 'none'.
  if v_status is distinct from 'compliant'
     or exists (select 1
                  from compliance_blockers(v_id, (now() at time zone 'Europe/London')::date) b
                 where b.reason like 'document_expired:%'
                    or b.reason = 'conviction_unreviewed') then
    raise exception 'not_editable' using errcode = 'P0001';
  end if;

  select u.series_id into v_series
    from staff_unavailability u
   where u.id = p_id and u.staff_id = v_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if coalesce(p_whole_series, false) and v_series is not null then
    delete from staff_unavailability u
     where u.staff_id = v_id
       and u.series_id = v_series
       and (u.id = p_id or upper(u.period) > now());
  else
    delete from staff_unavailability u
     where u.staff_id = v_id and u.id = p_id;
  end if;
  get diagnostics v_removed = row_count;

  return jsonb_build_object('ok', true, 'removed', v_removed);
end $$;

comment on function public.remove_my_unavailability(uuid, boolean) is
  'ADR-0042: deletes one of the calling worker''s availability entries, or (p_whole_series) it and every copy of its series not yet over. not_found for an id that is not theirs. Only for a worker the Staff App would show the screen to (appLock() none); every block, a manual hold included, raises not_editable (20260930205100).';

-- ---------------------------------------------------------------------
-- Grants — as 20260930202000 and 20260930202200 set them.
-- ---------------------------------------------------------------------
revoke execute on function public.request_profile_change(text, text, text, text, text, text) from public, anon;
revoke execute on function public.add_my_unavailability(date, date, time, time, int)          from public, anon;
revoke execute on function public.remove_my_unavailability(uuid, boolean)                     from public, anon;
grant  execute on function public.request_profile_change(text, text, text, text, text, text) to authenticated;
grant  execute on function public.add_my_unavailability(date, date, time, time, int)          to authenticated;
grant  execute on function public.remove_my_unavailability(uuid, boolean)                     to authenticated;
