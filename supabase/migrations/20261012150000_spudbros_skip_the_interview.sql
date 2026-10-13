-- =====================================================================
-- Migration 20261012150000 · SpudBros Express staff skip the Willo
--                            interview (ADR-0118; owner request,
--                            12.10.2026)
--
-- SpudBros Express staff already work for SpudBros, and THC never books
-- them (ADR-0106: onboarding only, shifts on Connecteam). The Willo
-- interview is THC's hiring screen, so it is not for them. Until now they
-- were sent it like anybody else: they applied (most through the ordinary
-- link, and the invite list marked them SpudBros, ADR-0107), Willo sent
-- E1, OC1 chased them, and their card sat in Interview requested.
--
-- Now a SpudBros Express candidate goes straight from the application to
-- Documents, with their login and E3 (activation + password + "download
-- the app"), exactly as if they had been accepted in Willo:
--
-- Every SpudBros Express person skips it, THC shifts switched on or not
-- (owner, 13.10.2026: "SpudBros don't need to do the interview").
--
--   1 · willo_invite_due() no longer leases a SpudBros candidate, so no
--       candidate is created in Willo for them and no E1 goes out. OC1
--       needs willo_invited_at, so it does not chase them either.
--
--   2 · spudbros_skip_due() leases every SpudBros candidate still in
--       interview_requested or interview_completed — new applicants, the
--       people already waiting when this was applied, and anyone the office
--       marks SpudBros (or resets to candidate) later — but never one whose
--       address is an office or client login, nor one refused for good
--       this period (spudbros_skip_blocked()). The every-minute
--       `willo-invite` sweep (and the nudge when someone applies) mints
--       their login with the office Accept's own code
--       (packages/db/src/provision.ts) and calls
--
--   3 · spudbros_skip_interview(staff, user, link, install): links the
--       login and walks interview_requested → interview_completed →
--       documents, stamping willo_decision 'accepted' with
--       willo_decided_via 'spudbros', and queues E3 under the same key the
--       Willo / office Accept uses, so the two can never both send it.
--       willo_completed_at is left as it was: nobody did an interview.
--       Audited as `spudbros_interview_skipped`.
--
-- Why a public link is enough. /apply/spudbros is public (ADR-0106), so
-- anyone could reach Documents this way. What they reach is an
-- onboarding-only profile: never in the pool, no booking possible (the
-- bookings trigger), and still every document, the quiz and the contract.
-- Switching THC shifts on for somebody is the office's decision on a person
-- it knows, and does not bring the interview back.
--
-- Not changed: a Willo decision that still arrives for one of the nine
-- people invited before this (willo_record_event) is applied as before.
-- pgTAP: supabase/tests/806_spudbros_skip_interview.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0 · 'spudbros' is a way a candidate can be accepted
-- ---------------------------------------------------------------------
alter table public.staff drop constraint if exists staff_willo_decided_via_check;
alter table public.staff add constraint staff_willo_decided_via_check
  check (willo_decided_via in ('willo', 'office', 'spudbros'));

-- ---------------------------------------------------------------------
-- 1 · willo_invite_due(): 20260926100000's body plus one predicate
-- ---------------------------------------------------------------------
create or replace function public.willo_invite_due(
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
       -- 20261012150000: SpudBros Express staff do not do the interview.
       and not s.spudbros_express
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
  '§2.4/§2.12: leases up to p_limit candidates in interview_requested with no Willo candidate yet (new applicants and resets), backing off 5 min doubling to 6 h per person per onboarding period. Each lease is an audit_log willo_invite_claim row. known_candidate_id = a key recorded this period by willo_invite_created and linked to nobody (link it, do not create); prior_candidate_ids = keys from earlier periods (never re-link). SpudBros Express staff are never leased (20261012150000: no interview). Service role only.';

-- ---------------------------------------------------------------------
-- 2 · Who is due to skip the interview
-- ---------------------------------------------------------------------
-- Leased like willo_invite_due(): a claim is an audit row, and while it is
-- younger than the backoff (5 min doubling, capped at 6 h) nobody else
-- claims that person, so the per-minute schedule and the nudge never mint
-- two logins for one person at once.
-- Who must never be swept, even though they are SpudBros and awaiting the
-- interview:
--   · an address that already belongs to an office or client login.
--     /apply/spudbros is public and nothing at apply time reads auth.users,
--     so anyone can apply with such an address. provisionStaffLogin() mints
--     a magic-link token on the existing login BEFORE it reads the role, so
--     a sweep that kept retrying would keep killing that person's pending
--     reset or invite link. The office decides these by hand.
--   · anyone refused for good this period (a login the database will not
--     link to them): retrying cannot change it. The office sees the failure
--     on the profile and uses Mark interview complete + Accept.
create or replace function public.spudbros_skip_blocked(p_staff uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
           select 1
             from staff s
             join auth.users u on lower(btrim(u.email)) = lower(btrim(s.email))
             left join profiles p on p.id = u.id
            where s.id = p_staff
              and (coalesce(u.raw_app_meta_data ->> 'role', 'staff') <> 'staff'
                   or coalesce(p.role::text, 'staff') <> 'staff'))
      or exists (
           select 1
             from staff s
             join audit_log a on a.entity_id = s.id and a.entity = 'staff'
            where s.id = p_staff
              and a.action = 'spudbros_skip_failed'
              and a.at >= s.onboarding_started_at
              and (a.data ->> 'error') ~ ('(account_not_staff|account_missing|account_email_mismatch'
                                          '|staff_linked_elsewhere|account_linked_elsewhere|unknown_account)'));
$$;

comment on function public.spudbros_skip_blocked(uuid) is
  '20261012150000 (ADR-0118): true for a SpudBros candidate the skip sweep must leave to the office — their address belongs to an office or client login (a mint would replace that login''s pending token), or a login was refused for good this period. Internal: read by spudbros_skip_due().';

create or replace function public.spudbros_skip_due(
  p_limit integer     default 20,
  p_now   timestamptz default now()
) returns table (
  staff_id uuid,
  email    text,
  user_id  uuid,
  attempt  integer
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
     where s.spudbros_express
       and s.status in ('interview_requested', 'interview_completed')
       and s.removed_at is null
       and not spudbros_skip_blocked(s.id)
     order by s.onboarding_started_at, s.id
     for update skip locked
  loop
    exit when v_taken >= greatest(coalesce(p_limit, 20), 1);

    select count(*)::int, max(a.at) into v_attempts, v_last
      from audit_log a
     where a.entity_id = r.id
       and a.action = 'spudbros_skip_claim'
       and a.entity = 'staff'
       and a.at >= r.onboarding_started_at;

    continue when v_last is not null
              and v_last > p_now - least(interval '5 minutes' * power(2, greatest(v_attempts - 1, 0)),
                                         interval '6 hours');

    insert into audit_log (at, actor, action, entity, entity_id, data)
    values (p_now, null, 'spudbros_skip_claim', 'staff', r.id,
            jsonb_build_object('attempt', v_attempts + 1));

    staff_id := r.id;
    email    := r.email;
    user_id  := r.user_id;
    attempt  := v_attempts + 1;
    v_taken  := v_taken + 1;
    return next;
  end loop;
end $$;

comment on function public.spudbros_skip_due(integer, timestamptz) is
  '20261012150000 (ADR-0118): leases up to p_limit SpudBros Express candidates still in interview_requested / interview_completed (never one spudbros_skip_blocked() names), backing off 5 min doubling to 6 h per person per onboarding period (audit_log spudbros_skip_claim). The willo-invite sweep mints each one''s login and calls spudbros_skip_interview(). Service role only.';

-- ---------------------------------------------------------------------
-- 3 · Skip the interview: login, Documents, E3 — one transaction
-- ---------------------------------------------------------------------
create or replace function public.spudbros_skip_interview(
  p_staff           uuid,
  p_user            uuid,
  p_activation_link text,
  p_install_link    text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s      staff;
  v_link text := btrim(coalesce(p_activation_link, ''));
  v_now  timestamptz := now();
begin
  if not activation_link_ok(v_link) then
    raise exception 'activation_link_not_personal' using errcode = '22023';
  end if;
  if coalesce(btrim(p_install_link), '') = '' then
    raise exception 'activation_link_required' using errcode = '22023';
  end if;
  if p_user is null then
    raise exception 'account_required' using errcode = '22023';
  end if;

  select * into s from staff where id = p_staff for update;
  if s.id is null or s.removed_at is not null then
    raise exception 'unknown_staff' using errcode = 'P0002';
  end if;

  if not s.spudbros_express
     or s.status not in ('interview_requested', 'interview_completed') then
    -- Moved on since the lease (accepted by the office, unmarked, …). The
    -- token minted for this call is now the live one if the login is
    -- theirs; keep any unsent E3 pointing at it.
    perform activation_link_refresh(s.id, p_user, v_link);
    return jsonb_build_object('staffId', s.id::text, 'outcome', 'unchanged',
                              'status', s.status::text);
  end if;

  perform link_staff_account(s.id, p_user);

  -- The machine has no shortcut (staff_transitions), so walk the edge.
  if s.status = 'interview_requested' then
    update staff set status = 'interview_completed' where id = s.id;
  end if;

  update staff
     set status = 'documents',
         willo_decision = 'accepted',
         willo_decided_at = v_now,
         willo_decided_via = 'spudbros'
   where id = s.id;

  -- E3 under onboarding_do_accept()'s key: whichever accept gets there
  -- first sends it, the other is a no-op.
  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values ('E3:staff:' || s.id || ':' || extract(epoch from s.onboarding_started_at)::bigint,
          'email', 'E3', array[s.email],
          jsonb_build_object('link', v_link,
                             'installLink', btrim(p_install_link),
                             'name', s.first_name))
  on conflict (key) do nothing;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (v_now, null, 'spudbros_interview_skipped', 'staff', s.id,
          jsonb_build_object('staffId', s.id::text, 'fromStatus', s.status::text,
                             'userId', p_user::text));

  return jsonb_build_object('staffId', s.id::text, 'outcome', 'documents',
                            'userId', p_user::text);
end $$;

comment on function public.spudbros_skip_interview(uuid, uuid, text, text) is
  '20261012150000 (ADR-0118): a SpudBros Express candidate skips the Willo interview — links the login, walks interview_requested → interview_completed → documents (willo_decided_via spudbros, willo_completed_at untouched), queues E3 under the Accept''s key, audits spudbros_interview_skipped. Anyone no longer SpudBros or no longer awaiting the interview is left alone (any unsent E3 is pointed at the new token). Service role only (the willo-invite sweep).';

create or replace function public.spudbros_skip_failed(p_staff uuid, p_error text)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  insert into audit_log (actor, action, entity, entity_id, data)
  values (null, 'spudbros_skip_failed', 'staff', p_staff,
          jsonb_build_object('error', left(coalesce(p_error, ''), 300)));
$$;

comment on function public.spudbros_skip_failed(uuid, text) is
  '20261012150000 (ADR-0118): records a SpudBros candidate whose login or move to Documents failed; spudbros_skip_due() retries after its backoff. Service role only.';

revoke execute on function public.spudbros_skip_blocked(uuid)                          from public, anon, authenticated;
revoke execute on function public.spudbros_skip_due(integer, timestamptz)              from public, anon, authenticated;
revoke execute on function public.spudbros_skip_interview(uuid, uuid, text, text)      from public, anon, authenticated;
revoke execute on function public.spudbros_skip_failed(uuid, text)                     from public, anon, authenticated;
grant  execute on function public.spudbros_skip_due(integer, timestamptz)              to service_role;
grant  execute on function public.spudbros_skip_interview(uuid, uuid, text, text)      to service_role;
grant  execute on function public.spudbros_skip_failed(uuid, text)                     to service_role;
