-- =====================================================================
-- Migration 20260930202200 · Request a change — the worker's side
--   docs/19-staff-features-plan.md §3 (Phase 1, Agent B · staff-pwa)
--   ADR-0045 (proposed — awaiting THC) · Q13, Q14, Q21 · §8 RC1
--
--   request_profile_change(kind, first, last, photo_path, evidence_path, note)
--                                   one pending request per kind; queues RC1
--   withdraw_profile_change(id)     pending → withdrawn, own requests only
--   my_profile_change_requests()    the worker's own, newest first — never
--                                   decided_by, never previous_value
--
-- §10.1 locks the name and the photo, and neither lock moves here: nothing
-- in this file writes staff. A request is a row in profile_change_requests
-- (Phase 0, 20260930200100: admin_read only, state guard, shape CHECKs,
-- one pending per kind); the office decides it (Agent C,
-- office_decide_profile_change).
--
-- The uploads are checked against what Storage actually holds, not what
-- the phone says it sent:
--   name   evidence in the documents bucket under
--          <staff_id>/change-requests/<file>.<pdf|jpg|jpeg|png>, judged by
--          evidence_upload_problem() (20260923200000): present, PDF/JPG/PNG
--          by content type AND extension, 1 byte to 10 MB. Uploaded through
--          a service-key signed upload URL, as every documents upload is —
--          the bucket has no worker policy and gets none (docs/19 §3).
--   photo  a fresh object in the photos bucket under <staff_id>/, written
--          by the worker's own session under photos_worker_insert_own
--          (20260922183015). No Storage policy changes.
--
-- RC1 (packages/notifications, ADDITION_CODES) is queued in the same
-- transaction as the insert, keyed RC1:request:<id>, to admin@ only. Its
-- payload carries exactly the template's placeholders — name, employeeId,
-- change, requestedAt, current, proposed, note — with `—` for a blank note
-- (REGISTER-NOTES "Additions": an unfilled placeholder would ship a brace).
--
-- Refusals raise (P0001) with a code the Staff App turns into a sentence.
-- Forward-only.
-- =====================================================================

create or replace function public.request_profile_change(
  p_kind          text,
  p_first         text default null,
  p_last          text default null,
  p_photo_path    text default null,
  p_evidence_path text default null,
  p_note          text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id    uuid := staff_caller();
  s       staff;
  v_first text := nullif(btrim(coalesce(p_first, '')), '');
  v_last  text := nullif(btrim(coalesce(p_last, '')), '');
  v_photo text := nullif(btrim(coalesce(p_photo_path, '')), '');
  v_evid  text := nullif(btrim(coalesce(p_evidence_path, '')), '');
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_problem text;
  v_req   uuid;
  v_created timestamptz;
begin
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  select * into s from staff where id = v_id for update;
  if s.status = 'removed' then
    raise exception 'account_closed' using errcode = 'P0001';
  end if;
  -- The locks are §10.1's, on a worker who has a profile to correct. A
  -- leaver's details are frozen (§10.6 step 7); a candidate still in the
  -- wizard sets their own name and selfie there.
  if s.status not in ('compliant', 'blocked') then
    raise exception 'not_editable' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('name', 'photo') then
    raise exception 'bad_kind' using errcode = 'P0001';
  end if;
  if exists (select 1 from profile_change_requests r
              where r.staff_id = v_id and r.kind = p_kind and r.status = 'pending') then
    raise exception 'already_pending' using errcode = 'P0001',
      hint = 'ADR-0045: one pending request per kind. Withdraw it to ask again.';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'note_too_long' using errcode = 'P0001';
  end if;

  if p_kind = 'name' then
    -- validateNameChange() in packages/domain, in its order.
    if v_first is null then raise exception 'first_required' using errcode = 'P0001'; end if;
    if v_last  is null then raise exception 'last_required'  using errcode = 'P0001'; end if;
    if char_length(v_first) > 100 then raise exception 'first_too_long' using errcode = 'P0001'; end if;
    if char_length(v_last)  > 100 then raise exception 'last_too_long'  using errcode = 'P0001'; end if;
    -- Exact after trimming: a capitalisation fix IS a change.
    if v_first = btrim(s.first_name) and v_last = btrim(s.last_name) then
      raise exception 'unchanged' using errcode = 'P0001';
    end if;
    if v_evid is null then
      raise exception 'evidence_required' using errcode = 'P0001',
        hint = 'ADR-0045 / Q13: a name change needs evidence.';
    end if;
    select e.problem into v_problem
      from evidence_upload_problem(v_id, 'change-requests', v_evid) e;
    if v_problem is not null then
      raise exception '%', v_problem using errcode = 'P0001';
    end if;
    v_photo := null;
  else
    if v_photo is null then
      raise exception 'photo_required' using errcode = 'P0001';
    end if;
    -- The worker's own folder only; the table CHECK says the same.
    if not starts_with(v_photo, v_id::text || '/')
       or char_length(v_photo) <= char_length(v_id::text) + 1
       or strpos(v_photo, '..') > 0 then
      raise exception 'wrong_path' using errcode = 'P0001';
    end if;
    if not exists (select 1 from storage.objects o
                    where o.bucket_id = 'photos' and o.name = v_photo) then
      raise exception 'file_not_found' using errcode = 'P0001';
    end if;
    if v_photo = s.photo_path then
      raise exception 'unchanged' using errcode = 'P0001';
    end if;
    v_first := null;
    v_last  := null;
    v_evid  := null;
  end if;

  begin
    insert into profile_change_requests
      (staff_id, kind, proposed_first_name, proposed_last_name,
       proposed_photo_path, evidence_path, worker_note)
    values (v_id, p_kind, v_first, v_last, v_photo, v_evid, v_note)
    returning id, created_at into v_req, v_created;
  exception when unique_violation then
    -- Two submits racing past the check above: the partial unique index
    -- keeps one, and the other is told what the first was.
    raise exception 'already_pending' using errcode = 'P0001';
  end;

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values ('RC1:request:' || v_req, 'email', 'RC1',
          array['admin@thehospitalitycompany.co.uk'],
          jsonb_build_object(
            'name',        s.first_name || ' ' || s.last_name,
            'employeeId',  coalesce(s.employee_id::text, '(not yet issued)'),
            'change',      p_kind,
            'requestedAt', to_char(v_created at time zone 'Europe/London', 'DD Mon YYYY HH24:MI'),
            'current',     case when p_kind = 'name' then s.first_name || ' ' || s.last_name
                                when s.photo_path is null then 'No photo on file'
                                else 'The current profile photo' end,
            'proposed',    case when p_kind = 'name' then v_first || ' ' || v_last
                                else 'A new photo, shown side by side in Staff → Change requests' end,
            'note',        coalesce(v_note, '—')))
  on conflict (key) do nothing;

  return jsonb_build_object('ok', true, 'id', v_req);
end $$;

comment on function public.request_profile_change(text, text, text, text, text, text) is
  'ADR-0045: the calling worker asks the office to change their locked name (first/last + evidence in documents/<id>/change-requests/) or photo (a fresh object in photos/<id>/). One pending per kind; the uploaded object must exist; a name equal to the current one is refused. Queues RC1 to admin@ in the same transaction. Never writes staff.';

create or replace function public.withdraw_profile_change(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  v_status staff_status;
  v_req_status text;
begin
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  select s.status into v_status from staff s where s.id = v_id;
  if v_status = 'removed' then
    raise exception 'account_closed' using errcode = 'P0001';
  end if;

  select r.status into v_req_status
    from profile_change_requests r
   where r.id = p_id and r.staff_id = v_id
   for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_req_status <> 'pending' then
    raise exception 'not_pending' using errcode = 'P0001',
      hint = 'ADR-0045: the office has already decided it.';
  end if;

  -- The state guard stamps decided_at on leaving pending; decided_by stays
  -- empty, which is how a withdrawal differs from a decision.
  update profile_change_requests set status = 'withdrawn' where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

comment on function public.withdraw_profile_change(uuid) is
  'ADR-0045: the calling worker withdraws their own pending change request. not_found for another worker''s id; not_pending once the office has decided.';

create or replace function public.my_profile_change_requests()
returns table (
  id                  uuid,
  kind                text,
  status              text,
  proposed_first_name text,
  proposed_last_name  text,
  proposed_photo_path text,
  worker_note         text,
  decision_reason     text,
  created_at          timestamptz,
  decided_at          timestamptz
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  v_status staff_status;
begin
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  select s.status into v_status from staff s where s.id = v_id;
  if v_status = 'removed' then
    raise exception 'account_closed' using errcode = 'P0001';
  end if;

  return query
    select r.id, r.kind, r.status, r.proposed_first_name, r.proposed_last_name,
           r.proposed_photo_path, r.worker_note, r.decision_reason,
           r.created_at, r.decided_at
      from profile_change_requests r
     where r.staff_id = v_id
     order by r.created_at desc, r.id;
end $$;

comment on function public.my_profile_change_requests() is
  'ADR-0045: the calling worker''s own change requests, newest first, with the office''s reason on a rejection (shown to the worker). Never returns decided_by, previous_value or evidence_path.';

revoke execute on function public.request_profile_change(text, text, text, text, text, text) from public, anon;
revoke execute on function public.withdraw_profile_change(uuid)                               from public, anon;
revoke execute on function public.my_profile_change_requests()                                from public, anon;
grant  execute on function public.request_profile_change(text, text, text, text, text, text) to authenticated;
grant  execute on function public.withdraw_profile_change(uuid)                               to authenticated;
grant  execute on function public.my_profile_change_requests()                                to authenticated;
