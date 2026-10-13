-- =====================================================================
-- Migration 20261013190000 · A SpudBros person who applied under another
--                            email skips the interview too (ADR-0125;
--                            owner request, 13.10.2026)
--
-- ADR-0118 skips the Willo interview for everyone marked SpudBros Express.
-- Marking comes from the link they applied through (/apply/spudbros) or
-- from the invite list, and the list is matched on EMAIL (ADR-0107). So
-- somebody on the list as SpudBros who applied through the ordinary /apply
-- with a different address was never marked, and was sent the interview
-- like a THC applicant. On 13.10 Charlotte Crossley-Smith was listed under
-- one address, applied under another, and sat in Interview requested.
-- ADR-0123's Link fixes it, but only once the office spots it and clicks.
-- Owner: "make sure any current or future SpudBros isn't asked for an
-- interview".
--
-- Now the list's SpudBros rows also mark by NAME, but only the restrictive
-- half and only for somebody still awaiting the interview:
--
--   1 · spudbros_listed_by_name() — candidates in interview_requested /
--       interview_completed, not SpudBros, no Payroll ID, whose own address
--       is not on the list, and whom neither the list (roster.matched,
--       roster.linked) nor the office (staff.scheduling_set) has ever placed,
--       paired with a SpudBros row nobody has applied for by email: same
--       first name and same last word of the surname, two words each side.
--       The pairing invite_roster_possible_matches() shows the office.
--
--   2 · spudbros_mark_listed_by_name() marks each of them SpudBros Express
--       (THC shifts off) and audits roster.spudbros_by_name with the list
--       address. Nothing else moves: no Payroll ID, the row stays, so it is
--       still shown under "Applied under another email" and the office's
--       Link still gives the Payroll ID. spudbros_skip_due() runs it first,
--       so the every-minute sweep then takes them to Documents as ADR-0118
--       does (current ones included — Charlotte is moved on the first run).
--
--   3 · willo_invite_due() also leaves them out, so a sweep that failed
--       before marking can never send them a Willo invitation instead.
--
-- The office's word wins: anyone it set on the profile (Scheduling) is
-- never marked by name, so unticking SpudBros on a wrongly paired THC
-- applicant sticks. A Willo invitation already sent stays in Willo, as for
-- the nine in ADR-0118.
-- pgTAP: supabase/tests/814_spudbros_listed_by_name.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · Who is on the list as SpudBros under another address
-- ---------------------------------------------------------------------
create or replace function public.spudbros_listed_by_name()
returns table (
  staff_id    uuid,
  entry_id    uuid,
  entry_email text
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with s as (
    select st.id, payroll_name_key(st.first_name, st.last_name) as k
      from staff st
     where st.status in ('interview_requested', 'interview_completed')
       and st.removed_at is null
       and not st.spudbros_express
       and st.payroll_id is null
       -- Their own address is on the list: the list has decided by email.
       and not exists (select 1 from invite_roster o where o.email = lower(btrim(st.email)))
       -- The list or the office has placed them already: never second-guessed.
       and not exists (select 1 from audit_log a
                        where a.entity = 'staff' and a.entity_id = st.id
                          and a.action in ('roster.matched', 'roster.linked', 'staff.scheduling_set'))
  ), r as (
    select ir.id, ir.email, payroll_name_key(ir.first_name, ir.last_name) as k
      from invite_roster ir
     where ir.grp = 'spudbros'
       and not exists (select 1 from staff o
                        where lower(btrim(o.email)) = ir.email and o.removed_at is null)
  )
  select s.id, r.id, r.email
    from s
    join r on split_part(s.k, ' ', 1) = split_part(r.k, ' ', 1)
          and regexp_replace(s.k, '^.* ', '') = regexp_replace(r.k, '^.* ', '')
   -- Two words at least on each side, so "Amrita" alone matches nobody.
   where position(' ' in s.k) > 0 and position(' ' in r.k) > 0
$$;

comment on function public.spudbros_listed_by_name() is
  'ADR-0125: candidates awaiting the interview, not SpudBros, with no Payroll ID, whose address is not on the invite list and whom neither the list nor the office has placed, each paired with a SpudBros list row nobody has applied for by email (same first name and last word of the surname). Internal: read by spudbros_mark_listed_by_name() and willo_invite_due().';

-- ---------------------------------------------------------------------
-- 2 · Mark them SpudBros (the restrictive half only)
-- ---------------------------------------------------------------------
create or replace function public.spudbros_mark_listed_by_name()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_n integer;
begin
  with m as (
    select l.staff_id,
           jsonb_agg(l.entry_email order by l.entry_email) as emails
      from spudbros_listed_by_name() l
     group by l.staff_id
  ), marked as (
    update staff s
       set spudbros_express = true,
           thc_shifts_enabled = false
      from m
     where s.id = m.staff_id
       -- Re-checked under the row lock: a racing sweep marked them first.
       and not s.spudbros_express
       and s.status in ('interview_requested', 'interview_completed')
    returning s.id, m.emails
  )
  insert into audit_log (actor, action, entity, entity_id, data)
  select null, 'roster.spudbros_by_name', 'staff', marked.id,
         jsonb_build_object('staffId', marked.id::text, 'listEmails', marked.emails)
    from marked;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

comment on function public.spudbros_mark_listed_by_name() is
  'ADR-0125: marks SpudBros Express (THC shifts off) every candidate spudbros_listed_by_name() names and audits roster.spudbros_by_name with the list address(es). No Payroll ID moves and the list row stays for the office''s Link. Run by spudbros_skip_due() before it leases. Internal.';

-- ---------------------------------------------------------------------
-- 3 · spudbros_skip_due(): 20261012150000's body, marking first
-- ---------------------------------------------------------------------
create or replace function public.spudbros_skip_due(
  p_limit integer     default 20,
  p_now   timestamptz default now()
) returns table (
  staff_id uuid,
  email    text,
  user_id  uuid,
  attempt  integer
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
  -- 20261013190000: SpudBros on the list under another address are
  -- SpudBros too, so they are leased below like anyone marked.
  perform spudbros_mark_listed_by_name();

  for r in
    select * from staff s
     where s.spudbros_express
       and s.status in ('interview_requested', 'interview_completed')
       and s.removed_at is null
       and not spudbros_skip_blocked(s.id)
     order by s.onboarding_started_at, s.id
     for update skip locked
  loop
    exit when v_taken >= greatest(coalesce(p_limit, 20), 1);

    select count(*)::int, max(a.at) into v_attempts, v_last
      from audit_log a
     where a.entity_id = r.id
       and a.action = 'spudbros_skip_claim'
       and a.entity = 'staff'
       and a.at >= r.onboarding_started_at;

    continue when v_last is not null
              and v_last > p_now - least(interval '5 minutes' * power(2, greatest(v_attempts - 1, 0)),
                                         interval '6 hours');

    insert into audit_log (at, actor, action, entity, entity_id, data)
    values (p_now, null, 'spudbros_skip_claim', 'staff', r.id,
            jsonb_build_object('attempt', v_attempts + 1));

    staff_id := r.id;
    email    := r.email;
    user_id  := r.user_id;
    attempt  := v_attempts + 1;
    v_taken  := v_taken + 1;
    return next;
  end loop;
end $$;

comment on function public.spudbros_skip_due(integer, timestamptz) is
  '20261012150000 (ADR-0118): leases up to p_limit SpudBros Express candidates still in interview_requested / interview_completed (never one spudbros_skip_blocked() names), backing off 5 min doubling to 6 h per person per onboarding period (audit_log spudbros_skip_claim). First marks SpudBros anyone on the list as SpudBros under another address (spudbros_mark_listed_by_name, ADR-0125). The willo-invite sweep mints each one''s login and calls spudbros_skip_interview(). Service role only.';

-- ---------------------------------------------------------------------
-- 4 · willo_invite_due(): 20261012150000's body plus one predicate
-- ---------------------------------------------------------------------
create or replace function public.willo_invite_due(
  p_limit integer     default 20,
  p_now   timestamptz default now()
) returns table (
  staff_id            uuid,
  first_name          text,
  last_name           text,
  email               text,
  phone               text,
  attempt             integer,
  known_candidate_id  text,
  prior_candidate_ids text[]
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
       -- 20261012150000: SpudBros Express staff do not do the interview.
       and not s.spudbros_express
       -- 20261013190000: nor SpudBros on the list under another address.
       and s.id not in (select l.staff_id from spudbros_listed_by_name() l)
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

    -- A key Willo gave us this period that nobody holds: link it, do not
    -- create again. The newest wins if there were ever two.
    select a.data ->> 'willoCandidateId' into known_candidate_id
      from audit_log a
     where a.entity = 'staff' and a.entity_id = r.id
       and a.action = 'willo_invite_created'
       and a.at >= r.onboarding_started_at
       and not exists (select 1 from staff o
                        where o.willo_candidate_id = a.data ->> 'willoCandidateId')
     order by a.at desc, a.id desc
     limit 1;

    -- Keys from earlier periods: never to be re-linked (§2.12). A retired
    -- key is from an earlier period by definition — its row is written in
    -- the Reset's own transaction, so its `at` equals the new period's
    -- start and a time filter would miss it.
    select coalesce(array_agg(distinct a.data ->> 'willoCandidateId'), '{}')
      into prior_candidate_ids
      from audit_log a
     where a.entity = 'staff' and a.entity_id = r.id
       and (a.action = 'willo_candidate_retired'
            or (a.action = 'willo_invite_created' and a.at < r.onboarding_started_at))
       and a.data ->> 'willoCandidateId' is not null;

    v_taken    := v_taken + 1;
    return next;
  end loop;
end $$;

comment on function public.willo_invite_due(integer, timestamptz) is
  '§2.4/§2.12: leases up to p_limit candidates in interview_requested with no Willo candidate yet (new applicants and resets), backing off 5 min doubling to 6 h per person per onboarding period. Each lease is an audit_log willo_invite_claim row. known_candidate_id = a key recorded this period by willo_invite_created and linked to nobody (link it, do not create); prior_candidate_ids = keys from earlier periods (never re-link). SpudBros Express staff (20261012150000) and SpudBros on the list under another address (20261013190000, ADR-0125) are never leased: no interview. Service role only.';

revoke execute on function public.spudbros_listed_by_name()      from public, anon, authenticated;
revoke execute on function public.spudbros_mark_listed_by_name() from public, anon, authenticated;

-- Those already waiting are marked now; the next sweep takes them on to
-- Documents.
select public.spudbros_mark_listed_by_name();
