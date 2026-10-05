# ADR-0086 · The Inbox shows every email the platform sent

**Status:** Accepted · **Wireframes:** none (`/inbox` reuses the Back Office's Tabs, SearchInput, Select, Pill and `card-rows` table, as `/activity` does) · **§8, §9.12, §1.8** · Extends ADR-0058

## Context

ADR-0058 gave the office an Inbox of the emails the platform sent to the office and payroll (E5-E10, CL3-CL6, the Monday payroll email) and deliberately kept every other email off it: a candidate's E3 and a new login's E11 carry live set-up links, so their codes were held out and three restrictive policies on `notification_outbox` keep those rows to owners.

That left the question the office asks most often unanswerable from the Back Office: **"did we email this person?"** A candidate says she got a Willo link but is not in the system; the office could not see whether the platform had sent her a rejection (E2), an activation (E3), a video-interview reminder (OC1), or a login invitation (E11), or whether the send failed.

## Decision

1. **Three views on `/inbox`**, a tab strip above the existing filters: **Office & payroll** (the default, unchanged), **Candidates & workers** (E2, E2b, E3, E4, E11, E12, OC1, OC2) and **Clients** (D1, D2, the timesheets to a client's contacts). Which code belongs to which is the register's (`EMAIL_AUDIENCES` in `packages/notifications/src/inbox.ts`). A test asserts that every email-channel template the system sends is in exactly one view (E1 aside), so a new email cannot be missed, and that the office view is still exactly the emails whose recipients the register pins. The URL is the state: `?who=people|clients`, `?q=`, `?type=`, `?status=`, `?period=`, `?before=`.
2. **Search by address, name or Employee ID** (`?q=`), the use case being "did we email this person?". It matches the addresses the email was sent to, the person's name, the name the email carried, and the Employee ID; `%` and `_` are literal.
3. **Each row shows** the template and its rendered subject, the recipient (a staff or candidate record, linked to `/onboarding/:id` while they are in the pipeline or turned down, otherwise to `/staff/:id`), the address it was sent to, the queued time (UK, audit-style), and a status: Queued, Held (the channel has no keys), Retrying (with the last error), Sent or Failed, with the stamp and the error. An email whose address matches no staff or candidate record says "No staff or candidate record has this address." rather than showing a blank, which is the answer to "she is not in the system".
4. **Willo's E1 is sent by Willo**, not by this system, so it is in no outbox row. The Candidates & workers view says so in a helper line, so its absence is not read as "not sent". The register already marks E1 `sender: 'willo'`.
5. **Read through `office_email_log()` and `office_email_failures()`** (`20261005120500`), not by widening `notification_outbox`'s policies:
   - Back Office logins only (`current_app_role() = 'admin'`); a worker, a client and anon get nothing; read-only; no table, policy or column changed, so `001_rls_guard` is untouched.
   - The function returns the recipient, the status and a **whitelist** of payload values that fill a subject line (`name`, `employeeId`, `event`, `role`, `date`, `days`, `app`, `periodStart`, `periodEnd`, `poSuffix`, `staffCount`, `variant`, `client`). It never returns `link`, `installLink`, `attachments`, `rate` or any other key, and strips any URL out of an error text. A vitest reads the whitelist from the migration and asserts it covers every placeholder in a logged subject and contains no link or rate key.
   - Because only the subject and recipient leave the database, a manager or scheduler can see *that* an E3, E11 or OC2 was sent and to whom, without being able to read the one-time link, which the owner-only policies on the table still guard. The page never renders a body.
   - The recipient is resolved in the database: the row's `recipient_staff_id`, else the worker its key names (`E3:staff:<id>:…`, `E3:resend:<id>:n`, `OC2:staff:<id>:…`), else the application behind an `E2:application:<id>` key, else a staff record with that address. A GDPR-removed profile reads "Deleted account #id", its address is withheld, and it is found by Employee ID only.
6. **Nothing is re-sent from here.** A failed email is re-queued where it was made (the event page, `/reports`, the candidate's page).

## Consequences

- `supabase/migrations/20261005120500_office_email_log.sql`; `supabase/tests/773_office_email_log.sql` (admin sees, worker/client/anon see nothing, links never leave, search, filters, counts); `packages/notifications/src/inbox.ts` and its test; `apps/office/app/inbox/**` and its tests.
- The "failed in this period" banner counts the failures in the view on screen, not the office's alone.
- The three owner-only policies stay: they still protect the link in the table itself, which no screen reads.
- `packages/db` generated types do not yet name these functions; `/inbox` calls them through an untyped client, as it did for `queued_at`. Regenerate with `pnpm --filter @thc/db gen:types` once the migration is applied.
- Only emails sent by this system are listed. Whether Willo delivered E1, or whether a mailbox accepted any email, is out of reach; Resend's dashboard is the next place to look for delivery.
