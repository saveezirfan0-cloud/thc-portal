-- =====================================================================
-- Migration 20261001210000 · date of birth corrections (ADR-0070)
--   §10.1 (the locked fields) · ADR-0045 (Request a change) amended ·
--   ADR-0041 / ADR-0025 (the gov.uk check) · ADR-0056 / ADR-0060 (office
--   roles) · RULE-20 (the under-18 opt-out) · §2.1 (the age gate)
--
-- The product owner decided on 28.09.2026 that a worker's date of birth
-- must be correctable from the Back Office and from the Staff App. Until
-- now only a candidate re-entering a rejected share code could change it
-- (onboarding_reenter_share_code, 20260928100000); a live test hit a wrong
-- date → gov.uk "not found" → nothing anybody could press. The date matters:
-- gov.uk matches share code + date of birth, an under-18 cannot sign the
-- 48-hour opt-out, the HMRC New Starter report carries it (§9.9) and /apply
-- dedupes on phone + date of birth. So every change is deliberate and
-- audited, and all three routes share one rule and one effect:
--
--   the rule    dob_change_problem(p_dob, p_current, p_today) — /apply's
--               (submit_application, 20260922183012): a date, not in the
--               future, at most 100 completed years ago, 18 or over in UK
--               time — plus "not the date on file". Held with
--               dobChangeProblem() in packages/domain (dob.ts) to the `dobs`
--               group of changeRequest.vectors.json (pgTAP 717).
--   the effect  staff_dob_apply() — internal: writes staff.dob; one
--               audit_log row with the dates under the `dob` key
--               ({from, to}), which remove_worker()'s §1.7 scrub already
--               strips (v_pii_keys has 'dob', 20261001205000) — and the
--               office's free-text reason, which staff_removed_purge_
--               additions() now overwrites on removal; closes any other
--               PENDING dob change request (withdrawn when it asked for
--               this date, rejected with a reason + RC3 when it did not);
--               and, for an office correction, clears a date a worker
--               entered with a pending share code (claimed_dob, route 2)
--               and asks gov.uk again (rtw_check_enqueue) while
--               rtw_check_enabled(). A check still QUEUED is left alone —
--               the runner reads the date when it claims (rtw_check_claim),
--               so it runs with the new one; one already RUNNING carries
--               the old date and is reported as 'running' so the office can
--               press "Run check again" once it lands. A finished
--               needs_review check is superseded in rtw_checks_latest_v,
--               which takes the newest per document.
--
-- The three routes:
--
--   1 · office_correct_dob(p_staff, p_dob, p_reason) — "Correct" on
--       /staff/:id and /onboarding/:id. Owners and managers only: a new
--       office_can() permission, 'identity' (ADR-0056 says a permission is
--       a migration plus permissions.ts; owner and manager hold it, the
--       scheduler and the viewer do not). A viewer is refused read_only
--       first (assert_not_read_only, ADR-0060), a scheduler not_permitted.
--       Refuses a removed / GDPR-anonymised profile, a no-op, an
--       implausible or under-18 date, and a reason under 10 or over 300
--       characters. Audited staff.dob_corrected with the reason and the
--       manager's name (actorName, ADR-0055's activity log).
--
--   2 · submit_share_code_with_dob(p_share_code, p_dob, p_file_path) — the
--       Documents hub's "New share code" form, which now carries the date
--       of birth pre-filled from the profile. submit_document_upload() does
--       the filing exactly as before (not restated). A CHANGED date does
--       NOT touch staff.dob: it is stored on the pending share-code row
--       (compliance_docs.claimed_dob — written only by definer code, a
--       guard refuses it from any API session), audited as the worker
--       (staff.dob_claimed_with_share_code), and rtw_check_claim() — restated
--       — asks gov.uk with coalesce(claimed_dob, staff.dob). The profile
--       takes the date only when an admin VERIFIES that document (a
--       trigger on review_status → verified, whichever verify path set
--       it: staff.dob_corrected, source share_code_verified). A not-found,
--       a rejection or a supersede never changes staff.dob, so the form is
--       not a way to overwrite an office correction. The office sees
--       "Date of birth entered with this code … (profile …)" beside the
--       check (share_code_dob_claims_v). The date is checked first, so a
--       refused date files nothing; at most settings.rtw_check.
--       reenter_per_day (5) claims in 24 h, the onboarding re-entry's cap,
--       so the form is no way to try dates against a code.
--
--   3 · Request a change → Date of birth. profile_change_requests.kind
--       gains 'dob' with proposed_dob (evidence required, as for a name);
--       request_dob_change(p_dob, p_evidence_path, p_note) is the worker's
--       door, with request_profile_change()'s gates in its order (that
--       function is NOT restated and still refuses kind 'dob' as bad_kind).
--       office_decide_profile_change() — owners and managers only for a
--       dob request — approves it with route 1's effect. RC1–RC3 are
--       reused with {field} = "date of birth"; RC4 (payroll's "Name
--       changed") stays name-only.
--
-- Under 18. staff.age_18 (20260923040000) already refuses an under-18
-- date on the row, and every route refuses it first, out loud (under_18),
-- as /apply does — so no worker can hold a signed opt-out while under 18
-- today. What a correction CAN do is move the eighteenth birthday past the
-- day an opt-out was signed. weekly_cap() already treats the opt-out as
-- void for any week the worker was under 18 (cap_under_18(), from the
-- date of birth, never stored), so the cap follows the corrected date by
-- itself. The signature is not revoked here — cancelling an opt-out is the
-- worker's, with a notice period (cancel_wtr_optout) — but it is FLAGGED:
-- optOutSignedUnder18 on the audit row and in the result, which the
-- office's dialog turns into "ask them to sign it again".
--
-- Restated from their latest definitions, every line carried, with only
-- the lines marked 20261001210000 added:
--   office_can                          20261001201100 + 'identity'
--   profile_change_requests_state_guard 20260930200100 + proposed_dob immutable
--   staff_removed_purge_additions       20260930205200 + proposed_dob → 1900-01-01
--   office_decide_profile_change        20260930206000 + the dob branch
--   staff_me                            20260928110700 + 'dob'
--   rtw_check_claim                     20260928100000 + coalesce(claimed_dob, dob)
--   my_profile_change_requests          20260930202200 + proposed_dob (appended)
--   office_profile_change_requests      20260930203000 + current_dob, proposed_dob
--                                       (appended; the return type changes,
--                                       so these two are dropped and created)
-- Forward-only. pgTAP: 717 (new); 715/716/741/750 unchanged expectations.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · office_can — 20261001201100 + 'identity' (owner, manager)
-- ---------------------------------------------------------------------
create or replace function public.office_can(p_perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p_perm in ('users', 'settings', 'finance', 'write', 'identity')
           and case p.office_role
                 when 'owner'     then true
                 when 'manager'   then p_perm in ('finance', 'write', 'identity')
                 when 'scheduler' then p_perm = 'write'
                 when 'viewer'    then p_perm = 'finance'
                 else false
               end
      from profiles p
     where p.id = auth.uid() and p.role = 'admin'
       and current_app_role() = 'admin'), false)
$$;

comment on function public.office_can(text) is
  'ADR-0056, ADR-0060, ADR-0070: may the signed-in Back Office login use ''users'' | ''settings'' | ''finance'' | ''write'' | ''identity''? owner: all five; manager: finance, write, identity; scheduler: write; viewer: finance (reads money, changes nothing). ''identity'' is correcting a worker''s date of birth (office_correct_dob, and deciding a dob change request). False for any other session and any other permission name. ''write'' is for the Back Office to ask; the database enforces it with the office_read_only triggers (20261001201100).';

revoke all on function public.office_can(text) from public, anon;
grant execute on function public.office_can(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2 · The rule: dob_change_problem()
--
-- /apply's checks (submit_application, 20260922183012) in its order and
-- with its arithmetic — completed years by age(), in UK time — then "not
-- the date on file". Held to the `dobs` vectors with dobChangeProblem().
-- ---------------------------------------------------------------------
create or replace function public.dob_change_problem(
  p_dob     date,
  p_current date,
  p_today   date default null
) returns text
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_today date := coalesce(p_today, (now() at time zone 'Europe/London')::date);
  v_age   int;
begin
  if p_dob is null then
    return 'dob_required';
  end if;
  if p_dob > v_today then
    return 'dob_invalid';
  end if;
  v_age := extract(year from age(v_today, p_dob))::int;
  -- Older than this is a typo, not a worker (MAX_AGE on /apply).
  if v_age > 100 then
    return 'dob_invalid';
  end if;
  -- §2.1: refused out loud; staff.age_18 would refuse the row anyway.
  if v_age < 18 then
    return 'under_18';
  end if;
  if p_dob = p_current then
    return 'unchanged';
  end if;
  return null;
end $$;

comment on function public.dob_change_problem(date, date, date) is
  'ADR-0070: why a date of birth cannot replace the one on file, or null. dob_required | dob_invalid (future, or over 100 completed years) | under_18 (§2.1, UK time) | unchanged. /apply''s rule, held with dobChangeProblem() in packages/domain to changeRequest.vectors.json (pgTAP 717). p_today defaults to today in Europe/London.';

-- ---------------------------------------------------------------------
-- 3 · profile_change_requests gains 'dob'
-- ---------------------------------------------------------------------
alter table profile_change_requests
  add column if not exists proposed_dob date;

comment on column profile_change_requests.proposed_dob is
  'ADR-0070: the date of birth a kind ''dob'' request asks for; null on every other kind. 1900-01-01 once the worker is removed (§1.7), as staff.dob.';

alter table profile_change_requests drop constraint if exists profile_change_requests_kind;
alter table profile_change_requests
  add constraint profile_change_requests_kind check (kind in ('name', 'photo', 'dob'));

-- A dob request carries its date and its evidence, no name, no photo; and
-- only a dob request carries a date.
alter table profile_change_requests drop constraint if exists profile_change_requests_dob_shape;
alter table profile_change_requests
  add constraint profile_change_requests_dob_shape check (
    kind <> 'dob'
    or (proposed_dob is not null and evidence_path is not null
        and proposed_first_name is null and proposed_last_name is null
        and proposed_photo_path is null));
alter table profile_change_requests drop constraint if exists profile_change_requests_dob_only;
alter table profile_change_requests
  add constraint profile_change_requests_dob_only check (proposed_dob is null or kind = 'dob');

comment on table profile_change_requests is
  'ADR-0045, ADR-0070: a worker''s request to change the name, photo or date of birth §10.1 locks. One pending per worker per kind; proposed values immutable (GDPR anonymisation excepted); a rejection carries decision_reason, which the worker is shown. Admin-read; written through definer RPCs (docs/19 §3). The machine is profile_change_transitions().';
comment on column profile_change_requests.previous_value is
  'The value on the profile at the moment of the decision, e.g. {"firstName","lastName"}, {"photoPath"} or {"dob"}. Issued PDFs and payroll exports are never corrected retroactively (§1.7).';

-- ---------------------------------------------------------------------
-- 3b · compliance_docs.claimed_dob — the date of birth a worker entered
--      with a new share code (route 2). gov.uk is asked with it; the
--      profile takes it only when the office verifies that document.
-- ---------------------------------------------------------------------
alter table compliance_docs
  add column if not exists claimed_dob date;

alter table compliance_docs drop constraint if exists compliance_docs_claimed_dob_share_code;
alter table compliance_docs
  add constraint compliance_docs_claimed_dob_share_code
  check (claimed_dob is null or doc_type = 'share_code_report');

comment on column compliance_docs.claimed_dob is
  'ADR-0070: the date of birth the worker entered with this share code when it differs from staff.dob (submit_share_code_with_dob). rtw_check_claim() asks gov.uk with coalesce(claimed_dob, staff.dob); copied to staff.dob only when this document is verified (compliance_docs_claimed_dob_verified). Cleared by an office correction while pending, and on §1.7 removal. Written only by definer code: compliance_docs_claimed_dob_guard refuses it from anon and authenticated.';

-- Not security definer on purpose: current_user is the caller's role for a
-- PostgREST write (anon / authenticated) and the owner inside a definer
-- function, which is how the one RPC and the office correction write it.
-- The office's admin_all policy would otherwise let any Back Office login —
-- a scheduler included — set a date that Verify then copies to the profile.
create or replace function public.compliance_docs_claimed_dob_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if current_user in ('anon', 'authenticated')
     and ((tg_op = 'INSERT' and new.claimed_dob is not null)
          or (tg_op = 'UPDATE' and new.claimed_dob is distinct from old.claimed_dob)) then
    raise exception 'claimed_dob_rpc_only' using errcode = '42501',
      hint = 'ADR-0070: the date entered with a share code is written by submit_share_code_with_dob() only.';
  end if;
  return new;
end $$;

drop trigger if exists compliance_docs_claimed_dob_guard on compliance_docs;
create trigger compliance_docs_claimed_dob_guard
  before insert or update of claimed_dob on compliance_docs
  for each row execute function compliance_docs_claimed_dob_guard();

comment on function public.compliance_docs_claimed_dob_guard() is
  'ADR-0070: refuses compliance_docs.claimed_dob from any API session (anon, authenticated); definer code (submit_share_code_with_dob, staff_dob_apply, the §1.7 purge) writes it. A trigger function: not an RPC.';

-- The same rule for the date itself. staff.dob changes only through definer
-- code — office_correct_dob / the approved request / a verified share-code
-- claim (all staff_dob_apply), onboarding's own RPCs, /apply (service role)
-- and the §1.7 purge. Without this, the office's admin_all policy on staff
-- lets any Back Office login — a scheduler included — rewrite a date of
-- birth with a plain UPDATE, around office_can('identity') and the audit
-- row (QA re-review, 28.09.2026). No app writes staff.dob directly.
create or replace function public.staff_dob_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if current_user in ('anon', 'authenticated')
     and new.dob is distinct from old.dob then
    raise exception 'dob_rpc_only' using errcode = '42501',
      hint = 'ADR-0070: a date of birth is corrected with office_correct_dob(), a share code, or Request a change.';
  end if;
  return new;
end $$;

drop trigger if exists staff_dob_guard on staff;
create trigger staff_dob_guard
  before update of dob on staff
  for each row execute function staff_dob_guard();

comment on function public.staff_dob_guard() is
  'ADR-0070: refuses a change to staff.dob from any API session (anon, authenticated); the audited definer routes write it. A trigger function: not an RPC.';

-- ---------------------------------------------------------------------
-- 4 · profile_change_requests_state_guard — 20260930200100 + proposed_dob
-- ---------------------------------------------------------------------
create or replace function public.profile_change_requests_state_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if tg_op = 'INSERT' then
    -- A request is born pending; nothing inserts a decided one.
    if new.status <> 'pending' then
      raise exception 'illegal_change_request_transition: (new) -> %', new.status
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if not exists (select 1 from profile_change_transitions() t
                    where t.from_status = old.status and t.to_status = new.status) then
      raise exception 'illegal_change_request_transition: % -> %', old.status, new.status
        using errcode = 'P0001',
              hint = 'ADR-0045. The legal edges are listed by profile_change_transitions().';
    end if;
    -- Leaving pending is the decision.
    new.decided_at := coalesce(new.decided_at, now());
  end if;

  if (new.staff_id, new.kind, new.created_at)
       is distinct from (old.staff_id, old.kind, old.created_at) then
    raise exception 'change_request_immutable' using errcode = 'P0001',
      hint = 'ADR-0045: a request''s worker, kind and creation time never change.';
  end if;

  -- The office approves exactly what was asked. The one exception is §1.7:
  -- a removed worker's proposed name is anonymised.
  -- 20261001210000 (ADR-0070): proposed_dob is a proposed value like the rest.
  if (new.proposed_first_name, new.proposed_last_name, new.proposed_photo_path, new.evidence_path,
      new.proposed_dob)
       is distinct from
     (old.proposed_first_name, old.proposed_last_name, old.proposed_photo_path, old.evidence_path,
      old.proposed_dob)
     and not exists (select 1 from staff s where s.id = old.staff_id and s.removed_at is not null) then
    raise exception 'change_request_immutable' using errcode = 'P0001',
      hint = 'ADR-0045: the proposed values are fixed when the request is made. Withdraw it and ask again.';
  end if;
  return new;
end $$;

comment on function public.profile_change_requests_state_guard() is
  'Refuses any profile_change_requests status change that is not an edge of profile_change_transitions(), a request inserted already decided, and any change to the proposed values — names, photo, evidence, and since 20261001210000 the date of birth — except the §1.7 anonymisation of a removed worker. Stamps decided_at on leaving pending. The DB half of assertChangeRequestTransition() in packages/domain.';

revoke execute on function public.profile_change_requests_state_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5 · staff_removed_purge_additions — 20260930205200 + proposed_dob,
--     the dob audit rows' reason, compliance_docs.claimed_dob
-- ---------------------------------------------------------------------
create or replace function public.staff_removed_purge_additions()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_label text := deleted_account_label(new.employee_id);
begin
  delete from staff_unavailability     where staff_id = new.id;
  delete from staff_emergency_contacts where staff_id = new.id;

  update profile_change_requests
     set status              = case when status = 'pending' then 'withdrawn' else status end,
         proposed_first_name = case when proposed_first_name is not null then 'Deleted' end,
         proposed_last_name  = case when proposed_last_name  is not null then 'account' end,
         -- 20261001210000 (ADR-0070): a requested date of birth is personal
         -- data. The 1900-01-01 sentinel, as staff.dob and applications.dob
         -- get on removal: the dob shape CHECK needs a value on a dob row.
         proposed_dob        = case when proposed_dob is not null then date '1900-01-01' end,
         worker_note         = null,
         previous_value      = null,
         decision_reason     = case when decision_reason is not null
                                    then 'Removed under GDPR (§1.7)' end
   where staff_id = new.id;

  -- 20261001210000 (ADR-0070): the date-of-birth audit rows keep what
  -- happened, not what anyone wrote about it. remove_worker() strips the
  -- dates (`dob`, v_pii_keys) before this trigger fires; the office's free-text
  -- reason and any note are not personal-data keys it knows, so they are
  -- overwritten here, as decision_reason is above.
  update audit_log l
     set data = (l.data - 'note')
                || case when l.data ? 'reason'
                        then jsonb_build_object('reason', 'Removed under GDPR (§1.7)')
                        else '{}'::jsonb end
   where l.entity = 'staff'
     and l.entity_id = new.id
     and l.action in ('staff.dob_corrected', 'staff.dob_claimed_with_share_code')
     and (l.data ? 'reason' or l.data ? 'note');

  -- 20261001210000 (ADR-0070): a date entered with a share code is the
  -- worker's date of birth too. Held right-to-work rows (ADR-0065) keep
  -- the evidence, not this.
  update compliance_docs set claimed_dob = null
   where staff_id = new.id and claimed_dob is not null;

  update staff_referral_codes
     set revoked_at = coalesce(revoked_at, new.removed_at)
   where staff_id = new.id;

  update shift_offers
     set status = 'lapsed', closed_reason = 'gdpr', closed_at = new.removed_at
   where status = 'open'
     and (offered_by_staff_id = new.id or target_staff_id = new.id);

  update shift_offers set note = null
   where offered_by_staff_id = new.id and note is not null;

  -- The office's decline note (office_decline_cover) is the only free text
  -- closed_reason carries; every other writer sets a snake_case code
  -- (taken, withdrawn_by_worker, expired, gdpr, a booking cancel_cause or
  -- status). The default 'declined by the office' names nobody and stays.
  update shift_offers set closed_reason = 'gdpr'
   where offered_by_staff_id = new.id
     and closed_reason is not null
     and closed_reason not in ('gdpr', 'declined by the office')
     and (status = 'cancelled' or closed_reason !~ '^[a-z_]+$');

  -- The outbox copies. Keys are unique, so the join is by exact key.
  with k (key) as (
    select 'RC1:request:' || r.id::text from profile_change_requests r where r.staff_id = new.id
    union all
    select 'RC3:request:' || r.id::text from profile_change_requests r where r.staff_id = new.id
    union all
    select 'RC4:request:' || r.id::text from profile_change_requests r where r.staff_id = new.id
    union all
    select 'OF5:offer:'   || o.id::text from shift_offers o where o.offered_by_staff_id = new.id
    union all
    select 'OF5:booking:' || b.id::text from bookings b where b.staff_id = new.id
  )
  update notification_outbox n
     set payload = (n.payload - array['current', 'proposed', 'note', 'reason'])
                   || case when n.payload ? 'name'
                           then jsonb_build_object('name', v_label) else '{}'::jsonb end
                   || case when n.payload ? 'previousName'
                           then jsonb_build_object('previousName', v_label) else '{}'::jsonb end,
         failed_at = case when n.sent_at is null and n.failed_at is null
                          then now() else n.failed_at end,
         error     = case when n.sent_at is null and n.failed_at is null
                          then 'gdpr_removed: not sent, the worker was removed (§1.7)'
                          else n.error end
    from k
   where n.key = k.key
     and n.template in ('RC1', 'RC3', 'RC4', 'OF5');

  return null;
end $$;

comment on function public.staff_removed_purge_additions() is
  '§1.7 GDPR removal for the docs/19 additions: deletes availability and the emergency contact, withdraws and anonymises change requests (a requested date of birth becomes 1900-01-01 since 20261001210000; the date-of-birth audit rows lose their reason and note, and compliance_docs.claimed_dob is cleared), revokes the referral code, lapses open offers and clears the office''s free-text decline note, and anonymises the RC1/RC3/RC4/OF5 outbox payloads (names → "Deleted account #id", free text removed, unsent rows failed gdpr_removed) that remove_worker()''s own scrub (20260930120100, which runs after this trigger and wins where both match) does not reach. Writes no new audit_log row; the additions'' audit rows carry no personal data. Fires once, after removed_at is first set. A trigger function: not an RPC.';

-- Trigger functions are never RPCs (20260927161000, pgTAP 190).
revoke execute on function public.staff_removed_purge_additions() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6 · The effect: staff_dob_apply() — internal: no API role may execute
--     it (the service role keeps the default grant, as for every function)
--
-- The caller has checked who may do this and that the date is allowed; this
-- writes it, audits it, closes any other pending dob request and, when
-- asked (the office's routes), re-runs a pending gov.uk check with it.
-- The audit row carries the two dates under the `dob` key only: the log
-- outlives a §1.7 removal and remove_worker() strips `dob` from every row
-- about the worker (v_pii_keys), so nowhere else in `data` holds them.
-- ---------------------------------------------------------------------
create or replace function public.staff_dob_apply(
  p_staff   uuid,
  p_dob     date,
  p_actor   uuid,
  p_action  text,
  p_data    jsonb,
  p_requeue boolean
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s          staff;
  r          profile_change_requests;
  v_doc      uuid;
  v_open     rtw_checks;
  v_check    uuid;
  v_rtw      text;
  v_optout   boolean;
  v_cleared  int := 0;
  v_closed   uuid;
  v_closed_as text;
begin
  select * into s from staff where id = p_staff for update;
  if s.id is null then
    raise exception 'staff_not_found' using errcode = 'P0002';
  end if;

  update staff set dob = p_dob where id = s.id;

  -- RULE-20: an under-18 cannot sign the opt-out. staff.age_18 means the
  -- worker is 18 today; the question is whether they were on the day they
  -- signed. weekly_cap() voids it for the under-18 weeks by itself
  -- (cap_under_18); the signature is the office's to take up.
  v_optout := coalesce(s.wtr_optout, false)
              and s.wtr_optout_signed_at is not null
              and (p_dob + interval '18 years')::date
                  > (s.wtr_optout_signed_at at time zone 'Europe/London')::date;

  -- A dob change request still pending is overtaken: withdrawn when it
  -- asked for exactly this date (nothing to tell the worker — the date is
  -- theirs), otherwise rejected with the reason they are shown (RC3). The
  -- request this call is approving is not touched (p_data.requestId).
  for r in
    select * from profile_change_requests q
     where q.staff_id = s.id and q.kind = 'dob' and q.status = 'pending'
       and q.id::text is distinct from (p_data ->> 'requestId')
     for update
  loop
    if r.proposed_dob = p_dob then
      update profile_change_requests
         set status = 'withdrawn', decided_by = p_actor,
             previous_value = jsonb_build_object('dob', s.dob)
       where id = r.id;
      v_closed_as := 'withdrawn';
    else
      update profile_change_requests
         set status = 'rejected', decided_by = p_actor,
             previous_value = jsonb_build_object('dob', s.dob),
             decision_reason = 'The office has since set your date of birth to '
                               || to_char(p_dob, 'DD.MM.YYYY') || '.'
       where id = r.id;
      insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
      values ('RC3:request:' || r.id, 'push', 'RC3', r.staff_id,
              jsonb_build_object('field', 'date of birth',
                                 'reason', 'The office has since set your date of birth to '
                                           || to_char(p_dob, 'DD.MM.YYYY') || '.'))
      on conflict (key) do nothing;
      v_closed_as := 'rejected';
    end if;
    v_closed := r.id;
  end loop;

  if p_requeue then
    -- The office's date wins over one a worker entered with a pending
    -- share code (route 2): gov.uk is asked with the corrected profile.
    update compliance_docs d
       set claimed_dob = null
     where d.staff_id = s.id
       and d.doc_type = 'share_code_report'
       and d.review_status = 'pending'
       and d.claimed_dob is not null;
    get diagnostics v_cleared = row_count;

    select d.id into v_doc
      from compliance_docs d
     where d.staff_id = s.id
       and d.doc_type = 'share_code_report'
       and d.review_status = 'pending'
       and d.share_code is not null
     order by d.uploaded_at desc, d.id desc
     limit 1;
    if v_doc is null then
      v_rtw := 'none';
    elsif not rtw_check_enabled() then
      -- Checked by hand (ADR-0018): the office uses the corrected date.
      v_rtw := 'off';
    else
      select * into v_open from rtw_checks c
       where c.compliance_doc_id = v_doc and c.status in ('queued', 'running');
      if v_open.status = 'running' then
        -- Already asking gov.uk with the old date; its result will say so.
        v_rtw := 'running';
        v_check := v_open.id;
      else
        -- A queued check is returned as it is (it reads the date when it is
        -- claimed); otherwise a new row, which supersedes a finished one.
        v_check := rtw_check_enqueue(v_doc, p_actor);
        v_rtw := case when v_check is null then 'none' else 'queued' end;
      end if;
    end if;
  end if;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), p_actor, p_action, 'staff', s.id,
          jsonb_strip_nulls(
            coalesce(p_data, '{}'::jsonb)
            || jsonb_build_object(
                 'staffId',             s.id,
                 'employeeId',          s.employee_id,
                 'dob',                 jsonb_build_object('from', s.dob, 'to', p_dob),
                 'rtwCheck',            v_rtw,
                 'checkId',             v_check,
                 'documentId',          coalesce(p_data ->> 'documentId', v_doc::text),
                 'claimCleared',        case when v_cleared > 0 then true end,
                 'closedRequestId',     v_closed,
                 'closedRequestAs',     v_closed_as,
                 'optOutSignedUnder18', case when v_optout then true end,
                 'actorName',           (select full_name from profiles where id = p_actor))));

  return jsonb_strip_nulls(jsonb_build_object(
    'ok',                  true,
    'dob',                 p_dob,
    'previousDob',         s.dob,
    'rtwCheck',            v_rtw,
    'checkId',             v_check,
    'closedRequestAs',     v_closed_as,
    'optOutSignedUnder18', case when v_optout then true end));
end $$;

comment on function public.staff_dob_apply(uuid, date, uuid, text, jsonb, boolean) is
  'ADR-0070, internal: write staff.dob and audit it (p_action; the dates under `dob` only, which the §1.7 scrub strips). Closes any OTHER pending dob change request (withdrawn when it asked for this date; rejected with a reason + RC3 otherwise). With p_requeue (the office''s routes): clears a pending share code''s claimed_dob and queues a fresh gov.uk check (rtwCheck: queued | running | off | none). Flags optOutSignedUnder18 when a signed 48-hour opt-out predates the corrected eighteenth birthday. The caller authorises and validates. No API role may execute it; the service role keeps the default grant.';

-- ---------------------------------------------------------------------
-- 7 · Route 1 — office_correct_dob(): "Correct" on /staff/:id and
--     /onboarding/:id. Owners and managers.
-- ---------------------------------------------------------------------
create or replace function public.office_correct_dob(
  p_staff  uuid,
  p_dob    date,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor   uuid := auth.uid();
  s         staff;
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_problem text;
begin
  if v_actor is null or current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  -- ADR-0060: a viewer is told it is read-only, before anything else.
  perform assert_not_read_only();
  -- ADR-0056's matrix: owner and manager hold 'identity'; a scheduler not.
  if not office_can('identity') then
    raise exception 'not_permitted' using errcode = '42501', detail = 'identity';
  end if;

  select * into s from staff where id = p_staff for update;
  if s.id is null then
    raise exception 'staff_not_found' using errcode = 'P0002';
  end if;
  -- §1.7: nothing personal is put back on an anonymised profile.
  if s.removed_at is not null or s.status = 'removed' then
    raise exception 'staff_removed' using errcode = 'P0001';
  end if;

  -- validateDobCorrection() in packages/domain, in its order.
  v_problem := dob_change_problem(p_dob, s.dob, (now() at time zone 'Europe/London')::date);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if char_length(v_reason) < 10 then
    raise exception 'reason_too_short' using errcode = '22023';
  end if;
  if char_length(v_reason) > 300 then
    raise exception 'reason_too_long' using errcode = '22023';
  end if;

  return staff_dob_apply(s.id, p_dob, v_actor, 'staff.dob_corrected',
                         jsonb_build_object('source', 'office', 'reason', v_reason),
                         true);
end $$;

comment on function public.office_correct_dob(uuid, date, text) is
  'ADR-0070: an owner or manager corrects a worker''s or candidate''s date of birth (office_can(''identity''); a viewer is read_only, a scheduler not_permitted). Refuses a removed profile (staff_removed), dob_change_problem() (dob_required | dob_invalid | under_18 | unchanged) and a reason under 10 or over 300 characters. Writes staff.dob, audits staff.dob_corrected with the reason and actorName, and queues a fresh gov.uk check of a pending share code while the check is on (rtwCheck in the result). Flags optOutSignedUnder18.';

-- ---------------------------------------------------------------------
-- 8 · Route 2 — submit_share_code_with_dob(): the Documents hub's "New
--     share code" form, with the date of birth gov.uk will be asked with.
--     The date is a CLAIM on the pending document; the profile takes it
--     only when the office verifies that document (8c).
-- ---------------------------------------------------------------------
create or replace function public.submit_share_code_with_dob(
  p_share_code text,
  p_dob        date,
  p_file_path  text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_me      uuid := staff_writer(null);
  s         staff;
  v_changed boolean;
  v_problem text;
  v_cap     int;
  v_recent  int;
  v_result  jsonb;
  v_doc     uuid;
begin
  if v_me is null then
    raise exception 'not_a_worker' using errcode = '42501';
  end if;
  select * into s from staff where id = v_me for update;

  -- submit_document_upload()'s own eligibility, asked first so a worker it
  -- would refuse is told that, not something about their date of birth.
  if s.removed_at is not null
     or s.status not in ('compliant', 'blocked')
     or (s.status = 'blocked' and s.block_kind = 'manual') then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible');
  end if;

  -- The form always sends the date; only a different one is a claim.
  v_changed := p_dob is not null and p_dob is distinct from s.dob;
  if v_changed then
    v_problem := dob_change_problem(p_dob, s.dob, (now() at time zone 'Europe/London')::date);
    if v_problem is not null then
      return jsonb_build_object('ok', false, 'reason', v_problem);
    end if;
    -- Each claim is a gov.uk query with a code and a date: the onboarding
    -- re-entry's cap (settings.rtw_check.reenter_per_day, 5), so the form is
    -- no way to try dates of birth against a code.
    v_cap := least(greatest(case when (rtw_check_config() ->> 'reenter_per_day') ~ '^\d{1,3}$'
                                 then (rtw_check_config() ->> 'reenter_per_day')::int end, 1), 50);
    select count(*)::int into v_recent
      from audit_log a
     where a.action = 'staff.dob_claimed_with_share_code'
       and a.entity = 'staff'
       and a.entity_id = s.id
       and a.at > now() - interval '24 hours';
    if v_recent >= v_cap then
      return jsonb_build_object('ok', false, 'reason', 'too_many_attempts');
    end if;
  end if;

  -- The filing, unchanged: every rule of the hub's upload, the pending row,
  -- its audit row, and the insert trigger that queues the gov.uk check.
  v_result := submit_document_upload('share_code_report', p_file_path, p_share_code, null);
  if not coalesce((v_result ->> 'ok')::boolean, false) then
    return v_result;
  end if;

  -- The claim goes on the document, never on the profile: the runner claims
  -- the check after commit and asks gov.uk with coalesce(claimed_dob, dob);
  -- staff.dob moves only when the office verifies this document.
  if v_changed then
    v_doc := (v_result ->> 'documentId')::uuid;
    update compliance_docs set claimed_dob = p_dob where id = v_doc;
    insert into audit_log (at, actor, action, entity, entity_id, data)
    values (now(), auth.uid(), 'staff.dob_claimed_with_share_code', 'staff', s.id,
            jsonb_build_object(
              'staffId',    s.id,
              'employeeId', s.employee_id,
              'source',     'staff_app',
              'documentId', v_doc,
              'dob',        jsonb_build_object('from', s.dob, 'to', p_dob)));
  end if;

  return v_result || jsonb_build_object('dobChanged', v_changed);
end $$;

comment on function public.submit_share_code_with_dob(text, date, text) is
  'ADR-0070: the Documents hub''s New share code with the date of birth gov.uk matches it against. A changed date is checked first (dob_change_problem; at most settings.rtw_check.reenter_per_day claims in 24 h, too_many_attempts), then submit_document_upload(''share_code_report'', …) files the code exactly as before, then — only if that succeeded — the date is stored on that document (compliance_docs.claimed_dob) and audited as the worker (staff.dob_claimed_with_share_code). staff.dob is NOT written: it takes the date only when the office verifies the document. The caller''s own row only (staff_writer). Returns submit_document_upload()''s answer plus dobChanged.';

-- ---------------------------------------------------------------------
-- 8b · rtw_check_claim — 20260928100000 + the claimed date of birth
-- ---------------------------------------------------------------------
create or replace function public.rtw_check_claim(
  p_limit         int default 3,
  p_lease_seconds int default 600
) returns table (
  check_id           uuid,
  staff_id           uuid,
  document_id        uuid,
  attempt            int,
  max_attempts       int,
  share_code         text,
  date_of_birth      date,
  first_name         text,
  last_name          text,
  rtw_branch         text,
  below_degree_level boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  r        rtw_checks;
  d        compliance_docs;
  s        staff;
  v_limit  int := least(greatest(coalesce(p_limit, 3), 1), 20);
  v_lease  int := least(greatest(coalesce(p_lease_seconds, 600), 60), 3600);
  v_taken  int := 0;
begin
  if not rtw_check_enabled() then
    return;
  end if;

  for r in
    select c.* from rtw_checks c
     where (c.status = 'queued' and c.next_attempt_at <= now())
        or (c.status = 'running' and c.lease_until < now())
     order by c.next_attempt_at, c.created_at, c.id
     limit v_limit * 3
     for update skip locked
  loop
    exit when v_taken >= v_limit;

    select * into d from compliance_docs where id = r.compliance_doc_id;
    select * into s from staff where id = r.staff_id;
    if d.id is null or d.review_status <> 'pending' or d.share_code is null
       or s.status in ('rejected', 'removed') or s.removed_at is not null then
      update rtw_checks
         set status = 'failed', error = 'document_not_pending',
             lease_until = null, finished_at = now()
       where id = r.id;
      continue;
    end if;

    -- A runner that died mid-check still spent an attempt. Once they are
    -- all spent the office decides, as for any other failure.
    if r.status = 'running' and r.attempts >= r.max_attempts then
      update rtw_checks
         set status = 'needs_review',
             review_reason = format('The automatic check could not be completed after %s attempts (runner_stopped). Run it again, or check the share code on gov.uk by hand.', r.attempts),
             lease_until = null,
             finished_at = now()
       where id = r.id;
      update compliance_docs set needs_manual_review = true where id = d.id;
      continue;
    end if;

    update rtw_checks
       set status = 'running',
           attempts = r.attempts + 1,
           started_at = now(),
           lease_until = now() + make_interval(secs => v_lease)
     where id = r.id;
    v_taken := v_taken + 1;

    check_id := r.id;
    staff_id := r.staff_id;
    document_id := r.compliance_doc_id;
    attempt := r.attempts + 1;
    max_attempts := r.max_attempts;
    share_code := d.share_code;
    -- 20261001210000 (ADR-0070): the date the worker entered with this
    -- code, when it differs from the profile (submit_share_code_with_dob).
    date_of_birth := coalesce(d.claimed_dob, s.dob);
    first_name := s.first_name;
    last_name := s.last_name;
    rtw_branch := s.rtw_branch::text;
    below_degree_level := coalesce(s.below_degree_level, false);
    return next;
  end loop;
end $$;

comment on function public.rtw_check_claim(int, int) is
  'Service role only: lease up to p_limit due checks (queued and due, or running with a lapsed lease), skip locked; a check whose document has left review is failed instead. Returns the share code and DOB for this run only (ADR-0025) — the date the worker entered with the code (compliance_docs.claimed_dob) when there is one, else the profile''s (ADR-0070, 20261001210000). Nothing when the check is switched off.';

revoke execute on function public.rtw_check_claim(int, int) from public, anon, authenticated;
grant  execute on function public.rtw_check_claim(int, int) to service_role;

-- ---------------------------------------------------------------------
-- 8c · Verified → the profile takes the claimed date
--
-- A trigger, not a restated verify function: every path that verifies a
-- share code — compliance_verify_document(_as), the automatic path with
-- admin_confirms off, onboarding's verify — flips review_status, so this
-- catches all of them and none is rewritten. The actor is the reviewer.
-- A rejected, superseded or never-checked document changes nothing.
-- ---------------------------------------------------------------------
create or replace function public.compliance_docs_claimed_dob_verified()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_current date;
begin
  select dob into v_current from staff where id = new.staff_id;
  -- Checked again: the office may have corrected it since (unchanged), and
  -- a claim that no longer passes the rule is not written. Nothing here
  -- may stop the verification itself.
  if dob_change_problem(new.claimed_dob, v_current,
                        (now() at time zone 'Europe/London')::date) is null then
    perform staff_dob_apply(new.staff_id, new.claimed_dob, new.reviewed_by,
                            'staff.dob_corrected',
                            jsonb_build_object('source', 'share_code_verified',
                                               'documentId', new.id),
                            false);
  end if;
  return null;
end $$;

drop trigger if exists compliance_docs_claimed_dob_verified on compliance_docs;
create trigger compliance_docs_claimed_dob_verified
  after update of review_status on compliance_docs
  for each row
  when (new.doc_type = 'share_code_report'
        and new.review_status = 'verified'
        and old.review_status is distinct from 'verified'
        and new.claimed_dob is not null)
  execute function compliance_docs_claimed_dob_verified();

comment on function public.compliance_docs_claimed_dob_verified() is
  'ADR-0070: when a share code carrying claimed_dob is verified (any verify path), staff.dob takes that date through staff_dob_apply() — audited staff.dob_corrected, source share_code_verified, the reviewer as actor, optOutSignedUnder18 flagged — unless dob_change_problem() refuses it now (e.g. unchanged). A trigger function: not an RPC.';

revoke execute on function public.compliance_docs_claimed_dob_verified() from public, anon, authenticated;
revoke execute on function public.compliance_docs_claimed_dob_guard()    from public, anon, authenticated;
revoke execute on function public.staff_dob_guard()                     from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 8d · What the office sees beside the check: the date entered with a
--      pending share code, against the profile's — so it knows Verify
--      will also change the date of birth.
-- ---------------------------------------------------------------------
create or replace view share_code_dob_claims_v with (security_invoker = true) as
select
  d.id                                                   as document_id,
  d.staff_id,
  d.claimed_dob,
  s.dob                                                  as profile_dob,
  -- RULE-20: verifying would put a signed opt-out before the eighteenth
  -- birthday (staff_dob_apply flags it on the audit row when it happens).
  coalesce(s.wtr_optout, false)
    and s.wtr_optout_signed_at is not null
    and (d.claimed_dob + interval '18 years')::date
        > (s.wtr_optout_signed_at at time zone 'Europe/London')::date
                                                         as opt_out_signed_under_18
from compliance_docs d
join staff s on s.id = d.staff_id
where d.doc_type = 'share_code_report'
  and d.review_status = 'pending'
  and d.claimed_dob is not null
  and s.removed_at is null;

comment on view share_code_dob_claims_v is
  'ADR-0070: every pending share code whose worker entered a date of birth different from the profile''s, with both dates — Verify copies claimed_dob to staff.dob. security_invoker: the office reads it through admin_all; a worker sees only their own row.';

revoke all on share_code_dob_claims_v from public, anon;
grant select on share_code_dob_claims_v to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 9 · Route 3 — request_dob_change(): Request a change → Date of birth.
--     request_profile_change()'s gates (20260930206000), in its order.
-- ---------------------------------------------------------------------
create or replace function public.request_dob_change(
  p_dob           date,
  p_evidence_path text,
  p_note          text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id      uuid := staff_caller();
  s         staff;
  v_evid    text := nullif(btrim(coalesce(p_evidence_path, '')), '');
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_problem text;
  v_req     uuid;
  v_created timestamptz;
begin
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  select * into s from staff where id = v_id for update;
  if s.status = 'removed' then
    raise exception 'account_closed' using errcode = 'P0001';
  end if;
  -- As request_profile_change(): a worker with a profile to correct; a
  -- candidate still in the wizard re-enters it there, a leaver is frozen.
  if s.status not in ('compliant', 'blocked') then
    raise exception 'not_editable' using errcode = 'P0001';
  end if;
  -- §10.1 case 2: a manual hold has no profile actions.
  if s.status = 'blocked' and s.block_kind is not distinct from 'manual'::block_kind then
    raise exception 'not_editable' using errcode = 'P0001',
      hint = '§10.1 case 2: a manual hold has no profile actions.';
  end if;
  if exists (select 1 from profile_change_requests r
              where r.staff_id = v_id and r.kind = 'dob' and r.status = 'pending') then
    raise exception 'already_pending' using errcode = 'P0001',
      hint = 'ADR-0045: one pending request per kind. Withdraw it to ask again.';
  end if;
  -- At most three of a kind in any 24 hours, any status (RC1 flood guard).
  if (select count(*) from profile_change_requests r
       where r.staff_id = v_id and r.kind = 'dob'
         and r.created_at > now() - interval '24 hours') >= 3 then
    raise exception 'too_many_requests' using errcode = 'P0001',
      hint = 'At most three change requests of a kind in 24 hours (RC1 flood guard).';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'note_too_long' using errcode = 'P0001';
  end if;

  -- dobChangeProblem() in packages/domain.
  v_problem := dob_change_problem(p_dob, s.dob, (now() at time zone 'Europe/London')::date);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = 'P0001';
  end if;
  if v_evid is null then
    raise exception 'evidence_required' using errcode = 'P0001',
      hint = 'ADR-0070: a date of birth change needs evidence, as a name does.';
  end if;
  select e.problem into v_problem
    from evidence_upload_problem(v_id, 'change-requests', v_evid) e;
  if v_problem is not null then
    raise exception '%', v_problem using errcode = 'P0001';
  end if;

  begin
    insert into profile_change_requests (staff_id, kind, proposed_dob, evidence_path, worker_note)
    values (v_id, 'dob', p_dob, v_evid, v_note)
    returning id, created_at into v_req, v_created;
  exception when unique_violation then
    raise exception 'already_pending' using errcode = 'P0001';
  end;

  -- RC1, the register's placeholders exactly; {field} is the worker-facing
  -- word, as RC2 and RC3 carry it.
  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values ('RC1:request:' || v_req, 'email', 'RC1',
          array['admin@thehospitalitycompany.co.uk'],
          jsonb_build_object(
            'name',        s.first_name || ' ' || s.last_name,
            'employeeId',  coalesce(s.employee_id::text, '(not yet issued)'),
            'field',       'date of birth',
            'requestedAt', to_char(v_created at time zone 'Europe/London', 'DD Mon YYYY HH24:MI'),
            'current',     coalesce(to_char(s.dob, 'DD Mon YYYY'), '—'),
            'proposed',    to_char(p_dob, 'DD Mon YYYY'),
            'note',        coalesce(v_note, '—')))
  on conflict (key) do nothing;

  return jsonb_build_object('ok', true, 'id', v_req);
end $$;

comment on function public.request_dob_change(date, text, text) is
  'ADR-0070: the calling worker asks the office to change their date of birth — a kind ''dob'' profile_change_requests row with proposed_dob and evidence in documents/<id>/change-requests/ (required). request_profile_change()''s gates: compliant, or blocked on documents or a conviction review (not a manual hold); one pending, at most three in 24 h; note ≤ 500. The date must pass dob_change_problem(). Queues RC1 to admin@ with {field} = date of birth. Never writes staff.';

-- ---------------------------------------------------------------------
-- 10 · office_decide_profile_change — 20260930206000 + the dob branch
-- ---------------------------------------------------------------------
create or replace function public.office_decide_profile_change(
  p_id      uuid,
  p_approve boolean,
  p_reason  text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r         profile_change_requests;
  s         staff;
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_field   text;
  v_prev    jsonb;
  v_now     timestamptz := now();
  -- 20261001210000 (ADR-0070): the date-of-birth branch.
  v_problem text;
  v_extra   jsonb := '{}'::jsonb;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'decision_required' using errcode = '22023';
  end if;

  select * into r from profile_change_requests where id = p_id for update;
  if r.id is null then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  -- 20261001210000 (ADR-0070): a date of birth is corrected by an owner or
  -- a manager only — the office_correct_dob() gate — and a request for one
  -- is decided by the same people, either way. A viewer is read-only
  -- (ADR-0060) and is told so first.
  if r.kind = 'dob' then
    perform assert_not_read_only();
    if not office_can('identity') then
      raise exception 'not_permitted' using errcode = '42501', detail = 'identity';
    end if;
  end if;
  if r.status <> 'pending' then
    raise exception 'already_decided' using errcode = 'P0001',
      hint = 'ADR-0045: approved, rejected and withdrawn are terminal. "Request again" is a new row.';
  end if;

  -- decisionNeedsReason(approve) in packages/domain: a rejection says why,
  -- and the worker reads it (RC3, "Not changed: {reason}").
  if not p_approve and v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 300 then
    raise exception 'reason_too_long' using errcode = '22023';
  end if;

  select * into s from staff where id = r.staff_id for update;
  -- The worker-facing word for {field}: "Your name has been updated."
  v_field := case r.kind when 'name' then 'name'
                         when 'dob'  then 'date of birth'
                         else 'photo' end;

  if not p_approve then
    update profile_change_requests
       set status = 'rejected',
           decision_reason = v_reason,
           decided_at = v_now,
           decided_by = auth.uid(),
           previous_value = case r.kind
             when 'name' then jsonb_build_object('firstName', s.first_name, 'lastName', s.last_name)
             when 'dob'  then jsonb_build_object('dob', s.dob)
             else jsonb_build_object('photoPath', s.photo_path) end
     where id = r.id;

    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    values ('RC3:request:' || r.id, 'push', 'RC3', r.staff_id,
            jsonb_build_object('field', v_field, 'reason', v_reason))
    on conflict (key) do nothing;

    insert into audit_log (at, actor, action, entity, entity_id, data)
    values (v_now, auth.uid(), 'profile_change.reject', 'staff', r.staff_id,
            jsonb_build_object('requestId', r.id, 'kind', r.kind));

    return jsonb_build_object('ok', true, 'status', 'rejected', 'kind', r.kind);
  end if;

  if r.kind = 'name' then
    v_prev := jsonb_build_object('firstName', s.first_name, 'lastName', s.last_name);

    -- The name the right-to-work check and payroll know the worker by.
    -- No automatic right-to-work re-check (Q13); nothing already issued
    -- is rewritten (§1.7) — RC4 tells payroll instead.
    update staff
       set first_name = r.proposed_first_name,
           last_name  = r.proposed_last_name
     where id = r.staff_id;

    insert into notification_outbox (key, channel, template, recipient_emails, payload)
    values ('RC4:request:' || r.id, 'email', 'RC4',
            array['admin@thehospitalitycompany.co.uk', 'thc_payroll@topsourceworldwide.com'],
            jsonb_build_object(
              'name',         r.proposed_first_name || ' ' || r.proposed_last_name,
              'employeeId',   coalesce(s.employee_id::text, '(not yet issued)'),
              'previousName', s.first_name || ' ' || s.last_name,
              'approvedAt',   to_char(v_now at time zone 'Europe/London', 'DD Mon YYYY HH24:MI')))
    on conflict (key) do nothing;
  elsif r.kind = 'dob' then
    v_prev := jsonb_build_object('dob', s.dob);

    -- 20261001210000 (ADR-0070): the office correction's effect, through
    -- the same helper — staff.dob, the staff.dob_corrected audit row, and
    -- a fresh gov.uk check of a pending share code. The rule is checked
    -- again against the profile NOW: the office may have corrected it
    -- since the worker asked (unchanged), and 18+ is today's question.
    v_problem := dob_change_problem(r.proposed_dob, s.dob,
                                    (v_now at time zone 'Europe/London')::date);
    if v_problem is not null then
      raise exception '%', v_problem using errcode = 'P0001';
    end if;
    v_extra := staff_dob_apply(r.staff_id, r.proposed_dob, auth.uid(), 'staff.dob_corrected',
                               jsonb_build_object('source', 'change_request', 'requestId', r.id),
                               true)
               - array['ok', 'dob', 'previousDob'];
  else
    v_prev := jsonb_build_object('photoPath', s.photo_path);

    -- §10.1's lock is on the WORKER's path (staff_set_photo refuses a
    -- second photo); the office's decision is the route through it. The
    -- old object is left where it is — purged with the prefix on GDPR
    -- removal, and still what already-issued allocation sheets printed.
    update staff set photo_path = r.proposed_photo_path where id = r.staff_id;
  end if;

  update profile_change_requests
     set status = 'approved',
         decided_at = v_now,
         decided_by = auth.uid(),
         applied_at = v_now,
         previous_value = v_prev
   where id = r.id;

  insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
  values ('RC2:request:' || r.id, 'push', 'RC2', r.staff_id,
          jsonb_build_object('field', v_field))
  on conflict (key) do nothing;

  -- The request row holds the values (and is anonymised on GDPR removal);
  -- the audit row records the decision, who made it and which request.
  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (v_now, auth.uid(), 'profile_change.approve', 'staff', r.staff_id,
          jsonb_build_object('requestId', r.id, 'kind', r.kind));

  return jsonb_build_object('ok', true, 'status', 'approved', 'kind', r.kind) || v_extra;
end $$;

comment on function public.office_decide_profile_change(uuid, boolean, text) is
  'ADR-0045, ADR-0070: the office approves or rejects a pending name/photo/date-of-birth change request (/staff/requests). Admin only; a dob request owners and managers only (office_can(''identity''); a viewer read_only). Approve name → staff.first_name/last_name + RC2 + RC4 (admin@ + payroll); approve photo → staff.photo_path despite the §10.1 lock, old object kept; approve dob → dob_change_problem() re-checked, then office_correct_dob()''s effect (staff.dob, staff.dob_corrected audit, a fresh gov.uk check of a pending share code — rtwCheck in the result) + RC2; reject → reason required (reason_required 22023, ≤ 300) + RC3. RC2/RC3 carry {field} (name | photo | date of birth). previous_value snapshots the profile at the decision; already_decided refuses a second decision; audit_log profile_change.approve|reject. A name change starts no right-to-work re-check (Q13); issued PDFs and payroll exports untouched (§1.7).';

-- ---------------------------------------------------------------------
-- 11 · staff_me — 20260928110700 + 'dob'
-- ---------------------------------------------------------------------
create or replace function public.staff_me()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  s staff;
  v_blockers text[];
  v_checked_in boolean;
  v_roles text[];
  v_bank jsonb;
begin
  if v_id is null then
    return null;
  end if;

  select * into s from staff where id = v_id;
  if s.id is null then
    return null;
  end if;

  select coalesce(array_agg(reason), '{}') into v_blockers
    from compliance_blockers(v_id, (now() at time zone 'Europe/London')::date);

  select exists (
    select 1
      from bookings b
      join shift_requirements sr on sr.id = b.shift_id
      join check_logs cl         on cl.booking_id = b.id
     where b.staff_id = v_id
       and b.cancelled_at is null
       and cl.check_in_at is not null
       and cl.check_out_at is null
       and now() < sr.ends_at + interval '4 hours'
  ) into v_checked_in;

  select coalesce(array_agg(r.name order by r.name), '{}') into v_roles
    from staff_roles sr join roles r on r.id = sr.role_id
   where sr.staff_id = v_id;

  select jsonb_build_object(
           'accountHolder', b.account_holder,
           'sortCode',      b.sort_code,
           'accountNumber', b.account_number,
           'updatedAt',     b.updated_at)
    into v_bank
    from bank_details b where b.staff_id = v_id;

  return jsonb_build_object(
    'staffId',        s.id::text,
    'firstName',      s.first_name,
    'lastName',       s.last_name,
    'employeeId',     s.employee_id,
    'email',          s.email,
    'phone',          s.phone,
    'homeAddress',    s.home_address,
    'photoPath',      s.photo_path,
    'photoLocked',    s.photo_path is not null,
    'status',         s.status::text,
    -- The KIND of manual block, never its reason (§10.1).
    'blockKind',      s.block_kind::text,
    -- The CAUSE of a rejection, never the office's reason (ADR-0017).
    'rejectionCause', s.rejection_cause,
    'leftAt',         s.left_at,
    'rtwBranch',      s.rtw_branch::text,
    'niMasked',       case
                        when s.ni_number is null then null
                        else repeat('●', greatest(length(s.ni_number) - 2, 0))
                             || right(s.ni_number, 2)
                      end,
    'hasNiNumber',    s.ni_number is not null,
    -- 20261001210000 (ADR-0070): Profile details shows it locked, with
    -- Request a change; the worker's own date, nobody else's.
    'dob',            s.dob,
    'rating',         s.rating,
    -- §10.1 "Show-rate 97%" pill: the derived §6 figure (20260928110700);
    -- null with no history, and the sheet hides the pill.
    'reliability',    staff_show_rate(v_id),
    'quizAttempts',   s.quiz_attempts,
    'roles',          to_jsonb(v_roles),
    'blockers',       to_jsonb(v_blockers),
    'checkedIn',      v_checked_in,
    'bank',           v_bank);
end $$;

comment on function public.staff_me() is
  'The worker''s own profile for the §10.1 profile sheet, plus the app-lock inputs. Never returns block_reason or rejection_reason; rejectionCause (willo / manager / quiz_failed) decides which terminal screen shows. reliability is staff_show_rate() since 20260928110700, null with no history. dob since 20261001210000: Profile details shows it locked (ADR-0070).';

-- ---------------------------------------------------------------------
-- 12 · The two reads gain the date — appended columns, so drop + create.
-- ---------------------------------------------------------------------
drop function if exists public.my_profile_change_requests();
create or replace function public.my_profile_change_requests()
returns table (
  id                  uuid,
  kind                text,
  status              text,
  proposed_first_name text,
  proposed_last_name  text,
  proposed_photo_path text,
  worker_note         text,
  decision_reason     text,
  created_at          timestamptz,
  decided_at          timestamptz,
  -- 20261001210000 (ADR-0070), appended.
  proposed_dob        date
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  v_status staff_status;
begin
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  select s.status into v_status from staff s where s.id = v_id;
  if v_status = 'removed' then
    raise exception 'account_closed' using errcode = 'P0001';
  end if;

  return query
    select r.id, r.kind, r.status, r.proposed_first_name, r.proposed_last_name,
           r.proposed_photo_path, r.worker_note, r.decision_reason,
           r.created_at, r.decided_at, r.proposed_dob
      from profile_change_requests r
     where r.staff_id = v_id
     order by r.created_at desc, r.id;
end $$;

comment on function public.my_profile_change_requests() is
  'ADR-0045: the calling worker''s own change requests, newest first, with the office''s reason on a rejection (shown to the worker). proposed_dob for a date-of-birth request (ADR-0070). Never returns decided_by, previous_value or evidence_path.';

drop function if exists public.office_profile_change_requests(uuid, boolean, int);
create or replace function public.office_profile_change_requests(
  p_staff   uuid default null,
  p_decided boolean default false,
  p_limit   int default 200
) returns table (
  id                  uuid,
  staff_id            uuid,
  kind                text,
  status              text,
  display_name        text,
  employee_id         int,
  removed             boolean,
  staff_status        text,
  rtw_branch          text,
  right_to_work_until date,
  current_first_name  text,
  current_last_name   text,
  current_photo_path  text,
  proposed_first_name text,
  proposed_last_name  text,
  proposed_photo_path text,
  evidence_path       text,
  worker_note         text,
  previous_value      jsonb,
  created_at          timestamptz,
  decided_at          timestamptz,
  decided_by_name     text,
  decision_reason     text,
  -- 20261001210000 (ADR-0070), appended; null for a removed worker.
  current_dob         date,
  proposed_dob        date
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  return query
  select r.id, r.staff_id, r.kind, r.status,
         case when s.removed_at is not null then deleted_account_label(s.employee_id)
              else s.first_name || ' ' || s.last_name end,
         s.employee_id,
         s.removed_at is not null,
         s.status::text,
         s.rtw_branch::text,
         s.right_to_work_until,
         case when s.removed_at is null then s.first_name end,
         case when s.removed_at is null then s.last_name end,
         case when s.removed_at is null then s.photo_path end,
         r.proposed_first_name, r.proposed_last_name,
         case when s.removed_at is null then r.proposed_photo_path end,
         case when s.removed_at is null then r.evidence_path end,
         r.worker_note, r.previous_value, r.created_at, r.decided_at,
         p.full_name,
         r.decision_reason,
         case when s.removed_at is null then s.dob end,
         case when s.removed_at is null then r.proposed_dob end
    from profile_change_requests r
    join staff s on s.id = r.staff_id
    left join profiles p on p.id = r.decided_by
   where (p_staff is null or r.staff_id = p_staff)
     and (case when p_decided then r.status <> 'pending' else r.status = 'pending' end)
   order by case when p_decided then null else r.created_at end asc,
            r.decided_at desc nulls last,
            r.created_at desc
   limit greatest(1, least(coalesce(p_limit, 200), 500));
end $$;

comment on function public.office_profile_change_requests(uuid, boolean, int) is
  'ADR-0045: the /staff/requests queue — pending oldest first, or decided newest first — optionally for one worker (the /staff/:id banner). Admin only. Names the decider (profiles.full_name, which an admin cannot read directly). A removed worker reads "Deleted account #id" with no photo, evidence path or date of birth. current_dob / proposed_dob appended by 20261001210000 (ADR-0070).';

-- ---------------------------------------------------------------------
-- 13 · Privileges
-- ---------------------------------------------------------------------
revoke execute on function public.dob_change_problem(date, date, date)                   from public, anon, authenticated;
revoke execute on function public.staff_dob_apply(uuid, date, uuid, text, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.office_correct_dob(uuid, date, text)                   from public, anon;
revoke execute on function public.submit_share_code_with_dob(text, date, text)           from public, anon;
revoke execute on function public.request_dob_change(date, text, text)                   from public, anon;
revoke execute on function public.office_decide_profile_change(uuid, boolean, text)      from public, anon;
revoke execute on function public.staff_me()                                             from public, anon;
revoke execute on function public.my_profile_change_requests()                           from public, anon;
revoke execute on function public.office_profile_change_requests(uuid, boolean, int)     from public, anon;

-- Each checks its caller in its own body: the office (office_correct_dob,
-- the decision, the queue) or the worker themself (the other four).
grant execute on function public.office_correct_dob(uuid, date, text)                    to authenticated;
grant execute on function public.submit_share_code_with_dob(text, date, text)            to authenticated;
grant execute on function public.request_dob_change(date, text, text)                    to authenticated;
grant execute on function public.office_decide_profile_change(uuid, boolean, text)       to authenticated;
grant execute on function public.staff_me()                                              to authenticated;
grant execute on function public.my_profile_change_requests()                            to authenticated;
grant execute on function public.office_profile_change_requests(uuid, boolean, int)      to authenticated;
