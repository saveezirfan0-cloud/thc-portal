# ADR-0076 · People already on payroll keep their payroll code as their Employee ID

**Status:** Accepted (owner request, 01.10.2026). An addition to scope v1.6 §2.7.

## Context

§2.7 issues an Employee ID at contract signature, from `employee_id_seq` (10001 up). The agency is moving the people already on its payroll onto the platform. Payroll already knows each of them by a code, and the owner sent the list ("THC - Staff on payroll 01-10-26", 672 people, codes 183–8002) and asked:

> for new staff signups, if any staff matches the name, we need to change their ids to whats in the file, this will apply only to staff in this list, all other new signups should be issued system default ids

## Decision

- **`payroll_codes`** holds the list: code, first name, last name, and a `name_key`. It only ever holds people who have not been matched yet. The office can read it (`admin_read`). Nothing signed in can write it.
- **At contract signature,** `staff_status_guard` calls `issue_employee_id()` instead of `nextval()`. If the person's name matches exactly one row, and no other live worker has the same name, they are issued that code. The row is deleted and `audit_log` records `employee_id_from_payroll`. Everybody else gets the next system ID, exactly as before. An ID the person already holds is still never replaced (§2.12).
- **People who signed before the list was loaded** go through `apply_payroll_codes()`. It moves a live worker from a system-issued ID (10001 up) to their payroll code, under the same matching rule, and audits the old and new ID. Removed workers are left alone, because their ID is their "Deleted account #".
- **Loading** is one call, `load_payroll_codes(jsonb)`, from the SQL editor or with the service key. It upserts the rows, skips anything it cannot store, runs `apply_payroll_codes()`, and returns what was loaded, what it skipped, what changed and which names are ambiguous.
- **The list is not in git.** The names are worker personal data. A migration would deploy them to every environment and keep them in history, where GDPR removal (§1.7) could never reach them. The migration carries the table and the logic. The data is loaded on the live project.

### Matching

The match uses the whole name: first + last, lower-cased. Hyphens and full stops read as spaces, apostrophes are dropped, and whitespace is collapsed. So it does not matter how the name is split between the two fields: "Harish" / "Kumar Paidi" on payroll matches "Harish Kumar" / "Paidi" in the app. Accented and unaccented letters do **not** match each other, and neither do nicknames.

A name that appears twice on the list, or that two workers in the app share, is never matched. The name alone cannot say which person is which, so those people get a system ID and the office decides.

## Consequences

- **Six codes on the list are skipped.** These are the ones with an "A" suffix (1641A, 1974A, 2040A, 2185A, 2265A, 392A). `employee_id` is an integer in every table, view, report and PDF since `0001_init.sql`, so these six people get system IDs. Keeping their codes would mean making `employee_id` a text column across the whole schema, which is a separate decision.
- **A changed ID is not reflected in documents already issued.** Already-issued PDFs and payroll exports keep the ID they were made with. This is in line with "never corrected retroactively". The audit row records the old ID.
- **Every payroll code is below 10001,** and the column has a check for this, so a payroll code and a system ID can never collide.
- **Matching on name alone can match the wrong person.** For example, a new applicant could happen to share a name with someone on the list. Each match is in `audit_log`, so the office can review them.
