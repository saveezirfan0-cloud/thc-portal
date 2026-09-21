-- =====================================================================
-- compliance_daily() — the document clock (§7 BG-04/05, §4.2, §4.3, §4.4)
--
-- Three rules share one daily sweep because all three read the same two
-- facts — what a worker's documents say and what day it is:
--
--   BG-04  the reminder ladder: 1 month / 2 weeks / 1 week before expiry
--   BG-05  the block, on the expiry day, with the §4.3 cascade
--   §4.4   N14 when the calculated weekly cap changes band
--
-- The §4.3 cascade is written once, as block_worker(), because three
-- separate sections of the scope order the same five steps: an expired
-- document here, the worker who leaves (§10.6) and the in-employment
-- conviction declaration (§10.7). Only the reason differs, so only the
-- reason is an argument.
--
-- Rules live in SQL, not in the Edge Function, for the reason the rest of
-- this schema gives: pgTAP reaches them here and nothing in this repo
-- checks the Deno (docs/14 O5).
--
-- Timing: 05:00 UK, gated by is_uk_time() so the pg_cron entry can stay
-- on UTC and the hour survives the DST boundaries (20260921160624).
-- =====================================================================

-- ---------------------------------------------------------------------
-- The date a document actually stops counting, which is not always the
-- date in its `expiry_date` column.
--
--   * University term dates letter (§4.2): the printed graduation date is
--     explicitly NOT the expiry. The letter expires 31 December, so the
--     ladder starts on 1 December — one month out, exactly as for every
--     other document. The scope rejects reminding a month before the last
--     printed vacation date by name: the student does not physically have
--     next year's letter yet, and we would block someone who did nothing
--     wrong. A letter whose own ranges run past that 31 December keeps
--     its later year, so a letter uploaded in the autumn for the academic
--     year ahead is not dead three weeks after it arrives.
--   * Share code report (§4.4): "Right-to-work-until from gov.uk = the
--     expiry date used for reminders", which is a different column.
--   * Everything else: the confirmed expiry date.
--
-- Null means no expiry — a birth certificate does not run out — and every
-- caller below treats null as "never due".
-- ---------------------------------------------------------------------
create or replace function public.doc_expires_on(
  p_doc_type    doc_type,
  p_expiry      date,
  p_rtw_until   date,
  p_term_dates  daterange[],
  p_uploaded_at timestamptz
) returns date
language sql
immutable
set search_path = public, extensions
as $$
  select case p_doc_type
    when 'university_term_dates_letter' then
      make_date(
        greatest(
          extract(year from (p_uploaded_at at time zone 'Europe/London'))::int,
          coalesce(
            (select max(extract(year from (upper(r) - 1))::int)
               from unnest(coalesce(p_term_dates, '{}'::daterange[])) r
              where not upper_inf(r)),
            0)
        ), 12, 31)
    when 'share_code_report' then coalesce(p_rtw_until, p_expiry)
    else p_expiry
  end
$$;

comment on function public.doc_expires_on(doc_type, date, date, daterange[], timestamptz) is
  '§4.2 effective expiry: the term letter dies 31 December whatever it prints, the share code report uses right_to_work_until, everything else uses expiry_date.';

-- ---------------------------------------------------------------------
-- What the worker calls the document. N1-N3 substitute it into copy the
-- worker reads — "Update your {document} — it expires on [date]" (§4.2) —
-- so the enum label cannot go through: nobody has a
-- `university_term_dates_letter`, they have a University Term Dates
-- Letter. The strings are the ones the Documents screen already shows
-- (wireframes/staff/documents.html), so the push and the screen it deep
-- links to name the same thing.
-- ---------------------------------------------------------------------
create or replace function public.doc_label(p_doc_type doc_type)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select case p_doc_type
    when 'passport'                     then 'Passport'
    when 'birth_certificate'            then 'Birth certificate'
    when 'ni_evidence'                  then 'NI evidence'
    when 'national_id'                  then 'National ID'
    when 'visa_document'                then 'Visa document'
    when 'status_document'              then 'Status document'
    when 'university_term_dates_letter' then 'University Term Dates Letter'
    when 'university_completion_letter' then 'Official University Completion Letter'
    when 'share_code_report'            then 'Right to work · share code'
  end
$$;

-- ---------------------------------------------------------------------
-- The document set that decides compliance: the latest non-superseded
-- row per document type. A rejected passport followed by an accepted one
-- is one document with a history, not two documents one of which is bad.
-- ---------------------------------------------------------------------
create or replace function public.current_compliance_docs(p_staff uuid)
returns table (
  doc_id     uuid,
  doc_type   doc_type,
  status     review_status,
  expires_on date
)
language sql
stable
set search_path = public, extensions
as $$
  select distinct on (d.doc_type)
         d.id,
         d.doc_type,
         d.review_status,
         doc_expires_on(d.doc_type, d.expiry_date, d.right_to_work_until,
                        d.term_dates, d.uploaded_at)
    from compliance_docs d
   where d.staff_id = p_staff
     and d.review_status <> 'superseded'
   order by d.doc_type, d.uploaded_at desc, d.id
$$;

-- ---------------------------------------------------------------------
-- Every reason this worker is not compliant, as text, on a given day.
--
-- §4.3's unblocking rule is the whole point of returning a SET rather
-- than a boolean: verifying one document re-checks the person's FULL
-- status, so the scope's own example works — right to work valid until
-- 30 July, worker leaves 26 July, returns in March 2027, uploads the
-- document that caused the block and is verified on it. The share code
-- is already dead, so the app stays locked to Documents instead of fully
-- unblocking. The second reason has to still be there to be found.
--
-- Empty set = compliant.
-- ---------------------------------------------------------------------
create or replace function public.compliance_blockers(p_staff uuid, p_on date default current_date)
returns table (reason text)
language sql
stable
set search_path = public, extensions
as $$
  select 'document_expired:' || d.doc_type::text
    from current_compliance_docs(p_staff) d
   where d.status = 'verified'
     and d.expires_on is not null
     and d.expires_on <= p_on
  union all
  select 'document_unverified:' || d.doc_type::text
    from current_compliance_docs(p_staff) d
   where d.status <> 'verified'
  union all
  -- §4.3: "the Criminal Record declaration, if answered Yes, must also be
  -- verified". A No needs nothing. The latest declaration is the one that
  -- counts — the table is history and is never edited (§1.5).
  select 'conviction_unreviewed'
    from (
      select c.answer, c.review_status
        from criminal_declarations c
       where c.staff_id = p_staff
         and not c.superseded
       order by c.declared_at desc
       limit 1
    ) c
   where c.answer and c.review_status <> 'verified'
$$;

comment on function public.compliance_blockers(uuid, date) is
  '§4.3 full compliance re-check, as reasons. Empty = compliant. Used by both the automatic unblock and the manual one (§9.6), which runs the same check before the block is lifted.';

-- ---------------------------------------------------------------------
-- The §4.3 cascade, written once.
--
-- Steps 1-3 are writes and live here. Steps 4 and 5 are consequences of
-- step 1 and are enforced where they belong: auto_assign_candidates gates
-- on `status <> 'compliant'` (20260921141500), so a blocked worker enters
-- no round and appears in no pool; the app lock is routing, and reads the
-- same status.
--
-- Releasing a confirmed booking (step 2) puts the slot back in front of
-- auto-assign by construction — shift_fill() counts confirmed bookings,
-- so cancelling one makes the section short again and the next hourly
-- round fills it. Withdrawing an open invitation (step 3) is the same
-- statement with a different starting status; §4.3 distinguishes them
-- because the worker sees a different thing happen, not because the
-- database does.
--
-- Only FUTURE work is touched. A shift already under way is a matter for
-- the manager on site, and a shift already worked is a pay record.
-- ---------------------------------------------------------------------
create or replace function public.block_worker(
  p_staff  uuid,
  p_kind   block_kind,
  p_reason text,
  p_now    timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_released int := 0;
  v_withdrawn int := 0;
  v_was staff_status;
begin
  select status into v_was from staff where id = p_staff for update;
  if v_was is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;

  -- 1 · blocked.
  update staff
     set status = 'blocked',
         block_kind = p_kind,
         block_reason = p_reason
   where id = p_staff;

  -- 2 · every future confirmed allocation is released.
  with released as (
    update bookings b
       set status = 'cancelled', cancelled_at = p_now, cancel_cause = 'blocked'
      from shift_requirements s
     where s.id = b.shift_id
       and b.staff_id = p_staff
       and b.status = 'confirmed'
       and b.cancelled_at is null
       and s.starts_at > p_now
    returning 1
  ) select count(*)::int into v_released from released;

  -- 3 · every open invitation disappears from their app.
  with withdrawn as (
    update bookings b
       set status = 'cancelled', cancelled_at = p_now, cancel_cause = 'blocked'
      from shift_requirements s
     where s.id = b.shift_id
       and b.staff_id = p_staff
       and b.status in ('invited', 'applied')
       and b.cancelled_at is null
       and s.starts_at > p_now
    returning 1
  ) select count(*)::int into v_withdrawn from withdrawn;

  return jsonb_build_object(
    'staffId', p_staff::text,
    'wasStatus', v_was::text,
    'kind', p_kind::text,
    'released', v_released,
    'withdrawn', v_withdrawn);
end $$;

comment on function public.block_worker(uuid, block_kind, text, timestamptz) is
  'The §4.3 cascade: blocked, future allocations released, open invitations withdrawn. Shared by document expiry (§4.3), the worker who leaves (§10.6) and the in-employment conviction (§10.7).';

-- ---------------------------------------------------------------------
-- §4.3 unblocking, for a block the system applied by itself.
--
-- A manual block (§9.6) and a conviction review (§10.7) are deliberately
-- NOT lifted here: the scope says the manager must press Unblock, and
-- that press runs the same full check. Hence the block_kind test — this
-- function is safe to call after any document is verified, and will do
-- nothing to a worker a human blocked on purpose.
--
-- There is no automatic restoration to the shifts they were removed from
-- (§4.3): those may already have gone to someone else.
-- ---------------------------------------------------------------------
create or replace function public.unblock_if_compliant(p_staff uuid, p_on date default current_date)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v staff;
begin
  select * into v from staff where id = p_staff for update;
  if v.id is null or v.status <> 'blocked' or v.block_kind <> 'auto_document' then
    return false;
  end if;
  if exists (select 1 from compliance_blockers(p_staff, p_on)) then
    return false;
  end if;
  update staff set status = 'compliant', block_kind = null, block_reason = null
   where id = p_staff;
  return true;
end $$;

comment on function public.unblock_if_compliant(uuid, date) is
  '§4.3 automatic unblock. Only ever lifts block_kind = auto_document; a manual block or a conviction review needs the manager to press Unblock, which runs the same check.';

-- ---------------------------------------------------------------------
-- "Verifying any document automatically re-checks the person's FULL
-- compliance status" (§4.3). Putting that on the row rather than in the
-- verify screen means it holds for every path that verifies a document —
-- the Needs review queue, a back-office fix, a future bulk import — and
-- cannot be forgotten by one of them.
-- ---------------------------------------------------------------------
create or replace function public.compliance_docs_verified()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.review_status = 'verified' and old.review_status is distinct from 'verified' then
    perform unblock_if_compliant(new.staff_id);
  end if;
  return new;
end $$;

drop trigger if exists compliance_docs_verified on compliance_docs;
create trigger compliance_docs_verified
  after update of review_status on compliance_docs
  for each row execute function compliance_docs_verified();

-- ---------------------------------------------------------------------
-- N14 fires "once per change, never more" (§4.4), and the cap itself is
-- calculated and never stored (RULE-20) — so the only thing that can be
-- stored is what the worker was last TOLD. Deriving the change instead,
-- by comparing today's band with yesterday's, does not work: a completion
-- letter verified this morning (§4.5) changes the band without any date
-- moving, so yesterday recomputed today already carries the new answer
-- and the change is invisible.
--
-- One row per worker, overwritten. It is a notification receipt, not a
-- cap — nothing may read it to decide what a worker may work.
-- ---------------------------------------------------------------------
create table if not exists cap_band_notices (
  staff_id    uuid primary key references staff(id) on delete cascade,
  band        cap_band not null,
  cap_hours   int,
  notified_on date not null
);
comment on table cap_band_notices is
  'What N14 last told each worker their weekly cap was (§4.4). A receipt, never an input: the cap is always recalculated (RULE-20).';

alter table cap_band_notices enable row level security;
drop policy if exists admin_all on cap_band_notices;
create policy admin_all on cap_band_notices for all using (current_app_role() = 'admin');
-- No staff policy. A worker learns their cap from N14 and from their own
-- profile, both of which read weekly_cap_for() live; this table is the
-- office's record of what was sent and must never become the number a
-- worker or a screen trusts (RULE-20).

-- ---------------------------------------------------------------------
-- The "until [date]" N14 substitutes: the last day the current band
-- holds. Ranges are half-open, so the last day inside one is upper() - 1.
-- Null where nothing on the calendar ends the band — a worker who is not
-- on a term letter stays where they are until they sign something, and
-- the sender drops the clause.
-- ---------------------------------------------------------------------
create or replace function public.cap_band_until(p_holidays daterange[], p_date date)
returns date
language sql
immutable
set search_path = public, extensions
as $$
  with weeks as (select cap_week_start(p_date) as w),
       r as (select unnest(coalesce(p_holidays, '{}'::daterange[])) as rng)
  select case cap_term_state(p_holidays, p_date)
    -- inside a holiday: the day before term restarts
    when 'holiday'  then (select min(upper(rng)) - 1 from r, weeks
                           where upper(rng) > weeks.w and not upper_inf(rng))
    -- in term: the day before the next holiday opens
    when 'term'     then (select min(lower(rng)) - 1 from r, weeks
                           where lower(rng) > weeks.w and not lower_inf(rng))
    -- a week with term on one side of it and holiday on the other takes
    -- the lower cap for the WHOLE week (§4.4), so what holds until is the
    -- Sunday. Naming the day term restarts would be wrong here twice over:
    -- the restart is inside this week, and the cap does not move when it
    -- arrives.
    when 'straddle' then (select w + 6 from weeks)
    else null
  end
$$;

-- ---------------------------------------------------------------------
-- BG-04 / BG-05 / N14 · the daily sweep.
--
-- The ladder is written as bands, not as equalities. "1 month before"
-- read literally is `expires_on - 30 = today`, which sends nothing at all
-- if the job misses a single day — and a job that silently skips a rung
-- of an expiry ladder ends with a worker blocked having been warned
-- twice instead of three times. Bands plus the outbox key give the same
-- once-each behaviour and heal a missed day on the next run.
--
--   N1   30 .. 15 days out
--   N2   14 ..  8
--   N3    7 ..  1
--   N4    expiry day and after, with the block
--
-- Who is in scope: workers who are live. Onboarding has its own document
-- flow (§2) and nobody there is booked onto anything; someone who has
-- left, been removed or rejected is not ours to remind.
-- ---------------------------------------------------------------------
create or replace function public.compliance_daily(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_today date := (p_now at time zone 'Europe/London')::date;
  v_n1 int := 0; v_n2 int := 0; v_n3 int := 0; v_n4 int := 0;
  v_blocked int := 0; v_n14 int := 0;
  r record;
begin
  create temporary table _due on commit drop as
  select s.id as staff_id,
         d.doc_id,
         d.doc_type,
         d.expires_on,
         (d.expires_on - v_today) as days_left
    from staff s
    cross join lateral current_compliance_docs(s.id) d
   where s.status in ('compliant', 'blocked')
     and s.left_at is null
     and s.removed_at is null
     and d.status = 'verified'
     and d.expires_on is not null;

  -- BG-04 · the three rungs. One key per document per rung, so a document
  -- renewed and re-expiring later is a new row and rings again.
  with q as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select 'N1:doc:' || doc_id, 'push', 'N1', staff_id,
           jsonb_build_object('document', doc_label(doc_type), 'date', expires_on::text)
      from _due where days_left between 15 and 30
    on conflict (key) do nothing returning 1
  ) select count(*)::int into v_n1 from q;

  with q as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select 'N2:doc:' || doc_id, 'push', 'N2', staff_id,
           jsonb_build_object('document', doc_label(doc_type), 'date', expires_on::text)
      from _due where days_left between 8 and 14
    on conflict (key) do nothing returning 1
  ) select count(*)::int into v_n2 from q;

  with q as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select 'N3:doc:' || doc_id, 'push', 'N3', staff_id,
           jsonb_build_object('document', doc_label(doc_type), 'date', expires_on::text)
      from _due where days_left between 1 and 7
    on conflict (key) do nothing returning 1
  ) select count(*)::int into v_n3 from q;

  -- BG-05 · the block. N4 and the cascade fire together (§4.2: "the
  -- automatic block fires at the same moment"), and the push is keyed on
  -- the document so a worker with two documents dead on the same morning
  -- is told about both but blocked once.
  with q as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select 'N4:doc:' || doc_id, 'push', 'N4', staff_id,
           jsonb_build_object('document', doc_label(doc_type), 'date', expires_on::text)
      from _due where days_left <= 0
    on conflict (key) do nothing returning 1
  ) select count(*)::int into v_n4 from q;

  for r in
    select distinct d.staff_id,
           string_agg(distinct doc_label(d.doc_type), ', ' order by doc_label(d.doc_type)) as docs
      from _due d
      join staff s on s.id = d.staff_id
     where d.days_left <= 0
       and s.status = 'compliant'
     group by d.staff_id
  loop
    perform block_worker(r.staff_id, 'auto_document',
                         'Document expired: ' || r.docs, p_now);
    v_blocked := v_blocked + 1;
  end loop;

  -- §4.4 · N14 on a band change. Everyone live is assessed, including the
  -- workers just blocked above — their cap is moot while they are blocked
  -- (§4.4: "there is no cap to calculate because the worker is already
  -- blocked"), so they are excluded by status rather than by timing.
  for r in
    select s.id as staff_id,
           (weekly_cap_for(s.id, v_today)).cap_hours as cap_hours,
           (weekly_cap_for(s.id, v_today)).band      as band,
           cap_band_until(s.term_dates, v_today)     as until,
           n.band                                    as last_band
      from staff s
      left join cap_band_notices n on n.staff_id = s.id
     where s.status = 'compliant'
       and s.left_at is null
       and s.removed_at is null
  loop
    if r.last_band is null then
      -- First assessment. Recorded, not announced: a worker who has not
      -- been told anything has not had anything change, and the first run
      -- of this job must not push N14 at the entire workforce.
      insert into cap_band_notices (staff_id, band, cap_hours, notified_on)
      values (r.staff_id, r.band, r.cap_hours, v_today)
      on conflict (staff_id) do nothing;
    elsif r.last_band is distinct from r.band then
      insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
      values ('N14:staff:' || r.staff_id || ':' || r.band || ':' || v_today,
              'push', 'N14', r.staff_id,
              jsonb_build_object(
                'limit', coalesce(r.cap_hours::text, 'unlimited'),
                'band',  r.band::text,
                'date',  r.until::text))
      on conflict (key) do nothing;
      update cap_band_notices
         set band = r.band, cap_hours = r.cap_hours, notified_on = v_today
       where staff_id = r.staff_id;
      v_n14 := v_n14 + 1;
    end if;
  end loop;

  -- `on commit drop` is the safety net, not the cleanup: it fires at COMMIT,
  -- so a second call inside one transaction would hit "relation _due
  -- already exists". The job itself only ever calls this once per
  -- transaction; the pgTAP suite calls it repeatedly inside one, which is
  -- exactly where a rule that must be idempotent gets proved.
  drop table _due;

  return jsonb_build_object('n1', v_n1, 'n2', v_n2, 'n3', v_n3, 'n4', v_n4,
                            'blocked', v_blocked, 'n14', v_n14);
end $$;

comment on function public.compliance_daily(timestamptz) is
  'BG-04/05 and the §4.4 cap-band change (§7). Idempotent via the outbox key and cap_band_notices; called at 05:00 UK by the compliance-daily Edge Function.';

-- ---------------------------------------------------------------------
-- Same lockdown as every other security definer function in public
-- (docs/14 O7): PostgREST publishes these, and Supabase's default
-- privileges grant EXECUTE to anon and authenticated by name, which a
-- revoke from PUBLIC does not take back. block_worker() alone can strip
-- a worker of every future shift they hold.
-- ---------------------------------------------------------------------
revoke execute on function public.block_worker(uuid, block_kind, text, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.unblock_if_compliant(uuid, date)
  from public, anon, authenticated;
revoke execute on function public.compliance_daily(timestamptz)
  from public, anon, authenticated;
revoke execute on function public.compliance_docs_verified()
  from public, anon, authenticated;

grant execute on function public.block_worker(uuid, block_kind, text, timestamptz) to service_role;
grant execute on function public.unblock_if_compliant(uuid, date)                  to service_role;
grant execute on function public.compliance_daily(timestamptz)                     to service_role;

-- The read-only helpers are `stable`/`immutable` and leak nothing the
-- caller's RLS does not already permit, so they keep the default. The
-- office needs compliance_blockers() to render the Needs review queue.

-- ---------------------------------------------------------------------
-- The registry entry can be enabled now: supabase/functions/compliance-daily
-- exists in this commit, which is what 20260921130927 was waiting for.
--
-- ORDERING, as with booking-tick: enabled here means "install this
-- schedule when schedules are installed", not "something is listening".
-- `install_job_schedules()` is a deploy step and must run AFTER
-- `supabase functions deploy`, or pg_cron starts posting at a 404.
--
-- The entry is every 5 minutes, not daily at 05:00: pg_cron is UTC and
-- 05:00 UK moves with British Summer Time, so is_uk_time() holds the hour
-- and the schedule just keeps knocking.
-- ---------------------------------------------------------------------
update job_schedules
   set enabled = true,
       note = 'BG-04/05 expiry ladder, auto-block with the §4.3 cascade, N14 cap bands (§4). Rules in compliance_daily(); the Edge Function is a thin wrapper gated on is_uk_time(now(), ''05:00''). Deploy functions before running install_job_schedules().'
 where job = 'compliance-daily';
