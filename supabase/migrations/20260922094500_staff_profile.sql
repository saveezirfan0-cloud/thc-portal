-- =====================================================================
-- The staff profile (§9.6) — role qualification, client qualification,
-- and the automatic grant after a clean shift
--
-- §9.6's profile is eight blocks over one worker. Six of them are reads
-- that the directory migration already has the hard part of (RULE-20's
-- cap, §1.7's anonymisation); this migration adds the rest of the reads
-- and, more importantly, the two lists the manager EDITS on this screen:
--
--   Role qualification   — what the worker can do anywhere (staff_roles).
--   Client qualification — where, and in what capacity, they are a known
--                          quantity (client_qualifications). RULE-17's
--                          Wave 1.
--
-- The three write paths a profile already had — Block, Unblock, Reset to
-- candidate and Remove — are compliance's and §1.7's and are not touched
-- here (20260921180312, 20260921190118).
--
-- The one genuinely new rule is the automatic grant. §9.6: "when a worker
-- completes a shift at a client with no unresolved Violation against them
-- (§9.5), the system adds the qualification itself for that client and
-- the role they actually worked". It is a trigger rather than a nightly
-- job because the evidence is the booking itself, and because §9.6 wants
-- the date and the event it came from on the row — a batch job would have
-- to reconstruct both.
-- =====================================================================

create index if not exists client_qualifications_client_role_idx
  on client_qualifications (client_id, role_id);
create index if not exists bookings_staff_status_idx
  on bookings (staff_id, status);
create index if not exists feedback_staff_idx
  on feedback (staff_id);

-- =====================================================================
-- READS
-- =====================================================================

-- ---------------------------------------------------------------------
-- staff_profile_v — the header and the Overview tab
--
-- Built on staff_directory_v so that §1.7's anonymisation and RULE-20's
-- cap have exactly one definition. Everything added here is personal
-- data, so every column is masked for a removed worker in the same
-- expression that reads it: remove_worker() nulls these columns on the
-- row, and this view is what makes a half-run wipe unable to leak
-- anything anyway.
--
-- NI number is masked rather than withheld. §9.6 shows it as ●●●●●●●2B
-- with a "locked" pill — the last two characters are how the office
-- confirms they are looking at the right record when payroll queries one,
-- and the screen has no business holding the rest.
-- ---------------------------------------------------------------------
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
    where b.staff_id = s.id and b.status in ('worked', 'closed'))::int   as shifts_worked,
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

comment on view staff_profile_v is
  'The /staff/:id header, Overview tab and KPI row (§9.6). Extends staff_directory_v, so §1.7''s anonymisation and RULE-20''s cap are not redefined. Every personal column is masked for a removed worker in the view itself, and the NI number, sort code and account number are masked for every worker — the office needs the last characters to confirm a record, never the whole value.';

-- ---------------------------------------------------------------------
-- staff_documents_v — the Documents tab
--
-- One list, in the order §9.6 reads it: what is under review first,
-- because that is the only part with an action on it, then the live
-- evidence, then what a Reset to candidate superseded. Superseded rows
-- stay visible and read-only (§2.12) — they are the record of the
-- previous period and must never satisfy the current check, which
-- current_verified_docs() already enforces.
-- ---------------------------------------------------------------------
create or replace view staff_documents_v with (security_invoker = true) as
select
  c.id,
  c.staff_id,
  c.doc_type,
  doc_label(c.doc_type)                                      as doc_label,
  c.review_status,
  c.review_status = 'superseded'                             as superseded,
  c.file_path,
  c.uploaded_at,
  c.expiry_date,
  doc_expires_on(c.doc_type, c.expiry_date, c.right_to_work_until,
                 s.right_to_work_until, c.uploaded_at)             as expires_on,
  c.ai_confidence,
  c.needs_manual_review,
  c.rejection_reason,
  c.reviewed_at,
  p.full_name                                                as reviewed_by_name,
  c.share_code,
  c.gov_report_path,
  c.right_to_work_until,
  c.term_dates,
  c.completion_date,
  c.awarding_institution
from compliance_docs c
join staff s on s.id = c.staff_id
left join profiles p on p.id = c.reviewed_by;

comment on view staff_documents_v is
  'The §9.6 Documents tab: every document on a worker with its status, expiry, AI confidence and the reviewer''s name for the UK-time audit stamp (§1.8). Superseded rows are flagged rather than filtered — §2.12 keeps them read-only as the record of the previous period.';

-- ---------------------------------------------------------------------
-- staff_client_qualifications_v — the Client qualification tab
--
-- §9.6 wants each row to say HOW it was granted: "manual by <name>" or
-- "automatically from <event>". The two are mutually exclusive by
-- construction (granted_by is null for a system grant), so the view says
-- which rather than leaving every caller to infer it from two nulls.
-- ---------------------------------------------------------------------
create or replace view staff_client_qualifications_v with (security_invoker = true) as
select
  q.id,
  q.staff_id,
  q.client_id,
  cl.name                                                    as client_name,
  q.role_id,
  r.name                                                     as role_name,
  case when q.granted_from_event is not null then 'automatic' else 'manual' end as granted_how,
  q.granted_by,
  p.full_name                                                as granted_by_name,
  q.granted_from_event,
  ev.title                                                   as granted_from_event_title,
  ev.event_date                                              as granted_from_event_date,
  q.granted_at,
  q.do_not_return,
  q.note
from client_qualifications q
join clients cl on cl.id = q.client_id
join roles r on r.id = q.role_id
left join profiles p on p.id = q.granted_by
left join events ev on ev.id = q.granted_from_event;

comment on view staff_client_qualifications_v is
  'The §9.6 Client qualification tab and the §9.7 Qualified staff block, from the worker''s end: client + role, how the entry was granted (manually by whom, or automatically from a named event), the internal note and the Do-not-return flag that is RULE-17''s hard gate.';

-- ---------------------------------------------------------------------
-- staff_shift_history_v — the Shifts tab
--
-- payable_shifts_v already holds RULE-01's intersection, the 15-minute
-- grace, the break deduction and the 4-hour floor. Re-deriving any of
-- that here would be a second answer to the question payroll asks, so
-- this joins to it rather than recomputing.
-- ---------------------------------------------------------------------
create or replace view staff_shift_history_v with (security_invoker = true) as
select
  b.id                                                       as booking_id,
  b.staff_id,
  b.status                                                   as booking_status,
  b.cancel_cause,
  b.self_cancelled,
  sr.id                                                      as shift_id,
  sr.starts_at,
  sr.ends_at,
  r.id                                                       as role_id,
  r.name                                                     as role_name,
  ev.id                                                      as event_id,
  ev.title                                                   as event_title,
  ev.event_date,
  ev.client_id,
  cl.name                                                    as client_name,
  ev.venue_name,
  ps.check_in_at,
  ps.check_out_at,
  ps.kind,
  ps.pay,
  (select count(*) from violations v
    where v.booking_id = b.id)::int                          as violation_count,
  (select count(*) from violations v
    where v.booking_id = b.id and not v.resolved)::int        as unresolved_violation_count
from bookings b
join shift_requirements sr on sr.id = b.shift_id
join roles r on r.id = sr.role_id
join events ev on ev.id = sr.event_id
join clients cl on cl.id = ev.client_id
left join payable_shifts_v ps on ps.booking_id = b.id;

comment on view staff_shift_history_v is
  'The §9.6 Shifts tab: one worker''s bookings with the scheduled role-section window (RULE-18, never the event window), the actual check-in/out and the payable figure read from payable_shifts_v rather than recalculated — RULE-01 has one implementation.';

-- ---------------------------------------------------------------------
-- staff_violations_v — the Violation log on the same tab
--
-- §9.6: "the same entries, the same detail window and the same Resolve
-- action with its mandatory note as the log in §9.5, just scoped to one
-- person". So this carries the same columns that screen needs and the
-- resolve path stays the one function both screens call.
-- ---------------------------------------------------------------------
create or replace view staff_violations_v with (security_invoker = true) as
select
  v.id,
  v.staff_id,
  v.booking_id,
  v.type,
  v.detected_at,
  v.minutes_late,
  v.resolved,
  v.resolved_at,
  v.resolution_note,
  v.actual_finish_at,
  p.full_name                                                as resolved_by_name,
  sr.starts_at,
  sr.ends_at,
  r.name                                                     as role_name,
  ev.id                                                      as event_id,
  ev.title                                                   as event_title,
  ev.event_date,
  cl.name                                                    as client_name,
  ev.venue_name
from violations v
join bookings b on b.id = v.booking_id
join shift_requirements sr on sr.id = b.shift_id
join roles r on r.id = sr.role_id
join events ev on ev.id = sr.event_id
join clients cl on cl.id = ev.client_id
left join profiles p on p.id = v.resolved_by;

comment on view staff_violations_v is
  'The §9.6 Violation log, scoped to one worker. Same rows as the §9.5 monitor — resolving from either surface is the same function and the note is mandatory in both.';

-- ---------------------------------------------------------------------
-- staff_feedback_v — the Feedback tab
--
-- §9.10: client feedback counts toward the rating only once it has been
-- read, and "Mark as read" lives only on the Feedback screen. The view
-- reports `counts_toward_rating` rather than leaving each screen to
-- re-derive that from author_kind and read_at, because getting it wrong
-- shows the manager a rating the scoring engine is not using.
-- ---------------------------------------------------------------------
create or replace view staff_feedback_v with (security_invoker = true) as
select
  f.id,
  f.staff_id,
  f.author_kind,
  case
    when f.author_kind = 'office' then p.full_name
    else cl.name
  end                                                        as author_name,
  f.rating,
  f.text,
  f.read_at,
  f.author_kind = 'office' or f.read_at is not null          as counts_toward_rating,
  f.created_at,
  f.updated_at,
  ev.id                                                      as event_id,
  ev.title                                                   as event_title,
  ev.event_date
from feedback f
join events ev on ev.id = f.event_id
join clients cl on cl.id = ev.client_id
left join profiles p on p.id = f.author_id;

comment on view staff_feedback_v is
  'The §9.6 Feedback tab: client and office entries with the author named. counts_toward_rating applies §9.10''s rule once here — a client entry counts only after it has been marked read, and only on the Feedback screen.';

-- =====================================================================
-- WRITES · role qualification (§9.6)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Adding a role is what makes a worker eligible for that role's
-- invitations at all (§3.4, §6: a worker without the role gets no
-- candidate row, not a gated one).
--
-- Idempotent: the profile's "+ Add role" is a dropdown, and pressing it
-- twice on a role already held must not be an error the manager has to
-- read.
-- ---------------------------------------------------------------------
create or replace function public.add_staff_role(p_staff uuid, p_role uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
begin
  if not exists (select 1 from staff where id = p_staff) then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if not exists (select 1 from roles where id = p_role) then
    raise exception 'unknown_role' using errcode = 'P0001';
  end if;

  insert into staff_roles (staff_id, role_id) values (p_staff, p_role)
  on conflict do nothing;

  return jsonb_build_object('staffId', p_staff::text, 'roleId', p_role::text);
end $$;

comment on function public.add_staff_role(uuid, uuid) is
  '§9.6 role qualification: the worker becomes eligible for this role''s invitations and auto-assign rounds. Idempotent. security invoker, so staff_roles'' admin_all policy is the gate.';

-- ---------------------------------------------------------------------
-- Removing a role, and the one part of it that is not obvious.
--
-- A client qualification names a client AND one of that worker's roles
-- (§9.6), so removing the role leaves rows that no longer describe
-- anything the worker can do. Deleting them with the role is right —
-- EXCEPT where the entry carries Do not return.
--
-- That flag is the only hard gate on the screen: a worker marked do-not-
-- return at a client is excluded from it outright, in both waves, on the
-- Radar and from manual invitation. Deleting the row un-bars them. §9.6
-- is explicit that removing a qualification is not the same as barring
-- someone and that a manager should block rather than delete where a
-- client has asked for someone not to return — so a role removal must
-- not quietly do the deletion the scope tells managers not to do.
--
-- The barring row therefore survives, and the tests pin it.
-- ---------------------------------------------------------------------
create or replace function public.remove_staff_role(p_staff uuid, p_role uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_dropped int := 0;
  v_kept    int := 0;
begin
  delete from staff_roles where staff_id = p_staff and role_id = p_role;

  select count(*)::int into v_kept
    from client_qualifications
   where staff_id = p_staff and role_id = p_role and do_not_return;

  with gone as (
    delete from client_qualifications
     where staff_id = p_staff and role_id = p_role and not do_not_return
    returning 1
  ) select count(*)::int into v_dropped from gone;

  return jsonb_build_object(
    'staffId', p_staff::text,
    'roleId', p_role::text,
    'qualificationsRemoved', v_dropped,
    'doNotReturnKept', v_kept);
end $$;

comment on function public.remove_staff_role(uuid, uuid) is
  '§9.6: drops the role and the client qualifications that named it, but KEEPS any entry carrying Do not return — that flag is the client-scoped hard gate (RULE-17) and deleting the row would un-bar the worker, which §9.6 tells managers not to do.';

-- =====================================================================
-- WRITES · client qualification (§9.6, §9.7)
-- =====================================================================

-- ---------------------------------------------------------------------
-- A manual grant. Editable from either end — the profile's "+ Add client"
-- and the client card's "+ Add staff" are the same function, so the two
-- screens cannot drift.
--
-- The worker must already hold the role: §9.6 defines each entry as "a
-- client and one of that worker's roles". A qualification for a role the
-- worker cannot be invited to is a row auto-assign will never read.
--
-- On conflict the note and the grantor are updated rather than ignored,
-- because re-adding an entry from the client card is how a manager
-- corrects a note — but do_not_return is deliberately NOT touched: an
-- "+ Add staff" must never be the thing that lifts a bar.
-- ---------------------------------------------------------------------
create or replace function public.grant_client_qualification(
  p_staff  uuid,
  p_client uuid,
  p_role   uuid,
  p_note   text default null
) returns uuid
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from staff_roles where staff_id = p_staff and role_id = p_role) then
    raise exception 'A worker can only be qualified at a client for a role they already hold (§9.6)'
      using errcode = 'check_violation';
  end if;

  insert into client_qualifications (client_id, role_id, staff_id, granted_by, note)
  values (p_client, p_role, p_staff, auth.uid(), nullif(btrim(p_note), ''))
  on conflict (client_id, role_id, staff_id) do update
    set note = coalesce(nullif(btrim(p_note), ''), client_qualifications.note),
        granted_by = auth.uid(),
        granted_at = now()
  returning id into v_id;

  return v_id;
end $$;

comment on function public.grant_client_qualification(uuid, uuid, uuid, text) is
  '§9.6 / §9.7 manual client qualification, callable from the profile or the client card. Refuses a role the worker does not hold, and never clears do_not_return — adding somebody back is not how a bar is lifted.';

-- ---------------------------------------------------------------------
-- Removing an entry. §9.6 says plainly what this does not do: "removing
-- it does not stop it being re-granted by a later clean shift". So there
-- is no tombstone here and none is wanted — the manager who means "never
-- again" uses Do not return, which this function refuses to delete for
-- exactly that reason.
-- ---------------------------------------------------------------------
create or replace function public.revoke_client_qualification(p_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v client_qualifications;
begin
  select * into v from client_qualifications where id = p_id;
  if v.id is null then
    raise exception 'unknown_qualification' using errcode = 'P0001';
  end if;
  if v.do_not_return then
    raise exception 'Switch Do not return off before removing this entry — removing it would un-bar the worker at this client (§9.6)'
      using errcode = 'check_violation';
  end if;

  delete from client_qualifications where id = p_id;
  return jsonb_build_object('id', p_id::text, 'removed', true);
end $$;

comment on function public.revoke_client_qualification(uuid) is
  '§9.6: removes a client qualification, manual or automatic. A later clean shift may re-grant it — that is the scope''s stated behaviour, and why an entry carrying Do not return cannot be removed until the flag is switched off.';

-- ---------------------------------------------------------------------
-- Do not return — the only hard gate on the profile (§9.6).
--
-- A reason is required to switch it ON, for the same reason a manual
-- block needs one (§4.3): the flag is shown to the manager reading the
-- client's events under "Unavailable → Do not return … with the
-- manager's reason attached", and an unexplained bar is one nobody can
-- ever decide to lift.
--
-- Switching it off leaves the note in place. It is the record of why the
-- bar existed, and a screen that erased it would make the next manager's
-- decision unauditable.
-- ---------------------------------------------------------------------
create or replace function public.set_do_not_return(
  p_id     uuid,
  p_on     boolean,
  p_reason text default null
) returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v client_qualifications;
begin
  select * into v from client_qualifications where id = p_id;
  if v.id is null then
    raise exception 'unknown_qualification' using errcode = 'P0001';
  end if;

  -- Switching it ON needs a reason of its own. An entry's existing note is
  -- not one: it was written to say why somebody was CLEARED, and reusing it
  -- would put "Do not return — site induction done" under Unavailable on
  -- the client's events. Re-setting a flag that is already on is idempotent
  -- and asks for nothing.
  if p_on and not v.do_not_return and coalesce(btrim(p_reason), '') = '' then
    raise exception 'Do not return needs a reason — it is shown on this client''s events (§9.6)'
      using errcode = 'check_violation';
  end if;

  update client_qualifications
     set do_not_return = p_on,
         note = coalesce(nullif(btrim(p_reason), ''), note)
   where id = p_id;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(),
          case when p_on then 'do_not_return_on' else 'do_not_return_off' end,
          'client_qualification', p_id,
          jsonb_build_object('staffId', v.staff_id::text,
                             'clientId', v.client_id::text,
                             'roleId', v.role_id::text,
                             'reason', nullif(btrim(p_reason), '')));

  return jsonb_build_object('id', p_id::text, 'doNotReturn', p_on);
end $$;

comment on function public.set_do_not_return(uuid, boolean, text) is
  '§9.6 Do not return: the client-scoped hard gate — not invited in either wave, never on the Radar, cannot be invited manually. Requires a reason to switch on, keeps it when switched off, and writes both directions to audit_log.';

-- =====================================================================
-- The automatic grant after a clean shift (§9.6)
-- =====================================================================

-- ---------------------------------------------------------------------
-- "When a worker completes a shift at a client with no unresolved
-- Violation against them (§9.5), the system adds the qualification itself
-- for that client and the role they actually worked, marked 'granted
-- automatically' with the date and the event it came from."
--
-- Four things this has to get right, each of which is a way to grant the
-- wrong thing:
--
--   1. THE ROLE THEY ACTUALLY WORKED, from the booking's role section —
--      never every role they hold. §9.6 says so outright: "Working a
--      Waiting Staff shift at a client does not qualify them as Bar Staff
--      there."
--   2. NO UNRESOLVED VIOLATION on that booking. A violation resolved
--      later makes the shift clean retrospectively, so the check has to
--      run again when one is resolved — see the second trigger.
--   3. NEVER over a do-not-return. The bar is client-wide (auto-assign
--      gates on any do_not_return row at the client, whatever its role),
--      so an automatic grant for a second role there would read as a
--      contradiction on the screen even though the gate still holds.
--   4. NEVER over a manual entry. `on conflict do nothing` keeps the
--      manager's note, their name and their date — a system grant must
--      not overwrite a human's record of why somebody is cleared.
--
-- security definer, because the grant is the system acting rather than
-- the caller: the check-in monitor closing a shift runs as an admin, but
-- the same booking can reach 'worked' from a job, and the row must appear
-- either way.
-- ---------------------------------------------------------------------
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
       and b.status in ('worked', 'closed')
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

comment on function public.grant_qualification_for_booking(uuid) is
  '§9.6''s automatic client qualification: grants client + THE ROLE ACTUALLY WORKED after a completed shift with no unresolved violation, marked as a system grant with the event it came from. Never grants over a do-not-return at that client, and never overwrites a manual entry.';

revoke execute on function public.grant_qualification_for_booking(uuid)
  from public, anon, authenticated;
grant execute on function public.grant_qualification_for_booking(uuid) to service_role;

-- ---------------------------------------------------------------------
-- Trigger 1: the shift completes.
-- ---------------------------------------------------------------------
create or replace function public.bookings_grant_qualification()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.status in ('worked', 'closed')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform grant_qualification_for_booking(new.id);
  end if;
  return null;
end $$;

drop trigger if exists bookings_grant_qualification_t on bookings;
create trigger bookings_grant_qualification_t
after insert or update of status on bookings
for each row execute function public.bookings_grant_qualification();

-- ---------------------------------------------------------------------
-- Trigger 2: the violation that was in the way is resolved.
--
-- Without this, "no unresolved Violation against them" would mean "none
-- at the instant the shift closed" — and a Late that the office resolves
-- the next morning with a note would cost the worker a qualification they
-- earned. §9.5's Resolve is a statement that the shift was fine after
-- all, so it is exactly the moment to look again.
-- ---------------------------------------------------------------------
create or replace function public.violations_grant_qualification()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.resolved and not old.resolved then
    perform grant_qualification_for_booking(new.booking_id);
  end if;
  return null;
end $$;

drop trigger if exists violations_grant_qualification_t on violations;
create trigger violations_grant_qualification_t
after update of resolved on violations
for each row execute function public.violations_grant_qualification();
