# ADR-0143 · The invite list says why an applicant has no Payroll ID, and can Link them

**Status:** Accepted · **Refines:** ADR-0107 (the invite list), ADR-0123 (its report and Link), ADR-0138 (its filters) · **Owner request:** 15.10.2026

## Context
A row reading **Applied · no Payroll ID** is a person who applied with the listed email, but whose Payroll ID was held back (ADR-0107). That happens when the app's name and the sheet's do not agree, or when somebody else already holds the ID. The page said no more than that. The office had to dig through `/activity` to find out why, then set the ID on the profile and Remove the row by hand. The owner asked "how do we fix this", then for "a proper fix", and for filters by Payroll ID and by reason.

## Decision
- **Why, on the row.** `invite_roster_kept()` gives each such row the person who applied and a reason, first that fits:
  - **Payroll ID held by someone else** (`payroll_id_taken`): the holder is named and linked;
  - **Has a different Payroll ID** (`other_payroll_id`): the applicant already carries another one;
  - **Name differs from the sheet** (`name_differs`): `payroll_names_compatible`, first name and last word of the surname;
  - **Already has this Payroll ID** (`already_has`): the row is only left over;
  - **No Payroll ID on the sheet** (`no_payroll_id`);
  - **Payroll ID not given yet** (`not_applied`): none of the above.

  `invite_roster_report()` carries these as `kept`. The list shows the reason under the amber pill, with a link to the applicant's profile and, for a taken ID, to the holder's. The column is now "Status · daily reminder".
- **Link, for these rows too**, in the row's actions (owner and manager, as before):
  - **Name differs:** the browser asks first, naming both: "The sheet says Andrea Gaviria; they applied as Andreu Gaviria. Link them only if they are the same person." Yes calls `link_invite_roster_entry(…, p_confirm_name => true)`. The office's word lifts the name check and nothing else. The audit row records both names and `nameConfirmed`.
  - **Already has it, no Payroll ID on the sheet, not given yet:** Link applies what the sheet gives and takes the row off the list.
  - **A taken Payroll ID, or a different one already carried:** no Link, and the database refuses even a confirmed call. One of the two records is wrong, and the office decides which on the profile; an ID is never given to two people (ADR-0107).
- **Two more filters** beside Group and Status, kept in the address bar and carried into Export CSV and its file name:
  - **Payroll ID:** on the sheet, or not;
  - **Why no Payroll ID:** one of the six reasons.

  Each option shows its count within the chosen group and status. The CSV gains a "Why no Payroll ID" column, and "Applied as" / "Applied with email" are now filled for these rows too.
- `link_invite_roster_entry` gains its third argument by being dropped and recreated (`p_confirm_name boolean default false`), so every two-argument call keeps working.
- There is still no wireframe. This extends the deviation recorded in ADR-0107, ADR-0123 and ADR-0138.

## Consequences
- ADR-0107's "the roster page does not yet flag rows that were kept or mismatched" is done.
- pgTAP 842 (and 812, for the new signature); vitest `list.test.ts` and `actions.test.ts`.
