-- =====================================================================
-- Onboarding chasers (ADR-0071) — an addition to scope v1.6 §8
--
-- The owner asked (29.09.2026): "Can chaser notifications be sent out to
-- staff to push them along the onboarding steps?", and settled the shape:
--
--   · before the account exists, the reminder is an EMAIL —
--       OC1  the Willo interview is not done (Interview requested)
--       OC2  accepted, the activation email went, no password set yet;
--            it carries a FRESH activation link, because the E3 one works
--            once and lives a day (supabase/config.toml otp_expiry)
--   · once signed up, the reminder is a PUSH in the Staff App —
--       OC3  a wizard step is waiting on the candidate
--
-- Only when the next move is the CANDIDATE's. Interview completed (the
-- Willo decision), documents under review and a Yes declaration awaiting
-- Verify are the office's move and are never chased.
--
-- The ladder: 2, 5 and 10 days after the candidate's last progress, the
-- three rungs at least as far apart as that (3 and 5 days) even when a
-- candidate is already weeks idle on day one. Any progress — a step saved,
-- a document uploaded or reviewed, a quiz attempt, a stage change, an E3
-- sent or re-sent — starts a fresh ladder: the outbox key carries the
-- progress instant (`<code>:staff:<id>:<epoch>:<rung>`). After the third
-- rung the card reads "Stalled" and the office phones them. Nothing is
-- rejected automatically. Daytime only: 10:00–18:00 UK.
--
-- Days, hours and an off switch are the `onboarding_chasers` setting.
--
-- The emails and the push are sent by the drain like every other row.
-- OC2's link is minted by the onboarding-chasers Edge Function (GoTrue's
-- admin API, packages/db/src/provision.ts — SQL cannot mint one), so the
-- job is: onboarding_chasers() queues OC1 + OC3 and names the OC2s due;
-- the function mints each link and hands it to onboarding_chaser_activation().
--
-- An OC2 row carries a live activation link, so it is fenced and redacted
-- exactly as E3 is (ADR-0060): office_activation_links and
-- redact_finished_invite_link() now name OC2, and activation_link_refresh()
-- points an unsent OC2 at the newest token as it does an unsent E3.
--
-- pgTAP: supabase/tests/394_onboarding_chasers.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0 · The setting
-- ---------------------------------------------------------------------
insert into settings (key, value) values
  ('onboarding_chasers',
   '{"enabled": true, "days": [2, 5, 10], "from": "10:00", "until": "18:00"}'::jsonb)
on conflict (key) do nothing;

-- The setting over its defaults, so a missing or partial row still reads
-- as a complete, sane configuration.
create or replace function public.onboarding_chaser_config()
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  select '{"enabled": true, "days": [2, 5, 10], "from": "10:00", "until": "18:00"}'::jsonb
      || coalesce((select value from settings
                    where key = 'onboarding_chasers' and jsonb_typeof(value) = 'object'),
                  '{}'::jsonb);
$$;

comment on function public.onboarding_chaser_config() is
  'ADR-0071: settings.onboarding_chasers over its defaults — enabled, days (the three rungs, days after the last progress), from/until (the UK hours sends may go out).';

-- ---------------------------------------------------------------------
-- 1 · Who is waiting on themselves, since when, and which rung is due
--
-- One row per candidate whose next move is their own. Internal: the job
-- and the office read it through the two functions below.
-- ---------------------------------------------------------------------
create or replace function public.onboarding_chaser_candidates(p_now timestamptz default now())
returns table (
  staff_id     uuid,
  track        text,         -- interview | activation | app
  template     text,         -- OC1 | OC2 | OC3
  step_no      integer,      -- the wizard step (app track), else null
  step         text,         -- the words the push uses for it
  progress_at  timestamptz,  -- the candidate's last progress
  epoch        bigint,       -- progress_at as the key's ladder id
  rungs_sent   integer,      -- 0..3 on this ladder
  last_sent_at timestamptz,  -- when the latest rung went into the outbox
  due_rung     integer,      -- the rung to queue now, or null
  next_due_at  timestamptz   -- when the next rung falls due, or null after the third
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with cfg as (
    select c,
           (c -> 'days' ->> 0)::int as d1,
           (c -> 'days' ->> 1)::int as d2,
           (c -> 'days' ->> 2)::int as d3
      from onboarding_chaser_config() c
  ),
  base as (
    select s.id, s.status, s.stage_entered_at, s.onboarding_started_at,
           s.willo_invited_at, s.willo_completed_at, s.contract_signed_at,
           s.user_id,
           coalesce(u.encrypted_password, '') <> ''                     as activated,
           u.email_confirmed_at,
           p.rtw_at, p.address_at, p.selfie_at, p.documents_at, p.induction_at,
           p.hmrc_at, p.references_at, p.bank_at, p.updated_at            as progress_updated_at,
           (select count(*) from current_compliance_docs(s.id) d
             where d.status = 'rejected')::int                            as docs_rejected
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
    -- OC2: accepted, the activation email has gone out, no password yet.
    select b.id, 'activation', 'OC2', null, null,
           greatest(b.stage_entered_at, e3.last_e3)
      from base b
      cross join lateral (
        select max(o.sent_at) as last_e3
          from notification_outbox o
         where o.template = 'E3'
           and o.key like 'E3:%:' || b.id::text || ':%'
      ) e3
     where b.status = 'documents'
       and b.user_id is not null
       and not b.activated
       and e3.last_e3 is not null
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
           r.last_sent_at
      from tracked t
      left join lateral (
        select max((o.payload ->> 'rung')::int)          as rungs_sent,
               max((o.payload ->> 'at')::timestamptz)    as last_sent_at
          from notification_outbox o
         where o.template = t.template
           and o.key like t.template || ':staff:' || t.id::text || ':'
                          || floor(extract(epoch from t.progress_at))::bigint::text || ':%'
      ) r on true
  ),
  timed as (
    select l.*,
           case l.rungs_sent
             when 0 then l.progress_at + make_interval(days => cfg.d1)
             when 1 then greatest(l.progress_at + make_interval(days => cfg.d2),
                                  l.last_sent_at + make_interval(days => cfg.d2 - cfg.d1))
             when 2 then greatest(l.progress_at + make_interval(days => cfg.d3),
                                  l.last_sent_at + make_interval(days => cfg.d3 - cfg.d2))
           end as next_due_at
      from laddered l cross join cfg
  )
  select t.id, t.track, t.template, t.step_no, t.step, t.progress_at, t.epoch,
         t.rungs_sent, t.last_sent_at,
         case when t.next_due_at is not null and p_now >= t.next_due_at
              then t.rungs_sent + 1 end,
         t.next_due_at
    from timed t;
$$;

comment on function public.onboarding_chaser_candidates(timestamptz) is
  'ADR-0071: every candidate whose next onboarding move is their own — the track (interview → OC1 email, activation → OC2 email, app → OC3 push), the step, their last progress, the rungs sent on this ladder and the rung due now. Internal: read through onboarding_chasers() and onboarding_chaser_state().';

revoke all on function public.onboarding_chaser_candidates(timestamptz) from public, anon, authenticated;
revoke all on function public.onboarding_chaser_config() from public, anon;
grant execute on function public.onboarding_chaser_config() to authenticated, service_role;

-- The three variants of each code, one per rung.
create or replace function public.onboarding_chaser_variant(p_rung integer)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select case p_rung when 1 then 'first' when 2 then 'second' else 'final' end;
$$;

revoke all on function public.onboarding_chaser_variant(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2 · The job's SQL half: queue OC1 and OC3, name the OC2s due
-- ---------------------------------------------------------------------
create or replace function public.onboarding_chasers(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cfg        jsonb := onboarding_chaser_config();
  v_clock      time  := uk_local(p_now)::time;
  v_oc1        integer;
  v_oc3        integer;
  v_activation jsonb;
begin
  if not coalesce((v_cfg ->> 'enabled')::boolean, true) then
    return jsonb_build_object('skipped', 'disabled in settings.onboarding_chasers');
  end if;
  if v_clock < (v_cfg ->> 'from')::time or v_clock >= (v_cfg ->> 'until')::time then
    return jsonb_build_object('skipped', 'outside ' || (v_cfg ->> 'from') || '–'
                                         || (v_cfg ->> 'until') || ' UK');
  end if;

  if to_regclass('pg_temp._due') is not null then
    drop table _due;
  end if;
  create temporary table _due on commit drop as
    select c.*, s.email, s.first_name
      from onboarding_chaser_candidates(p_now) c
      join staff s on s.id = c.staff_id
     where c.due_rung is not null;

  with ins as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, recipient_emails, payload)
    select 'OC1:staff:' || d.staff_id || ':' || d.epoch || ':' || d.due_rung,
           'email', 'OC1', d.staff_id, array[d.email],
           jsonb_build_object('name', d.first_name,
                              'variant', onboarding_chaser_variant(d.due_rung),
                              'rung', d.due_rung, 'at', p_now)
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
     where d.template = 'OC3'
    on conflict (key) do nothing
    returning 1
  ) select count(*) into v_oc3 from ins;

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

  return jsonb_build_object('oc1', v_oc1, 'oc3', v_oc3,
                            'oc2_due', jsonb_array_length(v_activation),
                            'activation', v_activation);
end $$;

comment on function public.onboarding_chasers(timestamptz) is
  'ADR-0071, the onboarding-chasers job: between settings.onboarding_chasers from/until (UK), queues the OC1 interview emails and OC3 wizard pushes due now, and returns the OC2 activation reminders due (staffId, userId, email, rung) for the Edge Function to mint a link for. Idempotent on the outbox key. Service role only.';

revoke all on function public.onboarding_chasers(timestamptz) from public, anon, authenticated;
grant execute on function public.onboarding_chasers(timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- 3 · OC2: the reminder carrying a freshly minted activation link
-- ---------------------------------------------------------------------
create or replace function public.onboarding_chaser_activation(
  p_staff           uuid,
  p_user            uuid,
  p_activation_link text,
  p_install_link    text,
  p_now             timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s     staff;
  d     record;
  v_key text;
  v_n   integer;
begin
  if coalesce(p_activation_link, '') !~ '/activate/[A-Za-z0-9_-]{32,}' then
    raise exception 'activation_link_not_personal' using errcode = '22023';
  end if;
  if coalesce(btrim(p_install_link), '') = '' then
    raise exception 'activation_link_required' using errcode = '22023';
  end if;

  select * into s from staff where id = p_staff for update;
  if s.id is null or s.user_id is distinct from p_user then
    raise exception 'account_mismatch' using errcode = 'P0001';
  end if;

  -- The new token has replaced the old one either way: an E3 or OC2 still
  -- waiting in the outbox must carry the new link, not a dead one.
  perform activation_link_refresh(p_staff, p_user, p_activation_link);

  select * into d from onboarding_chaser_candidates(p_now) c
   where c.staff_id = p_staff and c.template = 'OC2' and c.due_rung is not null;
  if not found then
    -- Activated, rejected or reminded since the job asked. Nothing to send.
    return jsonb_build_object('staffId', p_staff::text, 'queued', false);
  end if;

  v_key := 'OC2:staff:' || p_staff || ':' || d.epoch || ':' || d.due_rung;
  insert into notification_outbox (key, channel, template, recipient_staff_id, recipient_emails, payload)
  values (v_key, 'email', 'OC2', p_staff, array[s.email],
          jsonb_build_object('name', s.first_name,
                             'link', btrim(p_activation_link),
                             'installLink', btrim(p_install_link),
                             'variant', onboarding_chaser_variant(d.due_rung),
                             'rung', d.due_rung, 'at', p_now))
  on conflict (key) do nothing;
  get diagnostics v_n = row_count;

  return jsonb_build_object('staffId', p_staff::text, 'queued', v_n > 0,
                            'rung', d.due_rung, 'outboxKey', v_key);
end $$;

comment on function public.onboarding_chaser_activation(uuid, uuid, text, text, timestamptz) is
  'ADR-0071: queues the OC2 activation reminder with the link the onboarding-chasers Edge Function just minted, if the rung is still due; any unsent E3/OC2 is pointed at the same token first. Service role only.';

revoke all on function public.onboarding_chaser_activation(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.onboarding_chaser_activation(uuid, uuid, text, text, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------
-- 4 · The office's read: which cards have been chased, and which stalled
-- ---------------------------------------------------------------------
create or replace function public.onboarding_chaser_state(p_now timestamptz default now())
returns table (
  staff_id     uuid,
  track        text,
  step         text,
  progress_at  timestamptz,
  rungs_sent   integer,
  last_sent_at timestamptz,
  next_due_at  timestamptz,
  stalled      boolean
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
           c.next_due_at, c.rungs_sent >= 3
      from onboarding_chaser_candidates(p_now) c;
end $$;

comment on function public.onboarding_chaser_state(timestamptz) is
  'ADR-0071, the onboarding board: per candidate waiting on themselves, the reminders sent on the current ladder, when the next is due, and stalled (all three sent, still no progress — phone them). Back Office only.';

revoke all on function public.onboarding_chaser_state(timestamptz) from public, anon;
grant execute on function public.onboarding_chaser_state(timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- 5 · OC2 carries a live link: fenced, refreshed and redacted like E3
-- ---------------------------------------------------------------------
alter policy office_activation_links on notification_outbox
  using (template not in ('E3', 'OC2') or (select office_can('users')));

comment on policy office_activation_links on notification_outbox is
  'ADR-0060, ADR-0071: an E3 or OC2 row carries a worker''s one-time activation link; only a session with office_can(''users'') (an owner) may read it. 20261001201200, OC2 added 20261001211000.';

-- 20260924110000's body, OC2 added.
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
     and o.template in ('E3', 'OC2')
     and o.key like o.template || ':%:' || p_staff::text || ':%'
     and o.sent_at is null
     and o.failed_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- 20261001201200's body, OC2 added.
create or replace function public.redact_finished_invite_link()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.template in ('E11', 'E3', 'OC2')
     and (new.sent_at is not null or new.failed_at is not null)
     and new.payload ? 'link' then
    new.payload := (new.payload - 'link') || jsonb_build_object('linkRedacted', true);
  end if;
  return new;
end;
$$;

comment on function public.redact_finished_invite_link() is
  'ADR-0058, ADR-0060, ADR-0071: once an E11 (account set-up), E3 (worker activation) or OC2 (activation reminder) row is sent or has failed for good, its one-time link is removed from the payload (linkRedacted: true).';

revoke all on function public.redact_finished_invite_link() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6 · The schedule: hourly; the SQL keeps the sends inside UK daytime
-- ---------------------------------------------------------------------
insert into job_schedules (job, cron_expression, edge_path, enabled, note) values
  ('onboarding-chasers', '7 * * * *', 'onboarding-chasers', true,
   'ADR-0071 onboarding chasers: OC1/OC2 emails before sign-up, OC3 pushes after, at 2/5/10 days without progress. Hourly; onboarding_chasers() sends only between settings.onboarding_chasers from/until (UK).')
on conflict (job) do nothing;
