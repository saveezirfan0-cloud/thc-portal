-- =====================================================================
-- Migration 20260930203000 · the office side of the staff additions
--   docs/19-staff-features-plan.md Phase 1, Agent C (directory)
--   ADR-0042 (availability, read-only tab), ADR-0043 (emergency contact),
--   ADR-0044 (request a change), ADR-0046 (referrals)
--   — additions to Scope v1.6, status proposed — awaiting THC
--
-- Phase 0 (20260930200100) laid the tables with one admin_read policy each
-- and no write path at all. This file is the office's half:
--
--   §1 office_save_emergency_contact / office_clear_emergency_contact
--      Admin only, audited. The audit row records THAT the office changed
--      the contact and which fields moved — never the values: the contact
--      is a third party's personal data, the table row is deleted on GDPR
--      removal (staff_removed_purge_additions), and audit_log is not.
--   §2 office_decide_profile_change(p_id, p_approve, p_reason)
--      Approve a name → staff.first_name/last_name, RC2 to the worker, RC4
--      to admin@ + payroll (E7's recipients). Approve a photo →
--      staff.photo_path, despite the §10.1 lock; the old object is kept and
--      goes with the <staff_id>/ prefix on GDPR removal. Reject → reason
--      required and shown to the worker, RC3. previous_value is the snapshot
--      at the decision. No automatic right-to-work re-check (Q13). Issued
--      PDFs (event_documents) and payroll exports (report_sends) are never
--      touched (§1.7 — exports are never corrected retroactively).
--   §3 the office's reads — definer, admin only, naming their columns:
--      office_profile_change_requests  the /staff/requests queue and the
--                                      /staff/:id banner (who decided, which
--                                      admin cannot read off `profiles`)
--      office_emergency_contact        the Overview card ("by the worker" /
--                                      "by the office")
--      office_staff_unavailability     the read-only Availability tab
--      office_staff_referrals          the Referrals card + "Referred by"
--
-- The rules this file keeps (docs/19 §0):
--   • No client policy, no client_* view: the client sees none of this.
--   • Every function is security definer, pins search_path, checks
--     current_app_role() = 'admin' in its own body (the office_invite_worker
--     pattern, 20260927100000 — no service-role door), and is revoked from
--     public and anon (pgTAP 190 2e/2f).
--   • Nothing here restates a frozen function (docs/19 §0.6) or touches
--     another Phase-1 agent's objects.
--
-- pgTAP: 711 (emergency contact + the /staff/:id reads), 716 (decide).
-- Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- §1 · Emergency contact (ADR-0043)
-- ---------------------------------------------------------------------
create or replace function public.office_save_emergency_contact(
  p_staff        uuid,
  p_name         text,
  p_relationship text,
  p_phone        text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s          staff;
  v_old      staff_emergency_contacts;
  v_name     text := btrim(coalesce(p_name, ''));
  v_rel      text := btrim(coalesce(p_relationship, ''));
  -- What a person types between the digits goes; the leading + stays
  -- (normaliseEmergencyPhone() in packages/domain).
  v_phone    text := regexp_replace(btrim(coalesce(p_phone, '')), '[[:space:]()-]', '', 'g');
  v_changed  text[] := '{}';
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  select * into s from staff where id = p_staff for update;
  if s.id is null then
    raise exception 'staff_not_found' using errcode = 'P0002';
  end if;
  -- §1.7: the removed worker's contact was deleted with the rest; nothing
  -- may put one back.
  if s.removed_at is not null then
    raise exception 'staff_removed' using errcode = 'P0001';
  end if;

  if char_length(v_name) not between 1 and 100 then
    raise exception 'bad_name' using errcode = '22023';
  end if;
  if char_length(v_rel) not between 1 and 40 then
    raise exception 'bad_relationship' using errcode = '22023';
  end if;
  if v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'bad_phone' using errcode = '22023',
      hint = 'ADR-0043: E.164 with the country code, the /apply rule.';
  end if;

  select * into v_old from staff_emergency_contacts where staff_id = p_staff;
  if v_old.staff_id is null then
    v_changed := array['name', 'relationship', 'phone'];
  else
    if v_old.name is distinct from v_name then v_changed := v_changed || 'name'::text; end if;
    if v_old.relationship is distinct from v_rel then v_changed := v_changed || 'relationship'::text; end if;
    if v_old.phone is distinct from v_phone then v_changed := v_changed || 'phone'::text; end if;
  end if;

  insert into staff_emergency_contacts (staff_id, name, relationship, phone, updated_at, updated_by)
  values (p_staff, v_name, v_rel, v_phone, now(), auth.uid())
  on conflict (staff_id) do update
     set name = excluded.name,
         relationship = excluded.relationship,
         phone = excluded.phone,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by;

  -- Which fields, never their values (see the header).
  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'emergency_contact.office_save', 'staff', p_staff,
          jsonb_build_object('created', v_old.staff_id is null, 'changed', to_jsonb(v_changed)));

  return jsonb_build_object('ok', true, 'created', v_old.staff_id is null,
                            'changed', to_jsonb(v_changed));
end $$;

comment on function public.office_save_emergency_contact(uuid, text, text, text) is
  'ADR-0043: the office saves or corrects a worker''s emergency contact (/staff/:id Overview → Edit). Admin only; refuses a removed worker; name 1–100, relationship 1–40, phone E.164 after separators are stripped (bad_name / bad_relationship / bad_phone, 22023). Writes audit_log emergency_contact.office_save with the changed field names — never the values. No notification.';

create or replace function public.office_clear_emergency_contact(p_staff uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_deleted int;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if not exists (select 1 from staff where id = p_staff) then
    raise exception 'staff_not_found' using errcode = 'P0002';
  end if;

  delete from staff_emergency_contacts where staff_id = p_staff;
  get diagnostics v_deleted = row_count;

  if v_deleted > 0 then
    insert into audit_log (at, actor, action, entity, entity_id, data)
    values (now(), auth.uid(), 'emergency_contact.office_clear', 'staff', p_staff, '{}'::jsonb);
  end if;

  return jsonb_build_object('ok', true, 'cleared', v_deleted > 0);
end $$;

comment on function public.office_clear_emergency_contact(uuid) is
  'ADR-0043: the office clears a worker''s emergency contact (/staff/:id Overview → Clear). Admin only; audited (emergency_contact.office_clear) when there was a row to clear; clearing nothing is a no-op, not an error.';

-- ---------------------------------------------------------------------
-- §2 · Decide a change request (ADR-0044)
--
-- Locks the request, then the worker, in that order — the only order any
-- path here takes, so two managers deciding at once queue on the request
-- row and the second reads `already_decided`.
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
  v_change  text;
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
  -- The worker-facing word for {change}: "Your name has been updated."
  v_change := case r.kind when 'name' then 'name' else 'photo' end;

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
            jsonb_build_object('change', v_change, 'reason', v_reason))
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
          jsonb_build_object('change', v_change))
  on conflict (key) do nothing;

  -- The request row holds the values (and is anonymised on GDPR removal);
  -- the audit row records the decision, who made it and which request.
  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (v_now, auth.uid(), 'profile_change.approve', 'staff', r.staff_id,
          jsonb_build_object('requestId', r.id, 'kind', r.kind));

  return jsonb_build_object('ok', true, 'status', 'approved', 'kind', r.kind);
end $$;

comment on function public.office_decide_profile_change(uuid, boolean, text) is
  'ADR-0044: the office approves or rejects a pending name/photo change request (/staff/requests). Admin only. Approve name → staff.first_name/last_name + RC2 + RC4 (admin@ + payroll); approve photo → staff.photo_path despite the §10.1 lock, old object kept; reject → reason required (reason_required 22023, ≤ 300) + RC3. previous_value snapshots the profile at the decision; already_decided refuses a second decision; audit_log profile_change.approve|reject. No right-to-work re-check (Q13); issued PDFs and payroll exports untouched (§1.7).';

-- ---------------------------------------------------------------------
-- §3 · The office's reads
-- ---------------------------------------------------------------------

-- The /staff/requests queue (pending oldest first; decided newest first)
-- and the /staff/:id banner. `decided_by_name` is why this is a function:
-- an admin reads only their own `profiles` row (profiles_self).
create or replace function public.office_profile_change_requests(
  p_staff   uuid default null,
  p_decided boolean default false,
  p_limit   int default 200
) returns table (
  id                  uuid,
  staff_id            uuid,
  kind                text,
  status              text,
  display_name        text,
  employee_id         int,
  removed             boolean,
  staff_status        text,
  rtw_branch          text,
  right_to_work_until date,
  current_first_name  text,
  current_last_name   text,
  current_photo_path  text,
  proposed_first_name text,
  proposed_last_name  text,
  proposed_photo_path text,
  evidence_path       text,
  worker_note         text,
  previous_value      jsonb,
  created_at          timestamptz,
  decided_at          timestamptz,
  decided_by_name     text,
  decision_reason     text
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  return query
  select r.id, r.staff_id, r.kind, r.status,
         case when s.removed_at is not null then deleted_account_label(s.employee_id)
              else s.first_name || ' ' || s.last_name end,
         s.employee_id,
         s.removed_at is not null,
         s.status::text,
         s.rtw_branch::text,
         s.right_to_work_until,
         case when s.removed_at is null then s.first_name end,
         case when s.removed_at is null then s.last_name end,
         case when s.removed_at is null then s.photo_path end,
         r.proposed_first_name, r.proposed_last_name,
         case when s.removed_at is null then r.proposed_photo_path end,
         case when s.removed_at is null then r.evidence_path end,
         r.worker_note, r.previous_value, r.created_at, r.decided_at,
         p.full_name,
         r.decision_reason
    from profile_change_requests r
    join staff s on s.id = r.staff_id
    left join profiles p on p.id = r.decided_by
   where (p_staff is null or r.staff_id = p_staff)
     and (case when p_decided then r.status <> 'pending' else r.status = 'pending' end)
   order by case when p_decided then null else r.created_at end asc,
            r.decided_at desc nulls last,
            r.created_at desc
   limit greatest(1, least(coalesce(p_limit, 200), 500));
end $$;

comment on function public.office_profile_change_requests(uuid, boolean, int) is
  'ADR-0044: the /staff/requests queue — pending oldest first, or decided newest first — optionally for one worker (the /staff/:id banner). Admin only. Names the decider (profiles.full_name, which an admin cannot read directly). A removed worker reads "Deleted account #id" with no photo or evidence path.';

-- The Overview card. updated_by is compared with the worker's own login to
-- say "by the worker" / "by the office" — the name only for the office.
create or replace function public.office_emergency_contact(p_staff uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v jsonb;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  select jsonb_build_object(
           'name',          c.name,
           'relationship',  c.relationship,
           'phone',         c.phone,
           'updatedAt',     c.updated_at,
           'updatedBy',     case when c.updated_by is null then null
                                 when c.updated_by = s.user_id then 'worker'
                                 else 'office' end,
           'updatedByName', case when c.updated_by is not null and c.updated_by is distinct from s.user_id
                                 then p.full_name end)
    into v
    from staff_emergency_contacts c
    join staff s on s.id = c.staff_id
    left join profiles p on p.id = c.updated_by
   where c.staff_id = p_staff;

  return v;  -- null = "Not provided"
end $$;

comment on function public.office_emergency_contact(uuid) is
  'ADR-0043: the worker''s emergency contact for the /staff/:id Overview card, with who saved it last (worker / office + name). Admin only. Null when none — the card says "Not provided". Never read by a PDF, a client_* view or the Client Portal.';

-- The read-only Availability tab: entries overlapping [p_from, p_to), each
-- with its repeat series and any CONFIRMED booking it overlaps — measured
-- against the role section's own window (RULE-18), never the event's.
create or replace function public.office_staff_unavailability(
  p_staff uuid,
  p_from  timestamptz default now(),
  p_to    timestamptz default now() + interval '56 days'
) returns table (
  id                uuid,
  starts_at         timestamptz,
  ends_at           timestamptz,
  all_day           boolean,
  series_id         uuid,
  series_count      int,
  series_last_start timestamptz,
  created_at        timestamptz,
  bookings          jsonb
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'bad_window' using errcode = '22023';
  end if;

  return query
  select u.id, lower(u.period), upper(u.period), u.all_day, u.series_id,
         (select count(*)::int from staff_unavailability x where x.series_id = u.series_id),
         (select max(lower(x.period)) from staff_unavailability x where x.series_id = u.series_id),
         u.created_at,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'bookingId',  b.id,
                    'eventId',    ev.id,
                    'eventTitle', ev.title,
                    'roleName',   ro.name,
                    'startsAt',   sr.starts_at,
                    'endsAt',     sr.ends_at) order by sr.starts_at)
             from bookings b
             join shift_requirements sr on sr.id = b.shift_id
             join events ev on ev.id = sr.event_id
             join roles ro on ro.id = sr.role_id
            where b.staff_id = u.staff_id
              and b.status = 'confirmed'
              and tstzrange(sr.starts_at, sr.ends_at, '[)') && u.period), '[]'::jsonb)
    from staff_unavailability u
   where u.staff_id = p_staff
     and u.period && tstzrange(p_from, p_to, '[)')
   order by lower(u.period);
end $$;

comment on function public.office_staff_unavailability(uuid, timestamptz, timestamptz) is
  'ADR-0042: the /staff/:id Availability tab — a worker''s entries overlapping [p_from, p_to) (default the next 8 weeks), with the repeat series size and last start, and any confirmed booking whose role-section window overlaps (RULE-18). Admin only; read-only — the worker edits in the app.';

-- The Referrals card and the "Referred by" line (ADR-0046). A removed
-- person on either side reads "Deleted account #id" (§1.7).
create or replace function public.office_staff_referrals(p_staff uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_code     staff_referral_codes;
  v_by       jsonb;
  v_referred jsonb;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  select * into v_code from staff_referral_codes where staff_id = p_staff;

  select jsonb_build_object(
           'staffId',    s.id,
           'name',       case when s.removed_at is not null then deleted_account_label(s.employee_id)
                              else s.first_name || ' ' || s.last_name end,
           'employeeId', s.employee_id,
           'status',     s.status,
           'removed',    s.removed_at is not null,
           'recordedAt', a.recorded_at)
    into v_by
    from application_referrals a
    join staff s on s.id = a.referrer_staff_id
   where a.candidate_staff_id = p_staff
   order by a.recorded_at desc
   limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'staffId',    s.id,
           'name',       case when s.removed_at is not null then deleted_account_label(s.employee_id)
                              else s.first_name || ' ' || s.last_name end,
           'employeeId', s.employee_id,
           'status',     s.status,
           'removed',    s.removed_at is not null,
           'recordedAt', a.recorded_at) order by a.recorded_at), '[]'::jsonb)
    into v_referred
    from application_referrals a
    join staff s on s.id = a.candidate_staff_id
   where a.referrer_staff_id = p_staff;

  return jsonb_build_object(
    'code',          v_code.code,
    'codeRevokedAt', v_code.revoked_at,
    'referredBy',    v_by,
    'referred',      v_referred);
end $$;

comment on function public.office_staff_referrals(uuid) is
  'ADR-0046: the /staff/:id Referrals card — the worker''s code, who referred them (latest), and everyone who applied with their code, with status. Admin only; a removed person reads "Deleted account #id". No money, no reward (Q19).';

-- ---------------------------------------------------------------------
-- Grants: admin-only by the check inside; never PUBLIC or anon (190).
-- ---------------------------------------------------------------------
revoke execute on function public.office_save_emergency_contact(uuid, text, text, text)       from public, anon;
revoke execute on function public.office_clear_emergency_contact(uuid)                        from public, anon;
revoke execute on function public.office_decide_profile_change(uuid, boolean, text)           from public, anon;
revoke execute on function public.office_profile_change_requests(uuid, boolean, int)          from public, anon;
revoke execute on function public.office_emergency_contact(uuid)                              from public, anon;
revoke execute on function public.office_staff_unavailability(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function public.office_staff_referrals(uuid)                                from public, anon;

grant execute on function public.office_save_emergency_contact(uuid, text, text, text)       to authenticated;
grant execute on function public.office_clear_emergency_contact(uuid)                        to authenticated;
grant execute on function public.office_decide_profile_change(uuid, boolean, text)           to authenticated;
grant execute on function public.office_profile_change_requests(uuid, boolean, int)          to authenticated;
grant execute on function public.office_emergency_contact(uuid)                              to authenticated;
grant execute on function public.office_staff_unavailability(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.office_staff_referrals(uuid)                                to authenticated;
