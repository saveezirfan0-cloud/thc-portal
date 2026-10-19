-- =====================================================================
-- The onboarding app reminder goes by email when notifications are off
-- (ADR-0169; owner request, 19.10.2026)
--
-- After sign-up the daily onboarding reminder (OC3, ADR-0071) is a push.
-- Notifications in the Staff App are opt-in, and on an iPhone they work
-- only once the app is on the home screen, so many candidates sign up in a
-- browser and never turn them on. The drain fails every one of their
-- pushes ("no push subscription"); the board turns amber, then Stalled,
-- and the candidate has been reminded of nothing. The owner: "can the
-- candidate be emailed, if their notifications are off on their phone".
--
-- So:
--   · onboarding_chasers(p_now, p_app_link) — the Edge Function now passes
--     `<STAFF_APP_URL>/onboarding`. When an OC3 is due for a candidate with
--     NO push_subscriptions row (no device has notifications on), it queues
--     OC4 instead: the same rung by email, to staff.email, with that link.
--     With a device, or without a usable link, or without an email, it is
--     the OC3 push as before (and the board's amber line still says so).
--   · One ladder, one key. OC4 is queued under OC3's key,
--     `OC3:staff:<id>:<epoch>:<n>`, so a rung is one reminder by exactly
--     one channel (the unique key holds it), turning notifications on or
--     off part-way through carries on the count, and progress still starts
--     it again. The cadence, window, variants and who is chased do not
--     change.
--   · onboarding_chaser_candidates() reads both templates on that ladder
--     and returns `last_channel`, the channel of the latest rung;
--     onboarding_chaser_state() passes it to the board, which says
--     "App reminder 2 emailed 20 Oct" for an OC4. Both are dropped and
--     recreated (a new output column), with their grants restated.
--   · notification_priorities(): OC4 is bulk, like OC3.
--
-- The link is the app's own /onboarding page, which needs the candidate's
-- login, so the email carries nothing a forwarded copy could use.
-- onboarding_chasers() accepts only an https origin (or a local one) and
-- exactly /onboarding, as invite_roster_reminders() does for /apply.
--
-- Bodies restated from 20261007120000 (candidates), 20261001212000
-- (state) and 20261016120000 (onboarding_chasers). pgTAP:
-- supabase/tests/900_oc3_by_email.sql; 394 follows the new signature.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The ladder reads OC3 and OC4, and names the latest rung's channel
-- ---------------------------------------------------------------------
drop function if exists public.onboarding_chaser_state(timestamptz);
drop function if exists public.onboarding_chaser_candidates(timestamptz);

create function public.onboarding_chaser_candidates(p_now timestamptz default now())
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
  last_failed  boolean,      -- the latest rung could not be delivered (no push subscription, a bounce)
  last_channel text          -- the latest rung's channel: email | push (OC4 is OC3 by email)
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
           coalesce(r.last_failed, false) as last_failed,
           r.last_channel
      from tracked t
      left join lateral (
        select (o.payload ->> 'rung')::int          as rungs_sent,
               (o.payload ->> 'at')::timestamptz    as last_sent_at,
               o.failed_at is not null              as last_failed,
               o.channel::text                      as last_channel
          from notification_outbox o
         -- ADR-0169: OC3's ladder holds its pushes and the OC4 emails sent
         -- in their place, under the same keys.
         where (o.template = t.template or (t.template = 'OC3' and o.template = 'OC4'))
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
         t.last_failed,
         t.last_channel
    from timed t;
$$;

comment on function public.onboarding_chaser_candidates(timestamptz) is
  'ADR-0071: one row per candidate whose next onboarding move is their own (OC1 interview, OC2 activation, OC3 wizard step), with the reminders sent since their last progress, the rung due now and the latest rung''s delivery (last_failed) and channel (last_channel; an OC4 on OC3''s ladder is its email, ADR-0169). Internal: read by onboarding_chasers() and onboarding_chaser_state().';

revoke all on function public.onboarding_chaser_candidates(timestamptz) from public, anon, authenticated;

create function public.onboarding_chaser_state(p_now timestamptz default now())
returns table (
  staff_id     uuid,
  track        text,
  step         text,
  progress_at  timestamptz,
  rungs_sent   integer,
  last_sent_at timestamptz,
  next_due_at  timestamptz,
  stalled      boolean,
  last_failed  boolean,
  last_channel text
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select c.staff_id, c.track, c.step, c.progress_at, c.rungs_sent, c.last_sent_at,
           c.next_due_at,
           c.rungs_sent >= (onboarding_chaser_config() ->> 'stalled_after')::int,
           c.last_failed,
           c.last_channel
      from onboarding_chaser_candidates(p_now) c;
end $$;

comment on function public.onboarding_chaser_state(timestamptz) is
  'ADR-0071, the onboarding board: per candidate waiting on themselves, the reminders sent since their last progress, when the next is due, stalled (settings.onboarding_chasers.stalled_after sent, still no progress — phone them; the reminders carry on), last_failed (the latest could not be delivered — notifications off, a bounce) and last_channel (email or push; ADR-0169 emails the app reminder to a candidate with notifications off). Back Office only.';

revoke all on function public.onboarding_chaser_state(timestamptz) from public, anon;
grant execute on function public.onboarding_chaser_state(timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- 2 · The job: OC4 in place of an OC3 nobody can receive
-- ---------------------------------------------------------------------
drop function if exists public.onboarding_chasers(timestamptz);

create function public.onboarding_chasers(
  p_now      timestamptz default now(),
  p_app_link text        default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cfg        jsonb := onboarding_chaser_config();
  v_clock      time  := uk_local(p_now)::time;
  v_link       text  := willo_interview_public_url();
  v_app        text  := btrim(coalesce(p_app_link, ''));
  v_oc1        integer;
  v_oc3        integer;
  v_oc4        integer;
  v_activation jsonb;
begin
  if not coalesce((v_cfg ->> 'enabled')::boolean, true) then
    return jsonb_build_object('skipped', 'disabled in settings.onboarding_chasers');
  end if;
  if v_clock < (v_cfg ->> 'from')::time or v_clock >= (v_cfg ->> 'until')::time then
    return jsonb_build_object('skipped', 'outside ' || (v_cfg ->> 'from') || '–'
                                         || (v_cfg ->> 'until') || ' UK');
  end if;
  -- The app's onboarding page and nothing else: an https origin (or a local
  -- one, for development) followed by /onboarding. Anything else is no
  -- link, and every OC3 stays a push.
  if v_app !~ '^(https://[A-Za-z0-9.-]+|http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?)/onboarding$' then
    v_app := null;
  end if;

  if to_regclass('pg_temp._due') is not null then
    drop table _due;
  end if;
  create temporary table _due on commit drop as
    select c.*, s.email, s.first_name,
           -- ADR-0169: an OC3 goes by email when no device has notifications
           -- on, the address is there and the link is good.
           c.template = 'OC3'
             and v_app is not null
             and coalesce(btrim(s.email), '') <> ''
             and not exists (select 1 from push_subscriptions ps where ps.staff_id = c.staff_id)
             as by_email
      from onboarding_chaser_candidates(p_now) c
      join staff s on s.id = c.staff_id
     where c.due_rung is not null;

  -- Existing staff read that the interview is part of moving onto the new
  -- app (existing_first / existing_second / existing_repeat). When the
  -- office has set the interview's public link, every OC1 carries it too.
  with ins as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, recipient_emails, payload)
    select 'OC1:staff:' || d.staff_id || ':' || d.epoch || ':' || d.due_rung,
           'email', 'OC1', d.staff_id, array[d.email],
           jsonb_build_object('name', d.first_name,
                              'variant', case when onboarding_chaser_existing_staff(d.staff_id)
                                              then 'existing_' else '' end
                                         || onboarding_chaser_variant(d.due_rung),
                              'rung', d.due_rung, 'at', p_now)
             || case when v_link is not null
                     then jsonb_build_object('interviewLink', v_link)
                     else '{}'::jsonb end
      from _due d
     where d.template = 'OC1' and coalesce(d.email, '') <> ''
    on conflict (key) do nothing
    returning 1
  ) select count(*) into v_oc1 from ins;

  with ins as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select 'OC3:staff:' || d.staff_id || ':' || d.epoch || ':' || d.due_rung,
           'push', 'OC3', d.staff_id,
           jsonb_build_object('step', d.step, 'stepNo', d.step_no,
                              'variant', onboarding_chaser_variant(d.due_rung),
                              'rung', d.due_rung, 'at', p_now)
      from _due d
     where d.template = 'OC3' and not d.by_email
    on conflict (key) do nothing
    returning 1
  ) select count(*) into v_oc3 from ins;

  -- OC4: the same rung, on OC3's key, by email.
  with ins as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, recipient_emails, payload)
    select 'OC3:staff:' || d.staff_id || ':' || d.epoch || ':' || d.due_rung,
           'email', 'OC4', d.staff_id, array[btrim(d.email)],
           jsonb_build_object('name', d.first_name, 'step', d.step, 'stepNo', d.step_no,
                              'variant', onboarding_chaser_variant(d.due_rung),
                              'link', v_app,
                              'rung', d.due_rung, 'at', p_now)
      from _due d
     where d.template = 'OC3' and d.by_email
    on conflict (key) do nothing
    returning 1
  ) select count(*) into v_oc4 from ins;

  -- OC2 needs a link minted outside the database: name them, queue nothing.
  select coalesce(jsonb_agg(jsonb_build_object(
           'staffId', d.staff_id::text,
           'userId',  s.user_id::text,
           'email',   d.email,
           'rung',    d.due_rung) order by d.progress_at), '[]'::jsonb)
    into v_activation
    from _due d
    join staff s on s.id = d.staff_id
   where d.template = 'OC2' and coalesce(d.email, '') <> '';

  return jsonb_build_object('oc1', v_oc1, 'oc3', v_oc3, 'oc4', v_oc4,
                            'oc2_due', jsonb_array_length(v_activation),
                            'activation', v_activation);
end $$;

comment on function public.onboarding_chasers(timestamptz, text) is
  'ADR-0071, the onboarding-chasers job: between settings.onboarding_chasers from/until (UK), queues the OC1 interview emails (existing staff moving onto the new app get the existing_* wording, 20261012123000; each carries the interview''s public link when settings.willo_interview_public_url is set, 20261016120000) and the OC3 wizard pushes due now — as OC4 emails with p_app_link (<STAFF_APP_URL>/onboarding) to a candidate with no push subscription (ADR-0169, 20261021120000) — and returns the OC2 activation reminders due (staffId, userId, email, rung) for the Edge Function to mint a link for. Idempotent on the outbox key. Service role only.';

revoke all on function public.onboarding_chasers(timestamptz, text) from public, anon, authenticated;
grant execute on function public.onboarding_chasers(timestamptz, text) to service_role;

-- ---------------------------------------------------------------------
-- 3 · OC4 is bulk, like OC3 (ADR-0158; priorityValuesSql())
-- ---------------------------------------------------------------------
create or replace function public.notification_priorities()
returns table (code text, priority smallint)
language sql immutable set search_path = public, extensions as $$
  select v.code, v.priority::smallint from (values
    ('BG08', 1),
    ('CL1', 1),
    ('CL2', 1),
    ('CL3', 1),
    ('CL4', 2),
    ('CL5', 1),
    ('CL6', 1),
    ('CP1', 1),
    ('CP2', 1),
    ('CP3', 1),
    ('CR1', 1),
    ('CR2', 0),
    ('CR3', 1),
    ('D1', 1),
    ('D2', 1),
    ('E1', 1),
    ('E10', 0),
    ('E11', 1),
    ('E12', 1),
    ('E2', 1),
    ('E2b', 1),
    ('E3', 1),
    ('E4', 1),
    ('E5', 1),
    ('E5b', 1),
    ('E6', 1),
    ('E7', 1),
    ('E8', 1),
    ('E9', 1),
    ('IR1', 2),
    ('N1', 2),
    ('N10', 0),
    ('N10b', 0),
    ('N10c', 0),
    ('N10d', 0),
    ('N10e', 0),
    ('N11', 0),
    ('N11b', 0),
    ('N12', 0),
    ('N13', 0),
    ('N14', 1),
    ('N15', 1),
    ('N2', 2),
    ('N3', 2),
    ('N4', 1),
    ('N5', 0),
    ('N6', 0),
    ('N6b', 0),
    ('N7', 0),
    ('N8', 1),
    ('N9', 0),
    ('N9b', 0),
    ('NS1', 1),
    ('OC1', 2),
    ('OC2', 2),
    ('OC3', 2),
    ('OC4', 2),
    ('OF1', 0),
    ('OF2', 0),
    ('OF3', 0),
    ('OF4', 0),
    ('OF5', 0),
    ('OF6', 0),
    ('OM1', 0),
    ('OM2', 0),
    ('RC1', 1),
    ('RC2', 1),
    ('RC3', 1),
    ('RC4', 1),
    ('RC5', 1)
  ) as v(code, priority);
$$;

comment on function public.notification_priorities() is
  'ADR-0158: the send class of every register code and document email — 0 urgent, 1 normal, 2 bulk. Mirrors SEND_PRIORITY in packages/notifications/src/priority.ts (priorityValuesSql() renders these rows; __tests__/priority.test.ts holds the two equal). OC4 added 20261021120000.';

revoke execute on function public.notification_priorities() from public, anon, authenticated;
grant execute on function public.notification_priorities() to service_role;
