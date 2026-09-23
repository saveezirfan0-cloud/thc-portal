-- =====================================================================
-- Two things that should not happen on the day this deploys
--
-- 1 · The Monday finance send (BG-08) is paused until the outbox drain
--     (P2) exists. 20260923130000 enabled it, and finance_reports_due()
--     catches up a missed Monday — so the first run after deploy would
--     stamp last week into payroll_export_lines and events.payroll_
--     exported_at (switching on RULE-06's "already exported" warnings for
--     shifts finance never received), and every week until P2 ships would
--     queue a BG08 email that all go to the external payroll address at
--     once when it does. Re-enable in the same commit that ships P2 — 190
--     asserts the enabled list, so that commit has to say so.
--
-- 2 · The client's "signed timesheet" is a final one. client_event_
--     documents_v served the newest copy of each kind, and the office's
--     Download stores a copy — so a sign-out sheet downloaded mid-event,
--     finish cells blank, became the client's copy (§11.2, §11.4). A
--     sign-out copy now reaches the client only once it was sent, or was
--     generated after the event's last role ended. The allocation sheet
--     is a plan and is served as before.
-- =====================================================================
update job_schedules
   set enabled = false,
       note = 'BG-08 Monday 09:00 UK finance send (§9.9). PAUSED until the outbox drain (P2) ships — 20260923193100. Every 5 min when enabled; finance_reports_due() picks the UK minute and catches up a missed Monday.'
 where job = 'finance-reports';

create or replace view client_event_documents_v with (security_barrier = true) as
select distinct on (d.event_id, d.kind)
       d.id,
       d.event_id,
       d.kind,
       d.file_name,
       d.storage_path,
       d.generated_at as issued_at
  from event_documents d
  join events e on e.id = d.event_id
  left join event_windows w on w.event_id = e.id
 where client_portal_visible(e.client_id)
   and e.cancelled_at is null
   and (d.kind = 'allocation'
        or d.sent_at is not null
        or (w.ends_at is not null and d.generated_at >= w.ends_at))
 order by d.event_id, d.kind, d.generated_at desc;

comment on view client_event_documents_v is
  '§11.1/§11.2 downloads for the client whose event it is (client_portal_visible, ADR-0004): the latest allocation sheet, and the latest FINAL sign-out timesheet — one that was sent, or drawn after the event''s last role ended — never a mid-event copy with blank finish times. No money column. Signed URLs are made server-side from storage_path.';

revoke all on client_event_documents_v from public, anon;
grant select on client_event_documents_v to authenticated;
