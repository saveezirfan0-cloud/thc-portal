-- =====================================================================
-- Client Portal · "Your account" — the caller's own company and the
-- addresses its documents go to (ADR-0036, ADR-0004)
--
-- /client/account shows the signed-in customer who they are, which company
-- they are signed in for, and where THC emails the allocation sheet and the
-- signed timesheet (§9.7 "Contact emails", §11.4 "the addresses come from
-- the client card"). The recipients are shown so the customer can check
-- them; changing them goes through the office, never through the portal
-- (§11.1 "Read-only — no editing whatsoever").
--
-- The recipients live on `clients.contact_emails`. The fix is NOT a client
-- policy on `clients`: that table carries the account terms (pays_breaks,
-- pays_buffer), the office's contact name, phone and on-site notes, and
-- ADR-0026 pinned the client role's table policies at the empty set
-- (001_rls_guard §5). So this is the client_company_v shape
-- (20260927120000), copied exactly:
--
--   * owner rights (no security_invoker), so no policy on `clients` is
--     needed or granted;
--   * the tenancy rule in the view's own body — `c.id = current_client_id()`
--     makes it "the caller's own company" (an admin has no company and gets
--     no row), and client_portal_visible() is the predicate every other
--     client_* view carries, so a profile that is no longer a client role
--     sees nothing even if it still carries a client_id;
--   * security_barrier, so a user-supplied qual never runs ahead of it;
--   * named columns, two of them, neither money (050's column check):
--     the company name and the recipient list. No id, no terms, no phone,
--     no contact name, nothing about workers;
--   * select for `authenticated` only — anon is revoked outright rather
--     than left to rely on auth.uid() being null.
--
-- It is the tenth owner-rights view the Supabase advisor will list as a
-- `security_definer_view`. That is the ADR-0004 mechanism, not a lapse;
-- ADR-0036 records it.
-- =====================================================================

create view client_account_v with (security_barrier = true) as
  select c.name,
         c.contact_emails
    from clients c
   where c.id = current_client_id()
     and client_portal_visible(c.id);

comment on view client_account_v is
  'The signed-in customer''s own company name and the addresses THC emails its allocation sheet and signed timesheet to (§9.7, §11.4), for the Client Portal''s Your account page (ADR-0036). Owner rights + current_client_id() + client_portal_visible() per ADR-0004: the client role holds no policy on clients and must not be given one. One row for a client user, none for anybody else. Read-only; no terms, no phone, no money, nothing about workers.';

revoke all on client_account_v from public, anon, authenticated;
grant select on client_account_v to authenticated;
