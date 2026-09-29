-- =====================================================================
-- Documents approved: email the candidate that the quiz is open — ADR-0072
--
-- §2.3 unlocks the quiz by itself the moment the last outstanding document
-- or declaration is verified (onboarding_advance_if_ready, 20260923110000),
-- but §8 has no push for it: the candidate hears about a rejection (N8)
-- and never about the approval. On the live app (29.09.2026) a candidate's
-- passport was verified at 11:28, the quiz unlocked, and their phone said
-- nothing — they had no reason to open the app again.
--
-- The same function now queues E12, an email (the owner: "should be via
-- email" — it reaches a candidate who never turned notifications on), in
-- the transaction that moves the candidate to Quiz. Nothing else changes:
--   · it still does nothing unless the candidate is in Documents with no
--     blockers, so it can only fire once per onboarding period;
--   · the key carries the unlock moment, so a candidate Reset to candidate
--     (§2.12) who is verified again in a later period is told again, and a
--     re-run in the same instant cannot queue twice;
--   · it goes to the candidate's own address (staff.email), with their
--     first name as the only value; GDPR removal (20260930120100) matches
--     the row by recipient and by that address.
-- =====================================================================

create or replace function public.onboarding_advance_if_ready(p_staff uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare s staff;
begin
  select * into s from staff where id = p_staff for update;
  if s.status is distinct from 'documents' then
    return false;
  end if;
  if cardinality(onboarding_quiz_blockers(p_staff)) > 0 then
    return false;
  end if;
  update staff set status = 'quiz' where id = p_staff;
  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'quiz_unlocked', 'staff', p_staff, '{}'::jsonb);

  -- ADR-0072: the approval §8 never sent. Through the outbox like every send.
  if nullif(btrim(s.email), '') is not null then
    insert into notification_outbox (key, channel, template, recipient_staff_id, recipient_emails, payload)
    values ('E12:staff:' || p_staff || ':' || floor(extract(epoch from clock_timestamp()))::bigint,
            'email', 'E12', p_staff, array[s.email],
            jsonb_build_object('name', btrim(s.first_name)))
    on conflict (key) do nothing;
  end if;

  return true;
end $$;

comment on function public.onboarding_advance_if_ready(uuid) is
  '§2.3: "as soon as ALL documents — including the Criminal Record declaration — are verified, the candidate advances to the Quiz stage by themselves". Safe to call at any time: it does nothing unless the candidate is in documents with nothing outstanding. On the move it emails the candidate E12, "Your documents are approved" (ADR-0072, 20261001214000).';
