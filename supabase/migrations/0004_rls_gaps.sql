-- =====================================================================
-- Migration 0004 · close the row-level-security gaps
--
-- Why this exists
-- ---------------
-- 0001_init.sql enabled row level security on 17 tables and left 11 with
-- none at all:
--   audit_log, bank_details, client_qualifications, hmrc_checklists,
--   location_pings, push_subscriptions, quiz_attempts, report_sends,
--   staff_references, staff_roles, venue_types
-- Supabase grants anon / authenticated / service_role full DML on every
-- table in `public`, and a table with RLS switched off does not consult a
-- policy, so each of those was readable AND writable through PostgREST by
-- any signed-in user of any role. bank_details (sort code + account
-- number) and hmrc_checklists (derived tax statement) are payroll data:
-- §1.7 treats them as personal data that a GDPR removal must wipe, and
-- §11.1 says the client sees no money and no worker personal data.
--
-- This migration enables RLS on all eleven and gives each the policy set
-- that §1.4 (roles), §1.5 (data model), §1.7 (GDPR) and §11.1 (client sees
-- nothing) imply. Three rules decide almost every line below:
--
--   1. A worker reaches only their own rows, matched through
--      staff.user_id = auth.uid() exactly as 0001's staff_self* policies do.
--   2. The client role gets NO policy on any of these tables. None of them
--      is client-facing, several carry money or worker personal data, and
--      0002 established that a client policy on a money-bearing base table
--      cannot be undone by a view. Client access stays on the
--      security_invoker views.
--   3. Where a worker write has to be derived, scored or rate-limited by
--      the server, there is no write policy and a comment naming the
--      `security definer` RPC that owes it. Those RPCs are NOT invented
--      here; this migration only closes the holes.
--
-- service_role bypasses RLS, so "service-role-write" below means simply
-- "no write policy for anybody else".
--
-- Forward-only: 0001 and 0002 are left untouched.
-- =====================================================================

alter table audit_log             enable row level security;
alter table bank_details          enable row level security;
alter table client_qualifications enable row level security;
alter table hmrc_checklists       enable row level security;
alter table location_pings        enable row level security;
alter table push_subscriptions    enable row level security;
alter table quiz_attempts         enable row level security;
alter table report_sends          enable row level security;
alter table staff_references      enable row level security;
alter table staff_roles           enable row level security;
alter table venue_types           enable row level security;

-- ---------------------------------------------------------------------
-- audit_log — admin-read, service-role-write (§1.7)
--
-- The audit trail is only evidence if the actor cannot edit it. Every row
-- is written by a `security definer` transition function or by an Edge
-- Function on the service key, both of which bypass RLS, so no insert /
-- update / delete policy exists for any signed-in role. Admin reads it
-- because the Back Office shows it; a worker and a client never see it.
-- ---------------------------------------------------------------------
create policy admin_read on audit_log for select using (current_app_role() = 'admin');

comment on table audit_log is
  'Append-only audit trail (§1.7). Admin-read; written only by security definer functions and the service role. Never give any role an insert/update/delete policy here.';

-- ---------------------------------------------------------------------
-- report_sends — admin-read, service-role-write (§9.9)
--
-- BG-08 send status. Written by the payroll / new-starter report job on the
-- service key. The Back Office reads it to render the "sent / failed /
-- no new" line on the Reports screen.
-- ---------------------------------------------------------------------
create policy admin_read on report_sends for select using (current_app_role() = 'admin');

comment on table report_sends is
  'BG-08 report send log (§9.9). Admin-read; written only by the scheduled job on the service role.';

-- ---------------------------------------------------------------------
-- bank_details — the worker's own, and nobody else's (§2.10, §10.1, §1.7)
--
-- §2.10 and §10.1 both say the worker enters these at onboarding step 9/11
-- and can change them later from Payment information → Bank & payroll with
-- a "Save changes" button, so the worker genuinely owns the write. Admin
-- reads and writes them for payroll. The client must never see them: they
-- are personal data (§1.7) and they are the payment side of the money the
-- client is not allowed to see at all (§11.1).
--
-- No delete policy: a GDPR removal wipes these rows from a `security
-- definer` routine (§1.7), not from the worker's own session.
--
-- NOTE for the notifications session: saving bank details must enqueue E5
-- to gisela@ and thc_payroll@ (§8, §2.10). A write policy cannot do that on
-- its own — the outbox row comes from a trigger or RPC added with the §8
-- register; this migration deliberately does not invent it.
-- ---------------------------------------------------------------------
create policy admin_all on bank_details for all using (current_app_role() = 'admin');
create policy staff_self_bank on bank_details for select
  using (staff_id = (select id from staff where user_id = auth.uid()));
create policy staff_self_bank_insert on bank_details for insert
  with check (staff_id = (select id from staff where user_id = auth.uid()));
create policy staff_self_bank_update on bank_details for update
  using (staff_id = (select id from staff where user_id = auth.uid()))
  with check (staff_id = (select id from staff where user_id = auth.uid()));

comment on table bank_details is
  'Sort code / account number (§2.10). Worker-owned: the worker reads and writes only their own row; admin for payroll; the client role never holds a policy here (§11.1, §1.7).';

-- ---------------------------------------------------------------------
-- hmrc_checklists — admin only; the worker never sees the derived letter
--
-- §2.8 is explicit: "Statements A / B / C — not selected directly by the
-- worker … the worker never sees the resulting letter." The statement is a
-- column on this row, and RLS is row level, not column level, so ANY
-- worker select policy here hands them the letter. The checklist is
-- therefore admin-read and admin-write, and the worker's submission goes
-- through a `security definer` RPC (submit_hmrc_checklist) that takes q1 /
-- q2 / q3, the student-loan answers and the declaration tick, derives the
-- statement server-side per HMRC's routing and inserts the row. That RPC
-- belongs to the onboarding session and is NOT created here.
--
-- The client never reaches tax data: §11.1 plus §1.7 personal data.
-- ---------------------------------------------------------------------
create policy admin_all on hmrc_checklists for all using (current_app_role() = 'admin');

comment on table hmrc_checklists is
  'HMRC New Starter Checklist (§2.8). Admin only: the derived A/B/C statement lives on this row and the worker must never see it, so worker submission goes through a security definer RPC rather than an insert policy.';

-- ---------------------------------------------------------------------
-- client_qualifications — office-managed clearance (§9.6, §9.7, RULE-17)
--
-- Who is cleared for which client + role, and do_not_return. Granted by a
-- manager or by the system after a clean shift; it is an internal staffing
-- decision, never self-service. Admin only.
--
-- The client role gets nothing here on purpose. The table names the
-- workers a client has and has not cleared — worker personal data the
-- client portal has no route to under §11.1 — and the auto-assign wave-1
-- pool it feeds (§3.4) is computed server-side. The Staff App gets nothing
-- either: a worker has no screen that lists the clients they are cleared
-- for, and client_id would leak the client directory into the PWA.
-- ---------------------------------------------------------------------
create policy admin_all on client_qualifications for all using (current_app_role() = 'admin');

comment on table client_qualifications is
  'Per client AND per role clearance (§1.5, RULE-17). Admin only: it is an office decision, it names workers to a client (§11.1) and it feeds auto-assign wave 1 server-side (§3.4).';

-- ---------------------------------------------------------------------
-- staff_roles — which roles a worker may work anywhere (§1.5)
--
-- Office-granted, so admin writes. The worker reads their own rows: the
-- Staff App profile and Radar both show "your roles", and §1.7 keeps roles
-- visible even on a removed worker's row, so this is not personal data the
-- worker should be blind to. No worker write: a worker cannot qualify
-- themselves for Bar Staff.
--
-- Note this exposes role_id only, never roles.pay_rate — the worker still
-- holds no policy on `roles` itself.
-- ---------------------------------------------------------------------
create policy admin_all on staff_roles for all using (current_app_role() = 'admin');
create policy staff_self_roles on staff_roles for select
  using (staff_id = (select id from staff where user_id = auth.uid()));

comment on table staff_roles is
  'Role qualification (§1.5). Admin grants; the worker may read their own rows only. No worker write: nobody qualifies themselves.';

-- ---------------------------------------------------------------------
-- staff_references — the worker's own two referees (§2.10 step 8/11)
--
-- §2.10: "These references are not formally reviewed or verified by a
-- manager and there is no reference-check stage in the pipeline: they are
-- collected, stored and displayed on the profile as supporting
-- information." Nothing is derived, scored or gated, so the wizard step can
-- write them directly under a policy. The worker may correct a typo
-- (update) but not delete a referee, because two are mandatory with no
-- exception; removal happens with the record, through GDPR.
--
-- Admin reads and writes them (they show on the worker card, §9.6).
-- The client never sees a worker's referees (§1.7 personal data).
-- ---------------------------------------------------------------------
create policy admin_all on staff_references for all using (current_app_role() = 'admin');
create policy staff_self_refs on staff_references for select
  using (staff_id = (select id from staff where user_id = auth.uid()));
create policy staff_self_refs_insert on staff_references for insert
  with check (staff_id = (select id from staff where user_id = auth.uid()));
create policy staff_self_refs_update on staff_references for update
  using (staff_id = (select id from staff where user_id = auth.uid()))
  with check (staff_id = (select id from staff where user_id = auth.uid()));

comment on table staff_references is
  'Two mandatory referees (§2.10). Worker-owned read/insert/update; no delete, because two references are always required. Admin reads them on the worker card; the client never does.';

-- ---------------------------------------------------------------------
-- quiz_attempts — read your own result, never write it (§2.6)
--
-- score, passed and attempt_no decide whether onboarding continues and
-- whether a third failure rejects the candidate (§2.12), so a worker who
-- could insert here could pass the H&S quiz by writing a row. Marking is a
-- `security definer` RPC (submit_quiz_attempt) that takes the answers,
-- scores them against the stored key, enforces the 80% pass mark and the
-- 1..3 attempt limit, and keeps staff.quiz_attempts in step. That RPC is
-- NOT created here; this migration grants the read policy only.
-- ---------------------------------------------------------------------
create policy admin_all on quiz_attempts for all using (current_app_role() = 'admin');
create policy staff_self_quiz on quiz_attempts for select
  using (staff_id = (select id from staff where user_id = auth.uid()));

comment on table quiz_attempts is
  'H&S quiz attempts (§2.6). Read-only for the worker who sat it: scoring and the 3-attempt limit belong to a security definer RPC, never to an insert policy.';

-- ---------------------------------------------------------------------
-- location_pings — read your own trail, never write it (§5.2, §5.2b)
--
-- inside_geofence on this table is what "the last on-site fix" means when
-- a worker checks out off-site (§5.2b), so a worker able to insert here
-- could manufacture a fix that says they were on site. The ping must be
-- written by a `security definer` RPC (record_location_ping) that takes the
-- raw coordinate and derives inside_geofence from the event's own
-- venue_location + geofence_radius_m. That RPC belongs to the check-in
-- session and is NOT created here; this migration grants the read policy
-- only. The rows are append-only in any case: no update or delete policy.
-- ---------------------------------------------------------------------
create policy admin_all on location_pings for all using (current_app_role() = 'admin');
create policy staff_self_pings on location_pings for select
  using (booking_id in (
    select b.id from bookings b join staff s on s.id = b.staff_id
     where s.user_id = auth.uid()));

comment on table location_pings is
  'During-shift tracking (§5.2b). The worker may read their own trail; writing is a security definer RPC because inside_geofence must be derived server-side, never asserted by the device.';

-- ---------------------------------------------------------------------
-- push_subscriptions — the device registers and deregisters itself (§8)
--
-- A Web Push subscription is created by the worker's own browser and has to
-- be removed by it when the permission is revoked or the endpoint rotates,
-- so unlike the tables above this one genuinely wants a full self policy.
-- Nothing on the row is derived and nothing about it is worth forging: the
-- endpoint only ever receives that worker's own notifications, because the
-- sender selects subscriptions by staff_id.
--
-- Admin reads them for the "is this worker reachable?" line in the Back
-- Office. The client never sees them.
-- ---------------------------------------------------------------------
create policy admin_all on push_subscriptions for all using (current_app_role() = 'admin');
create policy staff_self_push on push_subscriptions for all
  using (staff_id = (select id from staff where user_id = auth.uid()))
  with check (staff_id = (select id from staff where user_id = auth.uid()));

comment on table push_subscriptions is
  'Web Push endpoints (§8). The worker''s own device manages its own rows in full; admin reads; the client never.';

-- ---------------------------------------------------------------------
-- venue_types — reference data (§9.11)
--
-- Nine editable rows of key / label / default_radius_m. No money, no
-- personal data, nothing client-specific: the label a venue shows and the
-- radius default the Venues screen pre-fills into the slider. Admin manages
-- it; any signed-in user may read it, so whoever needs the radius default
-- can resolve it without a second round trip. current_app_role() returns
-- null for a caller with no profile, which keeps anon out.
-- ---------------------------------------------------------------------
create policy admin_all on venue_types for all using (current_app_role() = 'admin');
create policy venue_types_read on venue_types for select
  using (current_app_role() is not null);

comment on table venue_types is
  'Venue type defaults (§9.11). Admin-managed reference data, readable by any signed-in role because it carries no money and no personal data. Anon is excluded: current_app_role() is null without a profile.';
