-- =====================================================================
-- Migration 20261005105955 · up to 10 contact emails per client (ADR-0087)
--
-- A stand-in for a migration that is ALREADY APPLIED to the live project.
--
-- The contact-emails limit was applied to production by hand through the
-- Supabase connector at 10:59 UTC on 05.10.2026, which recorded it in
-- supabase_migrations.schema_migrations under the clock-stamped version
-- 20261005105955. The repo then carried the same change as
-- 20261005130000_client_contact_emails_limit.sql (renumbered from
-- 20261005120000 to clear a collision with roles_and_descriptions).
--
-- With no file for 20261005105955, `supabase db push` refuses to run
-- ("Remote migration versions not found in local migrations directory"),
-- so every deploy-database run on main since then stopped at its dry run
-- and nothing after 20261005100000 reached the live project.
--
-- This file gives that version a file again, with the statements the
-- live project recorded for it. Both statements are idempotent: on the
-- live project the constraint is already as written here, and
-- 20261005130000 restates it harmlessly. It is the same change as
-- 20261005130000; do not edit one without the other.
-- =====================================================================

alter table clients drop constraint if exists clients_contact_emails_check;
alter table clients add constraint clients_contact_emails_check
  check (array_length(contact_emails, 1) between 1 and 10);
