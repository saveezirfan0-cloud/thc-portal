-- =====================================================================
-- Migration 20261014140100 · three things the customer asked to see on
--                            the event page (§11.2; ADR-0004, ADR-0026,
--                            ADR-0089, ADR-0134 N1–N3)
--
-- Approved by the product owner, 14.10.2026 (docs/20 Part B). All three
-- are the customer's own data or THC's public contact detail: no money,
-- nothing about a worker.
--
-- N1 · THC's on-the-day phone number.
--      "Who do I call at 07:30?" There was no office phone anywhere in the
--      schema, so a settings key carries it: `client_portal_phone`, a JSON
--      string, seeded empty and edited on the Back Office's /settings (the
--      admin-only `settings` policy is the gate, as for every other key).
--      The client role holds no policy on `settings` and must not get one
--      (the table also carries job secrets and payroll recipients), so the
--      portal reads ONE value through a new owner-rights view,
--      client_portal_contact_v: one column, `phone`, null while the setting
--      is empty or not a string. It has client_company_v's shape: one row
--      for a client user whose login is linked to a company
--      (current_client_id() + client_portal_visible() in the body), none
--      for anybody else — the admin included, who reads the setting
--      directly.
--
-- N2 · The dress code per role section.
--      client_role_sections_v gains shift_requirements.dress_code, the
--      text the office picked from the client's own rate card
--      (client_rate_cards.dress_codes). The section's other columns are
--      unchanged (headcount and the capped confirmed, 20261014140000).
--      events.notes is NOT exposed: it is the office's internal note
--      (ADR-0026).
--
-- N3 · "Timesheets for this event go to …"
--      client_events_v gains timesheet_recipients: the event's own list
--      (events.document_recipients, ADR-0089) or, when that is null, the
--      client card's contact_emails — exactly event_document_recipients(),
--      written inline because that function reads `clients` with the
--      caller's rights and the client role holds no policy there. The
--      addresses are the customer's own contacts (or ones THC was asked to
--      add for that event); no worker data.
--
-- Every view keeps ADR-0004's shape: owner rights (no security_invoker),
-- security_barrier, client_portal_visible() in its own body, named
-- columns, SELECT to authenticated and nothing else to anybody. The new
-- columns are appended; no existing column moves. Bodies restated from
-- 20261013100300 (client_events_v) and 20261014140000
-- (client_role_sections_v).
--
-- Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- N1 · the setting, and the one-column view over it
-- ---------------------------------------------------------------------
insert into settings (key, value) values ('client_portal_phone', '""')
on conflict (key) do nothing;

create view client_portal_contact_v with (security_barrier = true) as
  select nullif(btrim(s.value #>> '{}'), '') as phone
    from clients c
    left join settings s
      on s.key = 'client_portal_phone'
     and jsonb_typeof(s.value) = 'string'
   where c.id = current_client_id()
     and client_portal_visible(c.id);

comment on view client_portal_contact_v is
  'THC''s on-the-day phone number for the Client Portal event page (ADR-0134 N1): settings.client_portal_phone, null while empty. Owner rights + current_client_id() + client_portal_visible() per ADR-0004: the client role holds no policy on settings or clients and must not be given one. One row for a client user whose login is linked to a company, none for anybody else. One column; no other setting is reachable through it.';

revoke all on client_portal_contact_v from public, anon, authenticated;
grant select on client_portal_contact_v to authenticated;

-- ---------------------------------------------------------------------
-- N2 · client_role_sections_v + dress_code
-- ---------------------------------------------------------------------
create or replace view client_role_sections_v with (security_barrier = true) as
  select sr.id as shift_id,
         sr.event_id,
         r.name as role,
         sr.starts_at,
         sr.ends_at,
         sr.headcount,
         least((select count(*)
                  from bookings b
                 where b.shift_id = sr.id
                   and b.status in ('confirmed', 'worked')), sr.headcount)::int as confirmed,
         -- The customer's own dress code for the role (their rate card's
         -- list, picked per section by the office). Never events.notes.
         nullif(btrim(sr.dress_code), '') as dress_code
    from shift_requirements sr
    join events e on e.id = sr.event_id
    join roles r  on r.id = sr.role_id
   where client_portal_visible(e.client_id);

comment on view client_role_sections_v is
  'Role sections as the customer sees them (§11.1 "N of M confirmed", §11.2 grouped by role). Owner rights + client_portal_visible() per ADR-0004. Carries the role-section window (RULE-18), the ordered headcount, the confirmed count HELD TO the headcount (20261014140000) and the section''s dress code (20261014140100, ADR-0134 N2) — no charge_rate, no pay_rate, no buffer, no event notes.';

revoke all on client_role_sections_v from public, anon, authenticated;
grant select on client_role_sections_v to authenticated;

-- ---------------------------------------------------------------------
-- N3 · client_events_v + timesheet_recipients
-- ---------------------------------------------------------------------
create or replace view client_events_v with (security_barrier = true) as
  select e.id,
         e.client_id,
         e.title,
         e.venue_name,
         e.venue_address,
         e.event_date,
         e.po_number,
         e.onsite_contact,
         w.starts_at,
         w.ends_at,
         event_status(e, w.starts_at, w.ends_at) as status,
         e.cancelled_at,
         -- Who THC emails this event's Allocation Timesheet and Completed
         -- Timesheet to (ADR-0089): the event's own list, else the card's.
         coalesce(e.document_recipients, c.contact_emails) as timesheet_recipients
    from events e
    join event_windows w on w.event_id = e.id
    join clients c       on c.id = e.client_id
   where client_portal_visible(e.client_id);

comment on view client_events_v is
  'The customer''s own events (§11.1). Owner rights + client_portal_visible() per ADR-0004, so it can read the event window without a policy on the money-bearing shift_requirements table. Event window = min role start -> max role end (§1.5); per-role timings come from client_role_sections_v (RULE-18). onsite_contact is the §11.2 header field; cancelled_at dates a cancelled row (20261013100300) — never the reason; timesheet_recipients is who the timesheets for this event go to, the event''s own list or the client card''s (ADR-0089, 20261014140100). No rate, no charge, no margin, no notes.';

revoke all on client_events_v from public, anon, authenticated;
grant select on client_events_v to authenticated;
