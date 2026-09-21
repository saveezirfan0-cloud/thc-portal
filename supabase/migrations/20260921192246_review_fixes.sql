-- =====================================================================
-- Two holes the review found, and the smaller things around them
--
-- Both blockers were opened BY the previous two migrations rather than
-- by anything older: nothing could set `left_at` or `removed_at` before
-- §10.6 and §1.7 existed, and nothing could reject a declaration before
-- §10.7 did. So both are this branch's to close.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · A leaver or a removed worker could still be invited to a shift.
--
-- `auto_assign_candidates` ends `where s.removed_at is null and
-- s.left_at is null` (20260921141500), so for one of those two it
-- returns NO ROW — not a row carrying a gate. `invite_worker` read it
-- with
--
--     select gate into v_gate from auto_assign_candidates(p_shift)
--      where staff_id = p_staff;
--     if v_gate is not null then ... refuse
--
-- and PL/pgSQL's SELECT INTO leaves the variable NULL when nothing
-- matches. So the absence of a candidate row read exactly like "no gate
-- applies", and the insert went ahead. The `s.status <> 'compliant'`
-- gate never ran, because the row it would have been attached to had
-- already been filtered away.
--
-- §10.6 step 5: "They leave the scoring pool (§6) and cannot be invited,
-- auto-assigned or manually added to any event." §2.12: "Blocked,
-- inactive and removed workers receive no invitations and are not in the
-- scoring pool."
--
-- The fix is `not found`, not a change to the candidate query: every
-- worker who is neither removed nor left HAS a row (carrying a gate when
-- they are ineligible), so an absent row means exactly those two states
-- and nothing else. Widening the query instead would put leavers back
-- into a pool the engine ranks over, which is the opposite of §10.6.
--
-- It also stops N5 being queued at a leaver, whose push_subscriptions
-- are still live — only §1.7 removal deletes those.
-- ---------------------------------------------------------------------
create or replace function invite_worker(
  p_shift uuid, p_staff uuid,
  p_source booking_source default 'auto',
  -- Escalation only (§3.4): once the shift is under way the job invites
  -- "ignoring the event's original headcount + buffer cap". Never set by
  -- the hourly round, which is what keeps the cap meaningful before start.
  p_ignore_target boolean default false
)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  sr        shift_requirements;
  ev        events;
  v_gate    text;
  v_fill    record;
  v_booking uuid;
begin
  if current_app_role() is distinct from 'admin' and auth.uid() is not null then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  -- Lock the section: the fill check below and the insert must not race
  -- another round, or two workers take the last slot of the target.
  select * into sr from shift_requirements where id = p_shift for update;
  if sr.id is null then raise exception 'shift_not_found' using errcode = 'P0002'; end if;
  select * into ev from events where id = sr.event_id;
  if ev.cancelled_at is not null then
    return jsonb_build_object('invited', false, 'reason', 'event_cancelled');
  end if;

  -- Gates before "do they already have one", so the REASON is the useful
  -- one. A worker who self-cancelled off this event still holds the
  -- cancelled row, and reporting `already_has_booking` for them would hide
  -- RULE-04 behind a bookkeeping detail on the manager's screen.
  select gate into v_gate from auto_assign_candidates(p_shift) where staff_id = p_staff;
  -- NOT FOUND is its own refusal. auto_assign_candidates ends `where
  -- s.removed_at is null and s.left_at is null`, so for a leaver (§10.6)
  -- or a removed worker (§1.7) it returns no row at all — and SELECT INTO
  -- leaves v_gate NULL when nothing matches, which read exactly like "no
  -- gate applies". Every worker who is neither removed nor left HAS a row
  -- here, carrying a gate when they are ineligible, so an absent row means
  -- those two states and nothing else. §10.6 step 5: a leaver "cannot be
  -- invited, auto-assigned or manually added to any event".
  if not found then
    return jsonb_build_object('invited', false, 'reason', 'not_bookable');
  end if;
  if v_gate is not null then
    return jsonb_build_object('invited', false, 'reason', v_gate);
  end if;

  -- `bookings` is unique on (shift, staff), so any existing row blocks a
  -- second one — including a cancelled row. A slot released by the 12:00
  -- cutoff therefore cannot be re-offered to the same worker by a later
  -- round; it goes to someone else, which is what §3.5 intends anyway.
  if exists (select 1 from bookings where shift_id = p_shift and staff_id = p_staff) then
    return jsonb_build_object('invited', false, 'reason', 'already_has_booking');
  end if;

  -- Invitations are additive up to the target, counting the ones already
  -- open: without this a role whose target is met on paper keeps inviting.
  select * into v_fill from shift_fill(p_shift);
  if not p_ignore_target and v_fill.confirmed + v_fill.invited >= v_fill.target then
    return jsonb_build_object('invited', false, 'reason', 'target_met');
  end if;

  insert into bookings (shift_id, staff_id, status, source)
  values (p_shift, p_staff, 'invited', p_source)
  returning id into v_booking;

  perform queue_booking_push('N5', v_booking);
  return jsonb_build_object('invited', true, 'bookingId', v_booking);
end $$;

comment on function public.invite_worker(uuid, uuid, booking_source, boolean) is
  'Writes one invitation, re-applying every §3.3/§3.4 gate at the insert. An absent candidate row means removed (§1.7) or left (§10.6) and is refused as not_bookable — auto_assign_candidates filters those two out entirely, so their absence must not read as "no gate applies".';

-- ---------------------------------------------------------------------
-- 2 · A rejected conviction declaration blocked the worker for ever.
--
-- §10.7 Reject: "The block stands and converts to a manual block (§9.6)
-- with the manager's reason recorded, so only a manager can ever lift
-- it." That sentence says a manager CAN lift it. The manager's route is
-- unblock_worker(), which runs compliance_blockers() first — and that
-- emitted `conviction_unreviewed` for any Yes whose review_status was
-- not `verified`, which is permanently true of a REJECTED one. So the
-- only exits were a full re-onboarding or a GDPR removal.
--
-- §4.3's rule is about an UNDECIDED declaration: "the Criminal Record
-- declaration, if answered Yes, must also be verified" sits in the list
-- of things that must be settled before the automatic unblock fires. A
-- rejected declaration has been settled — by a human, against the
-- worker — and the consequence it carries is the manual block itself,
-- which §9.6 says only a manager may lift. Counting it twice is what
-- made the block permanent.
--
-- So: pending blocks, verified clears, rejected is carried by the manual
-- block and not by this.
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
  select 'conviction_unreviewed'
    from (
      select c.answer, c.review_status
        from criminal_declarations c
       where c.staff_id = p_staff
         and not c.superseded
       -- The id breaks a tie on declared_at. Two declarations at the same
       -- instant is not a real scenario, but "the latest one counts" has
       -- to have one answer rather than whichever the planner reaches
       -- first — otherwise the same profile can read compliant and
       -- non-compliant on consecutive calls.
       order by c.declared_at desc, c.id desc
       limit 1
    ) c
   where c.answer and c.review_status = 'pending'
$$;

comment on function public.compliance_blockers(uuid, date) is
  '§4.3 full compliance re-check, as reasons. Empty = compliant. A declaration still PENDING blocks; a rejected one does not, because §10.7 makes the manual block the thing that carries it and §9.6 says only a manager lifts that.';

-- ---------------------------------------------------------------------
-- 3 · The review trigger fired on any declaration, of any source.
--
-- §10.7's two outcomes are scoped to the in-employment declaration under
-- review. Rejecting an ONBOARDING declaration (§2.6, §10.3 step 4) for a
-- worker who happened to be blocked on an expired document rewrote that
-- `auto_document` block to `manual` with the declaration's note — which
-- takes it permanently out of the §4.3 automatic unblock, since
-- unblock_if_compliant refuses a manual block by design.
-- ---------------------------------------------------------------------
create or replace function public.criminal_declaration_reviewed()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_now timestamptz := coalesce(new.reviewed_at, now());
begin
  if new.review_status = old.review_status or new.source <> 'in_employment' then
    return new;
  end if;

  if new.review_status = 'verified' and new.answer then
    if unblock_if_compliant(new.staff_id, (v_now at time zone 'Europe/London')::date) then
      insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
      values ('N15:declaration:' || new.id, 'push', 'N15', new.staff_id, '{}'::jsonb)
      on conflict (key) do nothing;
    end if;

  elsif new.review_status = 'rejected' and new.answer then
    update staff
       set block_kind = 'manual',
           block_reason = coalesce(nullif(new.review_note, ''),
                                   'Declared conviction not accepted')
     where id = new.staff_id
       and status = 'blocked'
       -- Only the block THIS declaration caused. A worker blocked on an
       -- expired document keeps that block, and keeps the automatic
       -- unblock that goes with it.
       and block_kind = 'conviction_review';
  end if;

  return new;
end $$;

-- ---------------------------------------------------------------------
-- 4 · E8's key was unique per WORKER, so a second leaving sent nothing.
--
-- §2.12 and §10.6 both support leaving twice on one record — that is the
-- whole point of Reset to candidate. The second request re-entered the
-- outbox on `E8:staff:<id>`, hit the unique index, and the "immediately,
-- not batched" email to payroll silently never left the queue. E9 was
-- already keyed on the declaration and was right.
--
-- 5 · request_p45() was not idempotent, unlike remove_worker().
--
-- A double-submitted confirmation re-entered block_worker with
-- p_status = 'inactive', which assert_staff_transition waves through on
-- its `p_from = p_to` branch, and the update re-stamped left_at — so the
-- recorded leaving date drifted to the retry.
--
-- 6 · E8's released list included WITHDRAWN INVITATIONS as released
-- shifts. §10.6 step 6 asks for the shifts "just released … so whoever
-- picks it up can see instantly whether a big event has just lost
-- someone". An invitation nobody accepted is not a slot the event lost.
-- Withdrawals now carry their own cause, which also makes the two halves
-- of the cascade legible on the booking row afterwards.
-- ---------------------------------------------------------------------
create or replace function public.released_shift_lines(p_staff uuid, p_cause text, p_at timestamptz)
returns text
language sql
stable
set search_path = public, extensions
as $$
  select coalesce(
    string_agg(
      e.title || ' · ' || c.name || ' · ' || e.venue_name || ' · ' || r.name
                || ' · ' || to_char(s.starts_at at time zone 'Europe/London', 'DD Mon YYYY HH24:MI'),
      E'\n' order by s.starts_at),
    '(none)')
    from bookings b
    join shift_requirements s on s.id = b.shift_id
    join events e             on e.id = s.event_id
    join clients c            on c.id = e.client_id
    join roles r              on r.id = s.role_id
   where b.staff_id = p_staff
     and b.cancel_cause = p_cause
     and b.cancelled_at = p_at
$$;

create or replace function public.request_p45(
  p_staff  uuid,
  p_reason text        default null,
  p_now    timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v staff;
  v_cascade jsonb;
  v_last date;
begin
  select * into v from staff where id = p_staff for update;
  if v.id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if v.status = 'inactive' then
    -- Idempotent, as removal is: a double-submitted confirmation must not
    -- drift the recorded leaving date onto the retry.
    return jsonb_build_object('staffId', p_staff::text, 'alreadyInactive', true);
  end if;

  if exists (
    select 1
      from bookings b
      join shift_requirements s on s.id = b.shift_id
      join check_logs cl        on cl.booking_id = b.id
     where b.staff_id = p_staff
       and b.cancelled_at is null
       and cl.check_in_at is not null
       and cl.check_out_at is null
       and p_now < s.ends_at + interval '4 hours'
  ) then
    raise exception 'on_shift' using errcode = 'P0001';
  end if;

  v_cascade := block_worker(p_staff, null, p_reason, p_now, 'inactive', 'left');

  select max(s.ends_at at time zone 'Europe/London')::date into v_last
    from bookings b join shift_requirements s on s.id = b.shift_id
   where b.staff_id = p_staff and b.status = 'worked';

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values ('E8:staff:' || p_staff || ':' || extract(epoch from p_now)::bigint, 'email', 'E8',
          array['admin@thehospitalitycompany.co.uk'],
          jsonb_build_object(
            'name',          v.first_name || ' ' || v.last_name,
            'employeeId',    coalesce(v.employee_id::text, '(not yet issued)'),
            'niNumber',      coalesce(v.ni_number, '(not on file)'),
            'requestedAt',   to_char(p_now at time zone 'Europe/London', 'DD Mon YYYY HH24:MI'),
            'reason',        coalesce(nullif(p_reason, ''), '(none given)'),
            'lastShiftDate', coalesce(to_char(v_last, 'DD Mon YYYY'), '(none worked)'),
            -- Released confirmed shifts only. The withdrawn invitations
            -- carry cause 'left_invite' and are counted, not listed.
            'releasedShifts', released_shift_lines(p_staff, 'left', p_now)))
  on conflict (key) do nothing;

  return v_cascade || jsonb_build_object('lastShiftDate', v_last);
end $$;

-- block_worker distinguishes the two halves of the cascade on the row, so
-- E8 can list what the event actually lost. `<cause>_invite` keeps the
-- pair obvious in the data and needs no second argument.
create or replace function public.block_worker(
  p_staff  uuid,
  p_kind   block_kind,
  p_reason text,
  p_now    timestamptz default now(),
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
  if p_status not in ('blocked', 'inactive', 'removed') then
    raise exception 'block_worker: p_status must be blocked, inactive or removed, got %', p_status
      using errcode = 'P0001';
  end if;
  perform assert_staff_transition(v_was, p_status);

  update staff
     set status = p_status,
         block_kind = case when p_status = 'blocked' then p_kind else null end,
         block_reason = case when p_status = 'blocked' then p_reason else null end,
         leave_reason = case when p_status = 'inactive' then p_reason else leave_reason end,
         left_at      = case when p_status = 'inactive' then p_now   else left_at end,
         removed_at   = case when p_status = 'removed'  then p_now   else removed_at end
   where id = p_staff;

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

  with withdrawn as (
    update bookings b
       set status = 'cancelled', cancelled_at = p_now, cancel_cause = p_cause || '_invite'
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

-- ---------------------------------------------------------------------
-- 7 · reset_to_candidate was reachable from interview_requested.
--
-- It leaned on the transition table, and staff_transition_allowed()
-- returns true for p_from = p_to — an escape hatch added so block_worker
-- could re-block an already-blocked worker without raising. §9.6 is
-- narrower than the table here: "available on a blocked, rejected or
-- inactive profile". So the function says so itself.
-- ---------------------------------------------------------------------
create or replace function public.reset_to_candidate(
  p_staff  uuid,
  p_reason text,
  p_now    timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v staff;
  v_docs int := 0;
  v_decl int := 0;
  v_hmrc int := 0;
begin
  select * into v from staff where id = p_staff for update;
  if v.id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  if v.status not in ('blocked', 'rejected', 'inactive') then
    raise exception 'not_resettable: %', v.status using errcode = 'P0001';
  end if;
  perform assert_staff_transition(v.status, 'interview_requested'::staff_status);

  with d as (
    update compliance_docs set review_status = 'superseded'
     where staff_id = p_staff and review_status <> 'superseded'
    returning 1
  ) select count(*)::int into v_docs from d;

  with c as (
    update criminal_declarations set superseded = true
     where staff_id = p_staff and not superseded
    returning 1
  ) select count(*)::int into v_decl from c;

  with h as (
    update hmrc_checklists set superseded = true
     where staff_id = p_staff and not superseded
    returning 1
  ) select count(*)::int into v_hmrc from h;

  update staff
     set status = 'interview_requested',
         block_kind = null,
         block_reason = null,
         contract_signed_at = null,
         contract_version = null,
         quiz_attempts = 0,
         share_code = null,
         right_to_work_until = null,
         rtw_branch = null,
         term_dates = '{}',
         graduated_at = null,
         wtr_optout = false
         -- left_at and leave_reason are NOT cleared. §10.6 calls the P45
         -- request "the trigger and the audit record for THC to issue
         -- it", and §2.12 step 4 retains history; the §9.6 Inactive tab
         -- filters on STATUS, so a candidate drops out of it anyway. The
         -- previous version cleared them and left nothing in the database
         -- saying when the P45 was asked for.
   where id = p_staff;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (p_now, auth.uid(), 'reset_to_candidate', 'staff', p_staff,
          jsonb_build_object('reason', trim(p_reason),
                             'fromStatus', v.status::text,
                             'employeeId', v.employee_id,
                             'leftAt', v.left_at,
                             'leaveReason', v.leave_reason));

  return jsonb_build_object(
    'staffId', p_staff::text,
    'fromStatus', v.status::text,
    'employeeId', v.employee_id,
    'docsSuperseded', v_docs,
    'declarationsSuperseded', v_decl,
    'checklistsSuperseded', v_hmrc);
end $$;

-- ---------------------------------------------------------------------
-- 8 · deleted_account_label() was defined and never used.
--
-- The live line-up view built the label by hand as
-- 'Deleted account #' || s.employee_id, which is NULL when the worker was
-- removed before §2.7 ever issued one — so the customer's screen and the
-- §11.3 PDF show a BLANK name. §1.7 is explicit that the row "is NOT
-- filtered out — it stays, labelled 'Deleted account #id', so the
-- slot/headcount isn't skewed", and a blank name is the row being
-- filtered out in everything but arithmetic. The sort key had the same
-- null, which would have scattered such rows out of §11.3's order.
--
-- Only this definition is live: 0001_init and 0005_client_lineup created
-- earlier versions of the same view and 20260921140000 replaced it. The
-- view is otherwise unchanged — same columns, same ADR-0004 shape, same
-- client_portal_visible() in its own body.
-- ---------------------------------------------------------------------
drop view if exists client_lineup_v;

create view client_lineup_v with (security_barrier = true) as
  select b.id as booking_id,
         sr.event_id,
         r.name as role,
         sr.starts_at,
         sr.ends_at,
         case when s.removed_at is null then s.first_name || ' ' || s.last_name
              else deleted_account_label(s.employee_id) end as name,
         case when s.removed_at is null then s.photo_path end as photo_path,
         -- §11.3's order, so the screen and the PDF list the same people in
         -- the same sequence. A removed worker sorts under their anonymised
         -- label: surfacing the real surname as an order would undo §1.7.
         case when s.removed_at is null then lower(s.last_name)
              else 'zzzz-deleted-' || coalesce(s.employee_id::text, 'unknown') end as sort_key,
         -- §11.2 "✓ Feedback sent". One boolean about the customer's own
         -- entry; the office's feedback on the same worker stays invisible
         -- here (§9.10).
         exists (select 1
                   from feedback f
                  where f.event_id = sr.event_id
                    and f.staff_id = b.staff_id
                    and f.author_kind = 'client') as feedback_given
    from bookings b
    join shift_requirements sr on sr.id = b.shift_id
    join events e              on e.id  = sr.event_id
    join roles r               on r.id  = sr.role_id
    join staff s               on s.id  = b.staff_id
   where b.status in ('confirmed', 'worked')
     and client_portal_visible(e.client_id);

comment on view client_lineup_v is
  'The confirmed line-up a customer sees (§11.2). Owner rights + client_portal_visible() per ADR-0004; the client role holds no policy on bookings, shift_requirements, roles or staff and must not be given one. Photo, name and role only: never a rate, never the selection process (Invited / Potential pool / Unavailable). staff.id is deliberately absent — submit_client_feedback() takes booking_id instead. A removed worker reads deleted_account_label(), which never returns null (§1.7).';

revoke all on client_lineup_v from public, anon, authenticated;
grant select on client_lineup_v to authenticated;

revoke execute on function public.invite_worker(uuid, uuid, booking_source, boolean) from public, anon;
grant  execute on function public.invite_worker(uuid, uuid, booking_source, boolean) to authenticated, service_role;
revoke execute on function public.request_p45(uuid, text, timestamptz)      from public, anon, authenticated;
revoke execute on function public.reset_to_candidate(uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.released_shift_lines(uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.block_worker(uuid, block_kind, text, timestamptz, staff_status, text)
  from public, anon, authenticated;
revoke execute on function public.criminal_declaration_reviewed() from public, anon, authenticated;
grant  execute on function public.request_p45(uuid, text, timestamptz)      to service_role;
grant  execute on function public.reset_to_candidate(uuid, text, timestamptz) to service_role;
grant  execute on function public.released_shift_lines(uuid, text, timestamptz) to service_role;
grant  execute on function public.block_worker(uuid, block_kind, text, timestamptz, staff_status, text) to service_role;
