-- =====================================================================
-- Migration 20261005120000 · up to 10 contact emails per client (ADR-0087)
--
-- 0001_init.sql capped clients.contact_emails at 5 addresses. A council
-- client (Hackney Town Council) names six people who all need the
-- Allocation Timesheet and the Completed Allocation Timesheet (§11.4), so
-- the product owner asked on 05.10.2026 for the limit to be raised.
--
-- The cap is only ever enforced by this CHECK (assert_client_input
-- validates presence and shape, not count) and by MAX_CONTACT_EMAILS in
-- apps/office/app/clients/validate.ts, which moves with it.
--
-- Widening a CHECK cannot fail on existing rows. Forward-only.
-- =====================================================================

alter table clients drop constraint if exists clients_contact_emails_check;
alter table clients add constraint clients_contact_emails_check
  check (array_length(contact_emails, 1) between 1 and 10);
