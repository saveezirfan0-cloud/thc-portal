-- =====================================================================
-- Migration 20260930206000 · final follow-ups on the Staff App additions
--   docs/19-staff-features-plan.md §3 · ADR-0044 (proposed — awaiting THC)
--
-- Two functions RESTATED, each in full from its latest definition — grep
-- over every migration, main's included: nothing after the files named
-- below touches them — with the clauses named here and nothing else
-- changed. Same signatures, so `create or replace` replaces rather than
-- overloads; comments updated; grants re-issued exactly as before.
--
--   1 · request_profile_change        (latest: 20260930205100)
--       + not_editable for a worker on a MANUAL hold (status blocked,
--         block_kind manual). The Staff App already closes Profile details
--         and Request a change for them (canReachProfileDetails() in
--         apps/staff/app/profile/lock.ts: §10.1 case 2 is a static screen
--         with no action behind it), so an RPC that still accepted the
--         request was a door the UI had closed.
--
--         Decision: ONLY the manual hold is refused. A documents lock
--         (block_kind auto_document, or a compliant worker with an expired
--         document) and a conviction review (block_kind conviction_review,
--         or the conviction_unreviewed blocker) are §10.1 case 1: a
--         documents-locked worker keeps their profile, and
--         canReachProfileDetails() opens Profile details for them. A name
--         correction is exactly what such a worker may need — the passport
--         they re-upload may carry the new name — so the database accepts
--         what the screen they can reach sends. This is deliberately wider
--         than add_my_unavailability's appLock() === 'none' rule
--         (20260930205100): availability only feeds auto-assign, whose pool
--         a blocked worker is not in; a name/photo request is a profile
--         correction, and the RPC now mirrors canReachProfileDetails()
--         exactly.
--       ~ RC1's payload key `change` → `field` (see 3).
--       + wrong_path for a photo path over 200 characters — the ceiling
--         main's staff_set_photo() (20260930120200) puts on the same
--         `<own id>/<name>.jpg` shape. An approved request becomes that
--         avatar, so the request takes nothing staff_set_photo() would not.
--
--   2 · office_decide_profile_change  (latest: 20260930203000)
--       ~ RC2's and RC3's payload key `change` → `field` (see 3); the local
--         variable renamed with it. Nothing else.
--
--   3 · The placeholder clash. RC1–RC3 said {change} for the word "name"
--       or "photo", while main's N11b (ADR-0037) says {change} for a whole
--       sentence ("Dress code changed by the office (was …)"). Each row
--       carries its own payload so nothing rendered wrongly, but one
--       placeholder name meaning two things is a trap for the next
--       template. Ours is now {field} in packages/notifications, here, and
--       in the payloads already queued: any RC1–RC3 outbox row carrying
--       `change` has it renamed to `field`, so a row queued before this
--       migration and sent after it still renders. N11b is untouched.
--
-- Refusals raise as before: not_editable (P0001), which the Staff App
-- already turns into a sentence (apps/staff/app/profile/change-requests.ts).
--
-- Forward-only. pgTAP: 715 (H, and C's payload keys), 716 (payload keys),
-- 702 (the GDPR scrub reads the renamed key).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · request_profile_change — 20260930205100 + the manual hold refused,
--     the 200-character photo path ceiling, RC1's {change} → {field}.
-- ---------------------------------------------------------------------
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
  -- 20260930206000: a MANUAL hold is §10.1 case 2 — a static screen with
  -- nothing behind it, and canReachProfileDetails() closes this form. The
  -- documents and conviction-review locks keep their profile (§10.1 case
  -- 1), so they may still ask for a correction; only the manual hold is
  -- refused.
  if s.status = 'blocked' and s.block_kind is not distinct from 'manual'::block_kind then
    raise exception 'not_editable' using errcode = 'P0001',
      hint = '§10.1 case 2: a manual hold has no profile actions.';
  end if;
  if p_kind is null or p_kind not in ('name', 'photo') then
    raise exception 'bad_kind' using errcode = 'P0001';
  end if;
  if exists (select 1 from profile_change_requests r
              where r.staff_id = v_id and r.kind = p_kind and r.status = 'pending') then
    raise exception 'already_pending' using errcode = 'P0001',
      hint = 'ADR-0044: one pending request per kind. Withdraw it to ask again.';
  end if;
  -- 20260930205100: at most three of a kind in any 24 hours, any status.
  -- Each one emailed admin@ (RC1); withdrawing does not un-send it.
  if (select count(*) from profile_change_requests r
       where r.staff_id = v_id and r.kind = p_kind
         and r.created_at > now() - interval '24 hours') >= 3 then
    raise exception 'too_many_requests' using errcode = 'P0001',
      hint = 'At most three change requests of a kind in 24 hours (RC1 flood guard).';
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
        hint = 'ADR-0044 / Q13: a name change needs evidence.';
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
    -- The worker's own folder only; the table CHECK says the same. And
    -- exactly `<own id>/<name>.jpg`, one level deep — the shape main's
    -- 20260930120200 gave staff_set_photo(), because an approved request
    -- becomes the same locked avatar (re-checked when this file was
    -- re-stamped after it; the Staff App uploads <id>/selfie-<epoch>.jpg).
    if not starts_with(v_photo, v_id::text || '/')
       or char_length(v_photo) <= char_length(v_id::text) + 1
       or strpos(v_photo, '..') > 0
       or v_photo !~ ('^' || v_id::text || '/[A-Za-z0-9][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*\.jpg$')
       -- 20260930206000: and no longer than staff_set_photo() takes
       -- (20260930120200), since an approved request becomes the same avatar.
       or char_length(v_photo) > 200 then
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
            'field',       p_kind,
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
  'ADR-0044: the calling worker asks the office to change their locked name (first/last + evidence in documents/<id>/change-requests/) or photo (a fresh object in photos/<id>/). One pending per kind, and at most three of a kind created in any 24 hours whatever their status (too_many_requests — each queued an RC1; 20260930205100); the uploaded object must exist; a name equal to the current one is refused. A manual hold (status blocked, block_kind manual — §10.1 case 2) is refused not_editable; a documents or conviction-review block is not; a photo path over 200 characters is wrong_path, as for staff_set_photo() (20260930206000). Queues RC1 to admin@ in the same transaction, the kind as {field}. Never writes staff.';

-- ---------------------------------------------------------------------
-- 2 · office_decide_profile_change — 20260930203000, RC2/RC3's
--     {change} → {field}.
-- ---------------------------------------------------------------------
create or replace function public.office_decide_profile_change(
  p_id      uuid,
  p_approve boolean,
  p_reason  text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r         profile_change_requests;
  s         staff;
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_field   text;
  v_prev    jsonb;
  v_now     timestamptz := now();
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'decision_required' using errcode = '22023';
  end if;

  select * into r from profile_change_requests where id = p_id for update;
  if r.id is null then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  if r.status <> 'pending' then
    raise exception 'already_decided' using errcode = 'P0001',
      hint = 'ADR-0044: approved, rejected and withdrawn are terminal. "Request again" is a new row.';
  end if;

  -- decisionNeedsReason(approve) in packages/domain: a rejection says why,
  -- and the worker reads it (RC3, "Not changed: {reason}").
  if not p_approve and v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 300 then
    raise exception 'reason_too_long' using errcode = '22023';
  end if;

  select * into s from staff where id = r.staff_id for update;
  -- The worker-facing word for {field}: "Your name has been updated."
  v_field := case r.kind when 'name' then 'name' else 'photo' end;

  if not p_approve then
    update profile_change_requests
       set status = 'rejected',
           decision_reason = v_reason,
           decided_at = v_now,
           decided_by = auth.uid(),
           previous_value = case r.kind
             when 'name' then jsonb_build_object('firstName', s.first_name, 'lastName', s.last_name)
             else jsonb_build_object('photoPath', s.photo_path) end
     where id = r.id;

    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    values ('RC3:request:' || r.id, 'push', 'RC3', r.staff_id,
            jsonb_build_object('field', v_field, 'reason', v_reason))
    on conflict (key) do nothing;

    insert into audit_log (at, actor, action, entity, entity_id, data)
    values (v_now, auth.uid(), 'profile_change.reject', 'staff', r.staff_id,
            jsonb_build_object('requestId', r.id, 'kind', r.kind));

    return jsonb_build_object('ok', true, 'status', 'rejected', 'kind', r.kind);
  end if;

  if r.kind = 'name' then
    v_prev := jsonb_build_object('firstName', s.first_name, 'lastName', s.last_name);

    -- The name the right-to-work check and payroll know the worker by.
    -- No automatic right-to-work re-check (Q13); nothing already issued
    -- is rewritten (§1.7) — RC4 tells payroll instead.
    update staff
       set first_name = r.proposed_first_name,
           last_name  = r.proposed_last_name
     where id = r.staff_id;

    insert into notification_outbox (key, channel, template, recipient_emails, payload)
    values ('RC4:request:' || r.id, 'email', 'RC4',
            array['admin@thehospitalitycompany.co.uk', 'thc_payroll@topsourceworldwide.com'],
            jsonb_build_object(
              'name',         r.proposed_first_name || ' ' || r.proposed_last_name,
              'employeeId',   coalesce(s.employee_id::text, '(not yet issued)'),
              'previousName', s.first_name || ' ' || s.last_name,
              'approvedAt',   to_char(v_now at time zone 'Europe/London', 'DD Mon YYYY HH24:MI')))
    on conflict (key) do nothing;
  else
    v_prev := jsonb_build_object('photoPath', s.photo_path);

    -- §10.1's lock is on the WORKER's path (staff_set_photo refuses a
    -- second photo); the office's decision is the route through it. The
    -- old object is left where it is — purged with the prefix on GDPR
    -- removal, and still what already-issued allocation sheets printed.
    update staff set photo_path = r.proposed_photo_path where id = r.staff_id;
  end if;

  update profile_change_requests
     set status = 'approved',
         decided_at = v_now,
         decided_by = auth.uid(),
         applied_at = v_now,
         previous_value = v_prev
   where id = r.id;

  insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
  values ('RC2:request:' || r.id, 'push', 'RC2', r.staff_id,
          jsonb_build_object('field', v_field))
  on conflict (key) do nothing;

  -- The request row holds the values (and is anonymised on GDPR removal);
  -- the audit row records the decision, who made it and which request.
  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (v_now, auth.uid(), 'profile_change.approve', 'staff', r.staff_id,
          jsonb_build_object('requestId', r.id, 'kind', r.kind));

  return jsonb_build_object('ok', true, 'status', 'approved', 'kind', r.kind);
end $$;

comment on function public.office_decide_profile_change(uuid, boolean, text) is
  'ADR-0044: the office approves or rejects a pending name/photo change request (/staff/requests). Admin only. Approve name → staff.first_name/last_name + RC2 + RC4 (admin@ + payroll); approve photo → staff.photo_path despite the §10.1 lock, old object kept; reject → reason required (reason_required 22023, ≤ 300) + RC3. RC2/RC3 carry the kind as {field} (20260930206000). previous_value snapshots the profile at the decision; already_decided refuses a second decision; audit_log profile_change.approve|reject. No right-to-work re-check (Q13); issued PDFs and payroll exports untouched (§1.7).';

-- Grants exactly as 20260930205100 and 20260930203000 issued them.
revoke execute on function public.request_profile_change(text, text, text, text, text, text) from public, anon;
revoke execute on function public.office_decide_profile_change(uuid, boolean, text)           from public, anon;
grant  execute on function public.request_profile_change(text, text, text, text, text, text) to authenticated;
grant  execute on function public.office_decide_profile_change(uuid, boolean, text)           to authenticated;

-- ---------------------------------------------------------------------
-- 3 · RC1–RC3 rows already in the outbox: `change` → `field`, value kept.
--     Only this key, on only these templates; N11b's {change} is main's.
-- ---------------------------------------------------------------------
update notification_outbox
   set payload = (payload - 'change') || jsonb_build_object('field', payload -> 'change')
 where template in ('RC1', 'RC2', 'RC3')
   and payload ? 'change'
   and not payload ? 'field';
