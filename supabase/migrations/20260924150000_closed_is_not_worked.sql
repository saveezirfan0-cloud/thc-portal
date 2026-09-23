-- =====================================================================
-- A declined invitation is not a shift worked (§9.6, §3.6)
--
-- The automatic client qualification (§9.6, 20260922094500) fired on a
-- booking reaching 'worked' OR 'closed', and staff_profile_v /
-- onboarding_returning_v counted both as shifts worked. Under §3.6 as
-- 20260924120000 now enforces it, `closed` is ONLY an invitation or
-- application that did not go ahead — declined, withdrawn, or the slot
-- filled by someone else. So a worker who declined an invitation was
-- granted that client and role, and their shift count went up.
--
-- 'worked' is the only completed state. Everything below is restated
-- from its latest definition with that one change.
-- =====================================================================

create or replace function public.grant_qualification_for_booking(p_booking uuid)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  with clean as (
    select ev.client_id, sr.role_id, b.staff_id, ev.id as event_id
      from bookings b
      join shift_requirements sr on sr.id = b.shift_id
      join events ev on ev.id = sr.event_id
     where b.id = p_booking
       and b.status = 'worked'
       and not exists (select 1 from violations v
                        where v.booking_id = b.id and not v.resolved)
       and not exists (select 1 from client_qualifications q
                        where q.staff_id = b.staff_id
                          and q.client_id = ev.client_id
                          and q.do_not_return)
  )
  insert into client_qualifications
         (client_id, role_id, staff_id, granted_by, granted_from_event, granted_at)
  select clean.client_id, clean.role_id, clean.staff_id, null::uuid, clean.event_id, now()
    from clean
  on conflict (client_id, role_id, staff_id) do nothing
  returning id into v_id;

  return v_id;
end $$;

create or replace function public.bookings_grant_qualification()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.status = 'worked'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform grant_qualification_for_booking(new.id);
  end if;
  return null;
end $$;

create or replace view staff_profile_v with (security_invoker = true) as
select
  d.*,
  case when s.removed_at is null then s.email end            as email,
  case when s.removed_at is null then s.phone end            as phone,
  case when s.removed_at is null then s.dob end              as dob,
  case when s.removed_at is null then s.home_address end     as home_address,
  case when s.removed_at is null then s.share_code end       as share_code,
  case
    when s.removed_at is not null or s.ni_number is null then null
    else repeat('●', greatest(length(s.ni_number) - 2, 0)) || right(s.ni_number, 2)
  end                                                        as ni_number_masked,
  s.ni_number is not null                                    as has_ni_number,
  s.term_dates,
  -- §9.6 wants the cap's reason in full — "20 h — term time until
  -- 13.12.2026" — and §8 gives N14 the same shape. cap_band_until() is
  -- that date, and it is asked only of a student: the function assumes a
  -- visa condition, so for anyone else its answer would be a date with no
  -- rule behind it.
  case
    when s.rtw_branch = 'international_student'
      then cap_band_until(s.term_dates, (now() at time zone 'Europe/London')::date)
  end                                                        as weekly_cap_until,
  s.contract_signed_at,
  s.contract_version,
  s.created_at                                               as joined_at,
  s.quiz_attempts,
  -- Bank and HMRC are separate tables, and both are wholly personal data:
  -- the account number is masked to its last four for the same reason as
  -- the NI number, and the sort code to its first pair.
  case when s.removed_at is null then bd.account_holder end  as bank_account_holder,
  case
    when s.removed_at is not null or bd.sort_code is null then null
    else left(bd.sort_code, 2) || '-••-••'
  end                                                        as bank_sort_code_masked,
  case
    when s.removed_at is not null or bd.account_number is null then null
    else '••••' || right(bd.account_number, 4)
  end                                                        as bank_account_masked,
  case when s.removed_at is null then bd.updated_at end      as bank_updated_at,
  case when s.removed_at is null then h.statement end        as hmrc_statement,
  case when s.removed_at is null then h.student_loan end     as hmrc_student_loan,
  case when s.removed_at is null then h.postgraduate_loan end as hmrc_postgraduate_loan,
  case when s.removed_at is null then h.submitted_at end     as hmrc_declared_at,
  -- KPI row (§9.6). Shifts worked and no-shows are history and survive a
  -- removal; the scope keeps "roles and rating" visible on the anonymised
  -- row for the same reason.
  (select count(*) from bookings b
    where b.staff_id = s.id and b.status = 'worked')::int   as shifts_worked,
  (select count(*) from violations v
    where v.staff_id = s.id and v.type = 'no_show' and not v.resolved)::int as no_shows,
  (select count(*) from feedback f
    where f.staff_id = s.id
      and (f.author_kind = 'office' or f.read_at is not null))::int      as feedback_count,
  (select count(*) from compliance_docs c
    where c.staff_id = s.id and c.review_status = 'pending')::int        as documents_pending,
  (select count(*) from client_qualifications q
    where q.staff_id = s.id)::int                                        as qualification_count
from staff_directory_v d
join staff s on s.id = d.id
left join bank_details bd on bd.staff_id = s.id
-- §2.12 supersedes a checklist rather than deleting it, so the profile has
-- to name the live one explicitly — the superseded copy is the previous
-- period's record and is never the worker's current HMRC position.
left join hmrc_checklists h on h.staff_id = s.id and not h.superseded;

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
  (select r.block_reason from public.staff_block_reason_v r where r.staff_id = s.id) as block_reason,
  s.rating,
  s.reliability,
  (select count(*) from bookings b
    where b.staff_id = s.id and b.status = 'worked')::int as shifts_worked
from applications a
join staff s on s.id = a.staff_id
where a.outcome = 'returning_applicant'
  and a.resolved_at is null
  and s.removed_at is null;
