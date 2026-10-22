-- =====================================================================
-- Migration 20261024100000 · names already on file are corrected to the
--                             passport (ADR-0193, after ADR-0189)
--
-- ADR-0189 stopped a new candidate registering as "Marc M.". The ones
-- already on file stay, and the office had no way to change a name: only a
-- worker's own "Request a change" (ADR-0045) could. This adds:
--
--   office_correct_name(staff, first, last, reason)
--       The office's own correction, shaped like office_correct_dob()
--       (ADR-0070): an owner or manager (office_can('identity'); a viewer is
--       read_only, a scheduler not_permitted), never a removed profile, the
--       passport rule (name_fault(), ADR-0189) on both parts, "that is the
--       name already on file", and a reason of 10-300 characters. Writes
--       staff.first_name / last_name, audits staff.name_corrected with the
--       reason and actorName (the names under `firstName` / `lastName`, which
--       remove_worker()'s §1.7 scrub already strips) and tells payroll the
--       way an approved name request does (RC4). It starts no right-to-work
--       re-check (Q13) and rewrites nothing already issued (§1.7).
--
--   office_names_to_review()
--       The office's list: every live worker or candidate whose name is an
--       initial, has a symbol, or is all lower or all upper case, with the
--       name on the Home Office record beside it where a share-code check
--       found one. Read-only; any office login.
--
--   staff_removed_purge_name_audit()
--       §1.7: a removed worker's name audit rows keep what happened, not
--       what anyone wrote about it (the free-text reason is overwritten, as
--       it is for the date-of-birth rows), and the RC4 copy payroll was
--       sent is anonymised and, if unsent, failed gdpr_removed. A sibling of
--       staff_removed_purge_additions(), which is not restated.
--
--   request_profile_change()
--       Restated from 20260930206000 with one addition: a name request
--       takes the same passport rule, so "Request a change" cannot put an
--       initial back. Refusals first_initial | first_characters |
--       last_initial | last_characters, after the length checks.
--
-- Forward-only. pgTAP 926.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · office_correct_name
-- ---------------------------------------------------------------------
create or replace function public.office_correct_name(
  p_staff  uuid,
  p_first  text,
  p_last   text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor  uuid := auth.uid();
  s        staff;
  v_now    timestamptz := now();
  -- legalName.ts tidyName(): NFC, trimmed, runs of whitespace as one space.
  v_first  text := regexp_replace(btrim(normalize(coalesce(p_first, ''), nfc)), '[[:space:]]+', ' ', 'g');
  v_last   text := regexp_replace(btrim(normalize(coalesce(p_last, ''), nfc)), '[[:space:]]+', ' ', 'g');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_fault  text;
begin
  if v_actor is null or current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  -- ADR-0060: a viewer is told it is read-only, before anything else.
  perform assert_not_read_only();
  -- ADR-0056's matrix: owner and manager hold 'identity'; a scheduler not.
  if not office_can('identity') then
    raise exception 'not_permitted' using errcode = '42501', detail = 'identity';
  end if;

  select * into s from staff where id = p_staff for update;
  if s.id is null then
    raise exception 'staff_not_found' using errcode = 'P0002';
  end if;
  -- §1.7: nothing personal is put back on an anonymised profile.
  if s.removed_at is not null or s.status = 'removed' then
    raise exception 'staff_removed' using errcode = 'P0001';
  end if;

  -- validateNameCorrection() in packages/domain, in its order.
  v_fault := public.name_fault(v_first);
  if v_fault is not null then
    raise exception '%', 'first_' || v_fault using errcode = 'P0001';
  end if;
  v_fault := public.name_fault(v_last);
  if v_fault is not null then
    raise exception '%', 'last_' || v_fault using errcode = 'P0001';
  end if;
  if v_first = s.first_name and v_last = s.last_name then
    raise exception 'unchanged' using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if char_length(v_reason) < 10 then
    raise exception 'reason_too_short' using errcode = '22023';
  end if;
  if char_length(v_reason) > 300 then
    raise exception 'reason_too_long' using errcode = '22023';
  end if;

  update staff set first_name = v_first, last_name = v_last where id = s.id;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (v_now, v_actor, 'staff.name_corrected', 'staff', s.id,
          jsonb_build_object(
            'source',     'office',
            'reason',     v_reason,
            'actorName',  (select full_name from profiles where id = v_actor),
            'firstName',  jsonb_build_object('from', s.first_name, 'to', v_first),
            'lastName',   jsonb_build_object('from', s.last_name,  'to', v_last)));

  -- What payroll is told when an approved name request changes a name
  -- (RC4, office_decide_profile_change): they know the worker by it.
  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values ('RC4:correction:' || s.id || ':' || extract(epoch from v_now)::bigint, 'email', 'RC4',
          array['admin@thehospitalitycompany.co.uk', 'thc_payroll@topsourceworldwide.com'],
          jsonb_build_object(
            'name',         v_first || ' ' || v_last,
            'employeeId',   coalesce(s.employee_id::text, '(not yet issued)'),
            'previousName', s.first_name || ' ' || s.last_name,
            'approvedAt',   to_char(v_now at time zone 'Europe/London', 'DD Mon YYYY HH24:MI')))
  on conflict (key) do nothing;

  return jsonb_build_object('ok', true,
                            'firstName', v_first, 'lastName', v_last,
                            'previousFirstName', s.first_name, 'previousLastName', s.last_name);
end $$;

comment on function public.office_correct_name(uuid, text, text, text) is
  'ADR-0193: an owner or manager corrects a worker''s or candidate''s name to what the passport prints (office_can(''identity''); a viewer is read_only, a scheduler not_permitted). Refuses a removed profile (staff_removed), name_fault() on either part (first_|last_ + required|initial|characters|too_long), the name already on file (unchanged) and a reason under 10 or over 300 characters. Writes staff.first_name / last_name, audits staff.name_corrected with the reason and actorName, and sends payroll RC4. No right-to-work re-check (Q13).';

revoke execute on function public.office_correct_name(uuid, text, text, text) from public, anon;
grant  execute on function public.office_correct_name(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2 · office_names_to_review — the list the office works through
-- ---------------------------------------------------------------------
create or replace function public.office_names_to_review()
returns table (
  staff_id    uuid,
  status      text,
  first_name  text,
  last_name   text,
  reasons     text[],
  record_name text
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if auth.uid() is null or current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  return query
  select f.id, f.status, f.first_name, f.last_name, f.reasons,
         (select l.record_name
            from rtw_checks_latest_v l
           where l.staff_id = f.id and l.record_name is not null
           order by l.created_at desc
           limit 1)
    from (
      select s.id, s.status::text as status, s.first_name, s.last_name, s.created_at,
             array_remove(array[
               case when public.name_fault(s.first_name) = 'initial'
                      or public.name_fault(s.last_name)  = 'initial'    then 'initial' end,
               case when public.name_fault(s.first_name) = 'characters'
                      or public.name_fault(s.last_name)  = 'characters' then 'characters' end,
               case when (s.first_name = lower(s.first_name) and s.first_name ~ '[[:alpha:]]{2}')
                      or (s.last_name  = lower(s.last_name)  and s.last_name  ~ '[[:alpha:]]{2}')
                    then 'lower_case' end,
               case when (s.first_name = upper(s.first_name) and s.first_name ~ '[[:alpha:]]{2}')
                      or (s.last_name  = upper(s.last_name)  and s.last_name  ~ '[[:alpha:]]{2}')
                    then 'upper_case' end
             ], null) as reasons
        from staff s
       where s.removed_at is null
         and s.status not in ('removed', 'rejected')
    ) f
   where cardinality(f.reasons) > 0
   order by f.created_at desc;
end $$;

comment on function public.office_names_to_review() is
  'ADR-0193: live workers and candidates whose name is an initial, has a symbol, or is all lower or all upper case (reasons: initial | characters | lower_case | upper_case), newest first, with the name on the Home Office record from the latest share-code check where there is one. Any office login; a worker, a client and anon are refused.';

revoke execute on function public.office_names_to_review() from public, anon;
grant  execute on function public.office_names_to_review() to authenticated;

-- ---------------------------------------------------------------------
-- 3 · request_profile_change — 20260930206000, one addition
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
  v_fault text;
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
      hint = 'ADR-0045: one pending request per kind. Withdraw it to ask again.';
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
    -- 20261024100000 (ADR-0193): a name as it is printed on the passport, the
    -- rule /apply keeps (name_fault(), nameFault() in packages/domain). Only
    -- 'initial' and 'characters' can reach here: required and too_long are
    -- answered above.
    v_fault := public.name_fault(v_first);
    if v_fault is not null then
      raise exception '%', 'first_' || v_fault using errcode = 'P0001';
    end if;
    v_fault := public.name_fault(v_last);
    if v_fault is not null then
      raise exception '%', 'last_' || v_fault using errcode = 'P0001';
    end if;
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

-- ---------------------------------------------------------------------
-- 4 · §1.7 — removal keeps what happened, not what anyone wrote about it
--     (a sibling of staff_removed_purge_additions(), which is not
--     restated; remove_worker() has already stripped `firstName` /
--     `lastName` — v_pii_keys — from every audit row about the worker)
-- ---------------------------------------------------------------------
create or replace function public.staff_removed_purge_name_audit()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_label text := deleted_account_label(new.employee_id);
begin
  update audit_log l
     set data = (l.data - 'note') || jsonb_build_object('reason', 'Removed under GDPR (§1.7)')
   where l.entity = 'staff'
     and l.entity_id = new.id
     and l.action = 'staff.name_corrected'
     and l.data ? 'reason';

  update notification_outbox n
     set payload   = n.payload || jsonb_build_object('name', v_label, 'previousName', v_label),
         failed_at = case when n.sent_at is null and n.failed_at is null
                          then now() else n.failed_at end,
         error     = case when n.sent_at is null and n.failed_at is null
                          then 'gdpr_removed: not sent, the worker was removed (§1.7)'
                          else n.error end
   where n.template = 'RC4'
     and n.key like 'RC4:correction:' || new.id::text || ':%';

  return null;
end $$;

comment on function public.staff_removed_purge_name_audit() is
  '§1.7 GDPR removal for office_correct_name() (ADR-0193): overwrites the free-text reason on the worker''s staff.name_corrected audit rows and anonymises the RC4 outbox copy (names -> "Deleted account #id", unsent rows failed gdpr_removed). Fires once, after removed_at is first set. A trigger function: not an RPC.';

-- Trigger functions are never RPCs (20260927161000, pgTAP 190).
revoke execute on function public.staff_removed_purge_name_audit() from public, anon, authenticated;

drop trigger if exists staff_removed_purge_name_audit on staff;
create trigger staff_removed_purge_name_audit
  after update of removed_at on staff
  for each row
  when (old.removed_at is null and new.removed_at is not null)
  execute function staff_removed_purge_name_audit();
