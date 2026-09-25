# ADR-0036 · A "Your account" page in the Client Portal

**Status:** Accepted · 25.09.2026 · agreed with the client on 2026-09-25 · **§11.1, §9.7, §11.4, §10.2, ADR-0004, ADR-0026**

## Context

§11 gives the Client Portal two screens: the event list (§11.1) and the event page (§11.2). §11.1 says the portal is "Read-only — no editing whatsoever" and has "no money anywhere". A customer contact had no way to:

- see which email address they sign in with, or which company the portal thinks they belong to, beyond the name in the top bar;
- check where THC emails the allocation sheet and the signed timesheet. Those addresses are the client card's "Contact emails" (§9.7). §11.4 sends every document to them. When one is wrong, the customer finds out only when a document never arrives;
- change their own password without going through "Forgot password" (§10.2 A1–A3), which signs them out first.

The client asked for an account page and agreed its scope on 2026-09-25. It is a deliberate addition to §11 and is recorded here.

## Decision

1. **Route `/client/account`**, linked as "Account" from the top bar's account menu (`apps/client/app/client/layout.tsx`). There is no wireframe for it, so it is built from the portal's existing pieces (`PageHead`, `Panel`, the `/reset` form's checklist) with tokens only. It works on both grounds (ADR-0007) and at 390 px.
2. **Read-only details.** The page shows the contact's name (their own `profiles` row, `profiles_self`), their sign-in email (`auth.getUser()`), the company name and the document recipients. It has no input for any of them.
3. **The company and the recipients come from a new view, `client_account_v`** (`20260929100000`). It uses the `client_company_v` shape exactly: owner rights, `security_barrier`, `c.id = current_client_id() and client_portal_visible(c.id)` in the view body, exactly two named columns (`name`, `contact_emails`), and `select` granted to `authenticated` only (anon revoked). It returns the caller's own row and nothing else. It carries no terms (`pays_breaks`, `pays_buffer`), no contact name or phone, no money and nothing about workers. **No policy is added to `clients`.** ADR-0026's empty set of client table policies still holds. `supabase/tests/606_client_account_view.sql` pins all of this.
4. **Change password is the one input, and it is an exception to §11.1.** §11.1 says "Read-only — no editing whatsoever", and a password change is a write (to Supabase Auth) made from inside the portal. It is therefore recorded here as a deviation from the scope, agreed with the client on 25.09.2026, and the portal's second write after §11.2 feedback. The reasoning for accepting it: it changes how this person signs in, not any business data THC keeps about the account, and without it a client's only way to change a password is the forgotten-password email. The server action:
   - applies the `/reset` rules through the same `@thc/domain` functions (`checkPassword`, `passwordOk`, `passwordError`, `PASSWORD_MIN_LENGTH` = 10, must contain a number) and shows the same checklist and messages;
   - re-verifies the current password server-side with `signInWithPassword` against the session's own email (never an email from the form). This runs on a throwaway, cookie-less client, so it cannot overwrite this device's session cookies or its "keep me signed in" choice (ADR-0032). The check's own session is signed out straight away;
   - calls `auth.updateUser` on the caller's own session, then signs out every other device, as `/reset` does.
5. **"Need something changed?"** explains that the details are managed by THC and gives a `mailto:` link to the office. Changes to the name, company or recipients go through the office (§9.7 client card), not through the portal.

## The office address

The codebase has no single "office email" the client can read. The office's mailbox is `settings.senders.admin` (§9.12, editable at `/settings`), which the client role cannot read and must not be given. The page uses its code fallback, `DEFAULT_SENDER_ADDRESSES.admin` in `@thc/notifications` (`admin@thehospitalitycompany.co.uk`), which is the address the sign-in page footer already shows the customer. A change to the client's details is an office conversation, not a question about one document, so it does not go to the `timesheets@` sender. The string exists once in the app (`apps/client/app/client/account/copy.ts`).

## Consequences

- `client_account_v` is the tenth owner-rights view the Supabase advisor will list as `security_definer_view`. As with the other nine, this is the ADR-0004 mechanism and not a lapse. `docs/14-handover.md`'s count ("9 since `20260927120000`") should become 10.
- `packages/db` generated types do not include the view until `pnpm --filter @thc/db gen:types` runs against the project after deploy. Until then the loader reads it untyped, as the layout does for `client_company_v`.
- `docs/08-screen-inventory.md` needs a row for `/client/account` pointing at this ADR, since there is no wireframe.
- Supabase's "secure password change" setting, if it is turned on, asks for a reauthentication nonce when the session is more than 24 h old. The action reports this as "sign out and sign back in, then change your password straight away" rather than failing silently.
