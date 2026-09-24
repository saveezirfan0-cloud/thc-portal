-- =====================================================================
-- Client Portal · the caller's own company name (§11.1, ADR-0004)
--
-- The portal's top bar says "Signed in as <company>" (wireframes/client/
-- events.html), because a customer needs to know whose events they are
-- reading before they read a single row. apps/client/app/client/layout.tsx
-- read the name from `clients`, where the client role holds no policy — so
-- it was always null (audit 24.09 §2.2, verified on the live DB).
--
-- The fix is NOT a client policy on `clients`. That table carries the
-- account terms (pays_breaks, pays_buffer) and the office's contact notes,
-- and ADR-0004 keeps the client role's direct reach at `events` and
-- `feedback`; 001_rls_guard §5 asserts exactly that list. Instead, the
-- ADR-0004 shape:
--
--   * owner rights (no security_invoker), so no policy on `clients` is
--     needed or granted;
--   * the tenancy rule in the view's own body. `c.id = current_client_id()`
--     makes it "the caller's own company" — an admin has no company and gets
--     no row here — and client_portal_visible() is the same predicate every
--     other client_* view carries, so the view cannot drift from them;
--   * security_barrier, so a user-supplied qual never runs ahead of it;
--   * named columns, two of them, neither money (050's column check);
--   * select for `authenticated` only — anon is revoked outright rather than
--     left to rely on auth.uid() being null.
-- =====================================================================

create view client_company_v with (security_barrier = true) as
  select c.id as client_id,
         c.name
    from clients c
   where c.id = current_client_id()
     and client_portal_visible(c.id);

comment on view client_company_v is
  'The signed-in customer''s own company name for the Client Portal header (§11.1). Owner rights + current_client_id() + client_portal_visible() per ADR-0004: the client role holds no policy on clients and must not be given one. One row for a client user, none for anybody else. Name only: no terms, no contacts, no money.';

revoke all on client_company_v from public, anon, authenticated;
grant select on client_company_v to authenticated;
