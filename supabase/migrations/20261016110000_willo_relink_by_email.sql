-- =====================================================================
-- Migration 20261016110000 · A Willo participant we did not create, found
--                            by the candidate's email (ADR-0148, §2.4)
--
-- The receiver finds a candidate by the Willo key the invite sweep
-- stored (willo_link_candidate / willo_invite_created). On 16.10.2026 a
-- candidate was Accepted in Willo and never moved: he had recorded the
-- interview as a SECOND participant (name "Jose" only, no custom_id — the
-- interview's public link, not our invitation), so every one of his
-- deliveries — Received, New Response, Accepted — carried a key nobody
-- holds and was refused `unknown_willo_candidate`. Fifteen other keys
-- were refused the same way between 01.10 and 16.10.
--
-- Willo's delivery carries the participant's email. When the key is
-- unknown, the receiver now asks this function to move the link: exactly
-- one candidate, not removed, still waiting on the interview decision
-- (interview_requested or interview_completed), with that email. Then it
-- plans again and the event lands as it would have. Anything else — no
-- match, two matches, a candidate already past the decision, a key
-- another row holds — is null, and the delivery is refused as before.
--
-- Safe because Willo decides nothing the office did not: an Accept is the
-- office clicking Accept in Willo after watching the video, and the login
-- link (E3) goes to the email on OUR row, which is the email matched.
-- =====================================================================

create or replace function public.willo_relink_by_email(
  p_willo_candidate_id text,
  p_email              text
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key   text := lower(btrim(coalesce(p_willo_candidate_id, '')));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_ids   uuid[];
  s       staff;
begin
  if v_key !~ '^[0-9a-f]{32}$' or v_email !~ '^[^\s@]+@[^\s@]+$' then
    return null;
  end if;

  -- Already somebody's key: the receiver would have found it. A removed
  -- row holding it is not ours to hand on.
  if exists (select 1 from staff where willo_candidate_id = v_key) then
    return null;
  end if;

  select array_agg(id order by id) into v_ids
    from staff
   where lower(btrim(email)) = v_email
     and removed_at is null
     and status in ('interview_requested', 'interview_completed');
  if coalesce(array_length(v_ids, 1), 0) <> 1 then
    return null;
  end if;

  select * into s from staff where id = v_ids[1] for update;
  if s.removed_at is not null or s.status not in ('interview_requested', 'interview_completed') then
    return null;
  end if;

  update staff set willo_candidate_id = v_key where id = s.id;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (null, 'willo_relinked', 'staff', s.id,
          jsonb_build_object('from', s.willo_candidate_id, 'to', v_key, 'matchedOn', 'email'));

  return s.id;
end $$;

comment on function public.willo_relink_by_email(text, text) is
  '§2.4, ADR-0148: a Willo delivery for a key we never issued, carrying the email of exactly one candidate still awaiting the interview decision, moves that candidate''s Willo link to the key (audited willo_relinked). Null when there is not exactly one such candidate or the key is already held. Service role only (the willo-webhook Edge Function).';

revoke execute on function public.willo_relink_by_email(text, text) from public, anon, authenticated;
grant  execute on function public.willo_relink_by_email(text, text) to service_role;
