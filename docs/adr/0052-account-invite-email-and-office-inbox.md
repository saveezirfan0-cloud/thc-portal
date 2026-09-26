# ADR-0052 · The account invitation email (E11), and the office Inbox

**Status:** Accepted · **Wireframes:** none (`/inbox` reuses the Back Office's Panel, Select, Pill and `card-rows` table language, as `/activity` does) · **§1.4, §1.8, §8, §9.12**

## Context

ADR-0049 decision 3 showed a Back Office or Client Portal login's one-time set-up link on `/users` rather than emailing it, because an email is a new entry in the §8 register and that is the contract's to add. The manager copied the link, or opened it pre-written in their own mail app. THC's product owner has now approved adding the email.

Separately, the platform sends the office and payroll a dozen kinds of email (E5–E10, the completion-letter emails CL3–CL6, the Monday payroll email) and nothing in the Back Office showed whether one went, or why it did not. `notification_outbox` was admin-readable and unread.

## Decision

1. **E11 — account invitation.** A register extension (`EXTENSION_CODES`, beside E2b and E10), the next free E-number. Sender `admin` from `settings.senders` (§9.12). Subject `Your THC {app} login`, `{app}` being "Back Office" or "Client Portal". The body is in E3's voice (E3 is the same message for a Staff App login): the link, "works once and expires after 24 hours", and "if it has expired, reply to this email and we will send you a new one" — the reply goes to admin@, which is not a no-reply address. "24 hours" is GoTrue's `otp_expiry`; the register test reads `supabase/config.toml`, so changing one without the other fails. **THC to confirm the wording.**
2. **One write path, `queue_account_invite(p_user, p_link)`** (`20260930210200`). Admin only, and since `20260930210500` owner only (`office_can('users')`, ADR-0050). It refuses a staff login (their link is E3, from Accept), a switched-off login, one that has ever been signed in to (ADR-0049 3a), and any link that is not `https://<host>/auth/invite?…token=<GoTrue hashed token>` (or `http://127.0.0.1` / `localhost` for a local stack) — no userinfo, fragment or trailing text. The **address and name are read from `auth.users` and `profiles`**, never taken from the caller, so this door cannot send THC-branded mail anywhere else. Audited as `account.invite_emailed`, with the outbox key and address and **never the link**.
3. **Keys `E11:invite:<user>:<n>`.** A new link is a new row (n + 1); the same link twice (a double-click, a retried request) finds the row already carrying it and queues nothing. An older E11 for the same login that has not gone yet is failed with `superseded: …`, because minting the new link replaced its token. The profile row is locked first, so two concurrent calls cannot take the same n. The drain needs no change: E11 has no fixed recipients, so `messageFor()` sends to the row's `recipient_emails`, and Resend's `Idempotency-Key` is the outbox key.
4. **`/users` calls it.** `apps/office/app/_lib/inviteEmail.ts` exports `queueInviteEmail(supabase, userId, link)`, called with the manager's own client after a link is issued; the link modal then reads "Emailed to …; you can also copy the link". A refusal comes back as a sentence and the link on screen still works.
5. **`/inbox`** lists the office emails, newest first: type and rendered subject, whom or what it is about (the worker linked to their profile when the outbox key carries their id; the event, or the payroll week), recipients, queued time and status — queued (with "held" when the channel has no keys, or "retrying" with the last error), sent, or failed with the error. Filters by type, status and period; 50 a page. Every stamp is UK-only (§1.8): these are audit stamps.
   - **Which emails** is a property of the register (`OFFICE_INBOX` in `packages/notifications`): every email whose recipients the register pins. A test holds the list to that rule and asserts every pinned address is THC's or payroll's, so a candidate's E3 and a login's E11 — which carry live set-up links — can never appear.
   - It reads `notification_outbox` directly under the existing `admin_read` policy. No new policy, no new read function: the rows need no join.
6. **`notification_outbox.queued_at`.** The table had no creation stamp (`send_after` moves on every claim and retry). New rows are stamped on insert; existing rows are backfilled with the earliest stamp they carry.

## Consequences

- `20260930210200_account_invite_email.sql`; `supabase/tests/742_account_invite_email.sql`; `packages/notifications/src/{templates,inbox}.ts` and their tests; `apps/office/app/inbox/**`; `apps/office/app/_lib/inviteEmail.ts`.
- The one-time link sits in the outbox payload until the row is sent, like E3's activation link; only an admin can read the table.
- Nothing re-sends from `/inbox`. A failed office email is re-queued where it was made (the event page, `/reports`).
- `packages/db` generated types do not yet name `queued_at`; `/inbox` casts its rows, as `/activity` does. Regenerate with `pnpm --filter @thc/db gen:types`.

## Update — set-up links are owners' only (20260930210600)

The QA review found that an E11 row's `payload.link` was readable by every Back Office login through `notification_outbox`'s `admin_read`, so after ADR-0050 a manager or scheduler could take over a login an owner had just invited. A restrictive policy now shows E11 rows only to a session with `office_can('users')`, and a trigger removes the link from an E11 row once it is sent or has failed for good (`linkRedacted: true`). pgTAP 746.
