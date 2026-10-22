# ADR-0187 · Names are taken in full, as printed on the passport

**Status:** Accepted (owner request, 22.10.2026). A deviation from `wireframes/public/apply.html` (a "Middle name(s)" field and the passport hint; the wireframe is updated with it) and an addition to scope v1.6 §2.1, which lists only First name and Surname.

## Context

The office saw candidates listed as "Marc M.", "Oriol C.", "carlos g." and "Jon E." beside their photos, and asked for the full names, and for candidates to be made to enter their name as it appears on their passport: first name, middle name and surname.

Nothing in the product shortens a name. `display_name` is `first_name || ' ' || last_name` in every view that has one (`staff_directory_v`, the onboarding candidates view, the compliance queue), and no screen, PDF or export cuts a surname to its initial. The short names are what the candidates typed: `/apply` accepted any non-empty text, in all three places §2.1 repeats a rule (the form, the server action, `submit_application()`), so "M." was a valid surname. The right-to-work check (`namesMatch`), payroll, the sign-in log and the badges all need the name on the passport, and an initial cannot be matched to one.

## Decision

1. **One rule, `nameFault()`** in `packages/domain/src/legalName.ts`, refuses what cannot be a whole name and nothing else:
   - empty (a required field);
   - an initial: a part that is one letter, with or without a full stop, where parts are split on spaces and hyphens ("M.", "g", "Smith-J", "Marc J Antoni");
   - any full stop at all ("St. John", "J.R."), which is how an abbreviation is written;
   - digits and symbols, or a name that does not start with a letter;
   - more than 100 characters.

   It does **not** refuse hyphens, apostrophes (straight or typographic), accents, particles ("van der Berg"), two-letter names ("Li", "Ng"), or any capitalisation, which is left as typed. The form cannot know a passport; it can refuse only what a passport never prints.
2. **Three fields on `/apply`**: First name, Middle name(s) (optional, "Leave blank if you have none"), Surname, under "Enter your name exactly as it appears on your passport." The labels "First name" and "Surname" are unchanged. An initial in the middle field is refused too.
3. **Stored as before.** There is no new column. First and middle names are joined (whitespace tidied, nothing else) into the existing `staff.first_name`, the passport's "given names"; `last_name` is the surname. The two limits are therefore one: 100 characters for the first and middle names together.
4. **Three gates, one rule.** The form and the server action call `nameFault()`; `submit_application()` calls `name_fault(text, boolean)` (migration `20261023130000`), after every existing field rule (so an application wrong in several ways keeps the complaint it always got first) and before the locks. Both are held to `legalName.vectors.json` (37 cases): vitest reads it directly, pgTAP 120 through `legal_name_vectors.psql`, which a vitest test keeps in step with the JSON as for every other vectors file.
5. **Copy.** Each refusal names the field ("Enter your surname in full, as it appears on your passport — not an initial"). The database words the same reasons for the two things it can be asked about, and the server action shows its message when it refuses a name the form let through.

## Consequences

- **Workers already on file are not changed.** The four on the screenshot, and any other candidate whose surname is an initial, stay as they are: the product cannot know what their passport says. Each is corrected through the worker's own "Request a change" (name, ADR-0045), which the office approves against the passport, or by the office asking them to. A list is one query: `select id, first_name, last_name from staff where last_name ~ '^[[:alpha:]]\.?$' or last_name like '%.%' or first_name ~ '(^| )[[:alpha:]]\.?( |$)'`.
- **Not verified against the passport.** The rule stops an initial and a class of typos; it does not stop "Marc Martinez" being a nickname. A wrong name is caught where the share code is verified: `namesMatch` (`packages/domain/src/rtwCheck.ts`) requires every word of the profile's first name and of its surname to appear in the name on the Home Office record. That is the check an initial could never pass ("M." is the word `m`), and it is why this change is worth having.
- **A middle name that is not on the Home Office record now counts against the match.** Because middle names are stored in `first_name`, `namesMatch` reads them as part of the first name, and a worker who types a middle name the record does not carry (or spells it differently) gets a mismatch they would not have had by leaving it out. The record normally carries every given name on the passport, so a passport-accurate entry matches; the field is optional and says "as it appears on your passport" for that reason. If the office sees a run of mismatches on middle names, the fix is `namesMatch` reading the first given name only, which is a domain-and-SQL change of its own.
- **Name-change requests still accept an initial.** `validateNameChange()` and `request_profile_change()` check length and "unchanged" only. Adding the same rule there is a follow-up (a new refusal in both, and in `changeRequest.vectors.json`); it was left out so this change stays on the application path. The same goes for the office's roster import, which names its people itself.
- **Greetings read the given names.** Copy that says "Well done, {firstName}" now reads "Well done, Marc Antoni" for a worker with a middle name. The alternative, a separate `middle_name` column, touches the identity-column grants (20261020120000), every directory and queue view, the generated types and their pgTAP, and was judged too wide for this change. If the owner would rather greetings say the first word only, it is one helper used in five screens.
- **Capitalisation is not corrected.** "carlos" stays "carlos". Passports print capitals, so any rule would be a guess ("McDonald", "van der Berg"); a one-line normaliser for names typed entirely in one case is possible if wanted.
- **A false refusal** (a real name written with a single letter as one of its parts) is possible and is answered by email to the office, as for any other `/apply` problem; the message says what to enter.
- Tests: vitest `legalName`, `apply/form`, `apply/legal-names-action`; pgTAP 120 (87 assertions), 002 unchanged.
