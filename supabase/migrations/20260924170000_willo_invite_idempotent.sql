-- =====================================================================
-- Creating a candidate in Willo happens at most once (§2.4, §2.12,
-- ADR-0021)
--
-- The defect (docs/14 §4, "New from the 24.09 wave"): the `willo-invite`
-- sweep creates the candidate in Willo — an action nothing can undo, and
-- the one that makes Willo send E1 — and only then records the returned
-- key with willo_link_candidate(). If that second call failed, NOTHING
-- remembered that the first had succeeded. The candidate was still
-- `interview_requested` with no willo_candidate_id, so the next sweep
-- created them in Willo AGAIN: a second Willo candidate, and a second E1
-- interview invitation to a person who had already had one. The link can
-- fail for entirely transient reasons — a deadlock on the staff row, a
-- statement timeout, a dropped connection — not only for the "candidate
-- moved on" case 20260924110000's comment described.
--
-- The rule this migration encodes:
--
--   ONCE WILLO HAS RETURNED A CANDIDATE KEY, THAT KEY IS OURS AND IS
--   DURABLE. A CANDIDATE CARRYING ONE IS RE-LINKED, NEVER RE-CREATED.
--   AND WHERE WE ONLY KNOW THAT WILLO *MIGHT* HAVE CREATED THEM, WE DO
--   NOT CREATE THEM AGAIN ON A GUESS.
--
--   1. willo_invite_created(staff, key, ref) replaces willo_link_candidate
--      in the sweep. It writes the key to audit_log FIRST and then links,
--      in one transaction, and it RETURNS its outcome instead of raising:
--      `linked`, `already_linked` (a repeat — idempotent), or one of the
--      terminal ones (`not_awaiting_interview`, `superseded`,
--      `other_candidate_linked`, `candidate_taken`, `unknown_staff`).
--      So a raised error now means one thing only: the call did not get
--      through. That is the transient case, and the caller retries the
--      same call, holding the key in memory.
--
--   2. willo_invite_due() reads that key back. A candidate for whom this
--      onboarding period already has a key comes back as mode `relink`
--      carrying it: the Edge Function skips the HTTP call entirely and
--      only re-links. No second Willo candidate, no second E1.
--
--   3. willo_invite_failed() records how much we know about whether Willo
--      created them (`no` / `unknown` / `yes`), because a 401 and a
--      timeout are not the same fact:
--        no      — Willo refused the request. Nothing was created; the
--                  next sweep creates, mode `create`.
--        unknown — a 5xx, a 408/429, a network timeout. Probably not
--                  created, possibly created. The next sweep creates
--                  again but as mode `recover`, reusing the SAME invite
--                  reference, so an API that honours an idempotency key
--                  returns the first candidate instead of making a
--                  second. Dropping an applicant is worse than a
--                  duplicate we can see in the audit; the claim row
--                  records that this one was a guess.
--        yes     — Willo answered 2xx and we could not read a key out of
--                  its body (ADR-0021: the reader is tolerant over an
--                  assumed shape). The candidate EXISTS and E1 HAS GONE.
--                  Re-creating is guaranteed to send a second one, so the
--                  candidate is HELD: willo_invite_due() stops offering
--                  them for this onboarding period and audits
--                  willo_invite_held. The office's Reset (§2.12) starts a
--                  new period and is the escape hatch.
--
--   4. A key Willo created that can never be linked to the person it was
--      created for (they were rejected, removed, or Reset in between) is
--      audited as willo_invite_orphan: a live Willo candidate belonging
--      to nobody, which somebody should remove in Willo. The orphan row
--      also releases the candidate from mode `relink`, so a genuinely
--      terminal outcome cannot wedge the sweep in a loop.
--
-- Willo's own de-duplication is NOT the fix. ADR-0021 §1: the API shape,
-- the signing scheme and the create endpoint are assumed pending THC's
-- first sandbox delivery (Appendix B, B1). The invite reference is sent
-- as an `Idempotency-Key` header (packages/db/src/willo.ts) as a second
-- line only; everything above holds whether or not Willo honours it.
--
-- No new table: as in 20260924110000, leases, attempts, keys and refusals
-- are audit_log rows — which is where anybody would look for them — and
-- audit_log_entity_action_idx (that migration) is the index these read.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The Willo key is recorded, then linked, and says what happened
-- ---------------------------------------------------------------------
create or replace function public.willo_invite_created(
  p_staff              uuid,
  p_willo_candidate_id text,
  p_ref                text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s         staff;
  v_id      text := btrim(coalesce(p_willo_candidate_id, ''));
  v_period  timestamptz;
  v_outcome text;
  v_linked  boolean;
begin
  -- A blank key is a programming error, not an outcome: it would leave
  -- the candidate looking linked while every webhook for them was refused
  -- as unknown.
  if v_id = '' then
    raise exception 'willo_candidate_id_required' using errcode = '22023';
  end if;

  select onboarding_started_at into v_period from staff where id = p_staff;

  -- The durable record, written BEFORE anything that can decide not to
  -- link. From here on, this period's sweep re-links and never re-creates.
  if not exists (
    select 1 from audit_log a
     where a.entity = 'staff'
       and a.entity_id = p_staff
       and a.action = 'willo_invite_created'
       and a.data ->> 'willoCandidateId' = v_id
       and (v_period is null or a.at >= v_period))
  then
    insert into audit_log (actor, action, entity, entity_id, data)
    values (null, 'willo_invite_created', 'staff', p_staff,
            jsonb_build_object('willoCandidateId', v_id, 'ref', p_ref));
  end if;

  select * into s from staff where id = p_staff for update;

  if s.id is null then
    -- Removed outright (§1.7) between the create and this call.
    v_outcome := 'unknown_staff';
  elsif s.willo_candidate_id = v_id then
    -- A retry of this very call, or the nudge and the schedule both
    -- landing it. Nothing to do, and not a failure.
    v_outcome := 'already_linked';
  elsif s.willo_candidate_id is not null then
    v_outcome := 'other_candidate_linked';
  elsif exists (select 1 from staff o where o.willo_candidate_id = v_id and o.id <> p_staff) then
    -- staff_willo_candidate_idx would raise; say so instead of throwing,
    -- so the caller can tell this from a connection that dropped.
    v_outcome := 'candidate_taken';
  elsif s.removed_at is not null or s.status <> 'interview_requested' then
    -- Rejected, or moved on by a webhook that arrived first. Terminal.
    v_outcome := 'not_awaiting_interview';
  elsif p_ref is not null and not exists (
          select 1 from audit_log a
           where a.entity = 'staff'
             and a.entity_id = p_staff
             and a.action = 'willo_invite_claim'
             and a.data ->> 'ref' = p_ref
             and a.at >= s.onboarding_started_at)
  then
    -- A Reset (§2.12) happened between the claim and now: this key is
    -- last period's interview and must not be attached to this one.
    v_outcome := 'superseded';
  else
    update staff
       set willo_candidate_id = v_id,
           willo_invited_at   = coalesce(willo_invited_at, now())
     where id = s.id;
    v_outcome := 'linked';
  end if;

  v_linked := v_outcome in ('linked', 'already_linked');

  if not v_linked then
    -- A candidate that exists in Willo and belongs to nobody here.
    -- Recorded so it can be removed there, and so willo_invite_due stops
    -- offering this key for re-linking (otherwise a terminal outcome
    -- would be retried every backoff for ever).
    insert into audit_log (actor, action, entity, entity_id, data)
    values (null, 'willo_invite_orphan', 'staff', p_staff,
            jsonb_build_object('willoCandidateId', v_id, 'ref', p_ref, 'outcome', v_outcome));
  end if;

  return jsonb_build_object(
    'staffId', p_staff::text,
    'willoCandidateId', v_id,
    'outcome', v_outcome,
    'linked', v_linked,
    'terminal', not v_linked);
end $$;

comment on function public.willo_invite_created(uuid, text, text) is
  '§2.4/§2.12: records the key Willo returned for a candidate (durably, before linking) and links it in the same transaction. Returns its outcome — linked / already_linked / not_awaiting_interview / superseded / other_candidate_linked / candidate_taken / unknown_staff — rather than raising, so a raised error means only that the call did not get through and the caller may safely retry it. Terminal outcomes audit willo_invite_orphan. Service role only.';

-- ---------------------------------------------------------------------
-- 2 · A failed attempt records what we know, and any key we hold
--
-- Replaces the two-argument willo_invite_failed of 20260924110000 (drop,
-- not a second overload: two-argument calls would be ambiguous against a
-- version carrying defaults, and PostgREST resolves by argument names).
-- ---------------------------------------------------------------------
drop function if exists public.willo_invite_failed(uuid, text);

create function public.willo_invite_failed(
  p_staff              uuid,
  p_error              text,
  p_willo_candidate_id text    default null,
  p_ref                text    default null,
  p_phase              text    default 'create',
  p_created_in_willo   text    default 'unknown',
  p_retry              boolean default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id      text := nullif(btrim(coalesce(p_willo_candidate_id, '')), '');
  v_created text := coalesce(nullif(btrim(coalesce(p_created_in_willo, '')), ''), 'unknown');
  v_held    boolean;
begin
  if v_created not in ('no', 'unknown', 'yes') then
    raise exception 'created_in_willo_must_be_no_unknown_or_yes' using errcode = '22023';
  end if;

  -- Held: Willo created them (or answered as though it had) and we cannot
  -- name the candidate, so there is nothing to re-link and a second create
  -- would be a second E1 to a real person. Holding a key we DO have would
  -- be wrong — that one is re-linkable.
  v_held := v_created = 'yes' and v_id is null;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (null, 'willo_invite_failed', 'staff', p_staff,
          jsonb_build_object('error', left(coalesce(p_error, ''), 300),
                             'phase', coalesce(nullif(btrim(coalesce(p_phase, '')), ''), 'create'),
                             'createdInWillo', v_created,
                             'retry', p_retry,
                             'ref', p_ref)
          || case when v_id is null then '{}'::jsonb
                  else jsonb_build_object('willoCandidateId', v_id) end);

  if v_held then
    insert into audit_log (actor, action, entity, entity_id, data)
    values (null, 'willo_invite_held', 'staff', p_staff,
            jsonb_build_object('error', left(coalesce(p_error, ''), 300), 'ref', p_ref));
  end if;

  return jsonb_build_object('staffId', p_staff::text, 'held', v_held, 'createdInWillo', v_created);
end $$;

comment on function public.willo_invite_failed(uuid, text, text, text, text, text, boolean) is
  '§2.4: records a failed invitation attempt. p_willo_candidate_id carries the key when we have one (the create succeeded and the link did not), so the next sweep re-links instead of creating. p_created_in_willo is no / unknown / yes: `yes` with no key HOLDS the candidate — willo_invite_due stops offering them this onboarding period rather than send a second E1 — and audits willo_invite_held. Service role only.';

-- ---------------------------------------------------------------------
-- 3 · The sweep: create, re-link, recover — or hold
--
-- Replaces 20260924110000's willo_invite_due. Same arguments, same lease
-- and the same backoff (5 min, doubling, capped at 6 h, per onboarding
-- period); three columns more, and it now refuses to offer a candidate we
-- know Willo has already invited.
-- ---------------------------------------------------------------------
drop function if exists public.willo_invite_due(integer, timestamptz);

create function public.willo_invite_due(
  p_limit integer     default 20,
  p_now   timestamptz default now()
) returns table (
  staff_id             uuid,
  first_name           text,
  last_name            text,
  email                text,
  phone                text,
  attempt              integer,
  invite_mode          text,
  invite_ref           text,
  created_candidate_id text
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
  v_created  text;
  v_claim_at timestamptz;
  v_claim_rf text;
  v_mode     text;
  v_ref      text;
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

    -- Held this period: Willo has them and we cannot name them. Only a
    -- Reset (a new period) offers them again.
    continue when exists (
      select 1 from audit_log a
       where a.entity = 'staff' and a.entity_id = r.id
         and a.action = 'willo_invite_held'
         and a.at >= r.onboarding_started_at);

    select count(*)::int, max(a.at) into v_attempts, v_last
      from audit_log a
     where a.entity_id = r.id
       and a.action = 'willo_invite_claim'
       and a.entity = 'staff'
       and a.at >= r.onboarding_started_at;

    continue when v_last is not null
              and v_last > p_now - least(interval '5 minutes' * power(2, greatest(v_attempts - 1, 0)),
                                         interval '6 hours');

    -- A key Willo has already returned for this person, this period, that
    -- nothing has since orphaned. Its presence is the whole fix: it makes
    -- the retry a re-link.
    select a.data ->> 'willoCandidateId' into v_created
      from audit_log a
     where a.entity = 'staff'
       and a.entity_id = r.id
       and a.action in ('willo_invite_created', 'willo_invite_failed')
       and a.at >= r.onboarding_started_at
       and coalesce(a.data ->> 'willoCandidateId', '') <> ''
       and not exists (
         select 1 from audit_log o
          where o.entity = 'staff'
            and o.entity_id = r.id
            and o.action = 'willo_invite_orphan'
            and o.data ->> 'willoCandidateId' = a.data ->> 'willoCandidateId'
            and o.at >= r.onboarding_started_at)
     order by a.at desc
     limit 1;

    if v_created is not null then
      v_mode := 'relink';
      v_claim_rf := null;
    else
      -- Did the last attempt leave the create in doubt? Either it said so
      -- (`unknown`), or it never reported at all — the isolate died
      -- between the POST and the record. Both are guesses, and both reuse
      -- that attempt's reference, so a second POST can be recognised as
      -- the same one by an API that honours it.
      select a.at, a.data ->> 'ref' into v_claim_at, v_claim_rf
        from audit_log a
       where a.entity = 'staff' and a.entity_id = r.id
         and a.action = 'willo_invite_claim'
         and a.at >= r.onboarding_started_at
       order by a.at desc
       limit 1;

      if v_claim_at is null then
        v_mode := 'create';
        v_claim_rf := null;
      elsif not exists (
              select 1 from audit_log a
               where a.entity = 'staff' and a.entity_id = r.id
                 and a.action in ('willo_invite_created', 'willo_invite_failed')
                 and a.at >= v_claim_at)
      then
        v_mode := 'recover';
      elsif exists (
              select 1 from audit_log a
               where a.entity = 'staff' and a.entity_id = r.id
                 and a.action = 'willo_invite_failed'
                 and a.at >= v_claim_at
                 and coalesce(a.data ->> 'createdInWillo', 'unknown') = 'unknown')
      then
        v_mode := 'recover';
      else
        v_mode := 'create';
        v_claim_rf := null;
      end if;
    end if;

    v_ref := coalesce(
      case when v_mode = 'recover' then v_claim_rf end,
      'thc-' || r.id::text
        || '-' || extract(epoch from r.onboarding_started_at)::bigint
        || '-' || (v_attempts + 1));

    insert into audit_log (at, actor, action, entity, entity_id, data)
    values (p_now, null, 'willo_invite_claim', 'staff', r.id,
            jsonb_build_object('attempt', v_attempts + 1, 'mode', v_mode, 'ref', v_ref));

    staff_id             := r.id;
    first_name           := r.first_name;
    last_name            := r.last_name;
    email                := r.email;
    phone                := r.phone;
    attempt              := v_attempts + 1;
    invite_mode          := v_mode;
    invite_ref           := v_ref;
    created_candidate_id := v_created;
    v_taken              := v_taken + 1;
    return next;
  end loop;
end $$;

comment on function public.willo_invite_due(integer, timestamptz) is
  '§2.4/§2.12: leases up to p_limit candidates in interview_requested with no Willo candidate yet (new applicants and resets), backing off 5 min doubling to 6 h per person per onboarding period. invite_mode says what the caller may do: `create` (nothing has reached Willo), `relink` — created_candidate_id is the key Willo already returned, so create NOTHING and call willo_invite_created with it — or `recover` (the last attempt left the create in doubt: create again, reusing invite_ref as the idempotency reference). A candidate held by willo_invite_failed(…, p_created_in_willo => ''yes'') is not offered at all. Each lease is an audit_log willo_invite_claim row. Service role only.';

-- willo_link_candidate stays for a link made by hand; the sweep no longer
-- uses it, because it cannot tell a candidate who moved on from a
-- deadlock.
comment on function public.willo_link_candidate(uuid, text, timestamptz) is
  '§2.4: record that the candidate was created in Willo and Willo sent E1. Raises not_awaiting_interview for anyone past the interview. The willo-invite sweep uses willo_invite_created instead (20260924170000), which records the key durably before linking and reports a terminal outcome rather than raising; this one remains for a link made by hand.';

-- ---------------------------------------------------------------------
-- 4 · Grants (docs/14 O7: by name). A dropped function takes its revokes
-- with it, so both re-created ones are locked down again here.
-- ---------------------------------------------------------------------
revoke execute on function public.willo_invite_due(integer, timestamptz)    from public, anon, authenticated;
revoke execute on function public.willo_invite_created(uuid, text, text)    from public, anon, authenticated;
revoke execute on function public.willo_invite_failed(uuid, text, text, text, text, text, boolean)
  from public, anon, authenticated;
grant  execute on function public.willo_invite_due(integer, timestamptz)    to service_role;
grant  execute on function public.willo_invite_created(uuid, text, text)    to service_role;
grant  execute on function public.willo_invite_failed(uuid, text, text, text, text, text, boolean)
  to service_role;
