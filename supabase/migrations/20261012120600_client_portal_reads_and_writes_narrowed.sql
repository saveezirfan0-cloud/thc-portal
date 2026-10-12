-- =====================================================================
-- Migration 20261012120600 · three Client Portal gaps (§9.10, §11.1,
--                            ADR-0004)
--
-- Client Portal audit 12.10.2026:
--
--   1 · feedback text was unbounded (LOW). submit_client_feedback() wrote
--       whatever arrived; the portal's own box stops at 2,000 characters
--       (FEEDBACK_TEXT_MAX), but a caller on PostgREST could post a
--       megabyte into the office inbox. Now the function refuses more
--       than 2,000 characters (after the trim it already does) with
--       22023 'Feedback text must be at most 2000 characters' — the
--       message apps/client maps — and a CHECK on feedback holds the same
--       line for client-authored rows. Office-authored entries
--       (add_office_feedback, §9.10) are not limited by it: they are
--       written by THC's own staff, and nothing in the scope bounds them.
--       The constraint goes in NOT VALID and is validated at once only if
--       no existing client row is longer, so a long historical row can
--       neither stop this deploy nor be silently cut (it would surface
--       here as a NOTICE).
--
--   2 · a client login could rename itself (LOW). update_my_profile()
--       (20261001200000, the Back Office /account page) refused staff but
--       not clients, so a client could set its own profiles.full_name —
--       and that name is printed as the author of their feedback in the
--       office inbox. §11.1: the Client Portal has no editing. It now
--       refuses role = 'client' with P0001 'client_profile_read_only'.
--       apps/client never calls it (grep).
--
--   3 · contract_versions_read admitted every signed-in role (NOTE). The
--       §2.11 agreement is read by the office (admin_all) and by the
--       worker/candidate signing it (the Staff App reads it through the
--       definer onboarding_state(); current_contract_version() is an
--       invoker the worker may reach). A client has no reason to read it,
--       and ADR-0026 leaves the client role holding no table policy at
--       all. The policy now names staff only.
--
-- 792_client_portal_reads_and_writes_narrowed pins all three; 390's
-- client assertion is updated with it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · feedback text ≤ 2,000 characters for a client
-- ---------------------------------------------------------------------
alter table feedback drop constraint if exists feedback_client_text_length;
alter table feedback add constraint feedback_client_text_length
  check (author_kind <> 'client' or text is null or char_length(text) <= 2000) not valid;

do $$
begin
  if exists (select 1 from feedback
              where author_kind = 'client' and char_length(text) > 2000) then
    raise notice 'feedback_client_text_length left NOT VALID: % client row(s) are longer than 2000 characters',
      (select count(*) from feedback where author_kind = 'client' and char_length(text) > 2000);
  else
    alter table feedback validate constraint feedback_client_text_length;
  end if;
end $$;

comment on constraint feedback_client_text_length on feedback is
  '20261012120600 (§9.10): a client''s comment is at most 2,000 characters, the Client Portal''s box (FEEDBACK_TEXT_MAX). Office entries are not bound by it.';

-- submit_client_feedback(), 20260927160100's body plus the length check.
create or replace function public.submit_client_feedback(p_booking_id uuid, p_rating integer, p_text text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id  uuid;
  v_staff_id  uuid;
  v_client_id uuid;
  v_starts_at timestamptz;
  v_id        uuid;
  v_text      text := nullif(btrim(coalesce(p_text, '')), '');
begin
  -- The caller check first, so a non-client learns nothing about the row.
  if current_app_role() is distinct from 'client' then
    raise exception 'Only the Client Portal leaves client feedback (§9.10)' using errcode = '42501';
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5' using errcode = '22023';
  end if;

  if char_length(v_text) > 2000 then
    raise exception 'Feedback text must be at most 2000 characters' using errcode = '22023';
  end if;

  select sr.event_id, b.staff_id, e.client_id, w.starts_at
    into v_event_id, v_staff_id, v_client_id, v_starts_at
    from bookings b
    join shift_requirements sr on sr.id = b.shift_id
    join events e              on e.id  = sr.event_id
    join event_windows w       on w.event_id = e.id
   where b.id = p_booking_id
     and b.status in ('confirmed', 'worked');

  -- One sentence whether the booking is unknown, not confirmed, or
  -- another customer's: the answer must not say which.
  if v_event_id is null or not client_portal_visible(v_client_id) then
    raise exception 'That booking is not on your line-up' using errcode = '42501';
  end if;

  if now() < v_starts_at then
    raise exception 'Feedback opens once the event has started' using errcode = '22023';
  end if;

  insert into feedback (author_kind, author_id, staff_id, event_id, rating, text)
  values ('client', auth.uid(), v_staff_id, v_event_id, p_rating, v_text)
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    raise exception 'Feedback has already been left for this person on this event'
      using errcode = '23505';
end $$;

-- ---------------------------------------------------------------------
-- 2 · update_my_profile(), 20261001200000's body; a client is refused
-- ---------------------------------------------------------------------
create or replace function public.update_my_profile(p_full_name text, p_phone text default null, p_job_title text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_row   profiles;
  v_name  text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_title text := nullif(btrim(coalesce(p_job_title, '')), '');
  v_changed text[] := '{}';
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select * into v_row from profiles where id = v_uid for update;
  if v_row.id is null then
    raise exception 'no_profile' using errcode = 'P0001';
  end if;
  -- A worker's name is their staff record (§1.5), edited through the
  -- Staff App's Profile details and the office's staff profile.
  if v_row.role = 'staff' then
    raise exception 'use_staff_profile' using errcode = 'P0001';
  end if;
  -- §11.1: the Client Portal has no editing. A client login's name is the
  -- office's to set (it signs their feedback in the inbox, §9.10).
  if v_row.role = 'client' then
    raise exception 'client_profile_read_only' using errcode = 'P0001';
  end if;
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'name_required' using errcode = 'P0001';
  end if;
  if v_phone is not null and v_phone !~ '^\+?\(?[0-9][0-9 ()-]{5,22}$' then
    raise exception 'phone_invalid' using errcode = 'P0001';
  end if;
  if v_title is not null and char_length(v_title) > 80 then
    raise exception 'job_title_too_long' using errcode = 'P0001';
  end if;

  if v_name  is distinct from v_row.full_name then v_changed := v_changed || 'full_name'::text; end if;
  if v_phone is distinct from v_row.phone     then v_changed := v_changed || 'phone'::text;     end if;
  if v_title is distinct from v_row.job_title then v_changed := v_changed || 'job_title'::text; end if;

  if cardinality(v_changed) = 0 then
    return jsonb_build_object('changed', '[]'::jsonb);
  end if;

  update profiles
     set full_name = v_name, phone = v_phone, job_title = v_title, updated_at = now()
   where id = v_uid;

  -- The field NAMES, not the values: a phone number does not belong in an
  -- append-only trail that outlives a GDPR removal.
  insert into audit_log (actor, action, entity, entity_id, data)
  values (v_uid, 'profile.updated', 'account', v_uid, jsonb_build_object('fields', to_jsonb(v_changed)));

  return jsonb_build_object('changed', to_jsonb(v_changed));
end;
$$;

-- ---------------------------------------------------------------------
-- 3 · contract_versions: staff read it, the office has admin_all
-- ---------------------------------------------------------------------
alter policy contract_versions_read on contract_versions
  using ((select current_app_role()) = 'staff'::app_role);

comment on policy contract_versions_read on contract_versions is
  '§2.11: the worker or candidate signing reads the published agreement. 20261012120600: staff only (was any signed-in role); the office reads through admin_all and a client not at all (ADR-0004, ADR-0026).';
