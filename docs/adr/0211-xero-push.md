# ADR-0211 · Invoices are pushed to Xero by the existing 15-minute job

**Status:** Accepted (implements ADR-0210 §6) · **Builds on:** ADR-0074 / ADR-0176 (the `event-documents` job and its secret), ADR-0056 (finance is owner/manager), ADR-0060 (the viewer writes nothing) · **Source:** the brief of 24.10.2026

`apps/office/app/api/xero/**` · `apps/office/app/settings/XeroTab.tsx` · `supabase/migrations/20261027130000_xero_refresh_lock.sql` · schema from `20261027100000_timesheet_invoicing.sql` §7

The Xero developer documentation could not be opened from the build environment (the egress policy
refuses developer.xero.com). The endpoint, header and parameter facts below were checked against
the official `xero-node` SDK v20.0.0 (generated from Xero's OpenAPI) and the OAuth endpoints it
uses; items marked **unverified** are from memory of the published docs and must be checked on the
first connected run.

## Decisions

1. **OAuth 2.0 authorisation code, one organisation.** Authorize
   `https://login.xero.com/identity/connect/authorize`, token `https://identity.xero.com/connect/token`
   (HTTP Basic client id:secret), connections `https://api.xero.com/connections`, API
   `https://api.xero.com/api.xro/2.0` with `Authorization: Bearer` and `xero-tenant-id`. Connect is
   `/api/xero/connect` (owner only, asked of the database through `office_can`, single-use `state` in
   an httpOnly SameSite=Lax cookie), `/api/xero/callback` (state compared in constant time, same owner
   re-checked, first `ORGANISATION` of `/connections` stored in `xero_connection` by the service role).
   Connecting a different organisation than before clears every `clients.xero_contact_id`, which
   belongs to the old one. Disconnect and Sync now are same-origin POSTs.
2. **Scopes:** `offline_access accounting.invoices accounting.contacts accounting.attachments`.
   Xero moved to granular scopes for apps created from 2 March 2026 and retires the broad
   `accounting.transactions` for all apps in September 2027 (**unverified** wording; check the app's
   scope list in the developer portal). `XERO_SCOPES` overrides for an older app. No `openid`: the
   identity token is not used. No settings or reports scope: the account code and tax type are typed
   on the Xero tab, not read from Xero.
3. **Refresh tokens rotate.** Access tokens last 30 minutes; each refresh returns a new refresh token
   and spends the old one (valid 60 days unused). The client refreshes under a database lease
   (`xero_refresh_lock`, 30 s, expires by itself), re-reads the row inside the lock (another process may
   have refreshed), saves the new pair with a compare-and-swap **before** the new access token is used,
   and shares one refresh between concurrent callers in a process. A 401 refreshes once and retries.
   An idle connection is refreshed weekly by the job so the 60 days never run out. This is the only
   schema change beyond ADR-0210 (the lock column and two service-role functions); it needs a pgTAP
   case (service role only) from the database owner.
4. **Rate limits.** Xero allows 60 calls a minute and 5,000 a day per organisation (and 5 concurrent).
   A batch is 10 invoices at 2 to 4 calls each, run one at a time. A 429 waits its `Retry-After`
   (up to 60 s, then the run stops and says so: the daily limit is not waited out); 5xx and network
   errors back off 1, 2, 4, 8 s over five attempts. The rest of a stopped batch is handed back as
   `failed` with a plain reason, so the next run claims it. A failure from Xero counts as an attempt
   in `xero_sync.attempts` (24 then the office presses Try again), including when the run stops early.
5. **Contact.** Matched once by name (`GET /Contacts?searchTerm=`, then an exact case-insensitive
   comparison, so no quote-escaping of a client name), else created with the bill-to name and first
   email, and remembered in `clients.xero_contact_id`. An archived contact of the same name cannot be
   used: the invoice fails with Xero's text and the office renames or restores it in Xero.
6. **Invoice.** `PUT /Invoices` (create only: it can never overwrite an invoice), `Type ACCREC`,
   `InvoiceNumber` = our number, `Reference` = PO, dates, `GBP`, `LineAmountTypes Exclusive`, `Status`
   from `settings.xero.invoice_status` (Draft). One Xero line per `invoice_lines` row with
   `LineAmount` = **our stored amount**, so Xero's net equals ours to the penny. `Quantity x UnitAmount`
   is sent only where it reproduces that amount exactly (shift lines: hours x staff x rate); a line it
   does not reproduce is sent as 1 x amount with the working in the description, so Xero is never
   asked to reconcile two figures. Descriptions: date · role · (name) · times · break · hours; a
   role-aggregated client's lines carry **no staff names** in Xero. Overrun lines read "Overrun – role"
   (ADR-0184). VAT: we round once on the subtotal (`round(net x 20%, 2)`); Xero rounds per line. On the
   audit's sample invoice (#3255) that is 1p apart (706.06 against 706.07), so where the two differ the
   line `TaxAmount`s are set by running totals so they add up to our VAT (a documented, overridable
   field; **unverified** that Xero accepts the override on an ACCREC with `OUTPUT2` without complaint).
   A total that still differs is recorded `mismatch` by `xero_record_result()`, never accepted.
   A 0% VAT rate is sent as `ZERORATEDOUTPUT`.
7. **Idempotency.** Three layers. (a) `xero_claim_batch` leases a row for 10 minutes. (b) The
   `Idempotency-Key` header (128 characters at most; the SDK documents it for every create) is
   `thc-invoice-<number>-<12 hex of the payload digest>`: the same payload retried after a lost reply
   returns Xero's first answer; the digest is there so that a corrected account code or status is
   never answered with a remembered refusal (**unverified** how Xero treats a reused key with a
   different body). The brief said `thc-invoice-<number>`; the suffix is the only difference.
   (c) `InvoiceNumber` uniqueness: when Xero refuses a create, the job looks the number up
   (`GET /Invoices?InvoiceNumbers=`) and adopts the invoice it finds, recording its id, status and
   total. A retry after a failed attachment re-reads the recorded `xero_invoice_id` and only
   attaches. An adopted invoice's attachment list is read first so the PDF is not added twice.
8. **PDF.** `PUT /Invoices/{id}/Attachments/{file name}` (`Content-Type: application/pdf`, 10 MB
   limit) of `invoices.storage_path` from the private `timesheets` bucket, when `attach_pdf` is on.
   Only the invoice, not the sign-in log.
9. **Where it runs.** After D1/D2 and the event invoices, inside the 15-minute `event-documents` run
   (same `RTW_JOB_SECRET` gate, no new cron row, ADR-0074 / ADR-0176), its counts under
   `job_runs.counts.xero`. A Xero failure never fails the documents or invoices in the same run. The
   same function is called by `POST /api/xero/sync` (Sync now). With any `XERO_*` variable missing,
   `settings.xero.enabled` false or no organisation connected, nothing is claimed and no attempt
   counter moves.
10. **Nothing sensitive is logged or stored in an error.** Tokens never leave `xero_connection`; log
    lines carry an invoice id and an error kind; `last_error` holds Xero's validation text (about
    accounts and contacts) or one of our fixed sentences, at most 300 characters.

## What the office does

- **Failed:** read the reason on Settings → Xero (usually the account code, an archived contact or a
  lapsed connection), fix it, press **Try again** (`xero_retry`).
- **Total differs:** open the invoice in Xero beside ours; if Xero is right to differ (a tax
  setting), fix it in Xero; if not, void in Xero and see below.
- **Voiding an invoice here after it reached Xero:** the platform does **not** void it in Xero. The
  `xero_sync` row says "Void this invoice in Xero too." The accounts team voids (or, once paid,
  credits) it there. The number is never reused here. Voiding a Draft in Xero is a delete; an
  Approved one is voided.
- **Credit notes** are raised in Xero. The platform has no credit-note feature (ADR-0210, awaiting
  THC) and does not read them back.
- **A corrected invoice** is a void and a new invoice (new number), not an edit; a pushed Xero invoice
  is never updated.

## Not verified (no live Xero tenant)

The whole round trip: consent screen, scopes accepted for THC's app, tenant listing, contact search,
PUT invoice with `LineAmount`/`TaxAmount` overrides, attachment upload, Xero's own total rounding,
the behaviour of a reused `Idempotency-Key`, and the refresh-token grace period. Everything is tested
against a scripted Xero (`app/api/xero/_lib/__tests__`), which encodes our reading of the above.

## Awaiting THC

The Xero organisation and a user to connect it; the sales account code and tax type (defaults 200 and
OUTPUT2); Draft or Approved; whether a client's Xero contact already exists under the invoice display
name (else one is created); whether the sign-in log should be attached too; credit notes.
