-- =====================================================================
-- Onboarding board: stop scanning the whole outbox once per candidate
--
-- /onboarding calls onboarding_chaser_state() on every load (and every
-- 30 s auto-refresh), which runs onboarding_chaser_candidates(). That
-- function looked up each candidate's reminders with
--
--     o.key like 'E3:%:<id>:%'                       (leading wildcard)
--     o.key like 'OC3:staff:<id>:<epoch>:%'          (prefix, but a
--                                                     per-row pattern)
--
-- Neither can use the unique index on `key`: the first has no usable
-- prefix and the second is a join-dependent LIKE under a non-C collation.
-- So every candidate cost a sequential scan of notification_outbox, which
-- gains a row per chased candidate per day and never shrinks. Measured on
-- 500k outbox rows / 300 candidates: the ladder lookup 13.7 s, the E3
-- lookup 0.27 s per page load.
--
-- Same rows, found by index: an index on key in the "C" collation, and the
-- lookups written as anchored ranges on it. Every key the outbox holds for
-- these templates is `<prefix>:<digits>`, so `prefix || ':'` .. `prefix ||
-- ':~'` ('~' sorts after a digit) is exactly the set the LIKEs matched. E3
-- has exactly two shapes — E3:staff:<id>:<epoch> (Accept) and
-- E3:resend:<id>:<n> (Resend) — named here instead of a wildcard.
--
-- Result, output and grants are unchanged; 394_onboarding_chasers.sql
-- is the behavioural pin.
-- =====================================================================

create index if not exists notification_outbox_key_c_idx
  on notification_outbox ((key collate "C"));

create or replace function public.onboarding_chaser_candidates(p_now timestamptz default now())
returns table (
  staff_id     uuid,
  track        text,         -- interview | activation | app
  template     text,         -- OC1 | OC2 | OC3
  step_no      integer,      -- the wizard step (app track), else null
  step         text,         -- the words the push uses for it
  progress_at  timestamptz,  -- the candidate's last progress
  epoch        bigint,       -- progress_at as the key's ladder id
  rungs_sent   integer,      -- reminders sent since the last progress
  last_sent_at timestamptz,  -- when the latest rung went into the outbox
  due_rung     integer,      -- the rung to queue now, or null
  next_due_at  timestamptz,  -- when the next reminder falls due
  last_failed  boolean       -- the latest rung could not be delivered (no push subscription, a bounce)
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with cfg as (
    select make_interval(days => (c ->> 'every_days')::int) as every
      from onboarding_chaser_config() c
  ),
  base as (
    select s.id, s.status, s.stage_entered_at, s.onboarding_started_at,
           s.willo_invited_at, s.willo_completed_at, s.contract_signed_at,
           s.user_id, s.email,
           coalesce(u.encrypted_password, '') <> ''                     as activated,
           -- link_staff_account()'s own test: the login is this candidate's
           -- address and a worker's. An office edit to staff.email on a linked
           -- login must never route a freshly minted link somewhere else.
           lower(btrim(coalesce(u.email, ''))) = lower(btrim(s.email))
             and u.raw_app_meta_data ->> 'role' = 'staff'                 as login_is_theirs,
           u.email_confirmed_at,
           p.rtw_at, p.address_at, p.selfie_at, p.documents_at, p.induction_at,
           p.hmrc_at, p.references_at, p.bank_at, p.updated_at            as progress_updated_at,
           -- A rejected completion letter is optional (it never holds Submit
           -- or the quiz gate up), so it is not the candidate's move.
           (select count(*) from current_compliance_docs(s.id) d
             where d.status = 'rejected'
               and d.doc_type <> 'university_completion_letter')::int     as docs_rejected
      from staff s
      left join auth.users u          on u.id = s.user_id
      left join onboarding_progress p on p.staff_id = s.id
     where s.removed_at is null
       and s.status in ('interview_requested', 'documents', 'quiz', 'contract')
  ),
  tracked as (
    -- OC1: Willo has sent the invitation (E1) and no answers are in yet.
    -- A candidate not yet created in Willo has no interview to be chased
    -- for, so willo_invited_at must be set.
    select b.id, 'interview'::text as track, 'OC1'::text as template,
           null::int as step_no, null::text as step,
           greatest(b.stage_entered_at, b.willo_invited_at) as progress_at
      from base b
     where b.status = 'interview_requested'
       and b.willo_invited_at is not null
       and b.willo_completed_at is null
    union all
    -- OC2: accepted, this period's activation email has gone out, no
    -- password yet. An E3 of this period still queued means they have not
    -- had it: nothing to remind them of (and a mint would kill its link).
    select b.id, 'activation', 'OC2', null, null,
           greatest(b.stage_entered_at, e3.last_e3)
      from base b
      cross join lateral (
        select max(o.sent_at)                                     as last_e3,
               coalesce(bool_or(o.sent_at is null and o.failed_at is null), false) as e3_queued
          from notification_outbox o
         where o.template = 'E3'
           and (   (o.key collate "C" >= 'E3:staff:'  || b.id::text || ':'
                    and o.key collate "C" <  'E3:staff:'  || b.id::text || ':~')
                or (o.key collate "C" >= 'E3:resend:' || b.id::text || ':'
                    and o.key collate "C" <  'E3:resend:' || b.id::text || ':~'))
           and o.queued_at >= b.onboarding_started_at
      ) e3
     where b.status = 'documents'
       and b.user_id is not null
       and not b.activated
       and b.login_is_theirs
       and e3.last_e3 is not null
       and not e3.e3_queued
    union all
    -- OC3: signed up, and a wizard step is theirs to do.
    select b.id, 'app', 'OC3', w.step_no, w.step,
           greatest(b.stage_entered_at, b.email_confirmed_at, b.progress_updated_at,
                    act.last_act)
      from base b
      cross join lateral (
        select case
          when b.status = 'documents' and b.rtw_at is null       then 1
          when b.status = 'documents' and b.address_at is null   then 2
          when b.status = 'documents' and b.selfie_at is null    then 3
          when b.status = 'documents' and b.documents_at is null then 4
          when b.status = 'documents' and b.docs_rejected > 0    then 40   -- re-upload
          when b.status = 'quiz'      and b.induction_at is null then 5
          when b.status = 'quiz'                                  then 6
          when b.status = 'contract'  and b.hmrc_at is null       then 7
          when b.status = 'contract'  and b.references_at is null then 8
          when b.status = 'contract'  and b.bank_at is null       then 9
          when b.status = 'contract'  and b.contract_signed_at is null then 10
        end as code
      ) k
      cross join lateral (
        select case when k.code = 40 then 4 else k.code end as step_no,
               case k.code
                 when 1  then 'your right-to-work details'
                 when 2  then 'your home address'
                 when 3  then 'your profile selfie'
                 when 4  then 'uploading your documents'
                 when 40 then 're-uploading a rejected document'
                 when 5  then 'the Health & Safety induction'
                 when 6  then 'the Health & Safety quiz'
                 when 7  then 'the HMRC New Starter Checklist'
                 when 8  then 'your two references'
                 when 9  then 'your bank & payroll details'
                 when 10 then 'signing your contract'
               end as step
      ) w
      cross join lateral (
        -- Everything else that moves a candidate along, this period only:
        -- an upload, the office's review of one (a rejection hands the
        -- move back), a quiz attempt, a declaration and its review.
        select greatest(
                 (select max(greatest(c.uploaded_at, c.reviewed_at)) from compliance_docs c
                   where c.staff_id = b.id and c.uploaded_at >= b.onboarding_started_at),
                 (select max(q.taken_at) from quiz_attempts q
                   where q.staff_id = b.id and q.taken_at >= b.onboarding_started_at),
                 (select max(greatest(d.declared_at, d.reviewed_at)) from criminal_declarations d
                   where d.staff_id = b.id and d.declared_at >= b.onboarding_started_at)
               ) as last_act
      ) act
     where b.activated
       and w.step_no is not null
  ),
  laddered as (
    select t.*,
           floor(extract(epoch from t.progress_at))::bigint as epoch,
           coalesce(r.rungs_sent, 0) as rungs_sent,
           r.last_sent_at,
           coalesce(r.last_failed, false) as last_failed
      from tracked t
      left join lateral (
        select (o.payload ->> 'rung')::int          as rungs_sent,
               (o.payload ->> 'at')::timestamptz    as last_sent_at,
               o.failed_at is not null              as last_failed
          from notification_outbox o
         where o.template = t.template
           and o.key collate "C" >= t.template || ':staff:' || t.id::text || ':'
                          || floor(extract(epoch from t.progress_at))::bigint::text || ':'
           and o.key collate "C" <  t.template || ':staff:' || t.id::text || ':'
                          || floor(extract(epoch from t.progress_at))::bigint::text || ':~'
         order by (o.payload ->> 'rung')::int desc
         limit 1
      ) r on true
  ),
  timed as (
    select l.*,
           -- One interval after the last progress, then one after each
           -- reminder: daily by default, for as long as the move is theirs.
           case when l.rungs_sent = 0 then l.progress_at + cfg.every
                else l.last_sent_at + cfg.every end as next_due_at
      from laddered l cross join cfg
  )
  -- Half an hour's grace: the job runs hourly at a fixed minute, and a
  -- reminder queued at 17:07:02 must not miss 17:07:01 the next day and
  -- slip to the morning after.
  select t.id, t.track, t.template, t.step_no, t.step, t.progress_at, t.epoch,
         t.rungs_sent, t.last_sent_at,
         case when p_now + interval '30 minutes' >= t.next_due_at
              then t.rungs_sent + 1 end,
         t.next_due_at,
         t.last_failed
    from timed t;
$$;
