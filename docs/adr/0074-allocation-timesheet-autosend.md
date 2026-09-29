# ADR-0074 · The Allocation Timesheet and the Completed Allocation Timesheet: new names, automatic sending, THC's alcohol-policy column

**Status:** Accepted (THC, 29.09.2026). Agreed deviations from scope v1.6 §11.3 and §11.4. The manual Send and Download buttons stay exactly as §11.4 describes them.

## Context

§11.3 defines one PDF per event, in two states. The *allocation sheet* is the blank form sent before the event. The *sign-out timesheet* is the same form filled from check-in and check-out after the event. §11.4 has a manager send each state from the event page. Until now nothing sent them automatically: if nobody pressed Send, the client got nothing.

On 29.09.2026 THC asked for four changes:

1. new names in the product;
2. both emails to go out automatically;
3. their paper form's alcohol-policy column on the PDF;
4. a fix for the printed page size. A short sheet came out as a strip, not an A4 page.

## Decision

### 1 · Names

| State (code) | In the product | Office buttons | Client Portal |
| --- | --- | --- | --- |
| `allocation` | **Allocation Timesheet** | Send Allocation Timesheet · Download Allocation Timesheet | ↓ Download Allocation Timesheet |
| `signout` | **Completed Allocation Timesheet** | Send Completed Timesheet · Download Completed Timesheet | ↓ Download Completed Timesheet · "Completed Timesheet ready" |

This replaces the scope's literal wording for the documents: §11.1's row button "Allocation sheet / Signed timesheet" and §11.2's "↓ Download Allocation Sheet" / "↓ Download Signed Timesheet" now read **Allocation Timesheet** / **Completed Timesheet**, by THC's decision. The Client Portal's tabs (Upcoming · Past · All, §11.1) keep the scope's words; only the document names change.

The words "sign-out timesheet" no longer appear anywhere a client can see them. `signout` stays as the name in the code, the database and the storage paths. The PDF's own header still reads **STAFF ALLOCATION**, because that is THC's paper form. `DOCUMENT_NAME` in `packages/pdf/src/sheet.ts` holds both names. The D1/D2 payload carries the name as `documentName`.

### 2 · Automatic sending

A Back Office job, `POST /api/jobs/event-documents`, runs every 15 minutes (`job_schedules` row `event-documents`). The times are UK wall-clock times, so the rules are written in Europe/London time and hold through the clock changes.

**D1 · Allocation Timesheet.** It goes **the day before the event at 14:00**. That is after the 12:00 "I'm ready" deadline and the 12:05 release, so the line-up is firm.

- **Late events:** an event created or filled after 14:00 still gets it on the next run, as long as its first shift has not started.
- **Skip:** if a manager queued a D1 for the event at or after 00:00 UK on the day before, the job does not send one. The client already has a fresh copy.

**D2 · Completed Allocation Timesheet.** It goes **the morning after the event day at 10:00**. It never goes before the last shift's end + 4 hours, when the last check-out window closes.

- **Held:** while any worker's Finish Time and Hours Worked would print blank — an unresolved No check-out (RULE-02) — the job does not send it. A blank the manager can still fix is never sent.
- **Released:** it goes on the first run after the last one is resolved.
- **Given up:** the job stops trying 14 days after the morning it was due. The button still works after that.
- **Skip:** if a D2 was queued after the event ended.

**Both kinds** are also skipped when:

- the event is cancelled (§3.3: a cancelled event has no document at all);
- nobody is confirmed;
- the client card has no contact emails.

A skip is recorded as a reason in the run's counts (`job_runs.counts.verdicts`) and in the log, never as an error. Each event gets **at most one** automatic send of each kind. Three things hold that:

- the primary key of `event_document_autosends (event_id, kind)`;
- a claim with a 10-minute lease, so two overlapping runs cannot both draw the PDF;
- the outbox key `D1:auto:<event>` / `D2:auto:<event>`.

**A manager's Send during a run.** The claim, the automatic queue and the manual `queue_event_document_email()` all take the same transaction-scoped advisory lock for the event and kind. Just before writing its outbox row, the automatic queue takes the verdict again under that lock. If a manager sent the document while the PDF was being drawn (`manual_sent`), or anything else changed, the job stands down: it releases the claim with the reason, writes no outbox row, and answers `queued = false`. The run counts it as `stoodDown`. The client never gets both.

**A retry ceiling.** Each claim counts as an attempt. After **eight** spent claims (a live one is not counted as spent) the verdict is `gave_up`, the claim is refused, and the office sends the document by hand. A Storage or database fault therefore never retries for ever.

**Hardening.** The run passes its own clock (`p_now`) to the claim so that every candidate in one run is judged at the same instant. The claim clamps it to within five minutes of the database clock, so no caller can claim for another time. Recording a copy needs a **live** lease (`lease_until > now()`), so a run whose lease lapsed cannot record over the run that took over. When `RTW_JOB_SECRET` or the service key is missing, both job routes answer a generic `503 {"error":"not_configured"}` and write the detail to the server log only.

**No backfill.** The settings row carries `completed.not_before`, the moment the migration ran. Switching the job on therefore never emails a fortnight of old events that the office had chosen not to send.

**Settings:** `settings.document_autosend` (seeded by `20261002100000`, read on every run):

```json
{"allocation":{"enabled":true,"time":"14:00"},
 "completed":{"enabled":true,"time":"10:00","hold_days":14,"not_before":"<when the migration ran>"}}
```

There is no /settings control for it yet. It can be changed with an `update settings …` in the SQL editor.

**One rule, two implementations.** The rule is pure TypeScript, `autosendVerdict()` in `apps/office/app/api/jobs/event-documents/_lib/schedule.ts`. Its SQL twin is `document_autosend_verdict()`, which checks the same things in the same order. `event_documents_due()` returns every candidate with its facts and the SQL verdict. The route runs the TypeScript verdict over the same facts and sends only where **both** say `due`. A disagreement is counted and logged, and nothing is sent. `schedule.test.ts` and pgTAP 759 hold the same cases, including 13:59 and 14:00, BST and GMT, and both 2026 clock-change weekends.

**Mechanism.** The PDF is drawn by `@react-pdf/renderer`, which the Deno Edge Functions cannot run. So this is a Node route in the Back Office, the same pattern as rtw-check (ADR-0025). Each run:

1. `event_documents_due` finds the candidates;
2. `event_document_autosend_claim` claims one (event, kind);
3. the existing `generateDocument()` draws the PDF from `event_document_data`, with the service-role client and the store required;
4. `record_event_document_autosend` records the copy (`generated_by` null, `event_documents.automatic` true);
5. `queue_event_document_autosend` re-checks the verdict under the lock and queues the email;
6. `event_document_autosend_release` gives the claim back on any failure.

All of these functions are callable by the **service role only**. They are revoked from public, anon and authenticated. The manual path keeps `assert_reports_caller()` and is otherwise unchanged. `queue_event_document_email()` now builds its payload through `event_document_email_payload()`, which keeps every existing key and adds:

- `schedule`: the role sections that have confirmed staff, in sheet order, in UK time, each with its own window (RULE-18). For example: "Chef 07:00 – 15:00 · Waiting Staff 17:00 – 23:30".
- `totalHours` (D2 only): formatted like the PDF's Total Hours. It is empty while any row is still undetermined.
- `documentName`.

**New table.** `event_document_autosends` has admin read only and no client or staff policy (ADR-0026). It carries the office_read_only guard (ADR-0060), and only the functions above write to it. The event page reads it to show "Allocation Timesheet sent automatically 28/09 14:00", or when the automatic send will happen.

### Shared job secret

The new route uses **the same bearer secret as rtw-check**: vault `rtw_job_secret`, and `RTW_JOB_SECRET` on the Back Office Vercel project. It also uses the same vault base, `office_base_url`. It checks the secret with the same constant-time helper, now shared at `apps/office/app/api/jobs/_lib/auth.ts`.

**Why:** both routes are machine-to-machine entry points into the same Back Office deployment. Both are called only by pg_cron, and both hold the service key. A second secret would add an owner step and give no extra isolation: anyone holding one secret already holds what the other protects. The job therefore works on deploy wherever rtw-check's secrets exist. Without them, `install_job_schedules()` skips the row with a notice.

**Cost:** rotating `RTW_JOB_SECRET` rotates both jobs. The name is historical; it is now "the office job secret".

The job is registered **enabled**. As with every schedule, it reaches pg_cron the next time `select install_job_schedules();` is run after deploy (docs/16 §4.7).

### 3 · Alcohol Policy Understood and Agreed

THC's paper form has a last column headed **Alcohol Policy Understood and Agreed**. The PDF now has it too, after Hours Worked. It is blank in both states, because the worker initials it by hand on site.

The Photo column stays, because §11.3 requires it. To fit eight columns on A4 portrait inside the same margins:

- the column widths are 36/130/56/44/72/82/44/75 pt;
- the body text is 8 pt, down from 8.5 pt;
- the headings are 7 pt;
- words are no longer hyphenated;
- an unusually long name is clamped to two lines with an ellipsis, so it cannot run into the row below.

Twelve rows, twelve section headings and the footer still fit on one page. §11.3's pagination is unchanged.

### 4 · Every page is A4

The rendered pages were not A4. `<Page wrap={false}>` makes react-pdf size the page to its content, so a five-row sheet came out at 595 × 388 pt. The page is now wrappable, while rows keep `wrap={false}` so a row is never split. Every page's MediaBox is 595.28 × 841.89 pt. `render.test.ts` parses the MediaBox of every page of every rendered test sheet. It also still asserts the page count, so react-pdf never adds an overflow page of its own.

## Not done

- **No /settings control** for `document_autosend`. It is a SQL edit for now.
- **The email copy for D1/D2** (subject, body, and use of `schedule` / `totalHours`) lives in `packages/notifications` and is a separate change.
- **No per-client opt-out.** Switching the automatic sends off is global: `enabled: false` for each kind.
