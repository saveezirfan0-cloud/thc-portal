# ADR-0105 · An invite list decides who is SpudBros Express, and carries each Payroll ID

**Status:** Accepted · **Refines:** ADR-0104, ADR-0076 · Scope §2.1, §2.7, §2.12 · **Owner request:** 08.10.2026

## Context
SpudBros Express staff and THC's own staff are invited by email, from different mailboxes, with the same kind of link. The app cannot see which mailbox a message came from or which message someone clicked — only the address they apply with, and (since ADR-0104) which public page they applied on. The office also holds each person's Payroll ID on a sheet, some with a letter (`1641A`), which `employee_id` (an int) cannot hold.

## Decision
- **An invite list** (`invite_roster`): email, name, Payroll ID, group (`spudbros` / `thc`). Loaded by the office from `/staff/roster` (paste the sheet, header row: Email · First name · Last name · Payroll ID · Group) through `load_invite_roster()`. One row per email.
- **An application is matched on the email it is made with**, for the *new candidate that application created* only (never a returning applicant, §2.12):
  - on the list → the list's group wins, and the Payroll ID moves onto the person. A SpudBros person who clicks the ordinary link is still SpudBros; a THC person who clicks the SpudBros link is not;
  - not on the list → `/apply/spudbros` marks them SpudBros Express, `/apply` does not (ADR-0104);
  - the row is **consumed**, so `invite_roster` is exactly "invited, not applied yet" — a chase list — and an audit row (`roster.matched`, with `via` = `list` / `list_over_link` / `link`) says how each person was decided.
- **People already in the system** (same email) have the list applied when it is loaded: Payroll ID, a numeric Payroll ID as the Employee ID where the system had issued one (ADR-0076's backfill rule), and SpudBros marking — except where marking would strand an upcoming invitation or shift, which is reported (`held`) and left to the office. A list never switches a SpudBros person back to THC (it may be a deliberate exception); that too is reported.
- **`staff.payroll_id`** (text, unique, `[A-Z0-9-]{1,20}`): shown and editable on `/staff/:id`, searchable in the Staff directory and the onboarding board. At contract signature `issue_employee_id()` now prefers a **numeric** Payroll ID on the person (matched by email, so two spellings of a name cannot disagree) before ADR-0076's name match and then the next system ID. An ID with a letter keeps a system Employee ID and shows its Payroll ID beside it.
- **Seeing the groups.** The Staff directory and the onboarding board gain a *Group* filter (All · SpudBros Express · THC only), a SpudBros chip on the row/card, and the Payroll ID in search; the candidate and staff headers carry the label. `staff_directory_v` and `onboarding_candidates_v` gain `spudbros_express`, `thc_shifts_enabled` and `payroll_id` (appended).
- **Retention.** Entries older than 180 days are dropped on every load; the office can remove entries or clear the list. A list of people who never applied is not kept for ever (§1.7).

- **Names must agree.** The sheet has First name and Surname only, so a match needs the same first name and the same last word of the surname (`payroll_names_compatible`) — a middle name in the app is fine. For a *new applicant* a mismatch leaves the list row untouched and applies nothing from it (the link, if any, still decides; `roster.name_mismatch` is audited): someone who knows an invited email but not the invitee's name gets neither their group nor their Payroll ID. For a person *already here* a mismatch is held (`name_mismatch`) and changes nothing — a mistyped email can never move another worker's Payroll ID, Employee ID or group.
- **One spelling per ID.** Payroll IDs are upper-cased and all-digit IDs lose leading zeros (`0183` = `183`), here and in `set_staff_payroll_id`, matching the int Employee ID. `invite_roster.payroll_id` is unique too. A failure while matching is audited (`roster.match_failed`) and a SpudBros applicant is still marked.
- **Removal.** GDPR removal clears `payroll_id`, `spudbros_express` and `thc_shifts_enabled` (a trigger): they are not history, and a removed row must not hold an ID that blocks its re-use. The Employee ID survives, as before.

## Operating it
1. Load the list on `/staff/roster` **before** the emails go out (and again for any later batch — an email already on the list is updated).
2. Send the SpudBros email (link `/apply/spudbros`) and the ordinary email (link `/apply`). The list is the safety net if anyone uses the wrong one.
3. As people apply, the board shows a SpudBros chip and Payroll ID on their card. The roster page shows who has not applied yet.
4. Someone who applies with a *different* email from the one on the list is not matched: the link decides, and the office corrects the group on their profile (Scheduling) and sets the Payroll ID (Payroll ID row).

## Consequences
- Matching is by email. A typo on the sheet, or a different address on the application, is a miss — never a wrong match.
- Payroll exports are unchanged: they print the Employee ID. For a numeric Payroll ID that is the same number; for `1641A` it is the system ID until the payroll team says otherwise.
- The list holds names and emails of people who have not applied: admin-read only, consumed on use, purged at 180 days. GDPR removal of a person who applied never touches it (their row is already gone).
- pgTAP `780_invite_roster.sql`; `001_rls_guard` lists the table.
