-- =====================================================================
-- Willo receiver + Resend activation link (§2.1, §2.4, §2.7, §2.8 E3,
-- §2.12, Appendix B B1; ADR-0021)
--
-- Two follow-ups to 20260923110000 (the Willo functions) and
-- 20260923180000 (the login and the personal link):
--
--   1. WILLO, BOTH DIRECTIONS
--      In:  the `willo-webhook` Edge Function verifies the delivery, asks
--           willo_event_plan() whether the event is an Accept that needs
--           a login, provisions it exactly as the office Accept does
--           (packages/db/src/provision.ts — the same code), and applies
--           the event through willo_accept_with_account() (link + E3 in
--           ONE transaction) or plain willo_record_event().
--           A refusal no retry can fix is recorded here
--           (willo_record_refusal) so Willo is answered 200 and the
--           office can see why the card did not move.
--      Out: §2.4 "the candidate submits the form → the system
--           automatically creates them in Willo", and §2.12 step 1 "a
--           fresh Willo interview is sent" on Reset. Both are the same
--           condition — status `interview_requested` with no Willo
--           candidate — so one sweep serves both: willo_invite_due()
--           leases due candidates, the Edge Function creates them in
--           Willo and records the key with willo_link_candidate(). A
--           trigger nudges the function the moment a candidate enters
--           that state; the `willo-invite` schedule is the safety net
--           (registered disabled — see the end of this file).
--
--   2. RESEND ACTIVATION LINK (docs/14 §2 item 4)
--      An expired E3 link used to mean an email to admin@. The office
--      now issues a fresh personal link and a NEW E3 under a new outbox
--      key, `E3:resend:<staff>:<n>`. Admin only, once per 10 minutes per
--      person, audited, and refused for anyone who has already activated
--      (set a password) — they use "Forgot password" like any worker.
--
--   3. `activated` on onboarding_candidates_v meant `user_id is not
--      null`. Since 20260923180000 Accept links the login BEFORE the
--      candidate activates, so every accepted candidate read "Activated
--      (E3)" whether or not they had ever opened the link — and the new
--      Resend button would never have shown. It now means what it says:
--      the login has a password (staff_account_activated()).
--
-- No new table: 001_rls_guard inventories every table, and nothing here
-- needs one. Leases, attempts and refusals are audit_log rows, which is
-- also where anybody would look for them.
-- =====================================================================

-- The lookups below ("the last resend for this person", "the invite
-- claims this period") are by entity and action.
create index if not exists audit_log_entity_action_idx
  on audit_log (entity_id, action, at desc);

-- ---------------------------------------------------------------------
-- 0 · Has this person activated their login?
--
-- A GoTrue invite creates the user with an empty password; /activate sets
-- it (apps/staff/app/activate/actions.ts). So "activated" = a linked login
-- that has a password. `auth.users` is not readable by `authenticated`,
-- hence a definer function; it answers the office, the service role and
-- the person themselves, and nobody else (null).
-- ---------------------------------------------------------------------
create or replace function public.staff_account_activated(p_staff uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case
    when current_app_role() = 'admin'
      or auth.role() = 'service_role'
      or exists (select 1 from staff s where s.id = p_staff and s.user_id = (select auth.uid()))
    then coalesce((select coalesce(u.encrypted_password, '') <> ''
                     from staff s join auth.users u on u.id = s.user_id
                    where s.id = p_staff), false)
  end
$$;

comment on function public.staff_account_activated(uuid) is
  '§2.7: true when the person''s login exists and has a password (they opened E3 and activated). Null for a caller who is not the office, the service role or the person.';

-- ---------------------------------------------------------------------
-- 1 · An unsent E3 follows the newest token
--
-- generateLink REPLACES the token on a login. A caller that mints one and
-- then does not queue an E3 with it (it lost a race to another delivery,
-- or a second manager's click) has killed the link in any E3 still
-- waiting in the outbox. This points those rows at the new link, so what
-- goes out works. Rows already sent cannot be helped; the Resend button
-- is for them. Internal: not granted to anybody.
-- ---------------------------------------------------------------------
create or replace function public.activation_link_refresh(p_staff uuid, p_user uuid, p_link text)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare n integer;
begin
  update notification_outbox o
     set payload = jsonb_set(o.payload, '{link}', to_jsonb(btrim(p_link)))
    from staff s
   where s.id = p_staff
     and s.user_id = p_user
     and o.template = 'E3'
     and o.key like 'E3:%:' || p_staff::text || ':%'
     and o.sent_at is null
     and o.failed_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 2 · Willo, inbound
-- ---------------------------------------------------------------------

-- What the receiver needs to know BEFORE it touches GoTrue. A login is
-- provisioned (and a token minted) only when this says the event is an
-- Accept that will actually move the candidate: a repeat of an Accept
-- already applied must not mint, or it would kill the link in the E3
-- the first delivery queued.
create or replace function public.willo_event_plan(p_willo_candidate_id text, p_event text)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
           'staffId', s.id::text,
           'email', s.email,
           'userId', s.user_id::text,
           'status', s.status::text,
           'target', t.target,
           'needsAccount', coalesce(t.target = 'documents'
                                    and s.status in ('interview_requested', 'interview_completed'), false))
    from staff s
    cross join lateral (select (select value ->> p_event from settings where key = 'willo_stage_map') as target) t
   where s.willo_candidate_id = p_willo_candidate_id
     and s.removed_at is null
$$;

comment on function public.willo_event_plan(text, text) is
  '§2.4: who a Willo event is for and whether it is an Accept that needs the candidate''s login provisioned first (target documents, candidate still awaiting the decision). Null for an unknown candidate. Read-only. Service role only.';

-- A Willo Accept with the candidate's login: the link and the event in
-- ONE transaction, exactly as onboarding_accept_with_account does for the
-- office, so E3 is never queued without a linked login and a login is
-- never linked for a candidate Willo did not accept.
create or replace function public.willo_accept_with_account(
  p_willo_candidate_id text,
  p_event              text,
  p_at                 timestamptz,
  p_details            jsonb,
  p_user               uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s        staff;
  v_target text;
  v_link   text := coalesce(p_details, '{}'::jsonb) ->> 'activationLink';
begin
  if coalesce(v_link, '') !~ '/activate/[A-Za-z0-9_-]{32,}' then
    raise exception 'activation_link_not_personal' using errcode = '22023';
  end if;
  if p_user is null then
    raise exception 'account_required' using errcode = '22023';
  end if;

  select * into s from staff
   where willo_candidate_id = p_willo_candidate_id and removed_at is null
   for update;
  if s.id is null then
    raise exception 'unknown_willo_candidate' using errcode = 'P0002';
  end if;

  v_target := (select value ->> p_event from settings where key = 'willo_stage_map');

  if v_target = 'documents' and s.status in ('interview_requested', 'interview_completed') then
    perform link_staff_account(s.id, p_user);
    return willo_record_event(p_willo_candidate_id, p_event, coalesce(p_at, now()), p_details)
           || jsonb_build_object('userId', p_user::text);
  end if;

  -- Another delivery got here first (or the map changed in between). The
  -- token minted for THIS call is now the live one; keep any unsent E3
  -- pointing at it.
  perform activation_link_refresh(s.id, p_user, v_link);
  return willo_record_event(p_willo_candidate_id, p_event, coalesce(p_at, now()), p_details);
end $$;

comment on function public.willo_accept_with_account(text, text, timestamptz, jsonb, uuid) is
  '§2.4 Willo Accept with the candidate''s login: link_staff_account, then willo_record_event (→ documents, E3 with the personal /activate/<token> link in p_details.activationLink) in one transaction. A repeat is a no-op that keeps any unsent E3 on the newest token. Service role only (the willo-webhook Edge Function).';

-- A refusal no retry can change (unknown candidate, somebody else's
-- login, a mapping to a target that does not exist). Recorded so the
-- office can see why a card did not move after a Willo decision.
create or replace function public.willo_record_refusal(
  p_willo_candidate_id text,
  p_event              text,
  p_code               text
) returns void
language sql
security definer
set search_path = public, extensions
as $$
  insert into audit_log (actor, action, entity, entity_id, data)
  values (null, 'willo_event_refused', 'staff',
          (select id from staff where willo_candidate_id = p_willo_candidate_id limit 1),
          jsonb_build_object('willoCandidateId', p_willo_candidate_id,
                             'event', p_event,
                             'code', left(coalesce(p_code, ''), 200)));
$$;

comment on function public.willo_record_refusal(text, text, text) is
  '§2.4: audits a Willo event the database refused for good (the receiver then answers 200 so Willo stops retrying). Service role only.';

-- ---------------------------------------------------------------------
-- 3 · Willo, outbound — "create candidate in Willo" (§2.4, §2.12)
-- ---------------------------------------------------------------------

-- Lease the candidates who are due an invitation. A claim is an audit
-- row; while it is younger than the backoff (5 min, doubling, capped at
-- 6 h) nobody else claims that person, so the per-minute schedule and the
-- nudge below never create the same candidate in Willo twice. Only
-- claims in the current onboarding period count: a Reset starts again.
create or replace function public.willo_invite_due(
  p_limit integer     default 20,
  p_now   timestamptz default now()
) returns table (
  staff_id   uuid,
  first_name text,
  last_name  text,
  email      text,
  phone      text,
  attempt    integer
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
    v_taken    := v_taken + 1;
    return next;
  end loop;
end $$;

comment on function public.willo_invite_due(integer, timestamptz) is
  '§2.4/§2.12: leases up to p_limit candidates in interview_requested with no Willo candidate yet (new applicants and resets), backing off 5 min doubling to 6 h per person per onboarding period. Each lease is an audit_log willo_invite_claim row. Service role only.';

create or replace function public.willo_invite_failed(p_staff uuid, p_error text)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  insert into audit_log (actor, action, entity, entity_id, data)
  values (null, 'willo_invite_failed', 'staff', p_staff,
          jsonb_build_object('error', left(coalesce(p_error, ''), 300)));
$$;

comment on function public.willo_invite_failed(uuid, text) is
  '§2.4: records a failed "create candidate in Willo" call; willo_invite_due retries after its backoff. Service role only.';

-- The nudge: the moment a candidate is due, ask the Edge Function to run
-- the sweep, so E1 goes out on submit rather than on the next schedule.
-- pg_net queues the request with this transaction, so a rolled-back
-- application nudges nothing. Nothing configured (local, CI) → nothing
-- sent. It can never fail the write that fired it.
create or replace function public.willo_invite_nudge()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_base text;
  v_key  text;
begin
  if new.willo_candidate_id is not null or new.removed_at is not null then
    return null;
  end if;
  begin
    select value #>> '{}' into v_base from public.settings where key = 'edge_base_url';
    if coalesce(v_base, '') = '' then
      return null;
    end if;
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
    if coalesce(v_key, '') = '' then
      return null;
    end if;
    perform net.http_post(
      url     := v_base || '/willo-webhook/invite',
      body    := jsonb_build_object('job', 'willo-invite', 'staffId', new.id::text),
      params  := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'Authorization', 'Bearer ' || v_key));
  exception when others then
    raise warning 'willo_invite_nudge: %', sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists staff_willo_invite_nudge_ins on staff;
create trigger staff_willo_invite_nudge_ins
  after insert on staff
  for each row when (new.status = 'interview_requested')
  execute function public.willo_invite_nudge();

drop trigger if exists staff_willo_invite_nudge_upd on staff;
create trigger staff_willo_invite_nudge_upd
  after update of status on staff
  for each row when (new.status = 'interview_requested' and old.status is distinct from new.status)
  execute function public.willo_invite_nudge();

-- The safety net: a failed or missed nudge is picked up within a minute.
-- Registered DISABLED, like every schedule whose sends cannot go out yet:
-- it needs WILLO_API_KEY and WILLO_INTERVIEW_KEY (Appendix B, B1) and
-- 190 lists the enabled schedules. Enable it, then run
-- install_job_schedules(), once THC's keys are set.
insert into job_schedules (job, cron_expression, edge_path, enabled, note) values
  ('willo-invite', '* * * * *', 'willo-webhook/invite', false,
   '§2.4/§2.12 create candidates in Willo (E1 is Willo''s). Retries missed nudges. Enable once WILLO_API_KEY + WILLO_INTERVIEW_KEY are set (ADR-0021).')
on conflict (job) do nothing;

-- ---------------------------------------------------------------------
-- 4 · Resend activation link (office)
-- ---------------------------------------------------------------------

-- Why a resend is refused, or null. Internal; both office functions use
-- it so the pre-check and the write cannot disagree.
create or replace function public.activation_resend_refusal(p_staff uuid, p_now timestamptz default now())
returns text
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  s      staff;
  v_last timestamptz;
begin
  select * into s from staff where id = p_staff;
  if s.id is null or s.removed_at is not null or s.status = 'removed' then
    return 'unknown_staff';
  end if;
  -- Accept sends the first E3; before it there is no link to resend.
  if s.status in ('interview_requested', 'interview_completed') then
    return 'not_accepted';
  end if;
  -- A rejected or departed person is not given a way in.
  if s.status in ('rejected', 'inactive') then
    return 'not_resendable';
  end if;
  if exists (select 1 from auth.users u
              where u.id = s.user_id and coalesce(u.encrypted_password, '') <> '') then
    return 'already_activated';
  end if;
  select max(a.at) into v_last
    from audit_log a
   where a.entity_id = p_staff and a.action = 'onboarding_resend_activation' and a.entity = 'staff';
  if v_last is not null and v_last > p_now - interval '10 minutes' then
    return 'resend_too_soon: '
           || to_char((v_last + interval '10 minutes') at time zone 'Europe/London', 'HH24:MI');
  end if;
  return null;
end $$;

-- The office asks this BEFORE minting a token, so a refused resend never
-- kills the link already in the candidate's inbox.
create or replace function public.onboarding_resend_activation_check(p_staff uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_refusal text;
  s         staff;
begin
  perform assert_office_caller();
  v_refusal := activation_resend_refusal(p_staff, now());
  if v_refusal is not null then
    raise exception '%', v_refusal using errcode = 'P0001';
  end if;
  select * into s from staff where id = p_staff;
  return jsonb_build_object('staffId', s.id::text, 'email', s.email, 'userId', s.user_id::text);
end $$;

comment on function public.onboarding_resend_activation_check(uuid) is
  '§2.7 Resend activation link, step 1: whether a resend is allowed now (accepted, not rejected/inactive/removed, not yet activated, none in the last 10 minutes) and the email + login to mint it for. Office only; raises the refusal code.';

create or replace function public.onboarding_resend_activation(
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
  s         staff;
  v_refusal text;
  v_n       integer;
  v_key     text;
  v_raced   boolean := false;
begin
  perform assert_office_caller();

  if coalesce(p_activation_link, '') !~ '/activate/[A-Za-z0-9_-]{32,}' then
    raise exception 'activation_link_not_personal' using errcode = '22023';
  end if;
  if coalesce(btrim(p_install_link), '') = '' then
    raise exception 'activation_link_required' using errcode = '22023';
  end if;

  select * into s from staff where id = p_staff for update;
  v_refusal := activation_resend_refusal(p_staff, now());

  if v_refusal like 'resend_too_soon%' then
    -- Only reachable in a race: the pre-check passed, a second click got
    -- its resend in first, and THIS call's token has since replaced that
    -- one's. If that E3 is still unsent, point it here and stop. If it has
    -- gone, its link is already dead because of us — send this one.
    if activation_link_refresh(p_staff, p_user, p_activation_link) > 0 then
      return jsonb_build_object('staffId', p_staff::text, 'queued', false, 'refreshed', true);
    end if;
    v_raced := true;
  elsif v_refusal is not null then
    raise exception '%', v_refusal using errcode = 'P0001';
  end if;

  perform link_staff_account(p_staff, p_user);

  -- An older E3 still waiting (the drain is down, say) would go out with a
  -- token this resend has replaced.
  perform activation_link_refresh(p_staff, p_user, p_activation_link);

  select count(*)::int + 1 into v_n
    from audit_log a
   where a.entity_id = p_staff and a.action = 'onboarding_resend_activation' and a.entity = 'staff';
  v_key := 'E3:resend:' || p_staff::text || ':' || v_n;

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values (v_key, 'email', 'E3', array[s.email],
          jsonb_build_object('link', btrim(p_activation_link),
                             'installLink', btrim(p_install_link),
                             'name', s.first_name));

  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'onboarding_resend_activation', 'staff', p_staff,
          jsonb_build_object('n', v_n, 'outboxKey', v_key, 'userId', p_user::text, 'raced', v_raced));

  return jsonb_build_object('staffId', p_staff::text, 'queued', true, 'n', v_n, 'outboxKey', v_key);
end $$;

comment on function public.onboarding_resend_activation(uuid, uuid, text, text) is
  '§2.7 Resend activation link, step 2: links the login if needed and queues a NEW E3 (key E3:resend:<staff>:<n>) with the fresh personal link; audited. Refuses a person not yet accepted, rejected, inactive, removed or already activated, and more than once per 10 minutes. Office only.';

-- ---------------------------------------------------------------------
-- 5 · onboarding_candidates_v.activated reads the login (see header, 3)
-- ---------------------------------------------------------------------
create or replace view onboarding_candidates_v with (security_invoker = true) as
select
  s.id,
  s.first_name,
  s.last_name,
  s.first_name || ' ' || s.last_name                           as display_name,
  s.email,
  s.phone,
  s.dob,
  case when s.dob is not null
       then extract(year from age((now() at time zone 'Europe/London')::date, s.dob))::int end as age,
  s.applied_age_band,
  s.photo_path,
  s.status,
  s.stage_entered_at,
  s.onboarding_started_at,
  s.created_at                                                 as applied_at,
  s.gdpr_consent_at,
  s.employee_id,
  s.rtw_branch,
  s.right_to_work_until,
  s.share_code,
  coalesce(staff_account_activated(s.id), false)               as activated,
  coalesce((select array_agg(r.name order by r.name)
              from staff_roles sr join roles r on r.id = sr.role_id
             where sr.staff_id = s.id), '{}'::text[])           as role_names,
  coalesce((select array_agg(sr.role_id)
              from staff_roles sr where sr.staff_id = s.id), '{}'::uuid[]) as role_ids,
  -- Willo (§2.4)
  s.willo_candidate_id is not null                             as willo_linked,
  case when s.willo_candidate_id is not null
        and jsonb_typeof((select value from settings where key = 'willo_review_url_template')) = 'string'
       then replace((select value #>> '{}' from settings where key = 'willo_review_url_template'),
                    '{id}', s.willo_candidate_id) end         as willo_review_url,
  s.willo_invited_at,
  s.willo_answers_done,
  s.willo_answers_total,
  s.willo_completed_at,
  s.willo_decision,
  s.willo_decided_at,
  s.willo_decided_via,
  -- Documents (§2.3): current rows only; superseded ones are the previous
  -- period's record and never count (§2.12).
  (select count(*) from current_compliance_docs(s.id))::int                        as docs_total,
  (select count(*) from current_compliance_docs(s.id) d where d.status = 'verified')::int as docs_verified,
  (select count(*) from current_compliance_docs(s.id) d where d.status = 'pending')::int  as docs_pending,
  (select count(*) from current_compliance_docs(s.id) d where d.status = 'rejected')::int as docs_rejected,
  (select max(c.reviewed_at) from compliance_docs c
    where c.staff_id = s.id and c.review_status = 'rejected')                      as last_doc_rejected_at,
  onboarding_documents_missing(s.id)                                               as docs_missing,
  onboarding_quiz_blockers(s.id)                                                   as quiz_blockers,
  (select c.answer from criminal_declarations c
    where c.staff_id = s.id and not c.superseded
    order by c.declared_at desc limit 1)                                           as declaration_answer,
  (select c.review_status from criminal_declarations c
    where c.staff_id = s.id and not c.superseded
    order by c.declared_at desc limit 1)                                           as declaration_status,
  -- Quiz (§2.9), this period only
  (select count(*) from quiz_attempts q
    where q.staff_id = s.id and q.taken_at >= s.onboarding_started_at)::int        as quiz_attempts_used,
  (select max(q.score) from quiz_attempts q
    where q.staff_id = s.id and q.taken_at >= s.onboarding_started_at)             as quiz_best_score,
  (select min(q.taken_at) from quiz_attempts q
    where q.staff_id = s.id and q.passed and q.taken_at >= s.onboarding_started_at) as quiz_passed_at,
  -- Additional info (§2.10), wizard steps 7-9
  (select h.submitted_at from hmrc_checklists h
    where h.staff_id = s.id and not h.superseded)                                  as hmrc_submitted_at,
  (select count(*) from staff_references r where r.staff_id = s.id)::int           as references_count,
  exists (select 1 from bank_details b where b.staff_id = s.id)                     as bank_saved,
  s.ni_number is not null                                                          as ni_entered,
  -- Contract (§2.11)
  s.contract_signed_at,
  s.contract_version,
  -- Rejection
  s.rejected_at,
  s.rejected_from,
  s.rejection_cause,
  s.rejection_reason,
  p.full_name                                                                      as rejected_by_name
from staff s
left join profiles p on p.id = s.rejected_by
where s.removed_at is null;

comment on view onboarding_candidates_v is
  'One row per non-removed person for /onboarding and /onboarding/:id (§2.2, §2.3): stage and days in it, Willo tracking, current-period document / declaration / quiz / additional-info progress, and the rejection record. `activated` = the login has a password (staff_account_activated, 20260924110000), not merely that one is linked. security_invoker: staff is admin_all only, so a client sees nobody and a worker only themselves.';

-- ---------------------------------------------------------------------
-- 6 · Grants (docs/14 O7: by name)
-- ---------------------------------------------------------------------
revoke execute on function public.staff_account_activated(uuid) from public, anon;
grant  execute on function public.staff_account_activated(uuid) to authenticated, service_role;

revoke execute on function public.activation_link_refresh(uuid, uuid, text)          from public, anon, authenticated;
revoke execute on function public.activation_resend_refusal(uuid, timestamptz)       from public, anon, authenticated;
revoke execute on function public.willo_invite_nudge()                               from public, anon, authenticated;

revoke execute on function public.willo_event_plan(text, text)                                    from public, anon, authenticated;
revoke execute on function public.willo_accept_with_account(text, text, timestamptz, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.willo_record_refusal(text, text, text)                          from public, anon, authenticated;
revoke execute on function public.willo_invite_due(integer, timestamptz)                          from public, anon, authenticated;
revoke execute on function public.willo_invite_failed(uuid, text)                                 from public, anon, authenticated;
grant  execute on function public.willo_event_plan(text, text)                                    to service_role;
grant  execute on function public.willo_accept_with_account(text, text, timestamptz, jsonb, uuid) to service_role;
grant  execute on function public.willo_record_refusal(text, text, text)                          to service_role;
grant  execute on function public.willo_invite_due(integer, timestamptz)                          to service_role;
grant  execute on function public.willo_invite_failed(uuid, text)                                 to service_role;

-- The office's two: signed-in, and each refuses a non-admin itself.
revoke execute on function public.onboarding_resend_activation_check(uuid)             from public, anon;
revoke execute on function public.onboarding_resend_activation(uuid, uuid, text, text) from public, anon;
grant  execute on function public.onboarding_resend_activation_check(uuid)             to authenticated;
grant  execute on function public.onboarding_resend_activation(uuid, uuid, text, text) to authenticated;
