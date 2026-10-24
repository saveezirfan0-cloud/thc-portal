# Legacy invoicing audit — THC Invoicing (thc.northerncodes.com)

**Audited:** 24 Oct 2026 · **Logged in as:** Sam (Manager) · **Mode:** read-only

**How the audit was done.** I used the web UI and the app's own GET JSON endpoints (`/api/clients`, `/api/invoices`, `/api/jobs`, `/api/shifts`, `/api/settings`, `/api/users`) from the logged-in session. Nothing was created, edited, sent, voided or deleted. I opened the Email Invoice modal once, on invoice 3255 (already sent), and closed it with **Cancel**. I re-checked afterwards that `sentAt`/`updatedAt` were unchanged.

**Redaction.** Passwords, API keys and secrets are not recorded. Bank details are cut to the last 4 characters. Graph tenant/client IDs are left out.

**Timezone note.** The UI shows times in the browser's timezone (UTC+5 for this audit). For example, "Created 20/10/2026 21:34" is 16:34 UTC / 17:34 BST. The API stores UTC.

---

## 1. Site map and roles

### Navigation tree

| Area | URL | Notes |
|---|---|---|
| Dashboard | `/dashboard` | KPI tiles + Recent Activity |
| Operations ▸ Process Timesheet | `/process` (new), `/process/{jobId}` (existing job) | Badge = number of jobs in `REVIEWING` (21). When collapsed, "Operations" shows 305 = 21 + 284 |
| Operations ▸ Shifts | `/shifts` | "Shift Database". Filter state lives in the query string (`?status=…&sortBy=date&sortOrder=desc&page=1&limit=50`) |
| Operations ▸ Invoices | `/invoices`, `/invoices/{invoiceId}` | Badge = non-void invoice count (284) |
| Operations ▸ Clients | `/clients`, `/clients/{clientId}` | |
| Settings | `/settings` | Tabs: Account, Users, Company Details, Invoice Settings, Google Integration, Data Management |
| Sign Out | — | Not clicked |
| Footer | "Powered by Northern Codes" → https://northerncodes.com | |

**File/download endpoints:**

- `/api/invoices/{id}/pdf`
- `/api/invoices/{id}/excel`
- `/api/files/{fileId}`, used for source timesheets

**API routes referenced in the front-end bundle:**

- `/api/clients`, `/api/clients/{id}`
- `/api/jobs`, `/api/jobs/{id}`, `/api/jobs/{id}/extract`, `/api/jobs/{id}/shifts`, `/api/jobs/{id}/confirm`
- `/api/shifts/{id}`, `/api/shifts/bulk-approve`, `/api/shifts/bulk-reject`
- `/api/invoices/check-po-duplicates`
- `/api/invoices/{id}/pdf|excel`
- `/api/invoices/{id}/email/preview` (POST), `/api/invoices/{id}/email/send` (POST)
- `/api/email/template`
- `/api/files/{id}`
- `/api/auth/signin`

### Roles and users

There is one role, **`manager`**. It carries a permission list with `clients, shifts, invoices, process, users, export, settings`. The model looks granular, but every user has every permission.

| Name | Email | Role | Created |
|---|---|---|---|
| Sam | sam@thehospitalitycompany.co.uk | Manager | 08/04/2026 |
| Gisela Duncan (Head of Finance; the default email sender) | gisela@thehospitalitycompany.co.uk | Manager | 17/04/2026 |
| Eric Harrison (developer, Northern Codes) | eric@northerncodes.com | Manager | 18/05/2026 |

Settings also holds a `last_bcc:admin001` key. That suggests an earlier seeded `admin001` user that no longer appears in the list.

### Login

- NextAuth (`/api/auth/signin`) with email + password. Settings ▸ Account has "Change Password" with Current / New ("Min 6 characters") / Confirm New → **Save Password**.
- I saw no SSO buttons and no 2FA settings. I did not sign out to view the login screen, so this needs confirming (see the table at the end).

---

## 2. Per page

### 2.1 Dashboard — `/dashboard` (screenshot: `dashboard.jpg`)

**Purpose:** a weekly snapshot.

- Heading "Welcome back, Sam" / "Here's what's happening this week".
- Toggle **This Week | This Month**.
- Primary button **Process New Timesheet** → `/process`.

| Tile (exact label) | Example | Link / definition |
|---|---|---|
| THIS WEEK'S JOBS | 16 | `/shifts?dateFrom=2026-10-19` (Monday of the current week) |
| INVOICES GENERATED | 16 | `/invoices?dateFrom=2026-10-19` |
| TOTAL INVOICED | £33,682.26 | Same link. Equals Week 43 in Weekly Summary (sum of `amountDue`, inc. VAT) |
| NEEDS REVIEW | 21 | `/shifts?status=FLAGGED,EXTRACTED`. The number equals the count of jobs in `REVIEWING`, not a count of shifts (see §10) |

**Recent Activity:** a list of jobs. Each row shows:

- a green tick,
- the client display name,
- the source filename · status ("Complete"),
- relative time ("2 days ago").

Rows link to `/process/{jobId}`. The list is paginated 1–5.

### 2.2 Process Timesheet — `/process` (screenshots: `process--upload.jpg`, `process--id--step2-review-taster-liverpool.jpg`, `process--id--step4-generated.jpg`, `process--id--preview-empty.jpg`)

Subtitle: "Upload and process client timesheets through the 4-step workflow". Stepper: **1 Upload · 2 Review · 3 Confirm · 4 Generate**.

**Step 1 — Upload Timesheet.** "Select a client and upload one or more timesheet files to begin processing."

- **Client:** searchable ("Search clients…"). Helper text: "Required for scanned timesheets. Optional for Excel files."
- **Timesheet Files:** drag-and-drop. "Excel (.xlsx, .xls, .csv), PDF, or Image (max 25MB each, up to 10 files)".
- **Notes (optional).**
- Button **Upload & Process**.

**Step 2 — Review** (seen on job `cmuv8662d00kn01met3i0ppio`, Taster Liverpool).

- **Left pane, "Source Document":**
  - **Download** link.
  - For Excel files, a tab per worksheet (e.g. "All Employees" plus one tab per employee) rendered as a table.
  - For PDFs, extracted rows carry page and polygon coordinates.
- **Right pane, header:**
  - Client display name + filename.
  - Counters "9 shifts · 8 approved · 0 flagged".
  - Buttons **Change Client** and **Approve All Clean**.
- **Filter chips:** All / Extracted / Flagged / Approved / Rejected.
- **Contextual banner, e.g.:** "This timesheet has summary hours only — no per-shift Start/End times. Click any red - to add times manually if you have them."
- **Table columns:** Name, Staff ID, Event Date, Role, Start, End, Break, Hours, Rate, Total.
  - A coloured dot shows status: green = approved, red = rejected.
  - Cells are editable inline.
- **+ Add Staff Row.**
- **Footer:** "Approved: 8 shifts · Hours: 169.08 · Total: £3,004.55". Button **Continue with N approved shifts**.

**Step 3 — Confirm.** Not seen live, because every job I opened was past or before this step. The job record stores a `__CONFIRMED_GROUPS__` JSON in `notes`. It holds one group per invoice to be generated: `poNumber, invoiceDate, eventDateStart, eventDateEnd, uniform, format, shiftIds[]`. So at Confirm the user splits approved shifts into one or more invoices and sets PO, invoice date, event date range and format for each. The front end calls `/api/invoices/check-po-duplicates` at this step.

**Step 4 — Generate.**

- Message: "Invoices Generated Successfully · 1 invoice generated · Total value £4,236.34".
- Each invoice is a card: "Invoice #3255", badges "Role Aggregated" and "Generated", client, "PO: …", amount.
- Card buttons: **Preview**, **Download PDF**, **Download Excel**, **Email Invoice**.
- Footer: **← Back to Dashboard**, **View Invoice History**, **Process Another Timesheet**.
- **Preview** toggles to "Hide Preview" but renders an empty panel (see §10).

### 2.3 Shifts — `/shifts` (screenshot: `shifts.jpg`)

Title "Shift Database" · "All processed shifts across all jobs · 4,230 shifts total". Button **Export ▾**.

- **Filters:**
  - Client (select)
  - From / To (date)
  - Quick ranges: This Week, Last Week, This Month, Last Month, 30 Days, All
  - Staff ("Search name…")
  - Week ("#")
  - **Clear All**
  - Status chips: Extracted (grey), Flagged (amber), Approved (green), Rejected (red)
- **KPI strip (example):**

| Shifts | Hours | Total Charge | Total Pay | Margin | Unique Staff | Invoiced |
|---|---|---|---|---|---|---|
| 4,230 | 43,479.82 | £576,937.16 | £395,590.14 | £181,347.02 | 840 | 2684 of 4230 |

- **Columns:** checkbox, status dot, Name, ID, Client, Role, Date, Start, End, Break, Hours, Rate, Charge, Pay, PO, Wk, Invoice (link "#3133"). Sortable: Name, Role, Date, Hours, Rate. 50 per page (85 pages).
- **Calculations:**
  - Charge = hours × client charge rate.
  - Pay = hours × staff pay rate.
  - Margin = Charge − Pay.
  - Example: 9.50 h × £18.98 = £180.31 charge; 9.50 × £12.71 = £120.745 → £120.75 pay.

### 2.4 Invoices — `/invoices` (screenshots: `invoices--all.jpg`, `invoices--export-menu.jpg`, `invoices--weekly-summary.jpg`)

Header "All generated invoices · 284 invoices | £588,042.68 total". **Export ▾** → *Export as Excel*, *Export as CSV* (not run).

- **Tabs:** All Invoices | Weekly Summary | Monthly Summary.
- **Filters:**
  - Client (select; uses display names)
  - From / To
  - This Week / Last Week / This Month / Last Month / Quarter / All
  - Search "# / client / PO…"
  - Clear All
  - Status chips **Generated, Sent, Paid** (on by default) and **Void** (off by default)
- **KPI strip:** Invoices 284 · Total £588,042.68 · Hours 25951.41 · Average £2,070.57.
- **Columns:** # (sortable), Date (sortable), Client (sortable), Venue, PO, Event, Format ("Named"/"Aggregated" pill), Shifts, Hours, Subtotal, VAT, Amount Due, Status, Last sent, Actions.
  - Actions are a PDF download icon and an Excel download icon.
  - # links to the invoice; Client links to the client.
- **Weekly Summary:** collapsible rows per ISO week of invoice date. Example: "Week 43: 19 Oct - 25 Oct 2026 · 16 invoices · Hours 1471.84 · Total £33,682.26 · Average £2,105.14"; "Week 42: 12–18 Oct · 14 invoices · 1193.61 h · £27,073.33 · £1,933.81".
- **Monthly Summary:** same idea grouped by month (screenshot not captured).
- Stats with Void included (API): 288 invoices, £595,756.24, 26,303.41 h, average £2,068.60.

### 2.5 Invoice detail — `/invoices/{id}` (screenshots: `invoices--id--detail-3255.jpg`, `invoices--id--detail-3255-lineitems.jpg`, `invoices--id--email-modal.jpg`)

- **Header:**
  - "← Back to Invoices".
  - "Invoice #3255" + status pill "Generated".
  - "Created 20/10/2026 21:34".
  - Buttons **Download PDF**, **Download Excel**, **Email Invoice**, **Re-generate**.
- **Summary card:**
  - Client display name, contact name, contact email, venue.
  - "Event: 15/10/2026 - 17/10/2026", "PO: 52453465", format pill.
  - Right side: Subtotal, VAT (20%), Amount Due (large).
- **Invoice Preview:** a section header with an empty body (see §10).
- **Line Items (28):** Date, Role, Staff, Hours, Rate, Total. Named-staff invoices also show the staff name.
- **Linked Shifts (28):** collapsed list.
- **Timeline:** Generated (timestamp) · Last updated · Sent.
- **Send history:** timestamp · sender ("Gisela Duncan") · recipient · "Sent".
- **Danger Zone:** "Voiding an invoice unlinks all shifts and marks it as void. The invoice number is never reused. To correct a mistake, edit the timesheet and use Re-generate instead, which keeps the same number." Button **Void Invoice**.
- "From job: View Processing Job" → `/process/{jobId}`.

**Email Invoice modal** (opened, then Cancelled):

| Field | Value on 3255 |
|---|---|
| From | select: "Gisela Duncan <Gisela@thehospitalitycompany.co.uk> (default)" |
| To | client `contactEmail` (ajit_singh@leonardohotels.com) |
| Cc | client `invoiceEmails` (london_ap@…, ap_queries@leonardohotels.com) |
| Bcc | blank, placeholder "bcc@example.com". The last Bcc is remembered per user (`last_bcc:{userId}` setting, e.g. Sam@…) |
| Subject | `Jurys Inn & Leonardo Hotels UK & Ire St Paul's M & E - Inv 3255 - w/c 12/10/26 - (15th, 17th October) - 52453465` |
| Body | Rich text (B / I / U). See §5 |
| Attachments | Checkboxes, all ticked: invoice PDF, invoice Excel, the original timesheet file(s) ("Leonardo St Paul's Time w-c 12-10-26 M+E (15th + 17th Oct).pdf (1856 KB)"). Plus "Attach files from your computer" |
| Other | **Save template** — "Your wording and signature are saved as the default for every invoice. The greeting and the bold invoice line fill in automatically for each invoice." Buttons **Cancel** / **Send** |

### 2.6 Clients — `/clients` (screenshot: `clients.jpg`)

- Header "56 clients". Buttons **Export ▾**, **Import from Excel**, **+ Add Client**.
- Search "Search by name, venue, or contact…". Checkbox **Show inactive**.
- **Columns:** Client (sortable, with "Display: …" sub-line when a display name exists), Venue, Contact (name + email), Roles (count), Format ("Named"/"Aggregated"), PO badge, Status ("Active").

### 2.7 Client detail — `/clients/{id}` (screenshot: `clients--id--leonardo-me.jpg`)

Header shows counts, e.g. "31 jobs · 31 invoices · 1217 shifts".

**Client Details form:**

| Field | Notes |
|---|---|
| Client Name * | |
| Display Name | |
| Venue | |
| Venue Address | |
| Contact Name | |
| Contact Email | |
| Invoice CC Emails | Chips |
| Invoice Format | Select: Role Aggregated / Grouped Detail / Named Staff |
| VAT Rate (%) | |
| Payment Terms (days) | |
| PO Required | Checkbox |
| Default Role | "For timesheets without a role column (e.g. scheduling tool format). Must match a role in the rate card below." |
| Excluded Staff | "Non-THC staff names to auto-exclude from timesheets." |
| Date column header | "Invoice column header for the date column. Leave blank for "Date". Use "W/C Date" for Taster / Spud Bros-style weekly invoices." |
| Omit event dates from email subject | "Drop the "(7th to 9th May)" parenthetical from invoice email subject lines. Typically on for Tasters Liverpool, Tasters London, Alltaster." |
| Notes | |

Button **Save Changes**.

- **Rate Card:** **Add Role**. Each role has Charge £ and Pay £. Roles also support `roleAliases` and per-staff `staffOverrides` in the data, though none are in use.
- **Client Status:** "Deactivating will hide this client from active lists. Their data will be preserved." Buttons **Deactivate Client** and **Delete client permanently**.

### 2.8 Settings — `/settings` (screenshots: `settings--*.jpg`; the bank fields in the company-details shot are blacked out)

| Tab | Contents |
|---|---|
| Account | Change Password (above) |
| Users | "3 users", **Add User**. Columns Name, Email, Role, Permissions (chips), Created, Actions (edit) |
| Company Details | "These details appear on all generated invoices." Fields: Company Name, Company Email, Company Website, Registration Number, VAT Number, Bank Name, Account Number, Sort Code, Payment Terms (free text), Default VAT Rate (%). **Save Changes** |
| Invoice Settings | **Next Invoice Number** [3258] **Update** — "Warning: Only change this if you know what you are doing." Table "Recent Invoice Numbers" (Invoice #, Generated) — last 10 |
| Google Integration | "Google integration features (Sheets export, Drive save) will be enabled in a future update. Configure your credentials here to be ready." Fields: Service Account Email, Shift Input Report Sheet ID, Timesheet Tracker Sheet ID, Google Drive Invoices Folder ID, Enable toggle (**Disabled**), **Save Configuration**. All empty |
| Data Management | Database Statistics: Clients 56 active / 57 total, Roles 108, Jobs 314, Shifts 4,230, Invoices 288, Files 396. **Export All Data**. Danger Zone: "Delete all jobs, shifts, invoices, and uploaded files. Client data and settings are preserved." **Clear Test Data** |

Settings keys stored server-side (values not recorded where sensitive):

- `default_uniform` ("Standard"), `default_vat_rate` ("0.20"), `payment_terms`
- `company_name`, `company_email`, `company_website`, `registration_number`, `vat_number`, `bank_name`, `account_number`, `sort_code`
- `next_invoice_number`, `email_body_template`, `last_bcc:{userId}`
- `ocr_provider` ("azure"), `azure_doc_intelligence_endpoint`, `azure_doc_intelligence_key`, `anthropic_api_key`
- `graph_client_id`, `graph_tenant_id`, `graph_client_secret`, `graph_sender_mailbox`

### 2.9 Exports and downloads

| Where | Option | Contents |
|---|---|---|
| Invoice row / detail / step 4 | Download PDF | Invoice PDF (§4) |
| Invoice row / detail / step 4 | Download Excel | One-sheet .xlsx named "Invoice {n}", generated by SheetJS. Static values, no formulas. Same layout and wording as the PDF: header block A1–A3, invoice details A5–B8, client D5–E9, table from row 11 (Date, Role/Staff Name, Start, End, Break, No. of Staff, Hours, Rate (£), Total (£)), totals, Payment Details, late-payment paragraph |
| Invoices list | Export as Excel / Export as CSV | Not run (assumed: current filtered list) |
| Shifts | Export ▾ | Not opened |
| Clients | Export ▾, Import from Excel | Not run |
| Settings ▸ Data Management | Export All Data | Not run |
| Review step | Download (source) | Original uploaded timesheet |

---

## 3. Invoice numbering

- **Format:**
  - A plain global integer: no prefix, padding or year.
  - One series across all clients.
  - It continues an older series, because the first invoice in this system (30 May 2026) is **2946**.
- **Counter:** settings key `next_invoice_number`, currently **3258**. Editable in Settings ▸ Invoice Settings. Individual invoice numbers cannot be edited in the UI.
- **Latest issued:** **3256**, dated 21/10/2026 (generated 21/10/2026 12:40 UTC), Friends of The Earth, not yet sent.
- **Gaps:**
  - The counter is already at 3258, so **3257 was consumed but no invoice exists**.
  - In total 24 numbers are missing between 2946 and 3257: 2955, 2975, 2982–2984, 3002, 3048, 3050, 3059–3060, 3092, 3098, 3124, 3143, 3154–3158, 3189–3191, 3238, 3257.
  - Voided invoices keep their numbers (2962, 2977, 2994, 3111), so the gaps are not voids. They look like failed or abandoned generations, or deleted invoices.
- **Credit notes:** none exist. There is no credit-note feature. Corrections are made with **Void** (number retired) or **Re-generate** (same number, rebuilt from edited shifts).

**Last 20 invoices:**

| # | Invoice date | Client | Amount due | Sent | PO |
|---|---|---|---|---|---|
| 3256 | 21/10/2026 | Friends of The Earth | £206.40 | not sent | – |
| 3255 | 20/10/2026 | Leonardo St Paul's M & E | £4,236.34 | 20/10 | 52453465 |
| 3254 | 20/10/2026 | Leonardo St Paul's – KP | £204.98 | 20/10 | 52454248 |
| 3253 | 20/10/2026 | The Hellenic Centre | £220.60 | 20/10 | – |
| 3252 | 20/10/2026 | LB Hackney – Tomlinson Centre | £485.10 | 20/10 | 2200956260 Tomlinson |
| 3251 | 20/10/2026 | LB Hackney – Abney Park Chapel | £92.40 | 20/10 | 2200946611 Abney |
| 3250 | 20/10/2026 | LB Hackney – Hackney Town Hall | £231.00 | 20/10 | 2200946614 HTH NA |
| 3249 | 20/10/2026 | UGLE – Freemasons Hall | £1,587.30 | 20/10 | – |
| 3248 | 20/10/2026 | Leonardo St Paul's M & E | £5,796.49 | 20/10 | 52378239 |
| 3247 | 20/10/2026 | Rhubarb – Sky Garden | £783.00 | 20/10 | Seven Event |
| 3246 | 20/10/2026 | Rhubarb – Sky Garden | £3,132.00 | 20/10 | Seat Unique |
| 3245 | 19/10/2026 | COMO The Halkin | £1,691.12 | 19/10 | – |
| 3244 | 19/10/2026 | Mandarin Oriental Hyde Park | £2,402.87 | 19/10 | 714981 |
| 3243 | 19/10/2026 | Alltaster Food Limited | £983.10 | 19/10 | SpudForce-W42-2026 Training |
| 3242 | 19/10/2026 | Taster UK SBX (London) | £7,926.83 | 19/10 | SBX-London-W42-2026 |
| 3241 | 19/10/2026 | Taster UK SBX (Liverpool) | £3,702.73 | 19/10 | SBX-Liverpool-W42-2026 |
| 3240 | 13/10/2026 | UGLE – Freemasons Hall | £1,376.40 | 13/10 | – |
| 3239 | 13/10/2026 | AFC Lewisham | £412.80 | not sent | The Community Club |
| *(3238 missing)* | | | | | |
| 3237 | 13/10/2026 | Leonardo St Paul's M & E | £9,133.18 | 13/10 | 52257014 |
| 3236 | 13/10/2026 | The Conduit Club | £570.60 | 13/10 | XXIV Old Buildings Client Party at The Conduit |

- **PO field:** free text. It is often a PO number plus a label, or just an event name when the client has no PO.
- **Unsent invoices (22):** 3256, 3239, 3221, 3220, 3208, 3192, 3188, 3187, 3186, 3185, 3184, 3061, 2991, 2981, 2976, 2964, 2960, 2953, 2951, 2949, 2948, 2947.

---

## 4. Invoice content and PDF

### 4.1 Calculation rules (checked across all 288 invoices)

- **Hours per shift** = (End − Start) − break, to the minute. Overnight shifts are handled.
  - Worked example: 18:30 → 02:00 minus 30 min = **7.00 h**.
  - Weekly-summary sources store hh:mm and convert to decimal hours rounded to 2 dp: 25:14 → 25.23.
- **Line total** = hours × charge rate × no. of staff.
  - Stored **unrounded**: 6.5 × £17.77 = 115.505 is stored as 115.505.
  - Displayed rounded: £115.51.
- **Subtotal** = round(Σ unrounded line totals, 2). Rounding is **per invoice, not per line**.
  - Example 3241: lines sum to 3085.6082 → subtotal **£3,085.61**.
  - The displayed (rounded) lines add up to £3,085.62, so printed lines can be 1p off the printed subtotal. This happened on 13 lines across 9 invoices.
- **VAT** = round(subtotal × 0.20, 2). Example: 3,530.28 × 0.2 = 706.056 → **£706.06**. **Amount due** = subtotal + VAT.
- **VAT rate:**
  - Every client and invoice uses **20%**.
  - The rate is a per-client field (`vatRate`, default from settings `default_vat_rate`), applied to the whole invoice.
  - CUSTOM lines carry their own `vatRate` field (0.2), but no mixed-rate invoice exists.
- **Verified for all invoices:** subtotal = Σ lines (±1p) and VAT = 20% of subtotal. No mismatches found.

### 4.2 Line types

| Kind | Count | How it appears |
|---|---|---|
| `SHIFT` | 2,725 lines | One line per shift: date, role, start, end, break, staff count (always 1), hours, rate, total |
| `CUSTOM` | 4 lines (3 invoices) | Free-text description × qty × unit rate. Examples: "Train Ticket" 1 × £13.90 (3188); "Train Fare" 1 × £18.90 (3061); "Travel Time 2 hours per staff" 6 × £19.95; "Travel receipts (17.60 + 8.30 + 3.10 + 5.30) receipts attached" 1 × £34.30 (3003) |

- **Travel time** also appears as a rate-card *role* for some clients (Cinder "Outward/Return Travel Time", Falloway, Unilever, Ritesh Tiwari "Travel Time"), billed like hours.
- **Overtime, holiday pay, discounts, fixed fees:** none. No such fields, no multipliers, and no examples in the data. Every hour is billed at the role's flat rate.
- **Formats:**

| Format | Clients / use | Columns |
|---|---|---|
| `NAMED_STAFF` | 33 clients | DATE · STAFF NAME · ROLE · START · END · BREAK · HOURS · RATE · TOTAL |
| `ROLE_AGGREGATED` | 22 clients | DATE · ROLE · START · END · BREAK · NO. OF STAFF · HOURS · RATE · TOTAL |
| `GROUPED_DETAIL` | Offered in the client form, used by 0 invoices | — |

  Despite the name, ROLE_AGGREGATED does **not** aggregate. It prints one line per shift with "No. of staff = 1" and just hides the staff names. Across 2,725 lines, `numberOfStaff` is never > 1.
- **Role names on the invoice** come from the timesheet text, e.g. "Food Waiting Staff M&E", "Food Waiting Staff M&E MINUS 2". They are not the rate-card role names; the rate card only supplies the rate.

### 4.3 Three sample invoices

The PDFs were generated live and parsed from the PDF itself. Chrome's PDF viewer can't be screenshotted, so this is an exact text-and-layout extraction rather than an image. **The PDF files themselves are not attached** (see §10 / open questions).

**A. #3255 — Leonardo Hotel St Paul's (M+E), ROLE_AGGREGATED, with PO**

- **Invoice details:**
  - Invoice date 20/10/2026; event 15/10/2026 to 17/10/2026; PO 52453465.
  - To: Ajit Singh, ajit_singh@leonardohotels.com, Leonardo Hotel St Paul's, "Leonardo Hotel St Pauls, 10 Godliman Street, London EC4V 5AJ".
- **28 lines, all at £18.98/h:**

| Date | Role | Start–End | Break | Hours | Lines |
|---|---|---|---|---|---|
| 17/10 | Wine Waiting Staff M&E | 18:30–02:00 | 30 min | 7.00 | ×4 |
| 17/10 | Food Waiting Staff M&E | 19:00–23:00 | – | 4.00 | ×4 |
| 17/10 | TEAM LEAD | 19:00–23:00 | – | 4.00 | ×2 |
| 15/10 | Food Waiting Staff M&E MINUS 1 | 07:00–16:00 | 30 | 8.50 | ×2 |
| 15/10 | Food Waiting Staff M&E MINUS 2 | 08:30–16:00 | 30 | 7.00 | ×4 |
| 15/10 | Cloakroom Staff M&E | 08:30–17:30 | 30 | 8.50 | ×1 |
| 15/10 | Food Waiting Staff M&E | 10:00–21:00 | 30 | 10.50 | ×5 |
| 15/10 | Food Waiting Staff M&E | 10:30–16:00 | – | 5.50 | ×1 |
| 15/10 | Food Waiting Staff M&E | 11:30–16:00 | – | 4.50 | ×1 |
| 15/10 | Food Waiting Staff M&E | 11:30–21:00 | 30 | 9.00 | ×1 |
| 15/10 | Food Waiting Staff M&E | 17:00–21:00 | – | 4.00 | ×4 |

- **Totals:** 186.00 h · Subtotal £3,530.28 · VAT (20%) £706.06 · **TOTAL DUE £4,236.34**.
- **Length:** 2 pages.
- **Due date:** none printed. Terms: "Payable Within 7 Days from Date of Invoice".

**B. #3242 — Taster UK SBX Limited (London), NAMED_STAFF, PO**

- **Invoice details:**
  - Invoice date 19/10/2026; event 12/10/2026 to 18/10/2026; PO SBX-London-W42-2026.
  - To: Boyd Baptist Wahr, boyd@taster.com, Spud Bros Express, Oxford Circus, London, 4 Princes St, London W1B 2LE.
- **Lines:** one line per staff member per week, dated the week-commencing date (12/10/2026).
  - Start/End/Break print "-".
  - Hours are weekly decimal totals (e.g. Afolawe Mobolaji 9.82 h × £17.77 = £174.50).
  - "Shift Leader" lines are at £19.52 (Emily Luxford 27.07 h = £528.41; Suleyman Can Korkut 26.98 h = £526.65).
  - 16 shifts, 366.41 h.
- **Totals:** Subtotal £6,605.69 · VAT £1,321.14 · **£7,926.83**.
- **Column header:** "DATE", even though the form suggests "W/C Date" for Taster (`dateHeaderLabel` is empty).

**C. #3253 — The Hellenic Centre, ROLE_AGGREGATED, no PO**

- **Invoice details:**
  - Invoice date 20/10/2026; event 13/10/2026 to 17/10/2026.
  - **There is no PO row at all.** The label is omitted when the PO is blank.
  - To: Anna Middleton, administration@helleniccentre.org, The Hellenic Centre, 16-18 Paddington St, London W1U 5AS.
- **Lines:**
  - 13/10 Cloakroom Staff 17:00–21:30, 1 staff, 4.50 h × £21.50 = £96.75.
  - 17/10 Cloakroom Staff 17:00–21:03, 4.05 h × £21.50 = £87.08 (to-the-minute billing).
- **Totals:** 8.55 h · Subtotal £183.83 · VAT £36.77 · **£220.60**.
- **Length:** 1 page.

### 4.4 PDF layout (identical template for all invoices)

- **Generator and page:**
  - PDF 1.3. Text is in standard **Helvetica / Helvetica-Bold** (no embedded fonts).
  - Coordinate pattern matches react-pdf / PDFKit.
  - **A4 portrait**, 595 × 842 pt, ~30 pt left/right margins.
- **Top-left:** **logo** image (source 1178 × 364 px, drawn ~120 × 37 pt).
- **Top-right:** "**INVOICE**", Helvetica-Bold 24 pt, #1A1A1A.
- **Company block (left, from y≈70 pt):**
  - "THE HOSPITALITY COMPANY (London) Ltd" — Bold 11, #333.
  - "Company Reg: 12411407", "VAT Reg: 388046760", "info@thehospitalitycompany.co.uk", "www.thehospitalitycompany.co.uk" — Helvetica 8, #555.
- **Two columns at y≈158 pt:**
  - Left "INVOICE TO" and right (x≈308) "INVOICE DETAILS" — Bold 8, #888, caps.
  - Left: client **display name** (Bold 10), contact name, contact email, venue, venue address (Helvetica 9, #333).
  - Right: label/value pairs (labels Helvetica 8 #666; values Helvetica 9 #333 at x≈398): "Invoice Number:", "Invoice Date:", "Event Date:" ("dd/mm/yyyy to dd/mm/yyyy"), "PO Number:".
- **Line table from y≈258 pt:**
  - Header row Bold 7.5, #555, uppercase.
  - Light grey header band (#F3F4F6), zebra rows (#FAFAFA), hairline borders (#E5E5E5 / #D1D5DB).
  - Body Helvetica 8.5, #333. Long roles and names wrap to 2 lines.
  - Final row "**Totals**" with total hours and total £ (Bold 8.5).
- **Right-aligned summary:** "Total Hours:", "Subtotal:", "VAT (20%):" (labels Helvetica 9 #555), then "**TOTAL DUE:**" Bold 11.
- **"Payment Details"** (Bold 10), labels at x 30, values at x 150:
  - Account Name: THE HOSPITALITY COMPANY (London) Ltd
  - Bank: Lloyds Bank
  - Account Number: ••••6660
  - Sort Code: ••-•5-99
  - Payment Terms: Payable Within 7 Days from Date of Invoice
- **Small print** (Helvetica 7, #888): "Invoices exceeding these payment terms will be passed to International Commercial Investigation Services for collection. A £35.00 late payment fee will be automatically added and the invoice will be subject to statutory interest and additional costs, including any costs incurred during the recovery process."
- **Footer centred:** "Thank you for your business" (9, #666), then "THE HOSPITALITY COMPANY (London) Ltd" (7, #999). No page numbers.
- **Not on the PDF:**
  - due date
  - client VAT number
  - client PO-required flag
  - uniform
  - staff IDs
  - line VAT
- **Downloaded filename:** `{Display name, punctuation stripped} - Inv {n} - w-c {event start dd-mm-yyyy} - {PO}.pdf`, e.g. `Jurys Inn Leonardo Hotels UK Ire St Pauls M E - Inv 3255 - w-c 15-10-2026 - 52453465.pdf`. The .xlsx uses the same name.
- **Line order:** not strictly chronological. 3255 prints the 17/10 lines before the 15/10 lines, while the web detail page lists 15/10 first.

---

## 5. Workflow

### Invoice statuses

The database status has only `GENERATED` and `VOID`. The UI filter chips derive two more:

| Shown as | Rule | Count |
|---|---|---|
| Generated | `status = GENERATED` | 284 |
| Sent | `sentAt` is set | 263 |
| Paid | `paidAt` is set. No UI to set it was found | 0 |
| Void | `status = VOID` | 4: 2962, 2977, 2994, 3111 |

**Transitions:**

- Generate (step 4) → **Generated**.
- **Email Invoice → Send** sets `sentAt` and adds a send-history row (sender, recipient). It can be re-sent; "Last sent" shows the latest.
- **Re-generate** rebuilds the PDF/Excel from the current shifts and keeps the number.
- **Void Invoice** → **Void**: shifts unlinked, number retired.
- Any manager can do all of these. There is no approval step.

### Job (timesheet) statuses

`REVIEWING` (21) → `CONFIRMED` (10) → `COMPLETE` (277), plus `ERROR` (6). An upload status presumably exists before REVIEWING.

**ERROR example:** "Could not extract shift data from the document. Azure could not detect table structure or recognise shift patterns in the text. Check the debug file…" (Dough and Deer, Mandarin Oriental, Sabine Bar scans).

### Shift statuses

`EXTRACTED` → `FLAGGED` / `APPROVED` / `REJECTED`. Each shift also stores:

- `confidenceScore` (e.g. 0.8 / 0.4)
- `originalValues` (what OCR read)
- `sourceLocation` (`{type: "pdf-table", page, polygon}`, `{type: "excel", sheet, row}` or `{type: "manual"}`)
- `reviewedBy` / `reviewedAt`
- `weekNumber`, staff pay rate, `staffPayment`

### How an invoice is created

1. **Upload** one or more files (xlsx/xls/csv/PDF/image) and pick a client. The client is optional for Excel, where it can be inferred.
2. **Extract:**
   - Scanned PDFs and images go through **Azure Document Intelligence** OCR (`ocr_provider = azure`), with an **Anthropic (Claude) API key** configured, presumably to interpret rows.
   - Excel files are parsed directly.
   - Rates come from the client's rate card by role (or the client's **Default Role** when the source has no role column).
   - Names in **Excluded Staff** are auto-rejected.
3. **Review:**
   - Compare against the source.
   - Fix cells.
   - Add missing rows (**+ Add Staff Row**).
   - Approve or Reject, or **Approve All Clean**.
4. **Confirm:** split approved shifts into invoice groups, each with its own PO, invoice date, event date range and format. A PO duplicate check runs here.
5. **Generate:** assigns the next number, builds the PDF and Excel, then lets the user Email.

There is no import from another system and no manual "blank invoice" entry. Every invoice comes from a processed timesheet. Expense lines (`CUSTOM`) are added somewhere in the review/confirm flow. I did not see where.

### Approval / sign-off

None inside the app beyond the reviewer approving shifts. The email asks the client to "confirm that this invoice is processed and ready for payment".

### Email

Sent through **Microsoft Graph** as **Gisela@thehospitalitycompany.co.uk** (tenant and app registration configured; IDs not recorded). Recipients and attachments are described in §2.5.

- **Subject pattern:** `{Display name} - Inv {n} - w/c {dd/mm/yy} - ({day list}) - {PO}`.
  - The "(15th, 17th October)" part is dropped for clients with *Omit event dates from email subject* on: both Taster sites and Alltaster.
  - The w/c date appears to come from the timesheet week (12/10/26), while the attachment filename uses the first event date (15-10-2026).
- **Body (saved template, greeting and bold line auto-filled):**

> Hi {first name},
> I hope you are well.
> Please find the staffing invoice attached:
> **{same text as subject}**
> The staff timesheets are attached for your reference.
> I would be grateful if you can please confirm that this invoice is processed and ready for payment.
> Many thanks.
> Best wishes,
> Gisela Duncan · Head Of Finance · gisela@thehospitalitycompany.co.uk · www.thehospitalitycompany.co.uk

### Not present

- Reminders
- Overdue handling or ageing
- Payment recording
- Credit notes
- Statements
- Scheduled sends

The only overdue mechanism is the late-payment wording on the PDF.

---

## 6. Clients, rates and data

### Data model

**Fields that exist per client:**

- name, display name, venue, venue address
- contact name/email, invoice CC emails
- PO required, invoice format, VAT rate, payment terms (days)
- default role, excluded staff, date-header label, omit-dates-in-subject
- active flag, notes
- rate card: role → charge rate / staff pay rate, role aliases, per-staff overrides

**Fields that do not exist:**

- **Client VAT number**
- a billing address separate from the venue address
- overtime or holiday-pay multipliers
- currency (GBP throughout)

### Counts

- **Clients:** 57 total (56 active, 1 inactive, not viewed).
- **Roles:** 108.
- **Jobs:** 314.
- **Shifts:** 4,230; 840 unique staff.
- **Invoices:** 288 (284 live + 4 void).
- **Files:** 396.
- Payment terms are 7 days for every client except **COMO The Halkin (30)** and **Genevieve Brady (1)**.
- VAT is 20% for all.

### Spotlight: the three named clients

**Leonardo Hotel St Paul's (M+E)**

- System name "Jurys Inn & Leonardo Hotels UK & Ire (M&E)"; display "Jurys Inn & Leonardo Hotels UK & Ire St Paul's M & E".
- Address: Leonardo Hotel St Paul's, 10 Godliman Street, London EC4V 5AJ.
- Contact: Ajit Singh, ajit_singh@leonardohotels.com. CC london_ap@leonardohotels.com, ap_queries@leonardohotels.com.
- **PO required:** yes. A new PO every invoice (e.g. 52257014, 52378239, 52453465).
- Format: ROLE_AGGREGATED. Terms 7 days.
- **Rate card (charge / pay), all £18.98 / £12.71:** Bar Staff (ST Paul's M&E) MINUS 1 · Cloakroom Staff · Cloakroom Support Staff · Kitchen Porter · TEAM LEAD · Waiting · Wine Waiting Staff (ST Paul's M&E) - Minus 2.
- **Note on file:** "All roles can be called 'Waiting' on the invoice - the same charge rate and pay rate is used so it is not necessary to separate Wine Staff with Waiting Staff for example".
- **Where hours come from:**
  - The client's **paper timesheets** are scanned to PDF (`PDF_SCANNED`, ~2–3 MB) and uploaded twice a week. File names look like `Leonardo St Paul's Time w-c 12-10-26 M+E (12th to 14th Oct).pdf` and `… (15th + 17th Oct).pdf`, one invoice each.
  - Azure OCR reads the handwritten table: staff name, staff ID, role, date, start, end, break.
  - Staff then check every row against the scan, fix misreads (confidence typically 0.8, some 0.4), and add rows by hand where OCR missed them (`sourceLocation.type = "manual"`).
  - They approve, confirm with the PO from Leonardo, generate and email.
- **Volume:** 31 jobs, 30 live invoices, 1,217 shifts. **£177,590.18** invoiced (7,797 h) since 30 May — the largest client.

**Taster — two client records** ("Liverpool TASTER UK SBX LIMITED (Spud Bros)" / display "Taster UK SBX (Liverpool) Ltd."; "London TASTER UK SBX LIMITED (Spud Bros)" / display "TASTER UK SBX LIMITED (London)")

- **Addresses:**
  - Liverpool: venue "Spud Bros Express Liverpool", billing address "9th Floor, 107 Cheapside, London, EC2V 6DN".
  - London: venue "Spud Bros Express, Oxford Circus, London", 4 Princes St, London W1B 2LE.
- Contact: Boyd Baptist Wahr, boyd@taster.com. CC thomas.shaw@taster.com, bills@taster.com, ashley-marie.frank@taster.com.
- **PO required:** yes, using THC-built references `SBX-London-W{ISO week}-{year}` and `SBX-Liverpool-W{week}-{year}`.
- Format NAMED_STAFF. Default role "Service Staff". Omit-dates-in-subject on. Terms 7 days.
- **Rates (charge / pay):** Service Staff £17.77 / £12.75 · Shift Leader £19.52 / £14.00.
- **Excluded staff:** Liverpool "Ingrid"; London "Max Mackintosh", "Alfie Thompson", "Luke Preston-Davies".
- **Notes list who the shift leaders are:** Liverpool — Fae Gallagher, Christopher Meadows, Daisy Marsden. London — Emily Luxford. That role appears to be set by hand during review.
- **Where hours come from:**
  - Taster's **own scheduling system export** (.xlsx), e.g. `WC 12.10.26 Oxford Circus.xlsx`, `Taster Time WC 28.9.26 LIVERPOOL.xlsx`.
  - The workbook has an "All Employees" sheet plus one sheet per employee. Columns: First name, Last name (with ID in brackets), Total work hours, Total paid breaks, Total paid hours, Regular, Digital Hours, Regular, Total overtime, Overtime, Total unpaid breaks, Total paid time off hours, Total unpaid time off hours, Total pay GBP, Worked days, 15 minute break, Mobile phone, Start date, End date.
  - Hours are weekly hh:mm totals, converted to decimals. One invoice line per person per week. No start/end times.
  - Done weekly, on Monday for the previous week.
- **Volume (since 30 May):**
  - London: 23 invoices, **£176,837.84**, 8,160 h.
  - Liverpool: 21 invoices, **£84,865.00**, 3,771 h.

**All Taster** ("Alltaster Food Limited")

- No venue. Billing address 9th Floor 107 Cheapside, London, EC2V 6DN.
- Contact: Boyd Baptist Wahr, bills@taster.com. CC boyd@, thomas.shaw@, afl.invoices@, ashley-marie.frank@taster.com.
- **PO required:** no, though PO refs are used anyway (`SpudForce-W42-2026 Training`).
- Format NAMED_STAFF. Omit-dates-in-subject on. Terms 7 days.
- **Rates:** Kitchen Porter £17.77 / £12.71 · Shift Lead £19.52 / £14.00.
- **Where hours come from:** the same Taster export format, filtered to "Spud Force" training staff (e.g. `Alltaster WC 12.10.26 Spud Force.xlsx`, one sheet per person). Some files are named "… for AI.xlsx", which suggests staff re-key or trim the file before upload.
- **Volume:** 13 invoices, **£14,043.19**, 600 h.

### Full client list (56 active)

Charge / pay rates are per hour. "PO" = PO required. Terms are 7 days unless stated. All clients are VAT 20%, and none has a VAT number on file.

| Client (display name if different) | Billing / venue address | Contact · invoice CCs | PO | Format | Rate card (charge/pay) |
|---|---|---|---|---|---|
| AFC Lewisham | 24 Mountsfield Court, Hither Green Lane, London (SE13 6RR) | Tapiwa Mashanga, tmashanga@icloud.com | – | Named | Waiting / Wine Staff 21.50/12.71 |
| Albine Mombanza | Regency Banqueting Suite, 113 Bruce Grove, London N17 6UR | amombanza12@hotmail.co.uk | – | Named | Waiting Staff 18.50/12.71 |
| Alltaster Food Limited | see above | | – | Named | KP 17.77/12.71; Shift Lead 19.52/14 |
| Barnaby Graff | Purley Place Apartment 1, London | barnabygraff1@gmail.com | – | Named | Bar Staff, Wine/Waiting Staff 21.50/12.71 |
| Bridging Connections &Events | 122 Kensington Park Road, London W11 2EP | Martine Bridge, mbridge@bridginglondon.com | – | Named | Wine/Waiting Staff 21.50/12.71 |
| COMO The Halkin, London | 5-6 Halkin Street, Belgravia, London SW1X 7DJ | Andras Frisch, andras.frisch@comohotels.com · accounts.halkin@comohotels.com | – | Aggregated · **30 days** | Waiting 18.98/12.71 (note: any role on the signed timesheet can be named "Wait…" — note truncated) |
| Cherish Monaghan | 10 Navarino Road, London E8 1AD | cherishmonaghan@gmail.com | – | Named | Bar Staff, Waiting/Wine Staff 21.50/12.71 |
| Cinder - St John's Wood | Gower House, Woodlands Ride, Ascot, SL5 9HN | Ruby, hello@cinderrestaurant.co.uk | – | Named | FOH Staff, Outward Travel Time, Return Travel Time 19.95/12.71 |
| Doug Pendse | 15 Long Park, Amersham, HP6 5LA | mail@dougpendse.com · annloupendse@bedrock-health.com | – | Named | Waiting - Bar Staff 19.95/12.71 |
| Dough and Deer | Various Venues | James Szymik, james@doughanddeer.co.uk · info@ | – | Aggregated | BOH, Waiting 21.50/12.71 |
| Easy Gourmet Catering | Wilton's Music Hall, 1 Graces Alley, London E1 8JB | Evie McLean, info@easygourmetcatering.co.uk | – | Named | Porter 21.50/12.71 |
| Edmund Ovington | 89 Wimbledon Park Side, London SW19 5LR | eovington66@gmail.com | – | Named | Host / Meet & Greet 25/12.71; Waiting Wine Staff 21.50/12.71 |
| Falloway Ltd | Ashtree Farm, Teston Rd, Offham, West Malling ME19 5RL | Fraser Souter, fraser@falloway.co.uk | – | Named | Travel Time, Waiting Staff 21.50/12.71 |
| Fintern Limited T/A Abound | Commodity Quay, St. Katharine Docks, London E1W 1AZ | Zelina Rebeiro, zelina.rebeiro@fintern.ai | – | Named | Waiting - Bar Staff 19.95/12.71 |
| Friends of The Earth | 27 Goswell Rd London (venue "Leigh Day Solicitors,") | Anna Musgrave, Anna.Musgrave@foe.co.uk | – | Named | Waiting / Wine Staff 21.50/12.71 |
| Genevieve Brady | 8 Vancouver Road, London SE23 2AF | genevievebrady@hotmail.co.uk | – | Named · **1 day** | Bar, Waiting 18.98/12.71; Event Manager 29.50/15 |
| Ice Pig Ltd - TA Skuna (Skuna) | Off Hertsmere Rd, Canary Wharf, London E14 4AL | Lorcan Fahey, lorcan@skunaboats.com · finance@ | – | Aggregated | Waiting 21.50/12.71 |
| Inderaj Sehmi | 4 Braemar Avenue, CR2 0QA | inderajsingh@googlemail.com | – | Named | Bar Staff 21.50/12.71 |
| Ionian Gold | 72 Golborne road, London W10 5PS | Nicholas Dellaportas, nicholas@ioniangold.com | – | Named | Bar Staff 19/12.71 |
| Jurys Inn & Leonardo… (KP) (…St Paul's - KP) | 10 Godliman Street, London EC4V 5AJ | Ramneek Singh Chugh, Ramneek_Chugh@leonardohotels.com · london_ap@, ap_queries@ | PO | Named | Kitchen Porter 18.98/12.71 |
| Jurys Inn & Leonardo… (M&E) | see above | | PO | Aggregated | 7 roles @ 18.98/12.71 |
| Jurys Inn & Leonardo… (City) | 8-14 Cooper's Row, London EC3N 2BQ | Rishabh Kumar Singh · AP_Queries@, london_ap@, Jake_O'riley@leonardohotels.com | PO | Aggregated | KP 18.98/12.71 |
| Jurys Inn & Leonardo… - Sabine Bar (Leonardo St Paul's - Sabine Bar) | Leonardo Royal Hotel London St Paul's | Otto Boglary · AP_Queries@jurysinns.com, london_ap@ | – | Named | Bar Back, Food Prep, Glass Collector, Waiting 18.98/12.71 |
| Karma Sanctum Soho Hotel | 20 Warwick Street Soho London W1B 5NF | Gabriela Titiu · greg@conceptvenues.com, sherene@, mf@sanctumhotels.com | – | Named | Floor Supervisor/Head Waiter 23.98; Housekeeping 21.50; Receptionist 25.98 (pay 12.71) |
| Komodo Media Limited | Duck & Dry Mayfair, 33 North Audley Street, London W1K 6ZQ | Caitlin Emerson, caitlin@wearekomodo.com | – | Named | Bar Staff 21.50/12.71 |
| LB of Hackney - Abney Park Chapel | Abney Park, Stoke Newington High St, London N16 0LH | Stefano Del Core · invoices@hackney.gov.uk | PO (2200946611) | Named | Bar, Waiting 19.25/12.71 |
| LB of Hackney - Clissold House | Stoke Newington Church St, London N16 9HJ | as above | PO (2200946613) | Aggregated | 19.25/12.71 |
| LB of Hackney - Glass House | Springfield, London E5 9EF | as above | PO (2200946616) | Aggregated | 19.25/12.71 |
| LB of Hackney - Hackney Town Hall | Mare Street, London E8 1EA | as above | PO (2200946614) | Aggregated | 19.25/12.71 |
| LB of Hackney - Tomlinson Centre | Queensbridge Rd, E8 3ND | as above | PO | Named | 19.25/12.71 |
| League of Arab States - London Office | 106 Gloucester Place, London W1U 6HU | manalsami.arableague@gmail.com | – | Named | Waiting Staff 21.50/12.71 |
| Leonardo Hotel London Aldgate | 9 Aldgate High Street, London EC3N 1AH | Vishant Malpotra · AP_Queries@jurysinns.com, london_ap@ | PO | Aggregated | Deep Cleaner 45/25 |
| Liverpool TASTER… / London TASTER… | see above | | PO | Named | Service Staff 17.77/12.75; Shift Leader 19.52/14 |
| Mandarin Oriental Hotel Group (Mandarin Oriental Hyde Park) | 66 Knightsbridge, London SW1X 7LA | Paul Jordan, pjordan@mohg.com · mboneva@, MOLON.Supplierinvoice@mohgapac.docmx.net, molonfinance@, glatino@, dhanslip@, iarischina@mohg.com | – | Named | Bar, Cloakroom, Waiting, Wine 18.98/12.71 |
| Maria Terzini | 405 Fulham Road, SW10 9TU | mariaterzini11@gmail.com | – | Named | Bar 21.50/12.71 |
| NYX Hotel London Holborn | 50-60 Southampton Row, London WC1B 4AR | Roshan Costa · AP_Queries@, london_ap@leonardohotels.com | PO | Aggregated | Breakfast Chef, KP 18.98/12.71 |
| Nicholas Fletcher | Brockwell Hall, London SE24 | nfletc01@gmail.com | – | Named | Bar 18.95/12.71 |
| Nigel Williams | St Oswald's Church hall, Thornton Heath SW16 3SB | nwwilliams7@gmail.com | – | Named | Waiting 21.50/12.71 |
| Olivers Travels | Unit 1.01, Chester House, 1-3 Brixton Road, London SW9 6DE | Kobe Luke, kobe@oliverstravels.com | – | Named | Waiting/Bar 21.50/12.71 |
| Patch Events Limited | 58-60 Carter Lane, London EC4V 5EA | Lara Theiss-Buchanan · hello@patch-events.co.uk | – | Aggregated | Bar 21.50/12.71 |
| Paul Nery | 40 Calonne road Wimbledon Village SW19 5HJ | Pauln182@gmail.com | – | Named | Waiting 21.50/12.71 |
| Peri Peri T/A Armchair Leisure Limited | 21 Hereward Mount, Stock, Ingatestone CM4 9PS | Adam Curtis, adam@periperi.co.uk | – | Aggregated | Event Manager 35/15 |
| Rhubarb Food Design Limited - Sky Garden | 5-25 Burr Road, London SW18 4SQ (venue Sky Garden) | Bartosz Matlak · Invoices.EMEA@oakviewgroup.com, supplier.query@oakviewgroup.com | PO | Aggregated | BOH Aid, Lifting and Shifting, Porter, Shift & Lift 21.75/12.71 |
| Richard Miers Garden Design | Parsons Green Lane | Cristina Walshe-Garcia | – | Aggregated | Waiting / Drinks 18.95/12.71 |
| Ritesh Tiwari | Brookland Cavendish Road, Weybridge KT13 0JW | Manisha Tiwari, ritesh_tiwari@hotmail.com | – | Named | Travel Time, Waiting 21.50/12.71 |
| Table4Thirteen | Flat 105 Wallbrook Gardens, 58 Heartwell Avenue, London E16 1RU | Barbara Ahonsi | – | Named | Waiting / Wine 21.50/12.71 |
| The Conduit Club Limited | 6 Langley Street, Covent Garden, London WC2H 9JA | Meljo Cheriyan · dinaingram@, carolinecestari@theconduit.com | – | Named | Cloakroom 21.50; Lifting and Shifting 23.50 (pay 12.71) |
| The Hellenic Centre | 16-18 Paddington St, London W1U 5AS | Anna Middleton, administration@helleniccentre.org | – | Aggregated | Bar, Cloakroom, Runners, Waiting 21.50; On-site Delivery Support, Registration Assistant, Team Leader 23.98; Receptionist 25.98; Supervisor 35/21.71 |
| The Hive Stadium Ltd | Barnet FC, The Hive, Camrose Avenue, London HA8 6AG | Paul Marneros · purchaseinvoices@thehivelondon.com | PO | Aggregated | Bar/Waiting, Grill Chef, Ticketing 18.98/12.71 |
| UGLE Trading Company Ltd - The Goose and Gridiron | 60 Great Queen Street, London WC2B 5AZ | Cassandra Crowe · fmhdining@freemasonshall.com, finance@ugle.org.uk | PO | Aggregated | Bar Staff, Barista 18.50/12.71 |
| Unilever UK & Ireland | 26 Oaken Lane, Claygate, Esher | Cherie Hagar | – | Named | Travel Time, Waiting 19/12.71 |
| United Grand Lodge of England (UGLE) - Freemasons Hall | 60 Great Queen Street, London WC2B 5AZ | Patricia Radulescu · fmhdining@, finance@ugle.org.uk | PO | Aggregated | Waiting 18.50/12.71 |
| VCCP GROUP LLP | 66 Berners Street, W1T 3NL | Ada Mary Bahmukom | – | Named | Waiting 21.50/12.71 |
| Young Local Artists Cic | The Royal Geographical Society, 1 Kensington Gore, London SW7 2AR | Alison Jackson | – | Named | Waiting 21.50/12.71 |
| Yuxuan Peng | 26 Barrett Street, London W1U 1BG | Tina Peng, tina@houseofpeng.com | – | Named | Reception Host, Waiting 21.50/12.71 |

### Invoices per month (non-void; the system's first invoice is 30 May 2026)

| Month | Invoices | Value (inc. VAT) | Voided |
|---|---|---|---|
| May 2026 (30–31 only) | 7 | £24,845.32 | 0 |
| Jun 2026 | 44 | £141,239.32 | 3 |
| Jul 2026 | 54 | £108,596.61 | 0 |
| Aug 2026 | 55 | £81,317.48 | 1 |
| Sep 2026 | 82 | £150,504.30 | 0 |
| Oct 2026 (to 21st) | 42 | £81,539.65 | 0 |
| **Total** | **284** | **£588,042.68** | 4 |

### Value per client, 30 May – 21 Oct 2026 (inc. VAT, non-void)

| Client | Invoices | Value | Hours |
|---|---|---|---|
| Leonardo St Paul's (M&E) | 30 | £177,590.18 | 7,797.25 |
| Taster London | 23 | £176,837.84 | 8,159.62 |
| Taster Liverpool | 21 | £84,865.00 | 3,771.45 |
| Rhubarb – Sky Garden | 27 | £39,808.35 | 1,525.22 |
| Mandarin Oriental Hyde Park | 16 | £20,407.28 | 896.00 |
| UGLE – Freemasons Hall | 11 | £16,133.86 | 726.75 |
| Alltaster | 13 | £14,043.19 | 600.06 |
| Leonardo – Sabine Bar | 24 | £14,030.21 | 616.01 |
| COMO The Halkin | 15 | £8,820.02 | 387.25 |
| Leonardo St Paul's – KP | 11 | £6,308.94 | 277.00 |
| NYX Holborn | 14 | £5,824.96 | 255.75 |
| LBH Tomlinson / Abney / Town Hall / Clissold | 8 / 14 / 7 / 5 | £4,134.90 / £2,159.86 / £1,778.70 / £485.10 | |
| The Hellenic Centre | 4 | £1,691.20 | 65.55 |
| Genevieve Brady | 1 | £1,354.78 | |
| The Conduit Club | 3 | £1,125.00 | |
| UGLE Trading (Goose & Gridiron) | 2 | £1,102.68 | |
| Karma Sanctum Soho | 3 | £1,001.52 | |
| 30 other clients | 1–3 each | £103.20 – £637.73 each | |

---

## 7. Xero and other integrations

**Xero: no connection found.**

- No Xero settings tab, button, status, account code, tax-rate mapping, tracking category or item code anywhere in the UI.
- No Xero route in the front-end bundle.
- No Xero keys in settings.
- Invoices have no external/Xero ID field.
- **How invoices reach Xero today could not be determined from this app.** The likely options are manual re-keying or CSV import from the Invoices ▸ Export CSV. This needs a question (see the end).

**Other integrations:**

| Integration | Use | State |
|---|---|---|
| Microsoft Graph (Microsoft 365) | Sends invoice emails from Gisela@thehospitalitycompany.co.uk | Live |
| Azure AI Document Intelligence (`northern-codes.cognitiveservices.azure.com`) | OCR of scanned/PDF/image timesheets | Live. Endpoint is on the developer's (Northern Codes) Azure tenant |
| Anthropic API | AI extraction/interpretation (key configured) | Live (inferred) |
| Google Sheets / Drive | "Shift Input Report", "Timesheet Tracker", Drive invoices folder | **Disabled**, all fields blank. `googleDriveUrl` on invoices is always null |
| Payment links / card payments | — | None |
| File storage | Uploaded timesheets stored server-side (`storedFilename` like `1792512659579_Leonardo_St_Paul_s_Time…pdf`). PDF/Excel blobs stored on the invoice row (`pdfData`, `excelData`) | — |

---

## 8. Reports and dashboard

| Report / tile | Definition | Filters | Example |
|---|---|---|---|
| Dashboard: This Week's Jobs | Jobs uploaded since Monday | This Week / This Month toggle | 16 |
| Dashboard: Invoices Generated | Invoices with invoice date ≥ Monday | same | 16 |
| Dashboard: Total Invoiced | Σ amount due (inc. VAT) of those | same | £33,682.26 |
| Dashboard: Needs Review | Jobs in REVIEWING (link goes to flagged/extracted shifts) | — | 21 |
| Invoices KPI strip | Count, Σ amount due, Σ hours, average amount due | Client, dates, quick ranges, search, status chips | 284 · £588,042.68 · 25,951.41 h · £2,070.57 |
| Invoices ▸ Weekly Summary | Per ISO week of invoice date: count, hours, total, average | Same | Week 42: 14 invoices · 1193.61 h · £27,073.33 · £1,933.81 |
| Invoices ▸ Monthly Summary | Same per month | Same | Oct 2026: 42 invoices · £81,539.65 (my calc) |
| Shifts KPI strip | Shifts, Hours, Total Charge, Total Pay, Margin (Charge − Pay), Unique Staff, Invoiced (x of y) | Client, dates, staff, week #, status | 4,230 · 43,479.82 h · £576,937.16 · £395,590.14 · £181,347.02 · 840 · 2,684 of 4,230 |
| Settings ▸ Data Management | Row counts | — | see §2.8 |

---

## 9. Branding and technical notes

**Branding:**

- Company: **THE HOSPITALITY COMPANY (London) Ltd**. Company Reg 12411407. VAT Reg 388046760. info@thehospitalitycompany.co.uk, www.thehospitalitycompany.co.uk.
- Logo: `/thc-logo.svg`. The PDF embeds a raster version (1178 × 364 px). Two champagne flutes plus the wordmark "THE HOSPITALITY COMPANY". Shown white on the dark sidebar.
- **App UI:**
  - Font **Geist** (with Geist Mono) on a near-white background `#F8FAFC`.
  - Dark navy sidebar.
  - Primary buttons blue (Tailwind blue-600-ish).
  - Email button green (emerald).
  - Status pills: green "Generated", blue "Named", grey "Aggregated".
  - Lucide icons.
- **PDF:** Helvetica / Helvetica-Bold, greys #1A1A1A / #333 / #555 / #666 / #888 / #999, table band #F3F4F6, zebra #FAFAFA. The PDF has no brand colour, only greyscale.

**Technology:**

- Next.js (App Router, Turbopack chunks `/_next/static/chunks/…`), Tailwind, `lang="en-GB"`.
- NextAuth.
- IDs are cuid (`cmv…`), consistent with Prisma.
- PDFs generated with react-pdf/PDFKit; Excel with SheetJS.
- Built and maintained by **Northern Codes** (eric@northerncodes.com).
- No public API docs or webhooks found.
- The JSON API is session-cookie authenticated and returns full objects. One example is staff pay rates on every shift and client.

---

## 10. Gaps, risks, oddities

**Risks**

1. **Settings API exposes too much.** `/api/settings` returns full bank details and masked-but-partial API keys (last 4 characters visible) to any logged-in user. Graph/Azure/Anthropic secrets are stored in the app's settings table.
2. **"Clear Test Data" is live in production.** It deletes all jobs, shifts, invoices and files, and any manager can press it. "Delete client permanently" is also available.
3. **Everyone is a full manager**, including the external developer. There is no read-only or finance-only role, and no audit trail beyond invoice send history.
4. **OCR depends on the developer's Azure resource** (`northern-codes.cognitiveservices.azure.com`), not THC's.

**Data and logic oddities**

5. **Invoice number gaps:** 24 missing numbers, including 3257 (the counter is at 3258 but the last invoice is 3256). There are no deletion records to explain them.
6. **"Role Aggregated" doesn't aggregate.** It is one line per shift with staff count always 1. "Grouped Detail" exists but is never used.
7. **Rounding:**
   - Line totals are stored to 3 dp.
   - The subtotal is rounded at invoice level, so printed lines can differ from the printed subtotal by 1p (13 lines, 9 invoices).
   - Billing is to the minute (4.05 h).
8. **Payment terms:**
   - The PDF terms text comes from one global setting ("Payable Within 7 Days…").
   - Per-client `paymentTermsDays` (COMO 30, Genevieve Brady 1) doesn't appear to change it (not verified on a COMO PDF).
   - No due date is printed or stored.
9. **"Paid" exists as a filter and field (`paidAt`) but is never set.** There is no way to record payment, and no reminders, overdue handling or credit notes.
10. **Status is ambiguous.** The Status column always shows "Generated", even for sent invoices. Sent is only visible via "Last sent".
11. **Dashboard "Needs Review" (21)** counts REVIEWING jobs but links to a shift-status filter.
12. **Stale jobs and duplicate uploads:**
    - 21 jobs sit in REVIEWING, some since 1 June, often duplicate uploads of the same file (e.g. two "Alltaster Spud Force WC 10.8.26.xlsx", four "Rhubarb … HSBC Conference" jobs).
    - 10 jobs are stuck at CONFIRMED although invoices were generated (e.g. 3237).
    - 6 jobs are in ERROR from OCR failures.
13. **Shift data quality:**
    - Junk rows ("ARRIVED", "27/08/25-", names with stray quotes).
    - Rows with no hours or rates.
    - Most shifts have `date = null` and rely on `eventDate`, so sorting by Date puts blanks first.
    - The same person appears under name variants ("Abdul Hadi", "Abdul-Hadi", "Abdul Hadi Leo's Balcony").
14. **Taster date header:**
    - Client help text says to use "W/C Date" for Taster, but `dateHeaderLabel` is empty on both Taster clients, so their PDFs say "DATE" while the date is a week-commencing date.
    - The Alltaster Shift Lead role name ("Shift Lead") differs from Taster's "Shift Leader".
15. **Email and filename dates disagree.** The subject uses the w/c of the timesheet (12/10/26) while the attachment filename uses the first event date (w-c 15-10-2026).
16. **Shift-leader roles are kept in free-text notes** ("Shift Leaders are: …"), not data, so a reviewer must remember to change the role.
17. **Hand-keyed files:** filenames ending "for AI.xlsx" suggest staff re-key or clean source files before uploading.
18. **Unused fields:** the "Uniform" field is "N/A" on every invoice (default "Standard") and is not printed.
19. **Empty previews:** Invoice Preview on both the detail page and step 4 renders an empty panel.
20. **PDF line order** is not chronological and differs from the web view.
21. **Counter mismatch:** Settings ▸ Data Management shows 288 invoices (incl. void) while the nav badge shows 284.
22. **Inactive client:** 1 inactive client exists and was not viewed.

**Could not access / not done**

- Did not view the login page (to avoid signing out), the Confirm step live, Monthly Summary, the Shifts or Clients Export menus, the Add/Edit forms, or the inactive client.
- Could not visually render the PDFs. Chrome's PDF viewer can't be captured, so the PDFs were parsed for exact text, fonts, colours and positions instead.
- **The PDF files are not attached.** They could not be moved from the browser into this workspace. Navigating to the 3255 PDF URL opened it in Chrome's viewer on your machine.
- The browser extension stopped responding at the end of the session, so one last check of `/api/auth/providers` (login methods) was not completed.

---

## Attachments

All screenshots are in `attachments/`, named by URL path:

`dashboard.jpg`, `process--upload.jpg`, `process--id--step2-review-taster-liverpool.jpg`, `process--id--step4-generated.jpg`, `process--id--preview-empty.jpg`, `shifts.jpg`, `invoices--all.jpg`, `invoices--export-menu.jpg`, `invoices--weekly-summary.jpg`, `invoices--id--detail-3255.jpg`, `invoices--id--detail-3255-lineitems.jpg`, `invoices--id--email-modal.jpg`, `clients.jpg`, `clients--id--leonardo-me.jpg`, `settings--account.jpg`, `settings--users.jpg`, `settings--company-details-REDACTED.jpg` (account number and sort code blacked out), `settings--invoice-settings.jpg`, `settings--google-integration.jpg`, `settings--data-management.jpg`.

**Sample PDFs:** not attached (see §10). To get them, download from `/api/invoices/{id}/pdf` for:

- 3255 — `cmvgwlihn00hl01mepxuxaijy`
- 3242 — `cmvfey32a001801me4iusdli3`
- 3253 — `cmvgu0t4k00g901meeaekyw8b`

---

## Things I could not determine

| # | Unknown | Question that would resolve it |
|---|---|---|
| 1 | How invoices get into Xero today | "After an invoice is emailed, who puts it into Xero, and how — typed in, CSV import from the Invoices export, or something else? Which Xero org, account code, tax rate and tracking categories do you use?" |
| 2 | Login methods (SSO / 2FA / reset) | "Do users sign in only with email + password? Is there a forgot-password flow or 2FA?" (Eric at Northern Codes can confirm) |
| 3 | Why 24 invoice numbers are missing (incl. 3257) | "Were invoices 2955, 2975, 2982–84, 3002, 3048, 3050, 3059–60, 3092, 3098, 3124, 3143, 3154–58, 3189–91, 3238 and 3257 deleted, or did generation fail? Does your accountant need a gap-free sequence?" |
| 4 | What number the new system should continue from | "Should the new system start at 3258 (current counter) or 3257? Any prefix/year wanted?" |
| 5 | Payment tracking | "How do you mark invoices paid today — only in Xero/bank? Do you need paid/overdue status and reminders in the new system?" |
| 6 | Whether COMO's 30-day terms are honoured on its PDF | "Do COMO invoices show 30-day terms? Should terms text and a due date be per client?" |
| 7 | Credit notes / corrections | "When an invoice is wrong after sending, do you void and re-issue (new number), re-generate (same number), or raise a credit note in Xero?" |
| 8 | Overtime / holiday pay / minimum-hours rules | "Do any clients pay overtime, bank-holiday or holiday-pay uplifts, or minimum call-out hours? Today everything is a flat rate." |
| 9 | Leonardo M+E paper process details | "Who scans the M+E sheets, how often, and where does the PO come from (emailed by Ajit before or after the week)? Can the PO arrive after the invoice is drafted?" |
| 10 | Taster export source | "Which rota/time system produces the Taster 'All Employees' export, and who edits it before upload ('for AI' files)? How are shift leaders identified each week?" |
| 11 | Expense / CUSTOM lines entry point | "Where in the flow do you add train fares or travel receipts — review screen or confirm screen?" |
| 12 | Client VAT numbers / billing addresses | "Do any clients need their VAT number or a separate billing address on the invoice (e.g. Taster bills to Cheapside but the venue is Liverpool)?" |
| 13 | Inactive client and Grouped Detail format | "Which client is inactive, and is the 'Grouped Detail' format wanted at all?" |
| 14 | Exports used downstream | "Do you use the Invoices CSV/Excel export, Shifts export or 'Export All Data' for payroll or accounts? What columns matter?" |
| 15 | Staff pay data | "Is staff pay (and margin) needed in the new system, and who may see it?" |
| 16 | Sample PDFs as files | "Please download 3255, 3242 and 3253 PDFs from the links above and add them to `attachments/`." |
