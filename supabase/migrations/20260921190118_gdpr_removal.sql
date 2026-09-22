-- =====================================================================
-- GDPR removal (§1.7, §9.6 Remove)
--
-- "Double confirmation → irreversible anonymisation of personal data
-- (name → 'Deleted account #id', contacts / documents / photo wiped),
-- login disabled, future bookings released, status Removed; history
-- (bookings / feedback) is retained for reporting."
--
-- The confirmations are the screen's. Everything after them is here, and
-- the hard part is not the wiping — it is being precise about what must
-- SURVIVE. §1.7 is unusually specific about that, because a removal that
-- takes too much breaks billing, HMRC and the client's own record of who
-- worked their event:
--
--   * The row is never filtered out. "In the Staff directory's Removed
--     tab, and anywhere a removed worker's row appears on a past or
--     upcoming event they worked … the row is NOT filtered out — it
--     stays, labelled 'Deleted account #id', so the slot/headcount isn't
--     skewed."
--   * Non-personal data stays visible. "Fields not tied to personal
--     identity, such as roles and rating, can remain visible."
--   * The Employee ID stays, because every historical timesheet and
--     payroll line reconciles through it (§2.7, §9.9) — and it is the
--     `#id` in the label.
--   * Feedback text is retained VERBATIM. §1.7 confirms the name should
--     ideally be redacted from free text, and then defines v1 behaviour
--     as not doing it: "automatically detecting and redacting a name
--     inside free text requires an LLM step and is not built in v1 … the
--     office redacts a name by editing the entry or deleting it if asked
--     to." So this function must not touch feedback, and a future LLM
--     pass is a separate piece of work, not a TODO here.
--   * Already-issued PDFs are untouched by definition — they are files,
--     not rows, and §11.3 keeps them "exactly as issued … never
--     retroactively edited or reissued". A REGENERATED copy reads the
--     anonymised row and so prints the new label automatically, which is
--     what §1.7 asks for and needs no code here.
--
-- The declaration is the one row that is half-wiped. §10.7: "On GDPR
-- removal (§1.7) the details are wiped with the rest of the worker's
-- personal data, while the fact that a declaration existed and its review
-- outcome are retained as part of the compliance record."
-- =====================================================================

-- ---------------------------------------------------------------------
-- block_worker() gains its third terminal state.
--
-- Removal releases future bookings for the same reason leaving does, so
-- it is the same cascade again — and 0001_init already reserved
-- cancel_cause = 'gdpr' for it. Three states now: blocked (§4.3, §9.6,
-- §10.7), inactive (§10.6) and removed (§1.7).
-- ---------------------------------------------------------------------
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
  'The §4.3 cascade: the worker is stopped, future allocations released, open invitations withdrawn. Shared by document expiry (§4.3), the manual block (§9.6), the conviction (§10.7), leaving (§10.6, inactive/left) and GDPR removal (§1.7, removed/gdpr).';

-- ---------------------------------------------------------------------
-- The anonymised display name (§1.7).
--
-- "Deleted account #1042" in the wireframes and in supabase/seed.sql, and
-- the number is the Employee ID — which is retained precisely so that
-- payroll and every historical timesheet still reconcile. A worker
-- removed before one was ever issued (§2.7 issues it at contract
-- signature) has no number to show, and the label says so rather than
-- printing "#null" on a client's timesheet.
-- ---------------------------------------------------------------------
create or replace function public.deleted_account_label(p_employee_id int)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select 'Deleted account #' || coalesce(p_employee_id::text, 'unknown')
$$;

-- ---------------------------------------------------------------------
-- Remove (§1.7). Irreversible.
-- ---------------------------------------------------------------------
create or replace function public.remove_worker(
  p_staff uuid,
  p_now   timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v staff;
  v_cascade jsonb;
  v_docs int := 0;
begin
  select * into v from staff where id = p_staff for update;
  if v.id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if v.status = 'removed' then
    -- Idempotent rather than an error: a double confirmation that is
    -- double-submitted must not leave half a removal behind.
    return jsonb_build_object('staffId', p_staff::text, 'alreadyRemoved', true);
  end if;

  v_cascade := block_worker(p_staff, null, null, p_now, 'removed', 'gdpr');

  -- Personal data on the row itself. The shape matches supabase/seed.sql's
  -- own removed worker, so screenshots, seed and tests read the same
  -- (CLAUDE.md, wireframes/CONVENTIONS.md).
  --
  -- dob is `not null` and carries the §1.7 age check, so it cannot simply
  -- be nulled; a fixed sentinel satisfies the constraint and identifies
  -- nobody. phone is `not null` for the same reason.
  update staff
     set first_name  = 'Deleted',
         last_name   = 'account',
         email       = 'removed-' || coalesce(v.employee_id::text, replace(p_staff::text, '-', '')) || '@invalid.example',
         phone       = '+440000000000',
         dob         = date '1900-01-01',
         home_address = null,
         home_location = null,
         photo_path  = null,
         ni_number   = null,
         share_code  = null,
         right_to_work_until = null,
         rtw_branch  = null,
         term_dates  = '{}',
         graduated_at = null,
         wtr_optout  = false,
         leave_reason = null,
         -- Login disabled. The auth.users row is GoTrue's and is deleted
         -- through the admin API, which SQL here cannot reach; breaking
         -- the link is what stops the session resolving to this worker.
         user_id     = null,
         removed_at  = p_now
   where id = p_staff;

  -- Documents, and the evidence sets that are nothing but personal data.
  with d as (delete from compliance_docs  where staff_id = p_staff returning 1)
    select count(*)::int into v_docs from d;
  delete from bank_details      where staff_id = p_staff;
  delete from staff_references  where staff_id = p_staff;
  delete from hmrc_checklists   where staff_id = p_staff;
  delete from push_subscriptions where staff_id = p_staff;

  -- §10.7: the details go, the fact and the outcome stay.
  update criminal_declarations
     set details = null, conviction_date = null
   where staff_id = p_staff;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (p_now, auth.uid(), 'gdpr_remove', 'staff', p_staff,
          jsonb_build_object('employeeId', v.employee_id,
                             'fromStatus', v.status::text,
                             'documentsDeleted', v_docs));

  return v_cascade || jsonb_build_object(
    'label', deleted_account_label(v.employee_id),
    'documentsDeleted', v_docs);
end $$;

comment on function public.remove_worker(uuid, timestamptz) is
  '§1.7 GDPR removal. Irreversible anonymisation, documents and contacts deleted, login unlinked, future bookings released, status removed. History — bookings, feedback, violations, check-ins, the Employee ID — is retained for reporting, and feedback text is retained verbatim (v1: the office redacts by hand).';

-- ---------------------------------------------------------------------
-- Same lockdown as every other definer function in public (docs/14 O7).
-- This one is irreversible, which makes an open grant worse than most.
-- ---------------------------------------------------------------------
revoke execute on function public.remove_worker(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.remove_worker(uuid, timestamptz) to service_role;
