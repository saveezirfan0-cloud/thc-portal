-- =====================================================================
-- The quiz gate holds a rejected "Yes" declaration (§2.3, §2.10)
--
-- onboarding_quiz_blockers() is onboarding_documents_missing() plus
-- compliance_blockers(). The first only asks that a declaration EXISTS;
-- the second blocks on a pending Yes but deliberately not a rejected one,
-- because for a worker §10.7's manual block carries it. A candidate has
-- no such block, so a Yes the office rejected, followed by the last
-- document being verified, unlocked the quiz — the rejection read as
-- nothing. Found by S2's probe; a candidate's rejected Yes now holds the
-- gate until they declare again and it is verified.
--
-- compliance_blockers() is unchanged: the rule for workers stands.
-- =====================================================================
create or replace function public.onboarding_quiz_blockers(p_staff uuid)
returns text[]
language sql
stable
set search_path = public, extensions
as $$
  select coalesce(onboarding_documents_missing(p_staff), '{}')
         || coalesce((select array_agg(b.reason order by b.reason)
                        from compliance_blockers(p_staff, (now() at time zone 'Europe/London')::date) b),
                     '{}')
         || coalesce((select array['conviction_rejected']
                        from (select c.answer, c.review_status
                                from criminal_declarations c
                               where c.staff_id = p_staff
                                 and not c.superseded
                               order by c.declared_at desc, c.id desc
                               limit 1) c
                       where c.answer and c.review_status = 'rejected'),
                     '{}')
$$;

comment on function public.onboarding_quiz_blockers(uuid) is
  'The §2.3 quiz gate as reasons: missing items, anything unverified or expired, and a rejected Yes declaration (conviction_rejected) until a new one is verified. Empty = the quiz unlocks.';
