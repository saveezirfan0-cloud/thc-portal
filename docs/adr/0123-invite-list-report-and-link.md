# ADR-0123 · The invite list shows how the daily reminder is doing, and links people who applied under another email

**Status:** Accepted · **Refines:** ADR-0107 (the invite list), ADR-0122 (IR1) · **Owner request:** 13.10.2026

## Context
Once IR1 went out daily (ADR-0122), the owner asked for "a report on /staff/roster of emails sent etc, KPI metric widgets". They also asked for a fix for a known gap. The list is matched on email, so somebody who applied with a different address from the one on the sheet is never matched. Their row stays on the list, they keep getting the daily reminder, and they get neither their group nor their Payroll ID. There were eight such people on 13.10, including one SpudBros person now in the THC interview queue. The office's only remedy was to set the Payroll ID on the profile, then remove the row, by hand and without being told who.

## Decision
- **`invite_roster_report()`** (office logins, the viewer included: it only reads) returns:
  - **headline numbers:** not applied (THC, SpudBros), applied from the list (`roster.matched` via the list, plus `roster.linked`), applied under another email (possible matches), applied with the listed email but kept without a Payroll ID;
  - **the daily reminder:** sent today, sent in all, people reminded, applied after a reminder (a staff record on that address created after their first IR1), failed, waiting to send, last sent, and whether it is on (the setting and the `/settings` switch);
  - a 14-day **sent per day** series;
  - **per address:** how many reminders, the last one, and the last failure if it is newer than the last send;
  - the ids of rows whose person has applied with the listed email;
  - the **possible matches**.
- **Possible matches** come from `invite_roster_possible_matches()`. A row nobody has applied for by email is paired with a live staff record that has no Payroll ID, is not itself on the list, and has the same first name and the same last word of the surname (`payroll_name_key`, ADR-0076). Each side needs at least two words. This is a suggestion; the office decides.
- **Link** (`link_invite_roster_entry(entry, staff)`, owner and manager only) applies the row to that person exactly as loading the list applies it to somebody already here (ADR-0107):
  - the Payroll ID, and a numeric one as the Employee ID where the system issued theirs;
  - SpudBros marking, unless an upcoming shift would be stranded. In that case it is reported and left to the office.

  It then consumes the row, so the reminders stop, and audits `roster.linked` with both addresses. It refuses names that do not agree, a Payroll ID somebody else holds, and a person who already has a different Payroll ID.
- **On/Off on the page** (`set_invite_roster_reminders(p_enabled)`, any office login that may write; the viewer cannot). The owner asked for it on 13.10. It sets `settings.invite_roster_reminders.enabled`. Off also cancels the IR1 rows queued and not yet sent, which are paced over about half an hour, so emails stop at once (with a confirmation first). Both the change and the number cancelled are audited. The `/settings` → Notifications switch for IR1 (ADR-0083) still stops sending as well; the panel reads Off if either switch is off and says which one.
- **The page**, top to bottom:
  - the five headline tiles;
  - a **Daily reminders** panel: its On/Off and Turn off / Turn on, the schedule, six counts and the 14-day bars;
  - an **Applied under another email** table, with Link for owners and managers;
  - the existing Load panel;
  - the list, with a **Daily reminder** column: "3× · last 14 Oct 2026", "Not yet", "Not delivered" with the error on hover, "Possible match", "Applied · no Payroll ID", or "Not reminded (SpudBros)".

  The page's tables now use the design system's `tbl` class; the old `table` class had no styles. There is still no wireframe: this extends the deviation recorded in ADR-0107.

## Consequences
- One RPC per page load, alongside the paged list read. It reads the IR1 outbox rows through the `(template, id)` index and pairs about 900 list rows with staff on two hashed name keys, well inside the 8 s statement timeout.
- A common name could pair a list row with the wrong person. Link is never automatic (since ADR-0125 a SpudBros row's name pairing does mark a candidate still waiting for the interview as SpudBros, so they are never sent it; the Payroll ID still waits for Link), the table shows both addresses and the stage, and the names must agree in the database too.
- pgTAP `812_invite_roster_report.sql`; vitest `report.test.ts` and the Link action in `actions.test.ts`.
