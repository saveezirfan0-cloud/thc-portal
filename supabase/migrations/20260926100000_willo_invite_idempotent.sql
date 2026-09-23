-- =====================================================================
-- Willo "create candidate" is idempotent across a failed link
-- (§2.4, §2.12, Appendix B B1; ADR-0021, ADR-0024; docs/14 §4)
--
-- The defect. The `willo-invite` sweep (20260924110000) leased a due
-- candidate, POSTed them to Willo (Willo creates them and sends E1), and
-- only THEN recorded Willo's key with willo_link_candidate(). If that
-- second call failed — a network blip between the Edge Function and
-- PostgREST, a lock timeout — nothing in the database said the candidate
-- existed in Willo. They were still `interview_requested` with no
-- willo_candidate_id, so the next sweep created them again and Willo sent
-- a second E1.
--
-- The fix has three parts; this file is the database half.
--
--   1. willo_invite_created(staff, key) RECORDS the key (an audit_log
--      `willo_invite_created` row) and links it in ONE call. The link runs
--      in a sub-block: if it fails, the record survives and the call
--      answers `not_linked` instead of raising. So a key Willo returned is
--      either linked, or durably on file, or — if the call itself never
--      reached the database — covered by part 3.
--   2. willo_invite_due() now also returns `known_candidate_id`: a key
--      recorded in this onboarding period that is linked to nobody. The
--      sweep links that key and never POSTs again.
--   3. For the gap part 1 cannot close (the RPC lost in flight), the sweep
--      sends `external_id` = our staff id on create (it always did) and,
--      on any attempt after the first, asks Willo for a candidate with
--      that external_id before creating (packages/db/src/willo.ts,
--      willoLookupRequest / readLookupAnswer). A key from an EARLIER
--      onboarding period must never be re-linked — §2.12 wants a fresh
--      interview after Reset — so willo_invite_due() also returns
--      `prior_candidate_ids`, which the lookup refuses to match.
--      `willo_candidate_retired` rows (trigger below) are where those
--      keys come from from now on, because the status trigger nulls
--      willo_candidate_id on Reset and nothing else kept it.
--
-- No new table (001_rls_guard inventories them): the record is an
-- audit_log row, like the leases and failures it sits beside.
--
-- willo_invite_due's result type changes, which `create or replace`
-- cannot do, so it is dropped and recreated with the same arguments and
-- the same grants. Nothing in SQL calls it; the Edge Function names its
-- columns.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · Record + link, in one call
-- ---------------------------------------------------------------------
create or replace function public.willo_invite_created(
  p_staff              uuid,
  p_willo_candidate_id text,
  p_at                 timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text := nullif(btrim(coalesce(p_willo_candidate_id, '')), '');
  s     staff;
  v_owner uuid;
begin
  if v_key is null then
    raise exception 'willo_candidate_id_required' using errcode = '22023';
  end if;

  select * into s from staff where id = p_staff for update;
  if s.id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;

  -- The record first, once per key per onboarding period. It is what the
  -- next sweep reads if the link below does not happen.
  if not exists (select 1 from audit_log a
                  where a.entity = 'staff' and a.entity_id = s.id
                    and a.action = 'willo_invite_created'
                    and a.at >= s.onboarding_started_at
                    and a.data ->> 'willoCandidateId' = v_key) then
    insert into audit_log (at, actor, action, entity, entity_id, data)
    values (greatest(p_at, s.onboarding_started_at), null, 'willo_invite_created', 'staff', s.id,
            jsonb_build_object('willoCandidateId', v_key));
  end if;

  if s.willo_candidate_id = v_key then
    return jsonb_build_object('outcome', 'already_linked', 'willoCandidateId', v_key);
  end if;
  if s.willo_candidate_id is not null then
    -- Linked to a different Willo candidate already: Willo holds a
    -- duplicate. Recorded above so the office can find and delete it.
    return jsonb_build_object('outcome', 'not_linked', 'code', 'has_other_candidate',
                              'willoCandidateId', v_key);
  end if;
  if s.status <> 'interview_requested' or s.removed_at is not null then
    return jsonb_build_object('outcome', 'not_linked', 'code', 'not_awaiting_interview',
                              'willoCandidateId', v_key);
  end if;
  select id into v_owner from staff where willo_candidate_id = v_key and id <> s.id;
  if v_owner is not null then
    return jsonb_build_object('outcome', 'not_linked', 'code', 'key_in_use',
                              'willoCandidateId', v_key);
  end if;

  -- The link, in a sub-block: whatever goes wrong here rolls back only
  -- the link, never the record above.
  begin
    update staff
       set willo_candidate_id = v_key,
           willo_invited_at = p_at
     where id = s.id;
  exception when others then
    insert into audit_log (at, actor, action, entity, entity_id, data)
    values (p_at, null, 'willo_invite_failed', 'staff', s.id,
            jsonb_build_object('error', left('created ' || v_key || ', not linked: ' || sqlerrm, 300)));
    return jsonb_build_object('outcome', 'not_linked', 'code', 'link_failed',
                              'willoCandidateId', v_key, 'error', left(sqlerrm, 200));
  end;

  return jsonb_build_object('outcome', 'linked', 'willoCandidateId', v_key);
end $$;

comment on function public.willo_invite_created(uuid, text, timestamptz) is
  '§2.4: Willo answered "create candidate" with this key. Records it (audit_log willo_invite_created, once per key per onboarding period) and links it in one call; a failed link keeps the record and answers not_linked, so the next sweep links the recorded key instead of creating the candidate — and sending E1 — again. Service role only (ADR-0024).';

-- ---------------------------------------------------------------------
-- 2 · Keep the key a Reset throws away
--
-- The status trigger (20260923110000) nulls willo_candidate_id when a
-- person re-enters interview_requested. From now on the key it drops is
-- written down, so the lookup can refuse to re-link last period's
-- interview. Not on a GDPR removal: that clears the key on purpose, and
-- remove_worker() writes its own audit row.
-- ---------------------------------------------------------------------
create or replace function public.staff_willo_candidate_retired()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if old.willo_candidate_id is not null and new.willo_candidate_id is null
     and new.removed_at is null then
    insert into audit_log (actor, action, entity, entity_id, data)
    values (null, 'willo_candidate_retired', 'staff', new.id,
            jsonb_build_object('willoCandidateId', old.willo_candidate_id));
  end if;
  return null;
end $$;

drop trigger if exists staff_willo_candidate_retired on staff;
create trigger staff_willo_candidate_retired
  after update of willo_candidate_id, status on staff
  for each row
  when (old.willo_candidate_id is not null and new.willo_candidate_id is null)
  execute function public.staff_willo_candidate_retired();

-- ---------------------------------------------------------------------
-- 3 · The lease, now carrying what the sweep needs to be idempotent
--
-- Identical to 20260924110000 in who is due and in the backoff; two
-- columns more.
-- ---------------------------------------------------------------------
drop function if exists public.willo_invite_due(integer, timestamptz);

create function public.willo_invite_due(
  p_limit integer     default 20,
  p_now   timestamptz default now()
) returns table (
  staff_id            uuid,
  first_name          text,
  last_name           text,
  email               text,
  phone               text,
  attempt             integer,
  known_candidate_id  text,
  prior_candidate_ids text[]
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  r          staff;
  v_attempts integer;
  v_last     timestamptz;
  v_taken    integer := 0;
begin
  for r in
    select * from staff s
     where s.status = 'interview_requested'
       and s.willo_candidate_id is null
       and s.removed_at is null
     order by s.onboarding_started_at, s.id
     for update skip locked
  loop
    exit when v_taken >= greatest(coalesce(p_limit, 20), 1);

    select count(*)::int, max(a.at) into v_attempts, v_last
      from audit_log a
     where a.entity_id = r.id
       and a.action = 'willo_invite_claim'
       and a.entity = 'staff'
       and a.at >= r.onboarding_started_at;

    continue when v_last is not null
              and v_last > p_now - least(interval '5 minutes' * power(2, greatest(v_attempts - 1, 0)),
                                         interval '6 hours');

    insert into audit_log (at, actor, action, entity, entity_id, data)
    values (p_now, null, 'willo_invite_claim', 'staff', r.id,
            jsonb_build_object('attempt', v_attempts + 1));

    staff_id   := r.id;
    first_name := r.first_name;
    last_name  := r.last_name;
    email      := r.email;
    phone      := r.phone;
    attempt    := v_attempts + 1;

    -- A key Willo gave us this period that nobody holds: link it, do not
    -- create again. The newest wins if there were ever two.
    select a.data ->> 'willoCandidateId' into known_candidate_id
      from audit_log a
     where a.entity = 'staff' and a.entity_id = r.id
       and a.action = 'willo_invite_created'
       and a.at >= r.onboarding_started_at
       and not exists (select 1 from staff o
                        where o.willo_candidate_id = a.data ->> 'willoCandidateId')
     order by a.at desc, a.id desc
     limit 1;

    -- Keys from earlier periods: never to be re-linked (§2.12). A retired
    -- key is from an earlier period by definition — its row is written in
    -- the Reset's own transaction, so its `at` equals the new period's
    -- start and a time filter would miss it.
    select coalesce(array_agg(distinct a.data ->> 'willoCandidateId'), '{}')
      into prior_candidate_ids
      from audit_log a
     where a.entity = 'staff' and a.entity_id = r.id
       and (a.action = 'willo_candidate_retired'
            or (a.action = 'willo_invite_created' and a.at < r.onboarding_started_at))
       and a.data ->> 'willoCandidateId' is not null;

    v_taken    := v_taken + 1;
    return next;
  end loop;
end $$;

comment on function public.willo_invite_due(integer, timestamptz) is
  '§2.4/§2.12: leases up to p_limit candidates in interview_requested with no Willo candidate yet (new applicants and resets), backing off 5 min doubling to 6 h per person per onboarding period. Each lease is an audit_log willo_invite_claim row. known_candidate_id = a key recorded this period by willo_invite_created and linked to nobody (link it, do not create); prior_candidate_ids = keys from earlier periods (never re-link). Service role only.';

revoke execute on function public.willo_invite_due(integer, timestamptz)           from public, anon, authenticated;
revoke execute on function public.willo_invite_created(uuid, text, timestamptz)    from public, anon, authenticated;
revoke execute on function public.staff_willo_candidate_retired()                  from public, anon, authenticated;
grant  execute on function public.willo_invite_due(integer, timestamptz)           to service_role;
grant  execute on function public.willo_invite_created(uuid, text, timestamptz)    to service_role;
