-- =====================================================================
-- Migration 20261007100000 · the office can reject a profile selfie
--                            (ADR-0096; §10.1, §10.3 3/11, §2.7)
--
-- The selfie is set once and locked (staff_set_photo() refuses a second
-- photo once staff.photo_path is set, §10.1). The office could look at it
-- and — through the worker's own "Request a change" (ADR-0045) — decide a
-- NEW photo, but it could not take down one that was not appropriate: the
-- face stayed on the Back Office, the client line-up and the timesheet
-- until the worker thought to ask.
--
-- office_reject_selfie(p_staff, p_reason) is that action.
--
--   · staff.photo_path → null. The lock IS "photo_path is not null", so
--     clearing it hands the worker a fresh capture and nothing else has to
--     move: staff_set_photo() takes the next one, the avatar falls back to
--     initials everywhere (§2.7), and the Staff App already draws the
--     unlocked capture where there is no photo (PhotoField.tsx).
--   · onboarding_progress.selfie_at → null. The wizard decides "3/11 done"
--     from this timestamp, not from the photo, so without it a candidate
--     would be told the step is finished while holding no photo. With it
--     cleared a candidate in Documents is put back on step 3 (and the
--     chaser, OC3, names it).
--   · RC5 (push, to the worker) carries the office's reason word for word.
--   · The object stays in the photos bucket: it is what an already-issued
--     allocation sheet printed (§1.7, nothing issued is rewritten), and it
--     is purged with the worker's prefix on GDPR removal like every other
--     old photo.
--
-- Admin only, through the manager's SESSION (auth.uid() is the actor, as
-- office_decide_profile_change). A reason is required, ≤ 300 characters,
-- as for a rejected change request. Refused: a worker who has left, been
-- rejected or removed (not_active), and one with no photo (no_photo).
--
-- The audit row names who and which worker, never the reason — the reason
-- lives in the RC5 outbox row, which remove_worker() scrubs with the rest
-- of what is addressed to the worker (20260930120100). A pending photo
-- change request is left alone: approving it later is an office decision
-- like any other.
-- =====================================================================

create or replace function public.office_reject_selfie(p_staff uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s        staff;
  v_reason text        := nullif(btrim(coalesce(p_reason, '')), '');
  v_now    timestamptz := now();
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if char_length(v_reason) > 300 then
    raise exception 'reason_too_long' using errcode = '22023';
  end if;

  select * into s from staff where id = p_staff for update;
  if s.id is null then
    raise exception 'staff_not_found' using errcode = 'P0002';
  end if;
  if s.removed_at is not null or s.status in ('rejected', 'inactive', 'removed') then
    raise exception 'not_active' using errcode = 'P0001';
  end if;
  if s.photo_path is null then
    raise exception 'no_photo' using errcode = 'P0001';
  end if;

  update staff set photo_path = null where id = s.id;
  update onboarding_progress set selfie_at = null, updated_at = v_now where staff_id = s.id;

  -- One row per rejection: a worker whose retake is rejected again is told
  -- again, so the key carries the moment as well as the worker. clock_timestamp(),
  -- not v_now: two rejections inside one transaction are still two.
  insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
  values ('RC5:selfie:' || s.id || ':' || to_char(clock_timestamp() at time zone 'UTC', 'YYYYMMDD"T"HH24MISSUS'),
          'push', 'RC5', s.id,
          jsonb_build_object('reason', v_reason))
  on conflict (key) do nothing;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (v_now, auth.uid(), 'staff.selfie_rejected', 'staff', s.id, '{}'::jsonb);

  return jsonb_build_object('ok', true);
end $$;

comment on function public.office_reject_selfie(uuid, text) is
  'ADR-0096: the office rejects a worker''s profile selfie (/onboarding/:id and /staff/:id → Documents → Profile selfie → Reject). Admin only; reason required (reason_required 22023, ≤ 300 reason_too_long). Clears staff.photo_path (which is the §10.1 lock) and onboarding_progress.selfie_at (so the wizard reopens step 3), queues RC5 to the worker with the reason, audits staff.selfie_rejected without it. The object is kept for issued PDFs (§1.7). Refuses staff_not_found (P0002), not_active (a leaver, rejected or removed) and no_photo (P0001).';

revoke execute on function public.office_reject_selfie(uuid, text) from public, anon;
grant  execute on function public.office_reject_selfie(uuid, text) to authenticated;
