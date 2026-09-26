# ADR-0049 · Users & access, the activity log, and My profile

**Status:** Accepted · **Wireframes:** none (no wireframe exists for these three screens; they reuse the Back Office's Panel, form, pill and `card-rows` table language) · **§1.4, §1.7, §1.8, §10.2**

## Context

§1.4 says the Back Office and the Client Portal sign in with email and password, but nothing in the product created those logins: every one was made by hand in the Supabase dashboard, with `profiles` and `app_metadata.role` typed in separately. A manager could not change their own name, and a login could not be switched off without deleting it. `audit_log` had 56 writers and no reader. `/settings` changed live auto-assign behaviour with no record of who changed what.

## Decision

1. **`/users` — Users & access.** Three tabs, one per app. Back Office and Client Portal logins are **invited** here. Staff App logins are listed read-only: a worker's login is still made only by Accept (§2.4, §2.7) and closed only by Block / Remove (§9.6, §1.7), because both of those do more than the login (shifts, E3, the staff record).
2. **The service key mints, the database decides.** The server action uses the service key for one call — GoTrue `generateLink` (`invite`, or `magiclink` for an address that already has a login) — after checking the caller is an admin. It then calls `admin_register_account` **as the manager**. That function checks the role again, writes `profiles` and `app_metadata.role`, refuses to change the kind of an existing login (a worker's email typed into the invite never becomes an admin), and writes the audit row.
3. **The set-up link is shown, not emailed by the platform.** An invitation email would be a new entry in the §8 register, which is the contract's to add. Until it is, the manager copies the link or opens it pre-written in their own mail app. The link lands on `/auth/invite` in the right app, and the token is spent only when the password is submitted, so a chat preview or a mail scanner opening it does not use it up (the Staff App's `/activate` works the same way). Links expire with the project's OTP lifetime (`otp_expiry`, 24 h in `supabase/config.toml`). "New invite link" replaces the previous one.
3a. **Asked before anything is minted** (`admin_login_lookup`). Minting a token replaces the one in any link already sent, and a link for a login someone already uses would let the manager holding it sign in as them. So an address that belongs to a worker or to another kind of login is refused without a token being made; a client login is never moved to another client (also refused inside `admin_register_account`); and a login that has **ever been signed in to** gets no link at all — its owner uses Forgot password, which goes to their own mailbox.
4. **Switch off / on** (`admin_set_login_disabled`) sets GoTrue's `banned_until` and deletes the login's sessions and refresh tokens, as §1.7's removal does. It needs a reason, refuses staff logins, the caller's own login and the last working admin, and is audited.
5. **`/activity`** reads `audit_log` through `admin_activity` (admin only), which adds the actor's name and a label for the record, with filters by area, person, text and period and keyset paging on `id`. Every stamp is an audit stamp, so UK time only (§1.8). No actor is shown as "System" (jobs, webhooks).
6. **`/settings` history.** Triggers on `settings` and on `venue_types.default_radius_m` write `settings.*` audit rows with the key, the old value and the new one, and the manager as actor.
7. **`/account` — My profile.** Name, job title and phone through `update_my_profile` (`profiles` still has no UPDATE policy; the audit row names the fields changed, never the values). Email change is GoTrue's confirmation-link flow; a password change checks the current password on a separate cookie-less client and signs out every other device. A worker's name stays on the staff record, so the function refuses a staff login.

## Proposal, not built: finer office permissions

Every Back Office login has full access today, and every RLS policy in the schema reads `current_app_role() = 'admin'`. A toggle on `/users` that did not change those policies would be a lie, so none is shown. The shape that would work:

- an `office_role` on `profiles` (`owner`, `manager`, `scheduler`, `viewer`), `app_role` staying `admin` so routing is untouched;
- a `has_office_permission(text)` helper, and the money-bearing policies and RPCs (rates, charges, payroll, bank details, `/settings`, `/users`) changed to ask for `finance` or `settings` rather than bare `admin`;
- pgTAP per role, as for admin / client / staff today.

That is a change to the access rules the contract describes (§1.4 names three roles), so it needs THC's decision first.

## Known limit (closed)

Switching a login off deletes its sessions and refresh tokens, but an access token already issued used to stay valid until it expired (up to an hour), because `current_app_role()` read `profiles` only. **Closed by `20260930210500`:** `current_app_role()` now answers NULL for a login whose `banned_until` is in the future, so every policy and admin RPC refuses that token at once (pgTAP 745).

## Consequences

- `20260930210000_accounts_profile_and_activity.sql`, `supabase/tests/740_accounts_profile_activity.sql`.
- The Back Office needs `SUPABASE_SERVICE_ROLE_KEY` (already required by Accept) and, for Client Portal invites in production, `NEXT_PUBLIC_CLIENT_URL`.
- Two new public routes, `/auth/invite` in the Back Office and in the Client Portal, both under the existing public `/auth` prefix.
