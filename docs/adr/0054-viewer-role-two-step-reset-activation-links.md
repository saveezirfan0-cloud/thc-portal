# ADR-0054 · A read-only viewer role, resetting two-step from /users, and workers' activation links fenced

**Status:** Accepted (product owner approved the viewer role) · **Builds on:** ADR-0049, ADR-0050, ADR-0051, ADR-0052 · **§1.4, §1.7, §2.7, §2.8 (E3), §8, §10.2**

## Context

Three pieces of unfinished business from the office-roles work:

1. ADR-0049 sketched a fourth office role, **viewer** — someone who can look at everything and change nothing (an auditor, the accountant, a new starter shadowing the office). ADR-0050 left it out. THC has now approved it.
2. ADR-0051 left the lost-phone recovery to someone with Supabase dashboard access, with no audit row. Its follow-up 2 was a reset from `/users`.
3. ADR-0050's closing note: E3 rows in `notification_outbox` carry a worker's one-time activation link, and every Back Office login could read them (`admin_read`). Whoever holds the link sets that worker's password before they do. E11 was fenced by `20260930210600`. E3 was not.

## Decision

### 1 · The viewer role (`20260930220000`, `20260930220100`)

`office_role` gains `viewer`. The new value is added in its own migration because the Supabase CLI applies each file as one transaction, and a new enum label cannot be used in the transaction that adds it.

| Permission | owner | manager | scheduler | **viewer** |
|---|---|---|---|---|
| `users` | yes | — | — | — |
| `settings` | yes | — | — | — |
| `finance` (read money) | yes | yes | — | **yes** |
| `write` (new) | yes | yes | yes | **—** |

`office_can('write')` is new. The Back Office asks it (`permissions.ts`). The database does not need it, because it enforces read-only by trigger:

- **`office_read_only`** is a `BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE … FOR EACH STATEMENT` trigger on every table in `public`. Extension tables such as PostGIS's `spatial_ref_sys` are skipped. It raises `read_only` (42501) when `auth.uid()` is a viewer. A trigger fires whoever runs the statement, so it covers direct PostgREST writes as well as **security definer RPCs**, which bypass RLS. A restrictive policy per table would have covered only the first.
  - *Why a trigger rather than policies:* the permissive `admin_all` policies admit a viewer, since `current_app_role()` is still `admin`, and definer RPCs never meet RLS.
  - *Performance:* statement-level, so a bulk statement pays once, not once per row. With no session at all (jobs, webhooks, the service role) it returns after reading one GUC. With a session it is one primary-key read of `profiles` per statement. No transaction-scoped cache: a GUC cache would save a lookup on multi-statement transactions only, and it adds a value that something else might set.
  - *A statement matching no rows is refused as well*, because the trigger is per statement. No read path is known to issue one. Office loaders call only `stable` functions, and Postgres forbids a `stable` function from writing.
- **Allow-list**, pinned by pgTAP 750:
  - `profiles`: `update_my_profile()` (/account). `profiles` has no write policy, and every other definer that writes it is owners-only or also writes a guarded table.
  - `office_saved_views`: a viewer's own filter chips on /events (ADR-0053, `20260930222000`). It is own-row only, and a preference rather than office data.
- **`audit_log`** keeps the statement guard for UPDATE, DELETE and TRUNCATE. Its INSERT is guarded by **`audit_log_office_read_only`**, an AFTER INSERT statement trigger with a transition table. It refuses any audit row whose `actor` is a viewer, except `profile.updated`. This is the one gate for the **service-key** paths, where `auth.uid()` is null. The staff profile's Block, Unblock, Reset to candidate and Remove run on the service key and pass the manager as `p_actor`, and each writes that actor into `audit_log` in the same transaction. The raise undoes the whole call. It costs one query per statement, over the inserted rows only.
- **`onboarding_resend_activation_check()`** now refuses a viewer. It is asked *before* the service key mints a new token, and minting kills the candidate's current link. The body is 20260924110000's plus one line.
- **Future-proofing:** pgTAP 750 fails when any `public` table lacks the trigger in exactly that shape (statement-level, BEFORE, all four events, enabled), unless it is on the named allow-list. A table added by a later migration must attach the trigger itself or be argued onto the list here. `20260930220100`'s loop body is the recipe.

**Back Office.**
- `/users`: the role picker and Change role include Viewer, with its summary, and the access notes mention it.
- The shell shows "Read-only access" at the top of every screen for a viewer (`_components/ReadOnlyBanner.tsx`). It reads the office role from the same context as the menu.
- The menu gives a viewer the manager's items: Reports and Roles & rates, but not Settings or Users & access.
- `read_only` is explained in words in the shared explainers (`_lib/permissions.ts`, `_lib/accounts.ts`).

### 2 · Reset two-step from /users (`20260930220200`)

`admin_reset_two_step(p_user, p_reason)` is security definer and refuses, in this order:
1. Not a Back Office session.
2. Not an owner (`office_can('users')`).
3. An unknown login.
4. A login that is not Back Office (`not_office_login`).
5. The caller's own login (`cannot_reset_own_two_step`, use /account).
6. No reason given.
7. A login with no *verified* factor (`no_two_step`). An abandoned set-up is not two-step, and an audit row claiming a reset would be false.

When none of these apply, it deletes every row of the login in `auth.mfa_factors` and ends every session and refresh token, because an aal2 session raised with the lost phone must not outlive the reset. It writes `account.two_step_reset` with the reason, the number of factors removed and the number of sessions ended. The auth tables are reached with dynamic SQL behind `to_regclass`, as `20260930210000` does. The local harness now has GoTrue-shaped `auth.sessions` and `auth.refresh_tokens` stubs, so pgTAP 751 proves the session half as well.

`admin_accounts()` is re-created with a trailing `two_step boolean`. It keeps 20260930210100's body check for check and column for column, and 751 asserts the old columns and refusals. `/users` shows "Two-step on" under the status of a Back Office row. It offers **Reset two-step** on that row unless the row is yours, behind a confirmation that requires a reason and tells the owner to confirm who is asking by phone.

### 3 · E3 activation links (`20260930220200`)

Where the office reads E3 rows or their payload:
- `/inbox` lists only `OFFICE_INBOX` templates, which never include E3.
- Accept and Resend queue E3 through definer RPCs (`onboarding_accept_with_account`, `onboarding_resend_activation`, `activation_link_refresh`), which do not meet RLS.
- Nothing else in `apps/office` reads `notification_outbox` for E3.

No screen needs the rows, so no read RPC was added.

- **`office_activation_links`**: a restrictive SELECT policy, `to authenticated`, `template <> 'E3' or (select office_can('users'))`. Owners still read E3 rows. Every other role reads every other row as before. Workers and clients never read the outbox.
- **Redaction**: `redact_finished_invite_link()` (20260930210600) now covers E3 as well as E11. Once a row is sent, or has failed for good, `payload.link` is removed and `linkRedacted: true` is set. An **unsent** E3 keeps its link, because the drain sends it and a resend points it at the newest token. `installLink` (/install) and `name` stay; they are not secrets. Rows already finished are redacted by the migration.
- `001_rls_guard` assertions 8 and 10 and `310_office_notification_queue` 1 pin the new policy. It is the seventeenth restrictive policy.

## Residual gaps

Stated plainly, as in ADR-0050:

1. **Service-key calls made before any database write.** In each case below the database refuses the write, so no record changes, but something outside the database is left behind:
   - **Accept** in Onboarding creates or reuses the candidate's GoTrue login and mints a token before `onboarding_accept_with_account` refuses. This leaves an unused login and token. No E3 is queued, and a candidate awaiting a decision has no live link to kill.
   - **Download** of an allocation sheet or timesheet stores the PDF in the `timesheets` bucket before `record_event_document` refuses. The viewer still gets the PDF, and an unreferenced file stays in the bucket.
   - **The office upload slot** in Compliance signs an upload URL before the submit is refused. The existing `discard()` cleans up only when called.

   The fix is for those actions to ask `office_can('write')` before touching the service key. They live in `onboarding/**`, `api/documents/**` and `compliance/**`, which were outside this change's paths. `_lib/permissions.ts` exports `isReadOnly()` for them.
2. **Buttons are still drawn** for a viewer on most screens. They are refused with `read_only`, and screens that route errors through the shared explainers show "Your login is read-only". Screens with their own explainers may show their generic failure text. The banner says so up front.
3. **An audit row naming a viewer written later by a job** would now be refused. No job writes a stored actor today; every job writes `actor` null. A future job that records "who asked for this" must bear this in mind.
4. **Storage and Auth are outside `public`.** A viewer holds no write policy on `storage.objects` (only workers do, on their own photos). The viewer's own Auth changes (password, email, two-step on /account) go through GoTrue and are theirs to make.
5. Another branch may re-create `office_can()`. Whoever merges second must keep the `viewer` and `write` arms. pgTAP 750 section 2 fails if they are lost.

## Consequences

- New: `20260930220000_viewer_role_enum.sql`, `20260930220100_viewer_role_read_only.sql`, `20260930220200_two_step_reset_and_activation_links.sql`; pgTAP `750_viewer_role`, `751_two_step_reset`, `752_activation_links_owner_only`.
- Changed pins: `001_rls_guard` (8, 10), `310_office_notification_queue` (1), `741_office_roles` (the enum labels).
- `scripts/pgtest-local.sh`: `auth.sessions` and `auth.refresh_tokens` stubs in GoTrue's shape.
- `packages/db/src/types.generated.ts`: the `office_role` enum gains `viewer` (hand-edited; regenerate after deploy).
- Back Office: `_lib/permissions.ts`, `_lib/accounts.ts`, `_components/ReadOnlyBanner.tsx`, `_components/OfficeShell.tsx`, `users/**`.
- ADR-0050 and ADR-0051 carry update notes pointing here.
