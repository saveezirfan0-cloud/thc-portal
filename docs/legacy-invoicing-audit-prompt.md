# Cowork prompt · audit the legacy invoicing site

Paste everything below the line into Claude Cowork (with Chrome/browser access, logged in to
https://thc.northerncodes.com/dashboard). Save its output as `docs/legacy-invoicing-audit.md`
in this repo. Nothing should be created, edited, sent or deleted in the old system.

---

You are auditing a live invoicing web app so another engineer can rebuild it inside a different
product without ever seeing it. Start at https://thc.northerncodes.com/dashboard. This is a
**read-only audit**: never click Send, Delete, Void, Mark paid, Save or Submit on real data, and
never trigger an email or a Xero sync. If a page can only be understood by creating something,
stop and tell me what you would have done instead.

Work through EVERY page, tab, menu item, modal, filter, sort and pagination step. Build a site
map first, then visit each item. For each page record the sections below.

## 1. Site map and roles
- Full navigation tree with URLs. Every login role you can see and what each can do.
- How login works (email/password, SSO, 2FA). Do not record any password.

## 2. Per page
- URL, title, purpose, what a user does here.
- Every field, column, button, filter, status badge and empty/error state, with the exact
  label text. Take a screenshot of each page and each modal (name files by URL path).
- Every export, download or print option (PDF, CSV, XLSX) and what it contains.
- Anything that looks calculated, and how (show a worked example from real rows).

## 3. Invoice numbering
- Current number format (prefix, padding, year, per-client or global), the latest number
  issued, the date of the latest, and where the counter lives.
- Can numbers be edited by hand? Are credit notes numbered in the same series?
- List the last 20 invoice numbers with dates, to check for gaps.

## 4. Invoice content and PDF
- Open 3 different invoices (different clients, one with a PO number if any). For each record
  every line, quantity, unit, rate, VAT treatment, subtotal, VAT, total, due date, payment terms,
  bank details, footer text, logo and layout. Download the PDF and describe it precisely
  (fonts, colours, positions, wording). Attach the files.
- Line types: hours, overtime, holiday pay, expenses, fixed fees, discounts, anything else.
  Which have separate lines and which are rolled together?
- Rounding rules (per line or per invoice), VAT rate(s) and how they are chosen.

## 5. Workflow
- Statuses an invoice can have and the exact transitions between them. Who triggers each.
- How an invoice is created: from timesheets, manual entry, import? What are the inputs?
  (This matters most for Leonardo Hotel St Paul's (M+E), who use paper timesheets.)
- Approval or sign-off steps. Emails sent (to whom, subject, body text, attachments).
- Reminders, overdue handling, credit notes, re-issue, cancellation.

## 6. Clients, rates and data
- Client list with: name, billing address, contact emails, PO requirement, payment terms,
  VAT number, rate card (role → charge rate), any holiday-pay or overtime multiplier.
  Flag Leonardo Hotel St Paul's (M+E), Taster and All Taster specifically.
- Where hours come from for each of those three clients (paper timesheet typed in,
  their own system exported, uploaded file). Describe the exact steps staff take each week.
- Counts: total clients, total invoices, invoices per month for the last 6 months,
  total value per client for the last 6 months.

## 7. Xero and other integrations
- Is there any Xero connection today? If so: which organisation, what is pushed (invoices,
  contacts, payments), account codes, tax rates, tracking categories, item codes, invoice
  status pushed (draft / awaiting approval), and how failures show. If not, say so, and say how
  invoices currently get into Xero (manual entry, CSV import, nothing).
- Any other integration (email provider, payment links, accounting, storage).

## 8. Reports and dashboard
- Every dashboard tile and report: its name, definition, filters and an example number.

## 9. Branding and technical notes
- Colours, fonts, logo files, and anything worth carrying over to a document.
- Visible technology clues (framework, API URLs seen in the network tab, any public API or
  webhook documentation). Do not record tokens or keys.

## 10. Gaps, risks, oddities
- Anything inconsistent, manual, duplicated or broken. Anything that surprised you.
- Anything you could not access, and why.

## Output
One markdown document with the headings above, plus an `attachments/` list of the screenshots
and sample PDFs. Finish with a table of "things I could not determine" and the specific
question that would resolve each one. Redact passwords, API keys and bank account numbers
(keep sort code and account number last 4 digits only).
