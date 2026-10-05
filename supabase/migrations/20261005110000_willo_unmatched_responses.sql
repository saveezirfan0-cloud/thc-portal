-- =====================================================================
-- Unmatched Willo responses (§2.4, §2.12; ADR-0021, ADR-0066, ADR-0087)
--
-- A person finished the Willo interview on 4 Oct and appeared nowhere in
-- the Back Office. Willo had a participant the portal never created (the
-- old Accelerate flow, an invitation sent by hand, a direct interview
-- link); willo_event_plan() found no staff row for the key; the receiver
-- answered 200 and wrote one audit_log row, `willo_event_refused` with
-- code `unknown_willo_candidate`. Nothing read those rows, so a real
-- interview response vanished without a trace anyone could see.
--
--   1. willo_record_refusal() takes what the delivery said about the
--      applicant — a name and an email, best effort — and when Willo
--      sent it. The old three-argument call still works (the new
--      arguments default to null). Name and email are kept ONLY when no
--      staff row owns the key: for a known candidate they are already on
--      the staff row.
--   2. willo_unmatched_responses(): the office's read. One row per Willo
--      key — first and last seen, the events seen, name and email if
--      captured, the Willo review link, and whether it is resolved.
--   3. willo_unmatched_link(): attach a response to a candidate and
--      replay what Willo said, in order, through willo_record_event(), so
--      the card lands at the right stage with Willo's own timestamps.
--      willo_unmatched_dismiss(): put it aside with a reason.
--
-- Where the state lives. No new table (001_rls_guard inventories every
-- table, ADR-0021 for the same reason): the events are the existing
-- `willo_event_refused` rows, and a resolution is one more audit_log row,
-- `willo_unmatched_linked` or `willo_unmatched_dismissed`, naming the key,
-- the person who decided and why. A response is resolved while its newest
-- resolution row is at least as new as its newest event; a Willo event
-- that arrives after a dismissal opens it again. A linked response is
-- resolved for good: the key is on a staff row, so the receiver stops
-- refusing it.
--
-- What a link does NOT replay. An `accepted` event cannot be replayed
-- here: an Accept needs the candidate's login and a personal activation
-- link, which only the Edge Function / Back Office can mint (GoTrue), and
-- E3 must never go out without one. So the replay walks the card to
-- Interview completed, stamped with Willo's time, and the office's
-- ordinary Accept (role pick + E3) finishes it — the same decision
-- ADR-0077 leaves to the office. The result says `acceptPending`.
--
-- Who may. Reading: any Back Office login (assert_office_caller), like
-- the board itself. Linking and dismissing: owners and managers, as
-- "Mark interview complete" (ADR-0077). Never a client or a worker.
-- pgTAP: supabase/tests/774_willo_unmatched_responses.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0 · The lookups below are by key and action, over a table that also
--     holds every check-in and every block.
-- ---------------------------------------------------------------------
create index if not exists audit_log_willo_unmatched_idx
  on audit_log ((data ->> 'willoCandidateId'), at)
  where action in ('willo_event_refused', 'willo_unmatched_linked', 'willo_unmatched_dismissed');

-- ---------------------------------------------------------------------
-- 1 · willo_record_refusal — with what the delivery said about the person
--
-- Replaces the three-argument function: a second overload would make
-- every existing three-argument call ambiguous for PostgREST. Defaults
-- keep those callers (and pgTAP 482) working unchanged.
-- ---------------------------------------------------------------------
drop function if exists public.willo_record_refusal(text, text, text);

create or replace function public.willo_record_refusal(
  p_willo_candidate_id text,
  p_event              text,
  p_code               text,
  p_name               text        default null,
  p_email              text        default null,
  p_occurred_at        timestamptz default null
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_staff uuid;
  v_name  text := nullif(left(btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]+', ' ', 'g')), 120), '');
  v_email text := nullif(left(lower(btrim(coalesce(p_email, ''))), 254), '');
begin
  select id into v_staff from staff where willo_candidate_id = p_willo_candidate_id limit 1;
  -- Not an address, not kept.
  if v_email is not null and v_email !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' then
    v_email := null;
  end if;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (null, 'willo_event_refused', 'staff', v_staff,
          jsonb_strip_nulls(jsonb_build_object(
            'willoCandidateId', p_willo_candidate_id,
            'event', p_event,
            'code', left(coalesce(p_code, ''), 200),
            'occurredAt', p_occurred_at,
            'name', case when v_staff is null then v_name end,
            'email', case when v_staff is null then v_email end)));
end $$;

comment on function public.willo_record_refusal(text, text, text, text, text, timestamptz) is
  '§2.4: audits a Willo event the database refused for good (the receiver then answers 200 so Willo stops retrying). For an unknown candidate it also keeps the name and email the delivery carried (best effort, only when no staff row owns the key) and when Willo says it happened, so the office can find the person (willo_unmatched_responses). Service role only.';

revoke execute on function public.willo_record_refusal(text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant  execute on function public.willo_record_refusal(text, text, text, text, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- 2 · The events and the state of each unmatched key (internal)
--
-- Not granted to anybody: the three office functions below call them.
-- ---------------------------------------------------------------------

-- Each distinct event once, at the earliest time Willo said it happened
-- (the delivery's own time when the receiver recorded it, else when the
-- receiver saw it), oldest first.
create or replace function public.willo_unmatched_events(p_willo_candidate_id text)
returns table (event text, occurred_at timestamptz)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select e.event, min(e.occurred) as occurred_at
    from (
      select coalesce(a.data ->> 'event', '') as event,
             coalesce(case when a.data ->> 'occurredAt' ~ '^\d{4}-\d{2}-\d{2}T'
                           then (a.data ->> 'occurredAt')::timestamptz end, a.at) as occurred
        from audit_log a
       where a.action = 'willo_event_refused'
         and a.entity_id is null
         and a.data ->> 'code' = 'unknown_willo_candidate'
         and a.data ->> 'willoCandidateId' = p_willo_candidate_id
    ) e
   where e.event <> ''
   group by e.event
   order by min(e.occurred), e.event
$$;

create or replace function public.willo_unmatched_rows()
returns table (
  willo_candidate_id text,
  first_seen         timestamptz,
  last_seen          timestamptz,
  event_count        integer,
  events             text[],
  name               text,
  email              text,
  review_url         text,
  resolved           boolean,
  resolution         text,
  resolved_at        timestamptz,
  resolved_by_name   text,
  resolution_reason  text,
  staff_id           uuid
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with ev as (
    select a.at,
           a.data ->> 'willoCandidateId'  as key,
           coalesce(a.data ->> 'event', '') as event,
           a.data ->> 'name'              as name,
           a.data ->> 'email'             as email,
           coalesce(case when a.data ->> 'occurredAt' ~ '^\d{4}-\d{2}-\d{2}T'
                         then (a.data ->> 'occurredAt')::timestamptz end, a.at) as occurred
      from audit_log a
     where a.action = 'willo_event_refused'
       and a.entity_id is null
       and a.data ->> 'code' = 'unknown_willo_candidate'
       and coalesce(a.data ->> 'willoCandidateId', '') <> ''
  ),
  first_event as (
    select key, event, min(occurred) as first_at from ev where event <> '' group by key, event
  ),
  grp as (
    select e.key,
           min(e.at)                      as first_seen,
           max(e.at)                      as last_seen,
           count(*)::int                  as event_count,
           (select array_agg(f.event order by f.first_at, f.event) from first_event f where f.key = e.key) as events,
           (array_agg(e.name  order by e.at desc) filter (where e.name  is not null))[1] as name,
           (array_agg(e.email order by e.at desc) filter (where e.email is not null))[1] as email
      from ev e
     group by e.key
  ),
  res as (
    select distinct on (a.data ->> 'willoCandidateId')
           a.data ->> 'willoCandidateId' as key,
           a.at, a.action, a.entity_id,
           a.data ->> 'byName' as by_name,
           a.data ->> 'reason' as reason
      from audit_log a
     where a.action in ('willo_unmatched_linked', 'willo_unmatched_dismissed')
     order by a.data ->> 'willoCandidateId', a.at desc, a.id desc
  )
  select g.key,
         g.first_seen,
         g.last_seen,
         g.event_count,
         coalesce(g.events, '{}'::text[]),
         g.name,
         g.email,
         case when g.key ~ '^[A-Za-z0-9_-]{1,64}$'
               and jsonb_typeof(t.value) = 'string'
              then replace(t.value #>> '{}', '{id}', g.key) end,
         (s.id is not null or (r.at is not null and r.at >= g.last_seen)),
         case when s.id is not null then 'linked'
              when r.at is not null and r.at >= g.last_seen
              then case r.action when 'willo_unmatched_linked' then 'linked' else 'dismissed' end
         end,
         case when s.id is not null or (r.at is not null and r.at >= g.last_seen) then r.at end,
         case when r.at is not null and r.at >= g.last_seen then r.by_name end,
         case when r.at is not null and r.at >= g.last_seen then r.reason end,
         case when s.id is not null then s.id
              when r.at is not null and r.at >= g.last_seen and r.action = 'willo_unmatched_linked'
              then r.entity_id end
    from grp g
    left join res r on r.key = g.key
    left join settings t on t.key = 'willo_review_url_template'
    left join lateral (
      select x.id from staff x
       where x.willo_candidate_id = g.key and x.removed_at is null
       limit 1
    ) s on true
$$;

comment on function public.willo_unmatched_rows() is
  'Internal: one row per Willo key the receiver refused as unknown, with its events, the name and email captured, the review link and whether it is resolved (linked to a candidate, or dismissed with nothing newer). The office reads it through willo_unmatched_responses().';

revoke execute on function public.willo_unmatched_events(text) from public, anon, authenticated;
revoke execute on function public.willo_unmatched_rows()       from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3 · The office's read
-- ---------------------------------------------------------------------
create or replace function public.willo_unmatched_responses(p_include_resolved boolean default false)
returns table (
  willo_candidate_id text,
  first_seen         timestamptz,
  last_seen          timestamptz,
  event_count        integer,
  events             text[],
  name               text,
  email              text,
  review_url         text,
  resolved           boolean,
  resolution         text,
  resolved_at        timestamptz,
  resolved_by_name   text,
  resolution_reason  text,
  staff_id           uuid
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  perform assert_office_caller();
  return query
    select r.willo_candidate_id, r.first_seen, r.last_seen, r.event_count, r.events,
           r.name, r.email, r.review_url, r.resolved, r.resolution, r.resolved_at,
           r.resolved_by_name, r.resolution_reason, r.staff_id
      from willo_unmatched_rows() r
     where coalesce(p_include_resolved, false) or not r.resolved
     order by r.resolved, r.last_seen desc, r.willo_candidate_id;
end $$;

comment on function public.willo_unmatched_responses(boolean) is
  '§2.4, ADR-0087: the Willo responses that reached the receiver for a participant the portal has no candidate for (created in Willo by hand, or before the portal existed). One row per Willo key; unresolved only unless asked. Back Office only — a client or a worker is refused.';

-- ---------------------------------------------------------------------
-- 4 · Link a response to a candidate, and replay what Willo said
-- ---------------------------------------------------------------------
create or replace function public.willo_unmatched_link(
  p_willo_candidate_id text,
  p_staff              uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_key      text := btrim(coalesce(p_willo_candidate_id, ''));
  v_name     text;
  u          record;
  s          staff;
  e          record;
  v_target   text;
  v_out      jsonb;
  v_replayed jsonb := '[]'::jsonb;
  v_accept   boolean := false;
  v_accept_at timestamptz;
  v_status   text;
begin
  perform assert_office_caller();
  select p.full_name into v_name
    from profiles p
   where p.id = auth.uid() and p.role = 'admin' and p.office_role in ('owner', 'manager');
  if not found then
    raise exception 'not_permitted' using errcode = '42501', detail = 'willo_unmatched';
  end if;
  if v_key = '' then
    raise exception 'willo_candidate_id_required' using errcode = '22023';
  end if;

  -- One decision per key at a time: two managers pressing Link, or Link
  -- and Dismiss, serialise here and the second meets the first's result.
  perform pg_advisory_xact_lock(hashtextextended('willo_unmatched:' || v_key, 0));

  select * into u from willo_unmatched_rows() r where r.willo_candidate_id = v_key;
  if not found then
    raise exception 'unknown_unmatched_response' using errcode = 'P0002';
  end if;

  -- Already linked: to this person is a repeat (nothing replayed twice),
  -- to anybody else is refused.
  if u.staff_id is not null then
    if u.staff_id = p_staff then
      return jsonb_build_object('outcome', 'already_linked', 'staffId', p_staff::text);
    end if;
    raise exception 'key_linked_elsewhere' using errcode = 'P0001';
  end if;
  if exists (select 1 from staff x where x.willo_candidate_id = v_key) then
    -- Held by a removed record (§1.7): not ours to move.
    raise exception 'key_linked_elsewhere' using errcode = 'P0001';
  end if;

  select * into s from staff x where x.id = p_staff for update;
  if s.id is null or s.removed_at is not null then
    raise exception 'unknown_staff' using errcode = 'P0002';
  end if;
  if s.willo_candidate_id is not null then
    raise exception 'candidate_already_linked' using errcode = 'P0001';
  end if;
  -- Only a candidate still waiting on the interview decision. Replaying a
  -- Reject onto someone already in Documents or beyond would reject a
  -- person the office has since taken on.
  if s.status not in ('interview_requested', 'interview_completed') then
    raise exception 'not_awaiting_interview: %', s.status using errcode = 'P0001';
  end if;

  update staff
     set willo_candidate_id = v_key,
         willo_invited_at   = coalesce(willo_invited_at, u.first_seen)
   where id = p_staff;

  for e in select * from willo_unmatched_events(v_key) loop
    v_target := (select value ->> e.event from settings where key = 'willo_stage_map');
    if v_target = 'documents' then
      v_accept := true;
      v_accept_at := least(coalesce(v_accept_at, e.occurred_at), e.occurred_at);
      v_replayed := v_replayed || jsonb_build_object('event', e.event, 'outcome', 'accept_pending');
      continue;
    end if;
    v_out := willo_record_event(v_key, e.event, least(e.occurred_at, now()), '{}'::jsonb);
    v_replayed := v_replayed || jsonb_build_object('event', e.event, 'outcome', v_out ->> 'outcome');
  end loop;

  select x.status::text into v_status from staff x where x.id = p_staff;

  -- Willo accepted them. The login and E3 are the office's Accept; here
  -- the card only has to be where the Accept button is.
  if v_accept and v_status = 'interview_requested' then
    update staff
       set status = 'interview_completed',
           willo_completed_at = coalesce(willo_completed_at, least(v_accept_at, now()))
     where id = p_staff;
    v_status := 'interview_completed';
  end if;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'willo_unmatched_linked', 'staff', p_staff,
          jsonb_build_object('willoCandidateId', v_key, 'staffId', p_staff::text,
                             'byName', v_name, 'events', to_jsonb(u.events),
                             'replayed', v_replayed));

  -- The person is on a staff row now; the stranger's name and email in the
  -- refusal rows have done their job.
  update audit_log a
     set data = a.data - 'name' - 'email'
   where a.action = 'willo_event_refused'
     and a.entity_id is null
     and a.data ->> 'willoCandidateId' = v_key
     and (a.data ? 'name' or a.data ? 'email');

  return jsonb_build_object(
    'outcome', 'linked',
    'staffId', p_staff::text,
    'status', v_status,
    'replayed', v_replayed,
    'acceptPending', v_accept and v_status = 'interview_completed');
end $$;

comment on function public.willo_unmatched_link(text, uuid) is
  '§2.4, ADR-0087: an owner or manager links an unmatched Willo response to a candidate waiting on the interview (not removed, not already linked to Willo). Sets staff.willo_candidate_id, replays the response''s events in order through willo_record_event() with Willo''s own times (New Response → Interview completed; Reject → rejected and E2), and walks an Accept to Interview completed for the office''s ordinary Accept (acceptPending). Idempotent; audited as willo_unmatched_linked.';

-- ---------------------------------------------------------------------
-- 5 · Dismiss a response, with a reason
-- ---------------------------------------------------------------------
create or replace function public.willo_unmatched_dismiss(
  p_willo_candidate_id text,
  p_reason             text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_key    text := btrim(coalesce(p_willo_candidate_id, ''));
  v_reason text := left(btrim(coalesce(p_reason, '')), 500);
  v_name   text;
  u        record;
begin
  perform assert_office_caller();
  select p.full_name into v_name
    from profiles p
   where p.id = auth.uid() and p.role = 'admin' and p.office_role in ('owner', 'manager');
  if not found then
    raise exception 'not_permitted' using errcode = '42501', detail = 'willo_unmatched';
  end if;
  if v_key = '' then
    raise exception 'willo_candidate_id_required' using errcode = '22023';
  end if;
  if v_reason = '' then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('willo_unmatched:' || v_key, 0));

  select * into u from willo_unmatched_rows() r where r.willo_candidate_id = v_key;
  if not found then
    raise exception 'unknown_unmatched_response' using errcode = 'P0002';
  end if;
  -- A linked response is the candidate's now; nothing to put aside.
  if u.resolution = 'linked' then
    raise exception 'already_resolved' using errcode = 'P0001';
  end if;
  if u.resolved then
    return jsonb_build_object('outcome', 'already_dismissed');
  end if;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'willo_unmatched_dismissed', 'staff', null,
          jsonb_build_object('willoCandidateId', v_key, 'reason', v_reason,
                             'byName', v_name, 'events', to_jsonb(u.events)));

  update audit_log a
     set data = a.data - 'name' - 'email'
   where a.action = 'willo_event_refused'
     and a.entity_id is null
     and a.data ->> 'willoCandidateId' = v_key
     and (a.data ? 'name' or a.data ? 'email');

  return jsonb_build_object('outcome', 'dismissed');
end $$;

comment on function public.willo_unmatched_dismiss(text, text) is
  '§2.4, ADR-0087: an owner or manager puts an unmatched Willo response aside with a mandatory reason (audited as willo_unmatched_dismissed). A Willo event that arrives afterwards opens it again. A response already linked to a candidate cannot be dismissed. Idempotent.';

-- ---------------------------------------------------------------------
-- 6 · Grants — the office's three: signed in, each refuses a non-admin
--     itself (and the two writes anyone but an owner or manager).
-- ---------------------------------------------------------------------
revoke all on function public.willo_unmatched_responses(boolean) from public, anon;
revoke all on function public.willo_unmatched_link(text, uuid)   from public, anon;
revoke all on function public.willo_unmatched_dismiss(text, text) from public, anon;
grant execute on function public.willo_unmatched_responses(boolean) to authenticated;
grant execute on function public.willo_unmatched_link(text, uuid)   to authenticated;
grant execute on function public.willo_unmatched_dismiss(text, text) to authenticated;
