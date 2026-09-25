# ADR-0036 · What a GDPR removal scrubs and keeps; worker writes only through RPCs

Status: accepted · 25.09.2026 · WP-E fix round (audit 25.09 D8, D9, D29, D51, D52) ·
20260929140000, 20260929140100, 20260929140200

## 1 · §1.7 removal: every copy of the person, and the history kept

`remove_worker()` (20260929140100) now scrubs, in the same transaction as the
anonymisation, every place the audit found the same person written down:

| Where | What happens |
|---|---|
| `auth.users` | banned (as before); email → `removed-<staff id>@invalid.example`, phone null, `raw_user_meta_data` `{}`, outstanding confirmation / recovery / email-change tokens cleared; sessions, refresh tokens, one-time tokens deleted |
| `auth.identities` | `identity_data` → `{sub, email: <removed address>}` |
| `profiles.full_name` | the deleted-account label |
| `notification_outbox` | matched by recipient, any of the worker's ids in the key (staff, bookings, documents, declarations, applications, quiz attempts, rtw checks), or the staff id / address / NI number in the payload. **Unsent: deleted.** Sent: payload → `{gdprRemoved, label}`, the worker's own address in `recipient_emails` → the removed address (office recipients kept), `error` cleared |
| `audit_log` | rows about the worker (entity is one of their ids, or `data.staffId`) or by them (`actor` = their login) lose `name`, `fullName`, `firstName`, `lastName`, `staffName`, `workerName`, `email`, `phone`, `mobile`, `niNumber`, `shareCode`, `dob`, `dateOfBirth`, `address`, `homeAddress`, `postcode`, `fileName`, `visaType`, `visaExpiry`; `actorName` becomes the label where the worker was the actor. The manager's name and reason stay |
| `location_pings` | deleted for the worker's bookings |
| `check_logs` | `location`, `distance_m` → null; the check-in / check-out **times stay** (pay and timesheets reconcile through them) |
| `staff` | additionally `gender`, `home_postcode`, `home_country`, `applied_age_band`, `rejection_reason`, `rejection_cause`, `home_location_stale` |
| `applications` | additionally `dob` → 1900-01-01 (the column is `not null`; the same sentinel `staff.dob` takes) and `resolution_reason` → null |
| `criminal_declarations` | additionally `review_note` → null (details and date were already cleared) |
| `client_qualifications.note` | null |
| `rtw_checks` | deleted (their report PDFs are queued for the purge by the table's trigger) |
| `onboarding_progress` | already deleted by `onboarding_on_staff_change()` when `removed_at` is set (20260923120000); 630 pins it |

**Kept, deliberately** (§1.7 "keep history rows and already-issued PDFs"):
bookings, breaks, violations and their notes, feedback text verbatim (v1, as
before), `payroll_export_lines` (a payroll export is never corrected
retroactively), issued `event_documents`, the Employee ID, a completion letter
held under ADR-0019, and the `gdpr_remove` audit row itself (which names the
Willo candidate id so the office can ask Willo to delete).

**For THC to decide:** the stored CSVs behind `report_sends` (payroll and new
starter reports carry names, NI numbers, dates of birth and addresses) are
not touched. They are payroll records THC may be obliged to keep; if not, a
later migration can purge the worker's lines.

**D9b.** With the address gone from the login, a removed person who
re-applies with the same email is a new candidate and GoTrue's invite mints a
new login. `provisionStaffLogin()` also refuses to hand a link to a banned
login (`account_link_failed`, detail `login_disabled`), in case one ever
holds an address again.

## 2 · Declarations: the note is internal, the statement is never edited

- `criminal_declarations.review_note` and `reviewed_by` are not selectable by
  `anon` / `authenticated` (§10.1, §10.7). The office reads them through the
  owner-rights, admin-gated `criminal_declarations_office_v` (ADR-0004);
  `/onboarding/:id` reads that view.
- A trigger refuses UPDATE of `staff_id`, `declared_at`, `source`, `answer`;
  UPDATE of `details` / `conviction_date` except clearing them on a removed
  worker; and DELETE except the cascade from a deleted staff row (§1.5).
  Review fields and `superseded` stay writable.

## 3 · Worker writes only through RPCs

- `staff_references` and `push_subscriptions` lose their worker INSERT /
  UPDATE / DELETE policies (as `bank_details` did in 20260927120100); the app
  already writes through `onboarding_save_references` and
  `save_push_subscription` / `forget_push_subscription`.
- `staff_set_photo` takes exactly `<own staff id>/<name>.jpg` of an object
  that exists in the `photos` bucket.
- `staff_save_bank`'s E5 key carries microseconds.
- `submit_application` is service-role only; `/apply` always calls
  `submit_application_as_caller` (ADR-0024) and refuses in words without
  `SUPABASE_SERVICE_ROLE_KEY`. The security advisor's anon-callable definer
  count drops by one.

## 4 · Request my P45 while blocked

§10.1 lock case 2: a manager's block is lifted "only [by] a manager pressing
Unblock". `request_p45` therefore refuses `blocked_manual`, and the Staff
App shows the on-hold line. A worker on an automatic document block may
still leave. A `conviction_review` block is not refused; if THC wants it
held the same way, it is one more value in the same condition.
