# ADR-0193 · Names already on file are corrected to the passport's

**Status:** Accepted (owner request, 24.10.2026). Follows ADR-0189, which stopped a new candidate registering with an initial. An addition to scope v1.6 §9.6; not in the wireframes (this ADR is the deviation record).

## Context

ADR-0189 refuses "M." as a surname on `/apply`. The candidates who had already registered stayed as they were ("Marc M.", "carlos g."), and the office asked for every existing name to be brought to the passport's so the formats are the same from here on.

The product cannot do that by itself. The passport's name is nowhere in the database as text: the AI document reader is told to return no names (ADR-0033: "no names, numbers or other personal details"), and a passport upload records its dates and issuing country only. The one other place a name from an official document is kept is the Home Office share-code check (`rtw_checks`, `result ->> 'fullName'`), which exists only for workers who have a share code and whose check has run. So the name has to be typed by a person who has looked at the passport. Until now only the worker could (ADR-0045), and the office had no route at all.

## Decision

1. **`office_correct_name(staff, first, last, reason)`**, the name's counterpart of `office_correct_dob()` (ADR-0070). An owner or manager (`office_can('identity')`; a viewer is refused `read_only`, a scheduler `not_permitted`), never a removed profile (§1.7). It applies ADR-0189's passport rule to both parts (`name_fault()`), refuses a name that is already on file (`unchanged`), and needs a reason of 10–300 characters. It writes `staff.first_name` / `last_name` (NFC, whitespace tidied), audits `staff.name_corrected` with the reason and the manager's name, and emails payroll the way an approved name request does (RC4, so the name they know the worker by never differs from the system's). It starts no right-to-work re-check (Q13) and rewrites nothing already issued (§1.7). Called through the manager's own session, never the service key.
2. **`office_names_to_review()`** and **`/staff/names`**: every live worker or candidate whose name is an initial, has symbols, or is all in lower or upper case, newest first, with the Home Office record's name beside it where there is one. The record name is a guide, never filled into the dialog: it is upper case and carries every name, and which part is the surname is for a person to say. "Correct" opens the dialog; the same "Correct" sits on the name in `/staff/:id` (Contacts & identity) and the `/onboarding/:id` header. Linked from `/staff`.
3. **One format.** The dialog asks for the name as the passport prints it, in full, with the first letter of each name in capitals, and the list flags names in all lower or all upper case, so "carlos garcia" and "MARC MARTINEZ" are brought to the same shape as everyone else. Capitalisation is not corrected by a rule (McDonald, van der Berg): a person types it.
4. **"Request a change" takes the same rule** (`request_profile_change()`, restated from 20260930206000; `validateNameChange()`), with refusals `first_initial | last_initial | first_characters | last_characters` and a sentence for each in the Staff App. A worker can no longer ask for an initial.
5. **§1.7 on removal.** A sibling trigger to `staff_removed_purge_additions()` (not restated) overwrites the free-text reason on the worker's `staff.name_corrected` rows and anonymises the RC4 copy payroll was sent (names → "Deleted account #id", an unsent one failed `gdpr_removed`). The names themselves are under `firstName` / `lastName`, which `remove_worker()` already strips; its own scrub runs after this trigger and deletes the RC4 copy outright, which is what pgTAP 926 asserts (no row, and no payroll email carrying either name). The trigger is the belt to that braces: it keeps the free-text reason off the audit row, which `remove_worker()` does not reach.
6. **The surface is reviewed.** Both RPCs are added to pgTAP 892's pinned list (221 authenticated definers) and to docs/14 §4.

## Consequences

- **The existing names are corrected by a person, one at a time.** `/staff/names` is the work list; nothing is changed automatically. A bulk fill from the Home Office record was rejected: it cannot tell the surname from the given names, and it would write a name nobody had looked at.
- **No passport is read for the office.** The dialog shows no photo of the passport; the Documents tab already does. A follow-up could show it beside the form.
- **A corrected name can make a stuck right-to-work check match.** `namesMatch` reads the new name, but the check is not re-run for the office: "Run check again" on the Documents tab.
- **A pending name request is not closed** by an office correction to the same worker; the office decides it as usual, and approving it would overwrite the correction. Worth closing as withdrawn (as ADR-0070 does for a date) if it comes up.
- **The flagged "lower/upper case" reason may be noisy** for a name that is correctly all capitals on the passport; the office simply opens it and leaves it, or retypes it in the shared shape.
- Tests: vitest `legalName`, `changeRequest`, office `name-correction`; pgTAP 926 (48 assertions), 892 (221 definers).
