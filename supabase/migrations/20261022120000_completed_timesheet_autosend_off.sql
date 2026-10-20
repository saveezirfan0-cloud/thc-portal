-- =====================================================================
-- 20261022120000 · The automatic Completed Allocation Timesheet (D2) stops
--                   ADR-0176 (amended 20.10.2026)
--
-- THC, 20.10.2026: the invoice at 10:00 the morning after the event now
-- carries the sign-in and sign-out log (GPS-verified times, breaks, the
-- hours charged), so the separate D2 email at the same time is no longer
-- wanted: "stop it now that the invoice carries the log".
--
-- Only the automatic send stops (settings.document_autosend.completed
-- .enabled = false; the job's verdict for D2 becomes `disabled`). The
-- office's Send / Download Completed Timesheet buttons on the event page
-- (§11.4) are unchanged, and D1 — the Allocation Timesheet at 16:00 the
-- day before — is unchanged.
--
-- Forward-only. Switching it back on is the same update with true.
-- =====================================================================

update public.settings
   set value = jsonb_set(value, '{completed,enabled}', 'false'::jsonb, true)
 where key = 'document_autosend';

insert into public.audit_log (at, actor, action, entity, entity_id, data)
select now(), null, 'settings.document_autosend', 'settings', null,
       jsonb_build_object('completed', jsonb_build_object('enabled', false),
                          'reason', 'ADR-0176: the invoice carries the sign-in and sign-out log (THC, 20.10.2026)')
 where exists (select 1 from public.settings where key = 'document_autosend');
