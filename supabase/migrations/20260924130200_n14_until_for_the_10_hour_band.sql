-- =====================================================================
-- §4.4 / §8 N14 · "until [date]" for the 10-hour band
--
-- compliance_daily()'s N14 loop (20260921170411) asked cap_band_until()
-- for the Sunday a band holds until only when the band was
-- student_term_20 or student_holiday_48. 20260922093100 added the Student
-- visa's below-degree-level band, student_term_10, and recorded (its §8)
-- that the list was not widened — so a 10-hour student moving into term
-- got N14's dateless half: "Your weekly limit is now 10 hours — term
-- time." instead of "... term time until 13 Dec 2026."
--
-- The 10-hour band moves on exactly the same calendar as the 20-hour one
-- (term → holiday → term, straddling weeks at the lower cap), and
-- cap_band_until() evaluates that calendar for a degree-level student:
-- the Sundays at which term_20 ↔ holiday_48 flips are the Sundays at
-- which term_10 ↔ holiday_48 flips. So the only change is adding the band
-- to the list; the payload shape, the variants and the §8 copy in
-- packages/notifications are untouched ("dated" already exists).
--
-- The function is restated whole because plpgsql has no partial replace.
-- Everything else below is byte-for-byte 20260921170411; the grants on
-- compliance_daily(timestamptz) survive `create or replace`.
-- =====================================================================
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
           -- 20260924130200: the 10 h band is calendar-driven too.
           case when c.band in ('student_term_10', 'student_term_20', 'student_holiday_48')
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
  'BG-04/05 and the §4.4 cap-band change (§7). Idempotent via the outbox key and cap_band_notices; called at 05:00 UK by the compliance-daily Edge Function. N14 names the Sunday a calendar-driven band (term 10 / term 20 / holiday 48) holds until (20260924130200).';
