-- =====================================================================
-- The database half of the 26.09 "shared_change_needed" deferrals
--
-- Two screen fixers shipped their app halves against columns and fields
-- the database did not carry yet, and left fallbacks with a note at each
-- site. This closes those notes. Four objects are restated — the two
-- office views, staff_me() and activation_preview() — each from its
-- latest body, with the new columns APPENDED (create or replace view can
-- only add at the end) and nothing else moved:
--
--   onboarding_candidates_v  (20260924160000)
--     activated_at            when the login was activated — the
--                             confirmation stamp GoTrue writes when the
--                             one-time link is verified, shown only once
--                             the password exists (staff_account_activated
--                             is that predicate), read through a definer
--                             helper because auth.users is not readable
--                             by `authenticated`.
--     additional_info_done_at ADR-0013: Additional info is a derived
--                             column, not a status, so nothing re-stamps
--                             stage_entered_at when the card moves to
--                             Contract. This is that moment — the last of
--                             the three wizard stamps (steps 7-9: HMRC,
--                             references, bank), null while any is
--                             missing. The board counts the Contract
--                             card's age from it.
--     quiz_scores             every attempt's percentage this period, in
--                             attempt order, for "Attempts 65% · 75% ·
--                             70%" on the quiz-failed card (§2.9). Same
--                             period predicate as the three quiz columns
--                             beside it.
--
--   staff_directory_v        (20260923090000)
--     weekly_cap_until        the Sunday the current cap band holds until
--                             (§4.4, §9.6 "20 h — term time until
--                             13.12.2026"). Asked only of the three
--                             calendar-driven bands, exactly as N14 does
--                             (20260924130200): graduated_48, standard_48
--                             and uncapped have no end and read null.
--     last_shift_at           the end of the worker's last worked shift —
--                             the same reading request_p45() puts in E8
--                             as lastShiftDate.
--     released_shift_count    how many CONFIRMED shifts the system took
--                             back from the worker. Product decision,
--                             recorded here: "released" in the scope is
--                             always the system releasing a slot the
--                             worker held — the 12:05 cutoff (§3.6), a
--                             compliance block (§4.3), leaving (§10.6),
--                             GDPR removal (§1.7). So cancel_cause in
--                             ('ready_cutoff', 'left', 'blocked', 'gdpr').
--                             NOT self_cancel (the worker's own choice, and
--                             a RULE-04 matter), NOT office_withdraw or
--                             event_cancelled (nothing was released FROM
--                             the worker), NOT overlap_auto_withdraw (the
--                             scope calls that an auto-withdraw), and none
--                             of the *_invite halves — an invitation is not
--                             a shift held (§3.4). For a leaver this is the
--                             number E8 listed, which is what the Inactive
--                             tab's "Released shifts" column shows.
--     p45_requested_at        §10.6: the request is "the trigger and the
--                             audit record" and left_at is where
--                             request_p45() stamps it (20260921192246 keeps
--                             it through Reset to candidate for that
--                             reason). Exposed only while the row is
--                             inactive — a candidate who once left is not
--                             owed a P45 by their onboarding card.
--
--   staff_me()               (20260922180000)
--     rejectionCause          staff.rejection_cause — willo / manager /
--                             quiz_failed — which decides the §10.1 lock
--                             screen (E4's wording for a failed quiz, a
--                             neutral screen otherwise). rejection_reason
--                             is internal (ADR-0017, 20260923220000) and is
--                             still not selected.
--
--   activation_preview()     (20260923180000)
--     activated               true when the account behind the token
--                             already has a password: the link is spent
--                             and /activate/:token shows "You're already
--                             activated" instead of a form that would fail
--                             on submit.
--
-- ADR-0004 holds throughout: both views stay security_invoker with no
-- client policy behind them (a client sees no rows), grants are unchanged,
-- every function keeps its search_path pin and its revoke from public and
-- anon. pgTAP: supabase/tests/595_deferred_view_columns_26_09.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0 · staff_account_activated_at — the sibling of staff_account_activated
--
-- Same gate, same reasoning (20260924110000 §0): auth.users is not
-- readable by `authenticated`, so a definer function answers the office,
-- the service role and the person themselves, and nobody else (null).
-- The stamp is email_confirmed_at, which GoTrue writes when the one-time
-- link is verified (apps/staff/app/activate/actions.ts: verifyOtp, then
-- updateUser({ password })). Null until the password exists, so an
-- account confirmed but never activated does not read as activated on a
-- date.
-- ---------------------------------------------------------------------
create or replace function public.staff_account_activated_at(p_staff uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case
    when current_app_role() = 'admin'
      or auth.role() = 'service_role'
      or exists (select 1 from staff s where s.id = p_staff and s.user_id = (select auth.uid()))
    then (select case when coalesce(u.encrypted_password, '') <> '' then u.email_confirmed_at end
            from staff s join auth.users u on u.id = s.user_id
           where s.id = p_staff)
  end
$$;

comment on function public.staff_account_activated_at(uuid) is
  '§2.7: when the person''s login was activated — GoTrue''s email_confirmed_at, shown only once the login has a password (the same predicate as staff_account_activated). Null for a caller who is not the office, the service role or the person.';

revoke execute on function public.staff_account_activated_at(uuid) from public, anon;
grant  execute on function public.staff_account_activated_at(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1 · onboarding_candidates_v — 20260924160000's body, three columns
--     appended
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
  -- §2.9 / ADR-0017: the office's free-text reason for rejecting a
  -- candidate is internal. E2 and E2b never carry it, and this view runs
  -- with the caller's privileges, so it is read through the owner-rights
  -- sub-view rather than off `s` — the caller no longer holds the column.
  (select r.rejection_reason from public.staff_rejection_reason_v r
    where r.staff_id = s.id)                                   as rejection_reason,
  p.full_name                                                                      as rejected_by_name,
  -- ---- appended 20260927170000 ----------------------------------------
  -- §2.7: the date beside "activated" on the Documents card and the
  -- "Activated dd.mm.yyyy (E3)" fact on the profile.
  staff_account_activated_at(s.id)                                                 as activated_at,
  -- ADR-0013: the derived move from Additional info to Contract, dated.
  -- The three wizard stamps are written only by the onboarding_* definer
  -- functions (20260923120200), one per step, so the latest of them is
  -- when the phase completed; null while any step is still open.
  (select case when p.hmrc_at is not null and p.references_at is not null and p.bank_at is not null
               then greatest(p.hmrc_at, p.references_at, p.bank_at) end
     from onboarding_progress p where p.staff_id = s.id)                           as additional_info_done_at,
  -- §2.9: every attempt this period, in attempt order. score is already a
  -- whole percentage (floor(correct * 100 / total), 20260923120100).
  coalesce((select array_agg(round(q.score)::int order by q.attempt_no) from quiz_attempts q
             where q.staff_id = s.id and q.taken_at >= s.onboarding_started_at),
           '{}'::int[])                                                             as quiz_scores
from staff s
left join profiles p on p.id = s.rejected_by
where s.removed_at is null;

comment on view onboarding_candidates_v is
  'The §2.3 onboarding board row. security_invoker, so `staff`''s own RLS decides which candidates a caller sees. rejection_reason is read through the owner-rights staff_rejection_reason_v: §2.9''s reason is the office''s and ADR-0017 keeps it out of every rejection email. activated_at, additional_info_done_at and quiz_scores appended 20260927170000.';

revoke all on onboarding_candidates_v from public, anon;
grant select on onboarding_candidates_v to authenticated;

-- ---------------------------------------------------------------------
-- 2 · staff_directory_v — 20260923090000's body, four columns appended
-- ---------------------------------------------------------------------
create or replace view public.staff_directory_v with (security_invoker = true) as
select
  s.id,
  s.employee_id,
  s.status,
  s.removed_at is not null                                   as removed,
  case
    when s.removed_at is not null then deleted_account_label(s.employee_id)
    else s.first_name || ' ' || s.last_name
  end                                                        as display_name,
  case when s.removed_at is null then s.photo_path end       as photo_path,
  s.rating,
  s.reliability,
  s.block_kind,
  -- The reason for a manual block is internal and is never shown to the
  -- worker (§10.1), but the office sees it first when deciding to
  -- unblock. It is read through staff_block_reason_v rather than off
  -- `s`, because this view runs with the caller's privileges and the
  -- caller — admin or worker, both `authenticated` — no longer holds the
  -- column. The sub-view carries the admin gate and §1.7's suppression.
  br.block_reason                                            as block_reason,
  s.rtw_branch,
  s.right_to_work_until,
  s.graduated_at,
  s.wtr_optout,
  s.left_at,
  case when s.removed_at is null then s.leave_reason end     as leave_reason,
  coalesce(
    (select array_agg(r.name order by r.name)
       from staff_roles sr join roles r on r.id = sr.role_id
      where sr.staff_id = s.id),
    '{}'::text[]
  )                                                          as role_names,
  (select count(*) from violations v
    where v.staff_id = s.id and not v.resolved)::int          as unresolved_violations,
  coalesce(
    (select array_agg(distinct c.name order by c.name)
       from client_qualifications q join clients c on c.id = q.client_id
      where q.staff_id = s.id and q.do_not_return),
    '{}'::text[]
  )                                                          as do_not_return_clients,
  weekly_cap_hours(s.id, (now() at time zone 'Europe/London')::date)   as weekly_cap_hours,
  weekly_cap_band(s.id, (now() at time zone 'Europe/London')::date)    as weekly_cap_band,
  weekly_booked_hours(s.id, (now() at time zone 'Europe/London')::date) as weekly_booked_hours,
  -- ---- appended 20260927170000 ----------------------------------------
  -- §9.6 / §4.4: the Sunday the band holds until, for the three bands the
  -- term calendar moves (N14 asks the same question, 20260924130200).
  -- graduated_48, standard_48 and uncapped have no end: null.
  case
    when weekly_cap_band(s.id, (now() at time zone 'Europe/London')::date)
         in ('student_term_10', 'student_term_20', 'student_holiday_48')
      then cap_band_until(s.term_dates, (now() at time zone 'Europe/London')::date)
  end                                                        as weekly_cap_until,
  -- §10.6: the end of the last shift actually worked — E8's lastShiftDate.
  (select max(sr.ends_at)
     from bookings b join shift_requirements sr on sr.id = b.shift_id
    where b.staff_id = s.id and b.status = 'worked')          as last_shift_at,
  -- Confirmed shifts the system released from this worker (header).
  (select count(*) from bookings b
    where b.staff_id = s.id
      and b.status = 'cancelled'
      and b.cancel_cause in ('ready_cutoff', 'left', 'blocked', 'gdpr'))::int as released_shift_count,
  -- §10.6: when the P45 was asked for, while the row is a leaver's.
  case when s.status = 'inactive' then s.left_at end         as p45_requested_at
from staff s
left join staff_block_reason_v br on br.staff_id = s.id;

comment on view public.staff_directory_v is
  '§9.6 directory row. security_invoker; §1.7 anonymisation applied here; block_reason through the owner-rights staff_block_reason_v (§10.1). weekly_cap_until, last_shift_at, released_shift_count and p45_requested_at appended 20260927170000 for the Inactive tab and the "Limit reached … until" line.';

revoke all on public.staff_directory_v from public, anon;
grant select on public.staff_directory_v to authenticated;

-- ---------------------------------------------------------------------
-- 3 · staff_me() — 20260922180000's body, rejectionCause added
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
    'rating',         s.rating,
    'reliability',    s.reliability,
    'quizAttempts',   s.quiz_attempts,
    'roles',          to_jsonb(v_roles),
    'blockers',       to_jsonb(v_blockers),
    'checkedIn',      v_checked_in,
    'bank',           v_bank);
end $$;

comment on function public.staff_me() is
  'The worker''s own profile for the §10.1 profile sheet, plus the app-lock inputs. Never returns block_reason or rejection_reason; rejectionCause (willo / manager / quiz_failed) decides which terminal screen shows.';

revoke execute on function public.staff_me() from public, anon;
grant  execute on function public.staff_me() to authenticated;

-- ---------------------------------------------------------------------
-- 4 · activation_preview() — 20260923180000's body, `activated` added
-- ---------------------------------------------------------------------
create or replace function public.activation_preview(p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v jsonb;
begin
  -- The token columns default to '' — an empty or short argument must
  -- never match every account that has no pending token.
  if coalesce(p_token_hash, '') !~ '^[A-Za-z0-9_-]{32,200}$' then
    return null;
  end if;

  select jsonb_build_object(
           'firstName', s.first_name,
           'lastName',  s.last_name,
           'email',     u.email,
           -- §2.7 "the link is personal and single-use": a password already
           -- set means the link is spent, and the page says so instead of
           -- offering a form that verifyOtp would refuse on submit.
           'activated', coalesce(u.encrypted_password, '') <> '')
    into v
    from auth.users u
    join staff s on s.user_id = u.id
   where (u.confirmation_token = p_token_hash or u.recovery_token = p_token_hash)
     and s.removed_at is null
   limit 1;

  return v;
end $$;

comment on function public.activation_preview(text) is
  '§2.7 /activate/:token greeting: first name, last name, email and `activated` (the login already has a password — the link is spent) of the staff account whose pending one-time token this is, or null. Read-only — does not consume or verify the token. Service role only.';

revoke execute on function public.activation_preview(text) from public, anon, authenticated;
grant  execute on function public.activation_preview(text) to service_role;
