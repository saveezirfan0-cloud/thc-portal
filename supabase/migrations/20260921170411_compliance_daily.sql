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
-- Timing: 05:00 UK, gated by compliance_daily_due() so the pg_cron entry
-- can stay on UTC, the hour survives the DST boundaries (20260921160624),
-- and a missed 05:00 does not defer a block by a day.
--
-- NOT here, and not a gap this migration can close: nothing yet SETS
-- staff.graduated_at or copies a verified letter's term_dates onto the
-- worker. That is the verify action in Compliance → Needs review (§4.1)
-- and the profile (§9.6), neither of which is built. Until one of them
-- writes those two columns, §4.5's graduation band change cannot happen
-- and the N14 it promises cannot fire — the rules here are ready for it
-- and will act the morning after it is written. docs/14 O10.
-- =====================================================================

-- ---------------------------------------------------------------------
-- The date a document actually stops counting, which is not always the
-- date in its `expiry_date` column.
--
--   * University term dates letter (§4.2): the printed graduation date is
--     explicitly NOT the expiry, and neither is anything else printed on
--     it. The letter expires 31 December, so the ladder starts on
--     1 December — one month out, exactly as for every other document.
--     §4.2 rejects deriving the reminder from the printed dates by name:
--     the student does not physically have next year's letter yet, and we
--     would block someone who did nothing wrong.
--
--     One narrow exception, and it is an exception to the calendar and not
--     to that rule (ADR-0011): a letter uploaded in November or December
--     runs to the FOLLOWING 31 December. Without it the ladder is
--     self-defeating — it opens on 1 December precisely to make the
--     student upload next year's letter, and a letter uploaded on the 5th
--     in answer to that reminder would be dead on the 31st. The window is
--     the two months of the ladder, so nothing outside it is widened, and
--     the letter's own contents are never consulted.
--   * Share code report (§4.4): "Right-to-work-until from gov.uk = the
--     expiry date used for reminders" — a different column, and one that
--     lives on the WORKER (staff.right_to_work_until, §2.5), which is
--     where the gov.uk check writes it and where supabase/seed.sql puts
--     it. The document's own copy of it is read first where it is set,
--     because a superseded share code should not be judged by the worker's
--     current date.
--   * Everything else: the confirmed expiry date.
--
-- Null means no expiry — a birth certificate does not run out — and every
-- caller below treats null as "never due".
-- ---------------------------------------------------------------------
create or replace function public.doc_expires_on(
  p_doc_type    doc_type,
  p_expiry      date,
  p_doc_rtw     date,
  p_staff_rtw   date,
  p_uploaded_at timestamptz
) returns date
language sql
immutable
set search_path = public, extensions
as $$
  with up as (
    select (p_uploaded_at at time zone 'Europe/London')::date as d
  )
  select case p_doc_type
    when 'university_term_dates_letter' then
      (select make_date(
         extract(year from d)::int + case when extract(month from d) >= 11 then 1 else 0 end,
         12, 31)
         from up)
    when 'share_code_report' then coalesce(p_doc_rtw, p_staff_rtw, p_expiry)
    else p_expiry
  end
$$;

comment on function public.doc_expires_on(doc_type, date, date, date, timestamptz) is
  '§4.2 effective expiry: the term letter dies 31 December whatever it prints (the following one if uploaded in the ladder window, ADR-0011), the share code report uses right_to_work_until from the doc or the worker, everything else uses expiry_date.';

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
    -- Never null: render() in packages/notifications leaves an unmatched
    -- placeholder in the copy, so a doc_type added later without a label
    -- here would be sent to a worker as the literal "{document}".
    else replace(initcap(replace(p_doc_type::text, '_', ' ')), ' Id', ' ID')
  end
$$;

-- ---------------------------------------------------------------------
-- Two document sets, and the difference between them is a real hole if
-- you only build one.
--
--   current_compliance_docs   the latest non-superseded row per type,
--                             whatever its status. This answers "is
--                             anything waiting on the office?"
--   current_verified_docs     the latest VERIFIED row per type, with the
--                             date it stops counting. This answers "has
--                             anything run out?"
--
-- A rejected passport followed by an accepted one is one document with a
-- history, not two documents one of which is bad — hence the latest row
-- rather than all of them.
--
-- The reason for two: a worker whose passport expires on the 30th and who
-- uploads ANYTHING on the 1st — a blank page — has a pending row that is
-- now the latest of its type. Judge expiry off that set and their expired
-- passport is no longer in it, so no rung of the ladder fires and, worse,
-- BG-05 never blocks them. They keep taking shifts on a dead passport
-- until a manager happens to look at the upload. §4.3 is explicit that
-- the block happens "by itself, with no manager involved", so expiry is
-- measured off the last thing the office actually verified, and the
-- pending upload is caught by the other set instead.
-- ---------------------------------------------------------------------
create or replace function public.current_compliance_docs(p_staff uuid)
returns table (
  doc_id   uuid,
  doc_type doc_type,
  status   review_status
)
language sql
stable
set search_path = public, extensions
as $$
  select distinct on (d.doc_type) d.id, d.doc_type, d.review_status
    from compliance_docs d
   where d.staff_id = p_staff
     and d.review_status <> 'superseded'
   order by d.doc_type, d.uploaded_at desc, d.id
$$;

create or replace function public.current_verified_docs(p_staff uuid)
returns table (
  doc_id     uuid,
  doc_type   doc_type,
  expires_on date
)
language sql
stable
set search_path = public, extensions
as $$
  select distinct on (d.doc_type)
         d.id,
         d.doc_type,
         doc_expires_on(d.doc_type, d.expiry_date, d.right_to_work_until,
                        s.right_to_work_until, d.uploaded_at)
    from compliance_docs d
    join staff s on s.id = d.staff_id
   where d.staff_id = p_staff
     and d.review_status = 'verified'
   order by d.doc_type, d.uploaded_at desc, d.id
$$;

-- ---------------------------------------------------------------------
-- Does the term letter still apply to this worker at all?
--
-- §4.2: "A student who has finished their course should not be chased for
-- next year's term letter at all — that is what the Official University
-- Completion Letter is for (§4.5). Once a completion letter is verified,
-- the term-letter reminder ladder for that worker stops." §4.5 repeats it
-- from the other side: the letter "stops driving that worker's cap and
-- stops generating expiry reminders".
--
-- This is not cosmetic. Without it a graduate is sent N1, N2 and N3 every
-- December and then AUTOMATICALLY BLOCKED on 31 December — losing every
-- future confirmed shift they hold — over a document the scope says no
-- longer applies to them.
--
-- §4.5's own caveat still stands and is not affected: the completion
-- letter changes the study limit, not the visa. A graduate whose share
-- code has run out is still blocked on the share code.
-- ---------------------------------------------------------------------
create or replace function public.term_letter_applies(p_staff uuid, p_on date default current_date)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select not exists (
    select 1 from staff s
     where s.id = p_staff
       and s.graduated_at is not null
       and s.graduated_at <= p_on)
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
    from current_verified_docs(p_staff) d
   where d.expires_on is not null
     and d.expires_on <= p_on
     and (d.doc_type <> 'university_term_dates_letter'
          or term_letter_applies(p_staff, p_on))
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
  p_now    timestamptz default now(),
  -- §10.6 ends in `inactive`, not `blocked`, and 0001_init reserves
  -- cancel_cause = 'left' for it. The cascade is identical; only where the
  -- worker lands differs, so only that is an argument. Defaulted so the
  -- §4.3 and §10.7 callers say nothing.
  p_status staff_status default 'blocked',
  p_cause  text          default 'blocked'
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

  if p_status not in ('blocked', 'inactive') then
    raise exception 'block_worker: p_status must be blocked or inactive, got %', p_status
      using errcode = 'P0001';
  end if;

  -- 1 · blocked (or inactive, for the worker who leaves).
  update staff
     set status = p_status,
         block_kind = case when p_status = 'blocked' then p_kind else null end,
         block_reason = case when p_status = 'blocked' then p_reason else null end,
         leave_reason = case when p_status = 'inactive' then p_reason else leave_reason end,
         left_at      = case when p_status = 'inactive' then p_now   else left_at end
   where id = p_staff;

  -- 2 · every future confirmed allocation is released.
  with released as (
    update bookings b
       set status = 'cancelled', cancelled_at = p_now, cancel_cause = p_cause
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
       set status = 'cancelled', cancelled_at = p_now, cancel_cause = p_cause
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
    'status', p_status::text,
    'kind', p_kind::text,
    'released', v_released,
    'withdrawn', v_withdrawn);
end $$;

comment on function public.block_worker(uuid, block_kind, text, timestamptz, staff_status, text) is
  'The §4.3 cascade: the worker is stopped, future allocations released, open invitations withdrawn. Shared by document expiry (§4.3), the worker who leaves (§10.6, p_status = inactive, p_cause = left) and the in-employment conviction (§10.7, p_kind = conviction_review).';

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
-- holds.
--
-- The answer is ALWAYS a Sunday, and that is the part worth being careful
-- about. §4.4 gives the whole Mon-Sun week the lowest cap in force on any
-- day of it, so a band cannot change mid-week: "A week in which term
-- restarts on the Thursday is a 20-hour week, not a 48-hour one."
--
-- Naming the raw range endpoint instead gets it wrong on both sides. If
-- term restarts on a Thursday, the 48 h band actually ended on the Monday
-- and a push promising it "until Wednesday" is promising hours the worker
-- may not work. If a holiday opens on a Saturday, that week straddles and
-- stays at 20 h, so the 20 h band runs two days longer than the range
-- suggests.
--
-- So: walk forward week by week from this one and return the Sunday
-- before the first week whose BAND differs. The band, not the term state:
-- `term` and `straddle` both give 20 h (§4.4 gives a straddling week the
-- lower cap), so a week that merely starts straddling changes nothing the
-- worker can feel and must not be announced as the end of anything.
--
-- The band is evaluated as a visa-limited, non-graduated student without
-- an opt-out, because that is the only worker whose cap the calendar
-- moves at all. compliance_daily only asks the question for the two
-- calendar-driven bands; everyone else has no end date by construction.
--
-- The horizon is a year, further ahead than any term letter reaches; null
-- out there means nothing on the calendar ends this band, and the sender
-- picks N14's dateless half.
-- ---------------------------------------------------------------------
create or replace function public.cap_band_until(p_holidays daterange[], p_date date)
returns date
language sql
immutable
set search_path = public, extensions
as $$
  with this_week as (select cap_week_start(p_date) as w),
       weeks as (
         select t.w + (n * 7) as w
           from this_week t, generate_series(1, 53) as n
       ),
       changed as (
         select min(weeks.w) as w
           from weeks, this_week
          where (weekly_cap(true, cap_term_state(p_holidays, weeks.w), false, false)).band
                is distinct from
                (weekly_cap(true, cap_term_state(p_holidays, this_week.w), false, false)).band
       )
  select w - 1 from changed
$$;

comment on function public.cap_band_until(daterange[], date) is
  'The Sunday the current cap band holds until (§4.4). Always a Sunday: the Mon-Sun week is the unit, so a band never changes mid-week. Null = nothing on the calendar ends it.';

-- ---------------------------------------------------------------------
-- What N14 calls the band. §8 gives the copy as "... — [term time /
-- university holiday] until [date]", so the enum label cannot go through
-- any more than `university_term_dates_letter` could: nobody reads
-- "your weekly limit is now 20 hours — student_term_20".
-- ---------------------------------------------------------------------
create or replace function public.cap_band_label(p_band cap_band)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select case p_band
    when 'student_term_20'    then 'term time'
    when 'student_holiday_48' then 'university holiday'
    when 'graduated_48'       then 'your completion letter is verified'
    when 'standard_48'        then 'the standard weekly limit'
    when 'uncapped'           then 'you have signed the 48-hour opt-out'
    else p_band::text
  end
$$;

-- ---------------------------------------------------------------------
-- Has today's sweep already run?
--
-- The gate in the Edge Function is a 5-minute UK window, so a deploy, an
-- outage or a cold start that straddles 05:00 skips the whole day. The
-- ladder survives that — the rungs are bands and heal on the next run —
-- but §4.3's block does not: it would not fire until 05:00 tomorrow, and
-- the worker spends a day checking in on an expired right to work.
--
-- So the job asks this as well as the clock: run at 05:00, or run because
-- no run finished successfully today. Two conditions, one of which is
-- always true by 05:05, which makes the ordinary day unchanged and the
-- missed day self-correcting.
-- ---------------------------------------------------------------------
create or replace function public.compliance_daily_due(p_now timestamptz default now())
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select is_uk_time(p_now, '05:00')
      or not exists (
           select 1 from job_runs r
            where r.job = 'compliance-daily'
              and r.ok
              and uk_local(r.finished_at)::date = uk_local(p_now)::date)
$$;

comment on function public.compliance_daily_due(timestamptz) is
  'The 05:00 UK window, or any time after it on a day whose sweep has not yet succeeded (§7). A missed 05:00 must not defer a §4.3 block by 24 hours.';

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
    cross join lateral current_verified_docs(s.id) d
   where s.status in ('compliant', 'blocked')
     and s.left_at is null
     and s.removed_at is null
     and d.expires_on is not null
     -- §4.2: a student who has finished their course is not chased for
     -- next year's term letter at all. Without this the graduate is sent
     -- the whole ladder in December and blocked on the 31st.
     and (d.doc_type <> 'university_term_dates_letter'
          or term_letter_applies(s.id, v_today));

  -- BG-04 · the three rungs. One key per document per rung, so a document
  -- renewed and re-expiring later is a new row and rings again.
  with q as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select 'N1:doc:' || doc_id, 'push', 'N1', staff_id,
           jsonb_build_object('document', doc_label(doc_type),
                              'date', to_char(expires_on, 'DD Mon YYYY'))
      from _due where days_left between 15 and 30
    on conflict (key) do nothing returning 1
  ) select count(*)::int into v_n1 from q;

  with q as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select 'N2:doc:' || doc_id, 'push', 'N2', staff_id,
           jsonb_build_object('document', doc_label(doc_type),
                              'date', to_char(expires_on, 'DD Mon YYYY'))
      from _due where days_left between 8 and 14
    on conflict (key) do nothing returning 1
  ) select count(*)::int into v_n2 from q;

  with q as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select 'N3:doc:' || doc_id, 'push', 'N3', staff_id,
           jsonb_build_object('document', doc_label(doc_type),
                              'date', to_char(expires_on, 'DD Mon YYYY'))
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
           jsonb_build_object('document', doc_label(doc_type),
                              'date', to_char(expires_on, 'DD Mon YYYY'))
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
           c.cap_hours,
           c.band,
           case when c.band in ('student_term_20', 'student_holiday_48')
                then cap_band_until(s.term_dates, v_today) end as until,
           n.band                                as last_band
      from staff s
      cross join lateral weekly_cap_for(s.id, v_today) c
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
      -- Two halves, like N9's: §8's copy ends "until [date]", and two of
      -- the five bands have no date to put there — a graduate's letter is
      -- permanent and an opt-out lasts until it is revoked. render() in
      -- packages/notifications leaves an unmatched placeholder in the
      -- string as-is, so a null date would be SENT as the literal
      -- "{date}". The variant picks copy that does not ask for one.
      insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
      values ('N14:staff:' || r.staff_id || ':' || r.band || ':' || v_today,
              'push', 'N14', r.staff_id,
              jsonb_strip_nulls(jsonb_build_object(
                'variant', case when r.band = 'uncapped' then 'uncapped'
                                when r.until is null    then 'open'
                                else 'dated' end,
                'limit',   r.cap_hours::text,
                'band',    cap_band_label(r.band),
                'date',    to_char(r.until, 'DD Mon YYYY'))))
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
revoke execute on function public.block_worker(uuid, block_kind, text, timestamptz, staff_status, text)
  from public, anon, authenticated;
revoke execute on function public.unblock_if_compliant(uuid, date)
  from public, anon, authenticated;
revoke execute on function public.compliance_daily(timestamptz)
  from public, anon, authenticated;
revoke execute on function public.compliance_daily_due(timestamptz)
  from public, anon, authenticated;
revoke execute on function public.compliance_docs_verified()
  from public, anon, authenticated;

grant execute on function public.block_worker(uuid, block_kind, text, timestamptz, staff_status, text) to service_role;
grant execute on function public.unblock_if_compliant(uuid, date)                  to service_role;
grant execute on function public.compliance_daily(timestamptz)                     to service_role;
grant execute on function public.compliance_daily_due(timestamptz)                 to service_role;

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
