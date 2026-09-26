-- =====================================================================
-- Migration 20260930200100 · the staff additions — schema only
--   docs/19-staff-features-plan.md, Phase 0-A; ADR-0043 … ADR-0047
--   (additions to Scope v1.6, status proposed — awaiting THC)
--
-- Five features the product owner approved on 25.09.2026, each an addition
-- to the scope with its own ADR. This migration lays the data for all five
-- and NOTHING that a worker or the office can call yet: the RPCs are the
-- Phase-1 migrations (Agent A 20260930201000/110100, B 120000, C 130000,
-- D 140000), which reference only what is created here and what already
-- exists.
--
--   §1 staff_unavailability      ADR-0043 availability calendar — a hard gate
--                                for automated invitations only
--   §2 staff_emergency_contacts  ADR-0044 office-only worker data, never on a
--                                client document
--   §3 profile_change_requests   ADR-0045 request a change of name or photo
--   §4 shift_offers,             ADR-0046 offer up a shift: released only
--      shift_offer_notices       when a confirmed replacement takes it
--   §5 staff_referral_codes,     ADR-0047 refer a friend: recorded, no reward
--      application_referrals
--
-- The rules every table here keeps (docs/19 §0):
--
--   1. The client sees none of it. No client policy and no client_* view
--      reads from any of the seven (ADR-0004/0026); 001_rls_guard keeps its
--      empty client-policy set and 700 checks pg_depend for the views.
--   2. Workers read and write only through definer RPCs (ADR-0031, the
--      staff_caller() pattern). The staff role holds NO policy on any of the
--      seven — not even a self read.
--   3. Admin reads; every write is a definer RPC or the service role. One
--      `admin_read` select policy per table, the rtw_checks shape. All seven
--      are in OWNED_BY_RPC in scripts/check-write-paths.mjs.
--   4. State changes follow the repo rule: one machine in
--      packages/domain/src/state.ts, one transitions function, one
--      *_state_guard trigger, and a *.vectors.json both suites are held to
--      (701 here; Vitest in packages/domain).
--   5. GDPR removal by trigger (§1.7): staff_removed_purge_additions fires
--      after update of removed_at on staff, so remove_worker() is not
--      restated. Not RPC-callable (20260927161000).
--
-- Also here, because the vocabulary is shared and Phase 1 must not race
-- for it: bookings_cancel_cause_check gains 'handed_over' (ADR-0046,
-- restated from 20260924120000 with the one value added), and
-- booking_reopenable_by() classifies it 'never' (restated from main's
-- 20260930110100, its latest body, with the one line added). booking_source
-- gained 'offer' in 20260930200000, alone for the reason given there.
--
-- Forward-only. Nothing here edits an earlier migration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0 · bookings.cancel_cause += 'handed_over' (ADR-0046, RULE-04 §3.6)
--
-- The one cause take_offered_shift() writes on the ORIGINAL booking when a
-- confirmed replacement takes it. It is a `cancelled` cause, and like
-- self_cancel the row also carries self_cancelled = true, which is what
-- bars the offerer from the event (excludesFromEvent('handed_over'), Q15).
--
-- 20260924120000's CHECK, restated exactly with the value added. Adding a
-- value only widens the set, so every existing row still passes.
-- ---------------------------------------------------------------------
alter table bookings drop constraint if exists bookings_cancel_cause_check;
alter table bookings add constraint bookings_cancel_cause_check check (
  cancel_cause is null
  or (status = 'cancelled' and cancel_cause in (
        'office_withdraw', 'ready_cutoff', 'self_cancel', 'handed_over', 'overlap_auto_withdraw',
        'event_cancelled', 'blocked', 'blocked_invite', 'left', 'left_invite',
        'gdpr', 'gdpr_invite'))
  or (status = 'closed' and cancel_cause in ('slot_taken', 'declined', 'withdrawn_by_worker'))
);

comment on column bookings.cancel_cause is
  'Why the booking left the live states (Scope §3.6). cancelled: office_withdraw · ready_cutoff · self_cancel · handed_over (ADR-0046) · overlap_auto_withdraw · event_cancelled · blocked · blocked_invite · left · left_invite · gdpr · gdpr_invite. closed: slot_taken · declined · withdrawn_by_worker. Null while live. CANCEL_CAUSES in packages/domain/src/state.ts; bookings_cancel_cause_check.';

-- ---------------------------------------------------------------------
-- 0b · booking_reopenable_by() += 'handed_over' → 'never' (ADR-0046)
--
-- main's 20260930110100 (D33, ADR-0037) — the latest body — byte for byte
-- with one `when` added. A completed hand-over sets self_cancelled, so
-- invite_worker() and bookings_self_cancel_is_final already refuse to
-- reopen the row; this makes the classification say so too, so the SQL
-- and bookingReopenableBy() in packages/domain/src/reopen.ts agree cause
-- for cause (pgTAP 701). Without it 'handed_over' fell to the `else` and
-- read 'person'.
-- ---------------------------------------------------------------------
create or replace function public.booking_reopenable_by(p_status booking_status, p_cause text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select case
    when p_status = 'closed' then
      case coalesce(p_cause, '')
        when 'slot_taken' then 'anyone'
        else 'person'                     -- declined · withdrawn_by_worker · legacy null
      end
    when p_status = 'cancelled' then
      case coalesce(p_cause, '')
        when 'self_cancel'     then 'never'
        when 'handed_over'     then 'never'   -- ADR-0046: sets self_cancelled, the same bar
        when 'event_cancelled' then 'never'
        when 'gdpr'            then 'never'
        when 'gdpr_invite'     then 'never'
        when 'overlap_auto_withdraw' then 'anyone'
        when 'blocked'         then 'anyone'
        when 'blocked_invite'  then 'anyone'
        when 'left'            then 'anyone'
        when 'left_invite'     then 'anyone'
        else 'person'                     -- office_withdraw · ready_cutoff · legacy null
      end
    else null                             -- a live row: invited, applied, confirmed, worked, turned_away
  end
$$;

comment on function public.booking_reopenable_by(booking_status, text) is
  'Who may reopen an ended booking row on the same section (§3.6, ADR-0037): ''never'' (self_cancel — RULE-04 — handed_over — ADR-0046, the same bar — event_cancelled, gdpr), ''anyone'' (ended by circumstance: slot_taken, overlap_auto_withdraw, a block/leave cascade — an auto-assign round may re-invite), ''person'' (ended by a decision: declined, withdrawn_by_worker, office_withdraw, ready_cutoff — only the office''s manual invite or the worker''s own Radar application reopens it). Null for a live row. Mirrors bookingReopenableBy() in packages/domain/src/state.ts.';

revoke execute on function public.booking_reopenable_by(booking_status, text) from public, anon;
grant  execute on function public.booking_reopenable_by(booking_status, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- §1 · staff_unavailability (ADR-0043)
--
-- One row per entry: a half-open, finite, non-empty tstzrange of at most 31
-- UK calendar days. No reason column, on purpose — a reason field invites
-- health data (Q10). `series_id` ties the copies of one "repeat weekly"
-- together so the worker can delete the series.
--
-- The 31-day ceiling and the all-day shape are read in UK wall clock, so a
-- 31-day entry across the October changeover (31 days + 1 hour of absolute
-- time) is still 31 days, and an all-day entry is UK midnight to UK
-- midnight whichever offset each end has.
-- ---------------------------------------------------------------------
create table if not exists staff_unavailability (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references staff(id) on delete cascade,
  period     tstzrange not null,
  all_day    boolean not null default false,
  series_id  uuid,
  created_at timestamptz not null default now(),
  constraint staff_unavailability_period_shape check (
    not isempty(period)
    and not lower_inf(period) and not upper_inf(period)
    and lower_inc(period) and not upper_inc(period)),
  constraint staff_unavailability_period_max_31_days check (
    (upper(period) at time zone 'Europe/London')
      <= (lower(period) at time zone 'Europe/London') + interval '31 days'),
  constraint staff_unavailability_all_day_midnights check (
    not all_day
    or ((lower(period) at time zone 'Europe/London')::time = time '00:00'
        and (upper(period) at time zone 'Europe/London')::time = time '00:00'))
);

create index if not exists staff_unavailability_period_gist
  on staff_unavailability using gist (period);
create index if not exists staff_unavailability_staff_idx
  on staff_unavailability (staff_id);
create index if not exists staff_unavailability_series_idx
  on staff_unavailability (series_id) where series_id is not null;

comment on table staff_unavailability is
  'ADR-0043: days and times a worker has said they cannot work. A hard gate for automated invitations and offer pushes only — never for a manual invite, the worker''s own Accept / apply / take, an open invitation or a confirmed booking. No reason column (Q10). Admin-read; the worker reads and writes through definer RPCs (docs/19 §1). Deleted on GDPR removal.';
comment on column staff_unavailability.period is
  'Half-open [start, end) in UTC, built by unavailability_range() from UK dates and times. At most 31 UK calendar days.';
comment on column staff_unavailability.series_id is
  'Shared by the copies of one "repeat weekly for N weeks" entry, so the series can be deleted together.';

-- The builder. UK dates and times in, a half-open range out. All day =
-- UK midnight to UK midnight after the last date (23 h / 25 h on the
-- changeover days). A window whose end is at or before its start on one
-- date runs overnight into the next UK date; from == to is not a window.
-- The TS half is unavailabilityRange() in packages/domain/src/availability.ts;
-- availability.vectors.json holds both (701).
create or replace function public.unavailability_range(
  p_from_date date,
  p_to_date   date default null,
  p_from      time default null,
  p_to        time default null
) returns tstzrange
language plpgsql
immutable
set search_path = public, extensions
as $$
declare
  v_to_date date := coalesce(p_to_date, p_from_date);
  v_end_date date;
  v_start timestamptz;
  v_end   timestamptz;
begin
  if p_from_date is null or v_to_date < p_from_date or (p_from is null) <> (p_to is null) then
    raise exception 'bad_window' using errcode = '22023',
      hint = 'ADR-0043: a date (or range) and either both times or neither.';
  end if;

  if p_from is null then
    v_start := p_from_date::timestamp at time zone 'Europe/London';
    v_end   := (v_to_date + 1)::timestamp at time zone 'Europe/London';
  else
    if v_to_date = p_from_date then
      if p_to = p_from then
        raise exception 'bad_window' using errcode = '22023',
          hint = 'ADR-0043: from and to are the same time.';
      end if;
      v_end_date := case when p_to < p_from then p_from_date + 1 else p_from_date end;
    else
      v_end_date := v_to_date;
    end if;
    v_start := (p_from_date + p_from) at time zone 'Europe/London';
    v_end   := (v_end_date + p_to) at time zone 'Europe/London';
  end if;

  if v_end <= v_start then
    raise exception 'bad_window' using errcode = '22023';
  end if;
  return tstzrange(v_start, v_end, '[)');
end $$;

comment on function public.unavailability_range(date, date, time, time) is
  'ADR-0043: the half-open range one availability entry covers, from UK dates and times (Europe/London). All day when both times are null; to <= from on one date runs overnight; raises bad_window (22023) for from == to, one time alone, or to_date before from_date. Mirrors unavailabilityRange() in packages/domain; availability.vectors.json holds both.';

-- The gate. `&&` against the ROLE SECTION's window (RULE-18), half-open on
-- both sides, so an entry ending at 17:00 misses a section starting then.
-- Invoker on purpose: inside the definer engine functions it runs as their
-- owner and sees every row; called by the office it rides admin_read; a
-- worker calling it directly sees no rows at all and always gets false, so
-- it cannot be used to read another worker's calendar.
create or replace function public.staff_unavailable(
  p_staff  uuid,
  p_starts timestamptz,
  p_ends   timestamptz
) returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select p_ends > p_starts
     and exists (select 1 from staff_unavailability u
                  where u.staff_id = p_staff
                    and u.period && tstzrange(p_starts, p_ends, '[)'))
$$;

comment on function public.staff_unavailable(uuid, timestamptz, timestamptz) is
  'ADR-0043: whether the worker has an availability entry overlapping [p_starts, p_ends) — pass the role section''s window (RULE-18). The gate invite_worker(''auto''|''escalation'') and the offer pushes apply (Agent A); never applied to a manual invite or anything the worker does. Invoker: a worker calling it reads no rows.';

-- ---------------------------------------------------------------------
-- §2 · staff_emergency_contacts (ADR-0044)
--
-- One optional contact per worker. A separate table, not a staff column:
-- that keeps it out of #44's column-grant regime and out of every staff
-- view, and it is worker personal data the client must never reach
-- (§11.3's allocation sheet and timesheet are client documents).
-- The phone is E.164, the /apply rule (submit_application()).
-- ---------------------------------------------------------------------
create table if not exists staff_emergency_contacts (
  staff_id     uuid primary key references staff(id) on delete cascade,
  name         text not null,
  relationship text not null,
  phone        text not null,
  updated_at   timestamptz not null default now(),
  -- The auth uid (= profiles.id) of whoever saved it: the worker, or the
  -- office (office_save_emergency_contact, which also writes audit_log).
  updated_by   uuid references profiles(id) on delete set null,
  constraint staff_emergency_contacts_name check (
    name = btrim(name) and char_length(name) between 1 and 100),
  constraint staff_emergency_contacts_relationship check (
    relationship = btrim(relationship) and char_length(relationship) between 1 and 40),
  constraint staff_emergency_contacts_phone check (phone ~ '^\+[1-9][0-9]{6,14}$')
);

create index if not exists staff_emergency_contacts_updated_by_idx
  on staff_emergency_contacts (updated_by);

comment on table staff_emergency_contacts is
  'ADR-0044: a worker''s optional emergency contact. Office-only worker personal data: never on a client document, never in a client_* view, never in packages/pdf. Admin-read; written through definer RPCs (docs/19 §2). Deleted on GDPR removal.';
comment on column staff_emergency_contacts.phone is
  'E.164, ^\+[1-9][0-9]{6,14}$ — the /apply rule. normaliseEmergencyPhone() in packages/domain strips what a person types between the digits.';

-- ---------------------------------------------------------------------
-- §3 · profile_change_requests (ADR-0045)
--
-- §10.1 locks the name and the photo; this is the office's queue for a
-- correction. One pending request per worker per kind. The proposed values
-- are immutable once written — the office approves exactly what was asked
-- — except that GDPR removal anonymises them (§1.7). A rejection carries a
-- reason the worker is shown (the compliance_docs.rejection_reason
-- precedent). `previous_value` is the snapshot taken at the decision.
-- ---------------------------------------------------------------------
create table if not exists profile_change_requests (
  id                  uuid primary key default gen_random_uuid(),
  staff_id            uuid not null references staff(id) on delete cascade,
  kind                text not null,
  status              text not null default 'pending',
  proposed_first_name text,
  proposed_last_name  text,
  -- The worker's own upload in the photos bucket: <staff_id>/…
  proposed_photo_path text,
  -- Name evidence in the documents bucket: <staff_id>/change-requests/…
  evidence_path       text,
  worker_note         text,
  previous_value      jsonb,
  -- clock_timestamp(): "oldest first" is ordered on it.
  created_at          timestamptz not null default clock_timestamp(),
  decided_at          timestamptz,
  decided_by          uuid references profiles(id) on delete set null,
  applied_at          timestamptz,
  decision_reason     text,
  constraint profile_change_requests_kind check (kind in ('name', 'photo')),
  constraint profile_change_requests_status check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  -- A name request carries both names and its evidence (Q13), no photo.
  constraint profile_change_requests_name_shape check (
    kind <> 'name'
    or (proposed_first_name is not null and proposed_last_name is not null
        and evidence_path is not null and proposed_photo_path is null)),
  -- A photo request carries the photo, no names.
  constraint profile_change_requests_photo_shape check (
    kind <> 'photo'
    or (proposed_photo_path is not null
        and proposed_first_name is null and proposed_last_name is null)),
  constraint profile_change_requests_first_name check (
    proposed_first_name is null
    or (proposed_first_name = btrim(proposed_first_name)
        and char_length(proposed_first_name) between 1 and 100)),
  constraint profile_change_requests_last_name check (
    proposed_last_name is null
    or (proposed_last_name = btrim(proposed_last_name)
        and char_length(proposed_last_name) between 1 and 100)),
  -- Only the worker's own folder, so a forged request cannot point at
  -- somebody else's selfie or document.
  constraint profile_change_requests_photo_path_own check (
    proposed_photo_path is null
    or (starts_with(proposed_photo_path, staff_id::text || '/')
        and char_length(proposed_photo_path) > char_length(staff_id::text) + 1
        and strpos(proposed_photo_path, '..') = 0)),
  constraint profile_change_requests_evidence_path_own check (
    evidence_path is null
    or (starts_with(evidence_path, staff_id::text || '/change-requests/')
        and char_length(evidence_path) > char_length(staff_id::text) + 17
        and strpos(evidence_path, '..') = 0)),
  constraint profile_change_requests_note check (worker_note is null or char_length(worker_note) <= 500),
  constraint profile_change_requests_reason check (decision_reason is null or char_length(decision_reason) <= 300),
  -- Required on reject, and shown to the worker.
  constraint profile_change_requests_reject_reason check (
    status <> 'rejected' or (decision_reason is not null and btrim(decision_reason) <> '')),
  -- decided_at is set exactly when the request leaves pending (the guard).
  constraint profile_change_requests_decided check ((status = 'pending') = (decided_at is null)),
  constraint profile_change_requests_applied check (applied_at is null or status = 'approved'),
  constraint profile_change_requests_previous_value check (
    previous_value is null or jsonb_typeof(previous_value) = 'object')
);

create unique index if not exists profile_change_requests_one_pending
  on profile_change_requests (staff_id, kind) where status = 'pending';
create index if not exists profile_change_requests_staff_idx
  on profile_change_requests (staff_id, created_at desc);
create index if not exists profile_change_requests_queue_idx
  on profile_change_requests (created_at) where status = 'pending';
create index if not exists profile_change_requests_decided_by_idx
  on profile_change_requests (decided_by);

comment on table profile_change_requests is
  'ADR-0045: a worker''s request to change the name or photo §10.1 locks. One pending per worker per kind; proposed values immutable (GDPR anonymisation excepted); a rejection carries decision_reason, which the worker is shown. Admin-read; written through definer RPCs (docs/19 §3). The machine is profile_change_transitions().';
comment on column profile_change_requests.previous_value is
  'The value on the profile at the moment of the decision, e.g. {"firstName","lastName"} or {"photoPath"}. Issued PDFs and payroll exports are never corrected retroactively (§1.7).';
comment on column profile_change_requests.decision_reason is
  'Required on reject and shown to the worker (≤ 300). Never the place for anything the worker should not read.';

-- The machine. CHANGE_REQUEST_TRANSITIONS in packages/domain/src/state.ts;
-- changeRequest.vectors.json holds both (Vitest, and 701 through the
-- generated change_request_vectors.psql).
create or replace function public.profile_change_transitions()
returns table (from_status text, to_status text)
language sql
immutable
set search_path = public, extensions
as $$
  select * from (values
    ('pending', 'approved'),   -- the office approves (RC2, and RC4 for a name)
    ('pending', 'rejected'),   -- the office rejects, with a reason (RC3)
    ('pending', 'withdrawn')   -- the worker withdraws; GDPR removal (§1.7)
  ) as t(from_status, to_status)
$$;

comment on function public.profile_change_transitions() is
  'The profile_change_requests machine (ADR-0045): pending → approved | rejected | withdrawn; the three outcomes are terminal ("Request again" is a new row). Equal to CHANGE_REQUEST_TRANSITIONS in packages/domain.';

create or replace function public.profile_change_requests_state_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if tg_op = 'INSERT' then
    -- A request is born pending; nothing inserts a decided one.
    if new.status <> 'pending' then
      raise exception 'illegal_change_request_transition: (new) -> %', new.status
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if not exists (select 1 from profile_change_transitions() t
                    where t.from_status = old.status and t.to_status = new.status) then
      raise exception 'illegal_change_request_transition: % -> %', old.status, new.status
        using errcode = 'P0001',
              hint = 'ADR-0045. The legal edges are listed by profile_change_transitions().';
    end if;
    -- Leaving pending is the decision.
    new.decided_at := coalesce(new.decided_at, now());
  end if;

  if (new.staff_id, new.kind, new.created_at)
       is distinct from (old.staff_id, old.kind, old.created_at) then
    raise exception 'change_request_immutable' using errcode = 'P0001',
      hint = 'ADR-0045: a request''s worker, kind and creation time never change.';
  end if;

  -- The office approves exactly what was asked. The one exception is §1.7:
  -- a removed worker's proposed name is anonymised.
  if (new.proposed_first_name, new.proposed_last_name, new.proposed_photo_path, new.evidence_path)
       is distinct from
     (old.proposed_first_name, old.proposed_last_name, old.proposed_photo_path, old.evidence_path)
     and not exists (select 1 from staff s where s.id = old.staff_id and s.removed_at is not null) then
    raise exception 'change_request_immutable' using errcode = 'P0001',
      hint = 'ADR-0045: the proposed values are fixed when the request is made. Withdraw it and ask again.';
  end if;
  return new;
end $$;

drop trigger if exists profile_change_requests_state_guard on profile_change_requests;
create trigger profile_change_requests_state_guard
  before insert or update on profile_change_requests
  for each row execute function profile_change_requests_state_guard();

comment on function public.profile_change_requests_state_guard() is
  'Refuses any profile_change_requests status change that is not an edge of profile_change_transitions(), a request inserted already decided, and any change to the proposed values (except the §1.7 anonymisation of a removed worker). Stamps decided_at on leaving pending. The DB half of assertChangeRequestTransition() in packages/domain.';

-- ---------------------------------------------------------------------
-- §4 · shift_offers, shift_offer_notices (ADR-0046)
--
-- A worker offers a confirmed booking up and STAYS CONFIRMED until a
-- replacement takes it; fill, buffer, shift_fill and the client line-up
-- are unchanged while an offer is open. `shift_id` and
-- `offered_by_staff_id` are denormalised from the booking (the insert
-- guard fills and checks them). One open offer per booking.
--
--   mode pool    — every eligible worker, RULE-17 order, OF1 pushes
--   mode office  — a cover request inside 72 h (OF5), seen only by the
--                  office until it opens it to the pool
--   mode direct  — one colleague (designed, not built: Q17)
--
-- shift_offer_notices makes the OF1 rounds additive: one row per worker
-- told about an offer, so nobody is pushed twice.
-- ---------------------------------------------------------------------
create table if not exists shift_offers (
  id                  uuid primary key default gen_random_uuid(),
  booking_id          uuid not null references bookings(id) on delete cascade,
  shift_id            uuid not null references shift_requirements(id) on delete cascade,
  offered_by_staff_id uuid not null references staff(id) on delete cascade,
  mode                text not null default 'pool',
  target_staff_id     uuid references staff(id) on delete cascade,
  swap_group_id       uuid,
  status              text not null default 'open',
  note                text,
  created_at          timestamptz not null default clock_timestamp(),
  expires_at          timestamptz not null,
  closed_at           timestamptz,
  closed_reason       text,
  taken_by_booking_id uuid references bookings(id),
  taken_by_staff_id   uuid references staff(id),
  decided_by          uuid references profiles(id) on delete set null,
  constraint shift_offers_mode check (mode in ('pool', 'office', 'direct')),
  constraint shift_offers_status check (status in ('open', 'taken', 'withdrawn', 'lapsed', 'cancelled')),
  -- A target iff direct; a swap only between direct offers.
  constraint shift_offers_target check ((mode = 'direct') = (target_staff_id is not null)),
  constraint shift_offers_swap_is_direct check (swap_group_id is null or mode = 'direct'),
  constraint shift_offers_not_to_self check (target_staff_id is distinct from offered_by_staff_id),
  constraint shift_offers_note check (note is null or char_length(note) <= 300),
  constraint shift_offers_closed_reason check (closed_reason is null or char_length(closed_reason) <= 300),
  -- closed_at is set exactly when the offer leaves open (the guard).
  constraint shift_offers_closed check ((status = 'open') = (closed_at is null)),
  -- Taken names the taker and the taker's booking; nothing else does.
  constraint shift_offers_taken_by check (
    status <> 'taken' or (taken_by_booking_id is not null and taken_by_staff_id is not null)),
  constraint shift_offers_taken_only check (
    status = 'taken' or (taken_by_booking_id is null and taken_by_staff_id is null)),
  constraint shift_offers_not_own check (taken_by_staff_id is distinct from offered_by_staff_id),
  constraint shift_offers_taken_booking check (taken_by_booking_id is distinct from booking_id)
);

create unique index if not exists shift_offers_one_open_per_booking
  on shift_offers (booking_id) where status = 'open';
create index if not exists shift_offers_booking_idx
  on shift_offers (booking_id, created_at desc);
create index if not exists shift_offers_shift_idx
  on shift_offers (shift_id, status);
create index if not exists shift_offers_offered_by_idx
  on shift_offers (offered_by_staff_id);
create index if not exists shift_offers_target_idx
  on shift_offers (target_staff_id);
create index if not exists shift_offers_taken_booking_idx
  on shift_offers (taken_by_booking_id);
create index if not exists shift_offers_taken_staff_idx
  on shift_offers (taken_by_staff_id);
create index if not exists shift_offers_decided_by_idx
  on shift_offers (decided_by);
create index if not exists shift_offers_open_expiry_idx
  on shift_offers (expires_at) where status = 'open';
create index if not exists shift_offers_swap_idx
  on shift_offers (swap_group_id) where swap_group_id is not null;

comment on table shift_offers is
  'ADR-0046: a confirmed booking offered up by its worker, who stays confirmed until a replacement takes it (take_offered_shift, Agent A). One open per booking. Admin-read; written through definer RPCs and the auto-staffing job. Radar reads open pool offers through a definer RPC that never returns the offerer. The machine is shift_offer_transitions(); the one mode change is shift_offer_mode_transitions().';
comment on column shift_offers.expires_at is
  'When the offer stops being takeable: start − 72 h for a worker''s pool offer (offerExpiresAt / cancelDeadline); the section start for a cover request the office opened to the pool.';
comment on column shift_offers.closed_reason is
  'Why it left open, e.g. expired, the booking''s cancel_cause, gdpr, or the office''s decline note (OF6).';

create table if not exists shift_offer_notices (
  offer_id    uuid not null references shift_offers(id) on delete cascade,
  staff_id    uuid not null references staff(id) on delete cascade,
  notified_at timestamptz not null default now(),
  primary key (offer_id, staff_id)
);

create index if not exists shift_offer_notices_staff_idx on shift_offer_notices (staff_id);

comment on table shift_offer_notices is
  'ADR-0046: who has been pushed an offer (OF1), one row per worker per offer, so the hourly rounds are additive and nobody is pushed twice. Admin-read; written by notify_offer_candidates() (Agent A).';

-- The machines. SHIFT_OFFER_TRANSITIONS and SHIFT_OFFER_MODE_TRANSITIONS in
-- packages/domain/src/state.ts; shiftOffer.vectors.json holds both.
create or replace function public.shift_offer_transitions()
returns table (from_status text, to_status text)
language sql
immutable
set search_path = public, extensions
as $$
  select * from (values
    ('open', 'taken'),       -- a confirmed replacement took it (OF2 + OF4)
    ('open', 'withdrawn'),   -- the worker withdrew it
    ('open', 'lapsed'),      -- expired (OF3), the booking left confirmed, GDPR
    ('open', 'cancelled')    -- the office declined a cover request (OF6)
  ) as t(from_status, to_status)
$$;

comment on function public.shift_offer_transitions() is
  'The shift_offers machine (ADR-0046): open → taken | withdrawn | lapsed | cancelled; the four outcomes are terminal. Equal to SHIFT_OFFER_TRANSITIONS in packages/domain.';

create or replace function public.shift_offer_mode_transitions()
returns table (from_mode text, to_mode text)
language sql
immutable
set search_path = public, extensions
as $$
  select * from (values
    ('office', 'pool')       -- the office opens a cover request to the pool
  ) as t(from_mode, to_mode)
$$;

comment on function public.shift_offer_mode_transitions() is
  'The one mode change a shift offer has (ADR-0046): office → pool, while open (office_open_offer_to_pool). Equal to SHIFT_OFFER_MODE_TRANSITIONS in packages/domain.';

create or replace function public.shift_offers_state_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v_shift uuid;
  v_staff uuid;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'open' then
      raise exception 'illegal_shift_offer_transition: (new) -> %', new.status
        using errcode = 'P0001';
    end if;
    -- shift_id and offered_by_staff_id are the booking's own; filled when
    -- omitted, refused when they disagree. A missing booking is left to
    -- the foreign key.
    select b.shift_id, b.staff_id into v_shift, v_staff from bookings b where b.id = new.booking_id;
    if found then
      if new.shift_id is null then
        new.shift_id := v_shift;
      elsif new.shift_id <> v_shift then
        raise exception 'shift_offer_booking_mismatch' using errcode = 'P0001',
          hint = 'shift_offers.shift_id is the booking''s section.';
      end if;
      if new.offered_by_staff_id is null then
        new.offered_by_staff_id := v_staff;
      elsif new.offered_by_staff_id <> v_staff then
        raise exception 'shift_offer_booking_mismatch' using errcode = 'P0001',
          hint = 'shift_offers.offered_by_staff_id is the booking''s worker.';
      end if;
    end if;
    return new;
  end if;

  if (new.booking_id, new.shift_id, new.offered_by_staff_id, new.target_staff_id,
      new.swap_group_id, new.created_at)
       is distinct from
     (old.booking_id, old.shift_id, old.offered_by_staff_id, old.target_staff_id,
      old.swap_group_id, old.created_at) then
    raise exception 'shift_offer_immutable' using errcode = 'P0001',
      hint = 'ADR-0046: an offer''s booking, worker and target never change.';
  end if;

  if new.mode is distinct from old.mode
     and not (old.status = 'open' and new.status = 'open'
              and exists (select 1 from shift_offer_mode_transitions() m
                           where m.from_mode = old.mode and m.to_mode = new.mode)) then
    raise exception 'illegal_shift_offer_mode: % -> %', old.mode, new.mode
      using errcode = 'P0001',
            hint = 'ADR-0046: only office → pool, while the offer is open.';
  end if;

  if new.status is distinct from old.status then
    if not exists (select 1 from shift_offer_transitions() t
                    where t.from_status = old.status and t.to_status = new.status) then
      raise exception 'illegal_shift_offer_transition: % -> %', old.status, new.status
        using errcode = 'P0001',
              hint = 'ADR-0046. The legal edges are listed by shift_offer_transitions().';
    end if;
    new.closed_at := coalesce(new.closed_at, now());
  end if;
  return new;
end $$;

drop trigger if exists shift_offers_state_guard on shift_offers;
create trigger shift_offers_state_guard
  before insert or update on shift_offers
  for each row execute function shift_offers_state_guard();

comment on function public.shift_offers_state_guard() is
  'Refuses any shift_offers status change that is not an edge of shift_offer_transitions(), any mode change but office → pool while open, an offer inserted already closed, and any change to its booking, worker, target or swap group. Fills shift_id / offered_by_staff_id from the booking on insert. Stamps closed_at on leaving open. The DB half of assertShiftOfferTransition() in packages/domain.';

-- ---------------------------------------------------------------------
-- §5 · staff_referral_codes, application_referrals (ADR-0047)
--
-- One code per compliant worker, minted lazily by my_referral_code()
-- (Agent B), eight characters with no I, O, 0 or 1. An application that
-- arrives with a valid code is recorded (Agent D). No reward, no money:
-- nothing reads these for pay, reports or documents (Q19).
-- ---------------------------------------------------------------------
create table if not exists staff_referral_codes (
  staff_id   uuid primary key references staff(id) on delete cascade,
  code       text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint staff_referral_codes_code check (code ~ '^[A-HJ-NP-Z2-9]{8}$')
);

comment on table staff_referral_codes is
  'ADR-0047: a worker''s referral code for /apply?ref=. One per worker, never reissued; revoked (revoked_at) on GDPR removal. Admin-read; minted by a definer RPC (docs/19 §5).';

create table if not exists application_referrals (
  application_id     uuid primary key references applications(id) on delete cascade,
  referrer_staff_id  uuid not null references staff(id) on delete cascade,
  -- applications.staff_id: the candidate created, or the record matched.
  candidate_staff_id uuid not null references staff(id) on delete cascade,
  code               text not null,
  recorded_at        timestamptz not null default now(),
  constraint application_referrals_not_self check (candidate_staff_id <> referrer_staff_id),
  constraint application_referrals_code check (code ~ '^[A-HJ-NP-Z2-9]{8}$')
);

create index if not exists application_referrals_referrer_idx
  on application_referrals (referrer_staff_id);
create index if not exists application_referrals_candidate_idx
  on application_referrals (candidate_staff_id);

comment on table application_referrals is
  'ADR-0047: an application that arrived with a referral code — who referred whom. Kept on GDPR removal of either side (the removed person reads "Deleted account #id"). Admin-read; written only by record_application_referral() (Agent D). The applicant never sees the referrer; the referrer sees a count (Q20).';

-- ---------------------------------------------------------------------
-- RLS: admin_read on all seven, nothing for staff, client or anon.
-- The rtw_checks shape (20260928100000): authenticated keeps SELECT so the
-- office's policy can answer; every write is a definer function or the
-- service role.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'staff_unavailability', 'staff_emergency_contacts', 'profile_change_requests',
    'shift_offers', 'shift_offer_notices', 'staff_referral_codes', 'application_referrals']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists admin_read on %I', t);
    execute format(
      'create policy admin_read on %I for select using (current_app_role() = ''admin'')', t);
    execute format('revoke all on %I from public, anon, authenticated', t);
    execute format('grant select on %I to authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- GDPR removal (§1.7) — staff_removed_purge_additions
--
-- Fires once, when removed_at is first set (remove_worker() sets it through
-- block_worker(…, 'removed', 'gdpr') and again in its anonymising update;
-- the WHEN clause keeps the second a no-op). So remove_worker() is not
-- restated (docs/19 §0.7):
--
--   staff_unavailability      deleted
--   staff_emergency_contacts  deleted
--   profile_change_requests   pending → withdrawn; proposed names become
--                             "Deleted account"; note, snapshot and reason
--                             text cleared (the reason is replaced, because
--                             a rejection must carry one). The Storage
--                             objects go with the <staff_id>/ prefix purge.
--   staff_referral_codes      revoked; the code is never reissued
--   application_referrals     kept — the removed worker reads "Deleted
--                             account #id" through the anonymised staff row
--   shift_offers              any still open by or to the worker lapse
--                             (closed_reason gdpr); the note is cleared
--   shift_offer_notices       kept (who was pushed what: no personal data)
--
-- Security definer so it runs the same whoever set removed_at, and — like
-- every trigger function since 20260927161000 — not callable as an RPC.
-- ---------------------------------------------------------------------
create or replace function public.staff_removed_purge_additions()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  delete from staff_unavailability     where staff_id = new.id;
  delete from staff_emergency_contacts where staff_id = new.id;

  update profile_change_requests
     set status              = case when status = 'pending' then 'withdrawn' else status end,
         proposed_first_name = case when proposed_first_name is not null then 'Deleted' end,
         proposed_last_name  = case when proposed_last_name  is not null then 'account' end,
         worker_note         = null,
         previous_value      = null,
         decision_reason     = case when decision_reason is not null
                                    then 'Removed under GDPR (§1.7)' end
   where staff_id = new.id;

  update staff_referral_codes
     set revoked_at = coalesce(revoked_at, new.removed_at)
   where staff_id = new.id;

  update shift_offers
     set status = 'lapsed', closed_reason = 'gdpr', closed_at = new.removed_at
   where status = 'open'
     and (offered_by_staff_id = new.id or target_staff_id = new.id);

  update shift_offers set note = null
   where offered_by_staff_id = new.id and note is not null;

  return null;
end $$;

drop trigger if exists staff_removed_purge_additions on staff;
create trigger staff_removed_purge_additions
  after update of removed_at on staff
  for each row
  when (old.removed_at is null and new.removed_at is not null)
  execute function staff_removed_purge_additions();

comment on function public.staff_removed_purge_additions() is
  '§1.7 GDPR removal for the docs/19 additions: deletes availability and the emergency contact, withdraws and anonymises change requests, revokes the referral code, lapses open offers. Fires once, after removed_at is first set. A trigger function: not an RPC.';

-- ---------------------------------------------------------------------
-- Grants. Trigger functions are never RPCs (20260927161000, pgTAP 190);
-- the builders and machines are pure and a screen may ask them.
-- ---------------------------------------------------------------------
revoke execute on function public.staff_removed_purge_additions()        from public, anon, authenticated;
revoke execute on function public.profile_change_requests_state_guard()  from public, anon, authenticated;
revoke execute on function public.shift_offers_state_guard()             from public, anon, authenticated;

revoke execute on function public.unavailability_range(date, date, time, time)             from public, anon;
revoke execute on function public.staff_unavailable(uuid, timestamptz, timestamptz)        from public, anon;
revoke execute on function public.profile_change_transitions()                             from public, anon;
revoke execute on function public.shift_offer_transitions()                                from public, anon;
revoke execute on function public.shift_offer_mode_transitions()                           from public, anon;
grant  execute on function public.unavailability_range(date, date, time, time)             to authenticated, service_role;
grant  execute on function public.staff_unavailable(uuid, timestamptz, timestamptz)        to authenticated, service_role;
grant  execute on function public.profile_change_transitions()                             to authenticated, service_role;
grant  execute on function public.shift_offer_transitions()                                to authenticated, service_role;
grant  execute on function public.shift_offer_mode_transitions()                           to authenticated, service_role;
