-- =====================================================================
-- Migration 20261008160000 · the Radar names who verified each document
--                            (§4.1, §1.8)
--
-- The Compliance Radar lists every dated, verified document on a live
-- worker. Every other screen that shows a verified document now says who
-- verified it and when ("Verified by Gisela M. · 08.10.2026 11:05 UK time",
-- 20261008110000); the Radar was the one that did not.
--
-- compliance_radar_v is restated from 20260923100000 with two columns
-- appended (a create-or-replace view may only add columns at the end):
--
--   reviewed_at       when the document was verified.
--   reviewed_by_name  who, through reviewer_name() — admin sessions only —
--                     or "Automatic gov.uk check" for a share code the
--                     automated check verified (no reviewer on file).
--
-- The set of rows is unchanged: the inner join on compliance_docs is on the
-- document current_verified_docs() already returned, so it adds none and
-- drops none. Privileges are unchanged (create or replace keeps them).
-- =====================================================================

create or replace view compliance_radar_v with (security_invoker = true) as
with today as (select (now() at time zone 'Europe/London')::date as d)
select
  s.id                                                       as staff_id,
  s.first_name || ' ' || s.last_name                         as display_name,
  s.employee_id,
  s.rtw_branch,
  s.status,
  s.block_kind,
  s.photo_path,
  v.doc_id,
  v.doc_type::text                                           as doc_type,
  doc_label(v.doc_type)                                      as doc_label,
  v.expires_on,
  (v.expires_on - today.d)                                   as days_left,
  case when v.expires_on <= today.d then 'expired'
       when v.expires_on - today.d <= 30 then 'expiring'
       else 'valid' end                                      as state,
  (select coalesce(o.sent_at, o.send_after) from notification_outbox o
    where o.key = 'N1:doc:' || v.doc_id)                     as n1_at,
  (select coalesce(o.sent_at, o.send_after) from notification_outbox o
    where o.key = 'N2:doc:' || v.doc_id)                     as n2_at,
  (select coalesce(o.sent_at, o.send_after) from notification_outbox o
    where o.key = 'N3:doc:' || v.doc_id)                     as n3_at,
  (select coalesce(o.sent_at, o.send_after) from notification_outbox o
    where o.key = 'N4:doc:' || v.doc_id)                     as n4_at,
  exists (select 1 from compliance_docs p
           where p.staff_id = s.id and p.doc_type = v.doc_type
             and p.review_status = 'pending')                as replacement_in_review,
  -- Appended (20261008160000): who verified the document on the radar, and
  -- when. NULL for the automated gov.uk check, which has no reviewer.
  c.reviewed_at,
  coalesce(public.reviewer_name(c.reviewed_by),
           case when c.reviewed_by is null and c.reviewed_at is not null
                 and v.doc_type = 'share_code_report'
                then 'Automatic gov.uk check' end)                  as reviewed_by_name
from staff s
cross join today
cross join lateral current_verified_docs(s.id) v
join compliance_docs c on c.id = v.doc_id
where s.status in ('compliant', 'blocked')
  and s.left_at is null
  and s.removed_at is null
  and v.expires_on is not null
  and (v.doc_type <> 'university_term_dates_letter' or term_letter_applies(s.id, today.d));

comment on view compliance_radar_v is
  '§4.1 Radar: every dated, verified document on a live worker, with days left, expired/expiring/valid, the N1–N4 rungs actually queued, and who verified it and when (20261008160000). The same set compliance_daily() blocks on, so the screen and the job cannot disagree.';
