-- =====================================================================
-- Migration 20260923110000 · the onboarding pipeline, office side
--                            (§2.2, §2.3, §2.4, §2.12, §8 E2/E3/N8)
--
-- /apply has been creating candidates in `interview_requested` since it
-- shipped, and nothing moved them. This is the office's half of moving
-- them: the kanban's reads, the candidate profile's reads, and the
-- review/transition write paths the manager presses. The worker's half —
-- the eleven wizard steps and their submissions — is the Staff App's and
-- is not here.
--
-- What this adds
-- --------------
--   1. The §2.12 machine is enforced on the ROW for every onboarding
--      move (staff_status_guard). Until now it was enforced only inside
--      the functions that happened to call assert_staff_transition(), and
--      `admin_all` on `staff` let any signed-in manager write
--      `status = 'compliant'` on a candidate who had never seen the quiz.
--      "A candidate can never skip the quiz or the contract" is now true
--      of psql, PostgREST and every future RPC alike.
--   2. Evidence gates on the three forward moves that have evidence:
--        documents → quiz      every required document uploaded and
--                              verified, and the declaration settled
--                              (§2.3, RULE-10)
--        quiz → contract       a passed attempt in THIS onboarding period
--                              (§2.9, RULE-09)
--        contract → compliant  the contract signature timestamp is set
--                              (§2.11); the Employee ID is issued here if
--                              the person has none, and kept if they do
--                              (§2.7, §2.12 step 2)
--   3. The move to the quiz is automatic (§2.3): a trigger on the two
--      evidence tables advances the candidate the moment the last item is
--      verified, whichever path verified it.
--   4. Office RPCs: accept (with the qualified roles, E3), reject (E2),
--      verify / reject a document (N8), verify / reject a Yes declaration,
--      and resolve a returning-applicant entry (Reset to candidate or
--      reject the application, §2.12).
--   5. Willo, as far as it can go without THC's keys (§2.4, Appendix B):
--      the stage map in `settings` decides what a Willo event does, and a
--      service-role function applies it. The HTTP receiver (the
--      willo-webhook Edge Function) and the call that creates the
--      candidate in Willo are NOT here — both need the Willo API key.
--   6. Two read views for the screens.
--
-- "Additional info" is a column, not a status (ADR-0013)
-- -------------------------------------------------------
-- §2.2 and the approved board have six columns; §2.12's machine has five
-- onboarding states and goes quiz → contract. The `additional_info` enum
-- value 0001_init reserved has no edge in staff_transitions and none in
-- packages/domain/src/state.ts, so it is not used. A candidate who has
-- passed the quiz is in `contract`; the board shows them under
-- "Additional info" until the HMRC checklist, two references and bank
-- details are all in (wizard steps 7-9), and under "Contract" after that.
-- The guard below rejects any move into or out of `additional_info`, so
-- the choice cannot drift silently.
--
-- Scope of the row guard, and why it is not the whole machine
-- -----------------------------------------------------------
-- It fires when either side of the move is an onboarding status. The
-- lifecycle half of §2.12 (compliant ⇄ blocked → inactive → removed) is
-- already asserted inside block_worker(), unblock_if_compliant() and
-- reset_to_candidate(), and 130_auto_assign.sql borrows a worker through
-- removed → compliant as a fixture step; extending the row guard to that
-- half is a separate change with its own test edits. Recorded, not done.
--
-- Forward-only: no earlier migration is edited.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · Columns
-- ---------------------------------------------------------------------
alter table staff
  -- "days in the current stage" on every card (§2.2 board)
  add column if not exists stage_entered_at      timestamptz,
  -- the start of this onboarding period: creation, or the last Reset to
  -- candidate. Quiz attempts and interviews from a previous period never
  -- satisfy the current one (§2.12 step 3).
  add column if not exists onboarding_started_at timestamptz,
  -- rejection: "they sit in the column where they were rejected" (board)
  add column if not exists rejected_at           timestamptz,
  add column if not exists rejected_from         staff_status,
  add column if not exists rejection_cause       text
    check (rejection_cause in ('willo', 'manager', 'quiz_failed')),
  add column if not exists rejection_reason      text,
  add column if not exists rejected_by           uuid references profiles(id),
  -- Willo interview tracking (§2.4). No review URL is stored: it is built
  -- from willo_candidate_id and settings.willo_review_url_template, so
  -- §1.7's removal — which nulls willo_candidate_id — kills the link too.
  add column if not exists willo_invited_at      timestamptz,
  add column if not exists willo_answers_done    int check (willo_answers_done >= 0),
  add column if not exists willo_answers_total   int check (willo_answers_total >= 0),
  add column if not exists willo_completed_at    timestamptz,
  add column if not exists willo_decision        text check (willo_decision in ('accepted', 'rejected')),
  add column if not exists willo_decided_at      timestamptz,
  add column if not exists willo_decided_via     text check (willo_decided_via in ('willo', 'office'));

update staff
   set stage_entered_at = coalesce(stage_entered_at, created_at),
       onboarding_started_at = coalesce(onboarding_started_at, created_at);

alter table staff alter column stage_entered_at set default now();
alter table staff alter column stage_entered_at set not null;
alter table staff alter column onboarding_started_at set default now();
alter table staff alter column onboarding_started_at set not null;

create index if not exists staff_rejected_by_idx on staff (rejected_by);
create unique index if not exists staff_willo_candidate_idx
  on staff (willo_candidate_id) where willo_candidate_id is not null;

comment on column staff.stage_entered_at is
  'When the worker entered their current status. Stamped by staff_status_guard on every status change; the kanban''s "N d" reads it (§2.2).';
comment on column staff.onboarding_started_at is
  'Start of the current onboarding period: creation or the last Reset to candidate (§2.12). Evidence older than this never satisfies a gate.';
comment on column staff.rejected_from is
  'The onboarding status the candidate was rejected from. The Rejected view of the kanban places the card in that column.';

-- The returning-applicant entry is acted on once (§2.12).
alter table applications
  add column if not exists resolved_at  timestamptz,
  add column if not exists resolved_by  uuid references profiles(id),
  add column if not exists resolution   text check (resolution in ('reset', 'rejected')),
  add column if not exists resolution_reason text;
create index if not exists applications_resolved_by_idx on applications (resolved_by);

comment on column applications.resolution is
  'What the office did with a returning-applicant entry (§2.12): reset = Reset to candidate on the matched record, rejected = the application was declined. Null = still waiting on the onboarding screen.';

-- Willo review link, data-driven (§2.4: "the stage mapping is editable in
-- Django Admin so a change to the Willo pipeline does not need a
-- release"). JSON null until THC supplies the Willo account; a string with
-- `{id}` in it once they do.
insert into settings (key, value) values ('willo_review_url_template', 'null'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2 · What is still missing before the quiz can unlock
--
-- §2.5 points 1-5, per branch, exactly — nothing further is collected.
-- A document counts as present when a current (non-superseded) row of
-- that type exists in any status; whether it is VERIFIED is
-- compliance_blockers()'s question, asked separately in the gate. The
-- NI evidence of point 7 is required where the branch requires it (a UK
-- or Irish citizen without a passport) and verified like any other upload
-- where it is supplied.
--
-- Returns tokens, not prose: the screen owns the words.
-- ---------------------------------------------------------------------
create or replace function public.onboarding_documents_missing(p_staff uuid)
returns text[]
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  s staff;
  have doc_type[];
  missing text[] := '{}';
begin
  select * into s from staff where id = p_staff;
  if s.id is null then
    return null;
  end if;

  select coalesce(array_agg(d.doc_type), '{}') into have
    from current_compliance_docs(p_staff) d;

  if s.dob is null then
    missing := missing || 'dob'::text;             -- §2.5: mandatory in every branch
  end if;

  if s.rtw_branch is null then
    missing := missing || 'rtw_branch'::text;
  else
    case s.rtw_branch
      when 'uk_irish' then
        -- passport OR birth certificate + a document showing the NI number
        if not ('passport' = any(have)) then
          if 'birth_certificate' = any(have) then
            if not ('ni_evidence' = any(have)) then
              missing := missing || 'ni_evidence'::text;
            end if;
          else
            missing := missing || 'passport'::text;
          end if;
        end if;
      when 'eu_settled' then
        if not ('passport' = any(have) or 'national_id' = any(have)) then
          missing := missing || 'passport'::text;
        end if;
      when 'work_visa' then
        if not ('passport' = any(have)) then missing := missing || 'passport'::text; end if;
        if not ('visa_document' = any(have)) then missing := missing || 'visa_document'::text; end if;
      when 'international_student' then
        if not ('passport' = any(have)) then missing := missing || 'passport'::text; end if;
        if not ('university_term_dates_letter' = any(have)) then
          missing := missing || 'university_term_dates_letter'::text;
        end if;
      when 'dependant_other' then
        if not ('passport' = any(have)) then missing := missing || 'passport'::text; end if;
        if not ('status_document' = any(have)) then missing := missing || 'status_document'::text; end if;
    end case;

    -- The share code is typed, never uploaded (§2.5), and every branch
    -- but the first carries one.
    if s.rtw_branch <> 'uk_irish' and s.share_code is null then
      missing := missing || 'share_code'::text;
    end if;
  end if;

  -- The declaration sits on the same step (4/11) and is part of the same
  -- single blocker (§2.10).
  if not exists (select 1 from criminal_declarations c
                  where c.staff_id = p_staff and not c.superseded) then
    missing := missing || 'criminal_declaration'::text;
  end if;

  return missing;
end $$;

comment on function public.onboarding_documents_missing(uuid) is
  '§2.5 points 1-5: which of the branch''s required items have not been supplied at all (tokens: dob, rtw_branch, passport, ni_evidence, visa_document, status_document, university_term_dates_letter, share_code, criminal_declaration). Empty = everything is in; whether it is verified is compliance_blockers().';

-- Everything that keeps the quiz locked, uploaded or not (§2.3, RULE-10).
create or replace function public.onboarding_quiz_blockers(p_staff uuid)
returns text[]
language sql
stable
set search_path = public, extensions
as $$
  select coalesce(onboarding_documents_missing(p_staff), '{}')
         || coalesce((select array_agg(b.reason order by b.reason)
                        from compliance_blockers(p_staff, (now() at time zone 'Europe/London')::date) b),
                     '{}')
$$;

comment on function public.onboarding_quiz_blockers(uuid) is
  'The §2.3 quiz gate as reasons: missing items, then anything unverified or expired. Empty = the quiz unlocks.';

-- ---------------------------------------------------------------------
-- 3 · The row guard (§2.12 on the row)
-- ---------------------------------------------------------------------
create or replace function public.staff_status_guard()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_onboarding constant staff_status[] := array[
    'interview_requested', 'interview_completed', 'documents', 'quiz',
    'additional_info', 'contract']::staff_status[];
  v_blockers text[];
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if old.status = any(v_onboarding) or new.status = any(v_onboarding) then
    perform assert_staff_transition(old.status, new.status);

    if old.status = 'documents' and new.status = 'quiz' then
      v_blockers := onboarding_quiz_blockers(new.id);
      if cardinality(v_blockers) > 0 then
        raise exception 'quiz_locked: %', array_to_string(v_blockers, ', ')
          using errcode = 'P0001';
      end if;

    elsif old.status = 'quiz' and new.status = 'contract' then
      if not exists (select 1 from quiz_attempts q
                      where q.staff_id = new.id
                        and q.passed
                        and q.taken_at >= old.onboarding_started_at) then
        raise exception 'quiz_not_passed' using errcode = 'P0001';
      end if;

    elsif old.status = 'contract' and new.status = 'compliant' then
      if new.contract_signed_at is null then
        raise exception 'contract_not_signed' using errcode = 'P0001';
      end if;
      -- §2.7: generated at this exact moment. §2.12 step 2: one person
      -- keeps one Employee ID across every period, so an existing one is
      -- never replaced.
      new.employee_id := coalesce(new.employee_id, nextval('employee_id_seq'));
    end if;
  end if;

  new.stage_entered_at := now();

  if new.status = 'interview_requested' then
    -- A new onboarding period (§2.12, Reset to candidate): the previous
    -- rejection and interview belong to the previous period. They stay in
    -- audit_log; a fresh Willo interview is due.
    new.onboarding_started_at := now();
    new.rejected_at := null;
    new.rejected_from := null;
    new.rejection_cause := null;
    new.rejection_reason := null;
    new.rejected_by := null;
    new.willo_candidate_id := null;
    new.willo_invited_at := null;
    new.willo_answers_done := null;
    new.willo_answers_total := null;
    new.willo_completed_at := null;
    new.willo_decision := null;
    new.willo_decided_at := null;
    new.willo_decided_via := null;
  elsif new.status = 'rejected' then
    new.rejected_at := now();
    new.rejected_from := old.status;
    -- §2.9's rejection comes from the wizard, which has no reason to name
    -- itself; a rejection out of the quiz stage with no cause is that one.
    new.rejection_cause := coalesce(new.rejection_cause,
                                    case when old.status = 'quiz' then 'quiz_failed' end);
  end if;

  return new;
end $$;

comment on function public.staff_status_guard() is
  '§2.12 on the row. Any status change touching an onboarding status must be an edge of staff_transitions, and documents→quiz, quiz→contract and contract→compliant must carry their evidence. Stamps stage_entered_at, the rejection column, and a new onboarding period on entry to interview_requested; issues the Employee ID at contract→compliant if the person has none.';

drop trigger if exists staff_status_guard on staff;
create trigger staff_status_guard
  before update of status on staff
  for each row execute function staff_status_guard();

-- ---------------------------------------------------------------------
-- 4 · The quiz unlocks by itself (§2.3)
-- ---------------------------------------------------------------------
create or replace function public.onboarding_advance_if_ready(p_staff uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v staff_status;
begin
  select status into v from staff where id = p_staff for update;
  if v is distinct from 'documents' then
    return false;
  end if;
  if cardinality(onboarding_quiz_blockers(p_staff)) > 0 then
    return false;
  end if;
  update staff set status = 'quiz' where id = p_staff;
  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'quiz_unlocked', 'staff', p_staff, '{}'::jsonb);
  return true;
end $$;

comment on function public.onboarding_advance_if_ready(uuid) is
  '§2.3: "as soon as ALL documents — including the Criminal Record declaration — are verified, the candidate advances to the Quiz stage by themselves". Safe to call at any time: it does nothing unless the candidate is in documents with nothing outstanding.';

create or replace function public.onboarding_evidence_changed()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.review_status = 'verified'
     and (tg_op = 'INSERT' or old.review_status is distinct from 'verified') then
    perform onboarding_advance_if_ready(new.staff_id);
  end if;
  return new;
end $$;

drop trigger if exists onboarding_docs_advance on compliance_docs;
create trigger onboarding_docs_advance
  after update of review_status on compliance_docs
  for each row execute function onboarding_evidence_changed();

drop trigger if exists onboarding_declaration_advance on criminal_declarations;
create trigger onboarding_declaration_advance
  after insert or update of review_status on criminal_declarations
  for each row execute function onboarding_evidence_changed();

-- §2.3 / §2.10: "A No Criminal Record answer is auto-verified on
-- submission". Held on the row so the wizard's submission cannot leave a
-- No waiting in a queue it must never enter.
create or replace function public.criminal_declaration_no_is_verified()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if not new.answer and new.review_status = 'pending' then
    new.review_status := 'verified';
    new.reviewed_at := coalesce(new.reviewed_at, new.declared_at);
  end if;
  return new;
end $$;

drop trigger if exists criminal_declaration_no_is_verified on criminal_declarations;
create trigger criminal_declaration_no_is_verified
  before insert on criminal_declarations
  for each row execute function criminal_declaration_no_is_verified();

-- ---------------------------------------------------------------------
-- 5 · Internal: the two decisions every route shares
--
-- Accept and reject are each reachable from the office screen AND from a
-- Willo event, and §2.7 is explicit that E2 is "the same for every
-- rejection route". One body each, so the two routes cannot diverge.
-- Not granted to anybody: only the definer functions below call them.
-- ---------------------------------------------------------------------
create or replace function public.onboarding_do_accept(
  p_staff           uuid,
  p_via             text,
  p_at              timestamptz,
  p_activation_link text,
  p_install_link    text
) returns void
language plpgsql
set search_path = public, extensions
as $$
declare s staff;
begin
  select * into s from staff where id = p_staff for update;
  if coalesce(btrim(p_activation_link), '') = '' or coalesce(btrim(p_install_link), '') = '' then
    -- E3 is "the only mandatory system email" (§8) and its body carries
    -- both links; a send without them would reach the candidate as a
    -- literal "{link}".
    raise exception 'activation_link_required' using errcode = '22023';
  end if;

  update staff
     set status = 'documents',
         willo_completed_at = coalesce(willo_completed_at, p_at),
         willo_decision = 'accepted',
         willo_decided_at = p_at,
         willo_decided_via = p_via
   where id = p_staff;

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values ('E3:staff:' || p_staff || ':' || extract(epoch from s.onboarding_started_at)::bigint,
          'email', 'E3', array[s.email],
          jsonb_build_object('link', btrim(p_activation_link),
                             'installLink', btrim(p_install_link),
                             'name', s.first_name))
  on conflict (key) do nothing;
end $$;

create or replace function public.onboarding_do_reject(
  p_staff  uuid,
  p_cause  text,
  p_reason text,
  p_by     uuid,
  p_at     timestamptz
) returns void
language plpgsql
set search_path = public, extensions
as $$
declare s staff;
begin
  select * into s from staff where id = p_staff for update;

  update staff
     set status = 'rejected',
         rejection_cause = p_cause,
         rejection_reason = p_reason,
         rejected_by = p_by,
         willo_decision = case when p_cause = 'willo' then 'rejected' else willo_decision end,
         willo_decided_at = case when p_cause = 'willo' then p_at else willo_decided_at end,
         willo_decided_via = case when p_cause = 'willo' then 'willo' else willo_decided_via end
   where id = p_staff;

  -- E2, THC's wording, the same whichever route rejected (§2.7). The
  -- reason is the office's and never goes to the candidate.
  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values ('E2:staff:' || p_staff || ':' || extract(epoch from s.onboarding_started_at)::bigint,
          'email', 'E2', array[s.email], jsonb_build_object('name', s.first_name))
  on conflict (key) do nothing;

  -- §4.1: a rejected candidate's pending uploads drop out of Needs review
  -- because the queue excludes Rejected profiles — nothing to write here.
end $$;

-- The office's only door, checked the way queue_office_notifications()
-- checks it (20260922170000): the caller's own profile, read by auth.uid().
create or replace function public.assert_office_caller()
returns void
language plpgsql
stable
set search_path = public, extensions
as $$
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6 · Office RPCs
-- ---------------------------------------------------------------------

-- §2.4 / BO4 phase 2: "Accept — move to Documents". Mirrors the Willo
-- stage change; the qualified role type(s) are mandatory at this point
-- ("roles are mandatory before Accept") because they are what makes the
-- person eligible for shifts of that role later (§9.6).
create or replace function public.onboarding_accept(
  p_staff           uuid,
  p_roles           uuid[],
  p_note            text,
  p_activation_link text,
  p_install_link    text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s staff;
  v_roles int;
begin
  perform assert_office_caller();

  select * into s from staff where id = p_staff for update;
  if s.id is null or s.removed_at is not null then
    raise exception 'unknown_staff' using errcode = 'P0002';
  end if;
  if s.status <> 'interview_completed' then
    raise exception 'not_awaiting_decision: %', s.status using errcode = 'P0001';
  end if;

  select count(*) into v_roles from roles r where r.id = any(coalesce(p_roles, '{}'));
  if v_roles = 0 then
    raise exception 'roles_required' using errcode = '22023';
  end if;

  insert into staff_roles (staff_id, role_id)
  select p_staff, r.id from roles r where r.id = any(p_roles)
  on conflict do nothing;

  perform onboarding_do_accept(p_staff, 'office', now(), p_activation_link, p_install_link);

  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'onboarding_accept', 'staff', p_staff,
          jsonb_build_object('roles', to_jsonb(p_roles),
                             'note', nullif(btrim(coalesce(p_note, '')), '')));

  return jsonb_build_object('staffId', p_staff::text, 'status', 'documents', 'roles', v_roles);
end $$;

comment on function public.onboarding_accept(uuid, uuid[], text, text, text) is
  '§2.4. interview_completed → documents with the qualified role(s), which are mandatory, and E3 (activation + password + download the app) to the candidate. The office mirror of a Willo Accept; the Willo route is willo_record_event().';

-- §2.3: "Reject candidate" — final, no un-reject. A reason is mandatory:
-- the Rejected view shows it, and a rejection nobody can explain is one
-- nobody can review.
create or replace function public.onboarding_reject(p_staff uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare s staff;
begin
  perform assert_office_caller();

  select * into s from staff where id = p_staff for update;
  if s.id is null or s.removed_at is not null then
    raise exception 'unknown_staff' using errcode = 'P0002';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if s.status not in ('interview_requested', 'interview_completed', 'documents', 'quiz', 'contract') then
    -- A signed contract makes them Staff; §9.6's Block is the tool then.
    raise exception 'not_a_candidate: %', s.status using errcode = 'P0001';
  end if;

  perform onboarding_do_reject(p_staff, 'manager', btrim(p_reason), auth.uid(), now());

  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'onboarding_reject', 'staff', p_staff,
          jsonb_build_object('reason', btrim(p_reason), 'fromStatus', s.status::text));

  return jsonb_build_object('staffId', p_staff::text, 'status', 'rejected',
                            'fromStatus', s.status::text);
end $$;

comment on function public.onboarding_reject(uuid, text) is
  '§2.3 Reject candidate: any onboarding stage → rejected, with a mandatory reason kept for the office, and E2 (THC wording, the same for every rejection route, §2.7) to the candidate. Final: rejected leaves only by Reset to candidate.';

-- §2.3: Verify. The manager confirms the AI's dates, not the hours.
create or replace function public.verify_document(
  p_doc             uuid,
  p_expiry          date        default null,
  p_term_dates      daterange[] default null,
  p_completion_date date        default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  d compliance_docs;
  v_advanced boolean;
  v_today date := (now() at time zone 'Europe/London')::date;
begin
  perform assert_office_caller();

  select * into d from compliance_docs where id = p_doc for update;
  if d.id is null then
    raise exception 'unknown_document' using errcode = 'P0002';
  end if;
  if d.review_status <> 'pending' then
    -- Rejected needs a new upload (§2.3); superseded is read-only (§2.12).
    raise exception 'not_under_review: %', d.review_status using errcode = 'P0001';
  end if;
  if p_term_dates is not null and exists (
       select 1 from unnest(p_term_dates) r where isempty(r) or lower_inf(r) or upper_inf(r)) then
    raise exception 'term_dates_invalid' using errcode = '22023';
  end if;

  update compliance_docs
     set review_status = 'verified',
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         expiry_date = coalesce(p_expiry, expiry_date),
         term_dates = case when doc_type = 'university_term_dates_letter'
                           then coalesce(p_term_dates, term_dates) else term_dates end,
         completion_date = case when doc_type = 'university_completion_letter'
                                then coalesce(p_completion_date, completion_date) else completion_date end
   where id = p_doc
  returning * into d;

  -- The verified dates are the single input to the calculated cap
  -- (RULE-20, §2.3): nothing else to update, and nothing typed as hours.
  if d.doc_type = 'university_term_dates_letter' then
    update staff set term_dates = coalesce(d.term_dates, '{}') where id = d.staff_id;
  elsif d.doc_type = 'university_completion_letter' then
    -- §4.5 / the completion letter requirement: the 48 h release runs
    -- from the COURSE COMPLETION DATE on the letter, never from today;
    -- graduated_at records the verification (20260922093100).
    update staff
       set course_completion_date = d.completion_date,
           graduated_at = coalesce(graduated_at, v_today)
     where id = d.staff_id;
  end if;

  select status = 'quiz' into v_advanced from staff where id = d.staff_id;

  return jsonb_build_object('docId', d.id::text, 'staffId', d.staff_id::text,
                            'status', 'verified', 'quizUnlocked', coalesce(v_advanced, false));
end $$;

comment on function public.verify_document(uuid, date, daterange[], date) is
  '§2.3 / §4.1 Verify. Pending → verified with the reviewer and a UK-time audit stamp; the manager may correct the AI''s expiry, term periods (any number, + Add period) or completion date. Term dates feed the calculated cap; the completion date feeds the 48 h release. The quiz unlocks by itself if this was the last item (onboarding_docs_advance).';

-- §2.3: Reject with a reason → document Rejected → push N8 with the reason
-- and a Re-upload button. The candidate stays where they are.
create or replace function public.reject_document(p_doc uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare d compliance_docs;
begin
  perform assert_office_caller();

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  select * into d from compliance_docs where id = p_doc for update;
  if d.id is null then
    raise exception 'unknown_document' using errcode = 'P0002';
  end if;
  if d.review_status <> 'pending' then
    raise exception 'not_under_review: %', d.review_status using errcode = 'P0001';
  end if;

  update compliance_docs
     set review_status = 'rejected',
         rejection_reason = btrim(p_reason),
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_doc;

  insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
  values ('N8:doc:' || p_doc, 'push', 'N8', d.staff_id,
          jsonb_build_object('reason', btrim(p_reason), 'document', doc_label(d.doc_type)))
  on conflict (key) do nothing;

  return jsonb_build_object('docId', d.id::text, 'staffId', d.staff_id::text, 'status', 'rejected');
end $$;

comment on function public.reject_document(uuid, text) is
  '§2.3 Reject: pending → rejected with a mandatory reason and push N8 ("Document rejected — [reason]" + Re-upload). Rejecting a document is not rejecting the candidate.';

-- The Criminal Record declaration answered Yes follows the same mechanic
-- (§2.3, §2.10). The §10.7 consequences of reviewing an in-employment one
-- stay in criminal_declaration_reviewed (20260921180312).
create or replace function public.verify_declaration(p_declaration uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare c criminal_declarations;
begin
  perform assert_office_caller();
  select * into c from criminal_declarations where id = p_declaration for update;
  if c.id is null then
    raise exception 'unknown_declaration' using errcode = 'P0002';
  end if;
  if c.superseded or c.review_status <> 'pending' then
    raise exception 'not_under_review: %', c.review_status using errcode = 'P0001';
  end if;

  update criminal_declarations
     set review_status = 'verified', reviewed_by = auth.uid(), reviewed_at = now(),
         review_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_declaration;

  return jsonb_build_object('declarationId', c.id::text, 'staffId', c.staff_id::text,
                            'status', 'verified');
end $$;

create or replace function public.reject_declaration(p_declaration uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare c criminal_declarations;
begin
  perform assert_office_caller();
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  select * into c from criminal_declarations where id = p_declaration for update;
  if c.id is null then
    raise exception 'unknown_declaration' using errcode = 'P0002';
  end if;
  if c.superseded or c.review_status <> 'pending' then
    raise exception 'not_under_review: %', c.review_status using errcode = 'P0001';
  end if;

  update criminal_declarations
     set review_status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
         review_note = btrim(p_reason)
   where id = p_declaration;

  -- Onboarding: the same mechanic as a document, N8 included (§2.3).
  -- In employment: §10.7 is explicit that the worker is NOT told through
  -- the app — "this is a conversation rather than a push notification".
  if c.source = 'onboarding' then
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    values ('N8:declaration:' || c.id, 'push', 'N8', c.staff_id,
            jsonb_build_object('reason', btrim(p_reason), 'document', 'Criminal Record declaration'))
    on conflict (key) do nothing;
  end if;

  return jsonb_build_object('declarationId', c.id::text, 'staffId', c.staff_id::text,
                            'status', 'rejected');
end $$;

comment on function public.verify_declaration(uuid, text) is
  '§2.3 / §2.10: a Yes declaration is verified by a manager like a document. A No never reaches here — it is verified on insert.';
comment on function public.reject_declaration(uuid, text) is
  '§2.3 / §2.10: a Yes declaration rejected with a reason. N8 for an onboarding declaration; none for an in-employment one (§10.7).';

-- §2.12: a returning-applicant entry is acted on by Reset to candidate on
-- the named record, or by rejecting the application. The applicant saw
-- the ordinary confirmation either way and learns nothing from E2.
create or replace function public.onboarding_resolve_returning(
  p_application uuid,
  p_action      text,
  p_reason      text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  a applications;
  v_reset jsonb;
begin
  perform assert_office_caller();

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  select * into a from applications where id = p_application for update;
  if a.id is null or a.outcome <> 'returning_applicant' then
    raise exception 'unknown_application' using errcode = 'P0002';
  end if;
  if a.resolved_at is not null then
    raise exception 'already_resolved: %', a.resolution using errcode = 'P0001';
  end if;

  if p_action = 'reset' then
    -- The same function §9.6's button calls: it refuses anything but a
    -- blocked, rejected or inactive record, supersedes the evidence and
    -- keeps the Employee ID and the history.
    v_reset := reset_to_candidate(a.staff_id, btrim(p_reason));
  elsif p_action = 'reject' then
    insert into notification_outbox (key, channel, template, recipient_emails, payload)
    values ('E2:application:' || a.id, 'email', 'E2', array[a.email],
            jsonb_build_object('name', a.first_name))
    on conflict (key) do nothing;
  else
    raise exception 'unknown_action: %', p_action using errcode = '22023';
  end if;

  update applications
     set resolved_at = now(),
         resolved_by = auth.uid(),
         resolution = case when p_action = 'reset' then 'reset' else 'rejected' end,
         resolution_reason = btrim(p_reason)
   where id = p_application;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'returning_applicant_' || p_action, 'staff', a.staff_id,
          jsonb_build_object('applicationId', a.id, 'reason', btrim(p_reason),
                             'matchedOn', a.matched_on));

  return jsonb_build_object('applicationId', a.id::text, 'staffId', a.staff_id::text,
                            'resolution', p_action) || coalesce(v_reset, '{}'::jsonb);
end $$;

comment on function public.onboarding_resolve_returning(uuid, text, text) is
  '§2.12 returning applicant: reset → reset_to_candidate() on the matched record (blocked, rejected or inactive only); reject → the application is declined and E2 goes to the address on the application. Either way the entry leaves the board.';

-- ---------------------------------------------------------------------
-- 7 · Willo (§2.4, Appendix B) — data-driven, service role only
--
-- The receiver is not built: it needs the Willo API key and the webhook
-- signing secret (Edge Function secrets, docs/12). These two functions are
-- what it will call. What an event DOES is read from
-- settings.willo_stage_map, so remapping Willo's pipeline is a /settings
-- change, not a release (§2.4).
-- ---------------------------------------------------------------------
create or replace function public.willo_link_candidate(
  p_staff              uuid,
  p_willo_candidate_id text,
  p_invited_at         timestamptz default now()
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if coalesce(btrim(p_willo_candidate_id), '') = '' then
    raise exception 'willo_candidate_id_required' using errcode = '22023';
  end if;
  update staff
     set willo_candidate_id = btrim(p_willo_candidate_id),
         willo_invited_at = p_invited_at
   where id = p_staff and status = 'interview_requested' and removed_at is null;
  if not found then
    raise exception 'not_awaiting_interview' using errcode = 'P0001';
  end if;
end $$;

comment on function public.willo_link_candidate(uuid, text, timestamptz) is
  '§2.4: record that the candidate was created in Willo and Willo sent E1. Called by the integration once it has keys; nothing calls it yet.';

create or replace function public.willo_record_event(
  p_willo_candidate_id text,
  p_event              text,
  p_at                 timestamptz default now(),
  p_details            jsonb       default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s staff;
  v_target text;
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
begin
  select * into s from staff
   where willo_candidate_id = p_willo_candidate_id and removed_at is null
   for update;
  if s.id is null then
    raise exception 'unknown_willo_candidate' using errcode = 'P0002';
  end if;

  -- Progress is tracking only and never moves a card.
  if p_event = 'progress' then
    update staff
       set willo_answers_done = coalesce((v_details ->> 'answersDone')::int, willo_answers_done),
           willo_answers_total = coalesce((v_details ->> 'answersTotal')::int, willo_answers_total)
     where id = s.id;
    return jsonb_build_object('staffId', s.id::text, 'outcome', 'tracked');
  end if;

  v_target := (select value ->> p_event from settings where key = 'willo_stage_map');

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (p_at, null, 'willo_event', 'staff', s.id,
          jsonb_build_object('event', p_event, 'target', v_target, 'fromStatus', s.status::text));

  if v_target is null then
    return jsonb_build_object('staffId', s.id::text, 'outcome', 'ignored');
  end if;

  -- Idempotent: Willo retries webhooks, and a repeat of an event already
  -- applied must be a no-op rather than an illegal-transition error.
  if v_target = 'interview_completed' then
    if s.status = 'interview_requested' then
      update staff
         set status = 'interview_completed',
             willo_completed_at = p_at,
             willo_answers_done = coalesce((v_details ->> 'answersDone')::int, willo_answers_total, willo_answers_done),
             willo_answers_total = coalesce((v_details ->> 'answersTotal')::int, willo_answers_total)
       where id = s.id;
      return jsonb_build_object('staffId', s.id::text, 'outcome', 'interview_completed');
    end if;

  elsif v_target = 'documents' then
    if s.status = 'interview_requested' then
      -- A decision can arrive before, or instead of, the New Response
      -- event. The machine has no shortcut, so walk the edge.
      update staff set status = 'interview_completed', willo_completed_at = p_at where id = s.id;
      s.status := 'interview_completed';
    end if;
    if s.status = 'interview_completed' then
      perform onboarding_do_accept(s.id, 'willo', p_at,
                                   v_details ->> 'activationLink', v_details ->> 'installLink');
      return jsonb_build_object('staffId', s.id::text, 'outcome', 'documents');
    end if;

  elsif v_target = 'rejected' then
    if s.status in ('interview_requested', 'interview_completed', 'documents', 'quiz', 'contract') then
      perform onboarding_do_reject(s.id, 'willo', 'Rejected in Willo', null, p_at);
      return jsonb_build_object('staffId', s.id::text, 'outcome', 'rejected');
    end if;

  else
    raise exception 'unsupported_willo_mapping: % -> %', p_event, v_target using errcode = '22023';
  end if;

  return jsonb_build_object('staffId', s.id::text, 'outcome', 'unchanged', 'status', s.status::text);
end $$;

comment on function public.willo_record_event(text, text, timestamptz, jsonb) is
  '§2.4. Applies one Willo webhook event through settings.willo_stage_map: → interview_completed (New Response), → documents (Accept: E3; roles are picked on the profile), → rejected (Reject: E2). Idempotent on repeats. `progress` updates the answer count only. Service role only — the receiving Edge Function is not built (needs THC''s Willo keys).';

-- ---------------------------------------------------------------------
-- 8 · Reads
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
  s.user_id is not null                                        as activated,
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
  'One row per non-removed person for /onboarding and /onboarding/:id (§2.2, §2.3): stage and days in it, Willo tracking, current-period document / declaration / quiz / additional-info progress, and the rejection record. security_invoker: staff is admin_all only, so a client sees nobody and a worker only themselves.';

create or replace view onboarding_returning_v with (security_invoker = true) as
select
  a.id                                                         as application_id,
  a.created_at                                                 as applied_at,
  a.first_name || ' ' || a.last_name                           as applicant_name,
  a.matched_on,
  s.id                                                         as staff_id,
  s.first_name || ' ' || s.last_name                           as existing_name,
  s.employee_id,
  s.status,
  s.block_kind,
  s.block_reason,
  s.rating,
  s.reliability,
  (select count(*) from bookings b
    where b.staff_id = s.id and b.status in ('worked', 'closed'))::int as shifts_worked
from applications a
join staff s on s.id = a.staff_id
where a.outcome = 'returning_applicant'
  and a.resolved_at is null
  and s.removed_at is null;

comment on view onboarding_returning_v is
  'The §2.12 returning-applicant cards: an unresolved application that matched an existing record, with what the manager needs to decide — the record''s status, why it is blocked, and its history. matched_on is shown because the match is a claim by an anonymous caller (20260922183012).';

revoke all on onboarding_candidates_v, onboarding_returning_v from public, anon;
grant select on onboarding_candidates_v, onboarding_returning_v to authenticated;

-- ---------------------------------------------------------------------
-- 9 · Grants (docs/14 O7: revoke from anon and authenticated BY NAME)
-- ---------------------------------------------------------------------
revoke execute on function public.onboarding_documents_missing(uuid)  from public, anon;
revoke execute on function public.onboarding_quiz_blockers(uuid)      from public, anon;
grant  execute on function public.onboarding_documents_missing(uuid)  to authenticated, service_role;
grant  execute on function public.onboarding_quiz_blockers(uuid)      to authenticated, service_role;

revoke execute on function public.staff_status_guard()                  from public, anon, authenticated;
revoke execute on function public.onboarding_evidence_changed()         from public, anon, authenticated;
revoke execute on function public.criminal_declaration_no_is_verified() from public, anon, authenticated;
revoke execute on function public.onboarding_do_accept(uuid, text, timestamptz, text, text)
  from public, anon, authenticated;
revoke execute on function public.onboarding_do_reject(uuid, text, text, uuid, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.assert_office_caller()               from public, anon;

-- Advancing is harmless (it only takes a legal, evidenced step), but it is
-- a write path with no caller check, so it is not published to users.
revoke execute on function public.onboarding_advance_if_ready(uuid)    from public, anon, authenticated;
grant  execute on function public.onboarding_advance_if_ready(uuid)    to service_role;

-- The office's RPCs: signed-in, and each refuses a non-admin itself.
revoke execute on function public.onboarding_accept(uuid, uuid[], text, text, text) from public, anon;
revoke execute on function public.onboarding_reject(uuid, text)                     from public, anon;
revoke execute on function public.verify_document(uuid, date, daterange[], date)    from public, anon;
revoke execute on function public.reject_document(uuid, text)                       from public, anon;
revoke execute on function public.verify_declaration(uuid, text)                    from public, anon;
revoke execute on function public.reject_declaration(uuid, text)                    from public, anon;
revoke execute on function public.onboarding_resolve_returning(uuid, text, text)    from public, anon;
grant  execute on function public.onboarding_accept(uuid, uuid[], text, text, text) to authenticated;
grant  execute on function public.onboarding_reject(uuid, text)                     to authenticated;
grant  execute on function public.verify_document(uuid, date, daterange[], date)    to authenticated;
grant  execute on function public.reject_document(uuid, text)                       to authenticated;
grant  execute on function public.verify_declaration(uuid, text)                    to authenticated;
grant  execute on function public.reject_declaration(uuid, text)                    to authenticated;
grant  execute on function public.onboarding_resolve_returning(uuid, text, text)    to authenticated;

-- Willo: the integration only.
revoke execute on function public.willo_link_candidate(uuid, text, timestamptz)      from public, anon, authenticated;
revoke execute on function public.willo_record_event(text, text, timestamptz, jsonb) from public, anon, authenticated;
grant  execute on function public.willo_link_candidate(uuid, text, timestamptz)      to service_role;
grant  execute on function public.willo_record_event(text, text, timestamptz, jsonb) to service_role;
