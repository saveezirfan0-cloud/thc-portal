# ADR-0080 · Languages spoken — asked at onboarding, needed by an event

**Status:** Accepted, 01.10.2026 (product owner request) · **Builds on:** [ADR-0079](0079-role-section-staff-gender.md) (a gate on what the booking asks for), [ADR-0043](0043-worker-availability-hard-gate.md) (a gate overlaid on the pool), [ADR-0060](0060-viewer-role-two-step-reset-activation-links.md) (the viewer writes nothing), [ADR-0076](0076-payroll-codes-as-employee-id.md) (staff brought across from payroll) · **§3.2, §3.3, §3.4, §6, §9.6, §10.3** · **Code:** migration `20261002108000_languages_spoken.sql`; pgTAP `768`; `packages/domain/src/languages.ts` (`LANGUAGES`, `missingLanguages`, `requiredLanguagesLabel`), `scoring.ts` (`HARD_GATES`, `showsUnderUnavailable`), `staff.ts`, `board.ts`, `state.ts`, `shift.ts`, `shiftOffer.ts`; `apps/office/app/_components/LanguagePicker.tsx`, `events/_components/ShiftBuilder.tsx` (Languages staff must speak), `events/[id]/page.tsx` + `board-model.ts`, `staff/[id]/LanguagesField.tsx`, `onboarding/CandidateScreen.tsx`; `apps/staff/app/onboarding/_components/LanguagesQuestion.tsx` + `AddressStep.tsx`

## Context

The product owner asked on 01.10.2026: _"Please can a 'languages spoken' field also capture what languages the candidate speaks at point of onboarding — can this also be an option at event level — default for English but the option to select other languages if required."_

The scope has nothing on languages. The pattern for a requirement auto-assign must respect already exists: ADR-0079 put a gender requirement on a role section as a hard gate in `auto_assign_candidates()`, which every booking path re-reads (the hourly and first rounds, the 12:05 refills, same-day escalation, `invite_worker` — manual invites too — `accept_invite`, `apply_to_shift`, `accept_application`, Radar and the shift-offer pushes and takes).

## Decision

### 1 · One fixed list

`known_languages()` in SQL and `LANGUAGES` in `packages/domain` hold the same 54 languages: English first, then A → Z, British Sign Language included. A fixed list rather than free text, so "Spanish", "spanish" and "Español" can never be three different requirements, and a requirement and a worker's answer always match. `languages.test.ts` reads the migration and fails if the two lists drift; pgTAP 768 pins the order. Adding a language is a migration that restates the function.

### 2 · English is the base

Every worker THC books speaks English: the induction, the quiz and the contract are all in English. So English is always on both lists (a CHECK on each column), the pickers draw it as a fixed chip with no remove, and **it never gates anyone**. Only the languages an event names _besides_ English are a requirement. This is what makes "default for English" safe: every event on file, and every new one nobody changes, reads exactly as before, and the ~1,000 workers with no languages on file are not shut out of anything.

### 3 · The worker says on onboarding step 2

`staff.languages text[]` — null means never asked. Step 2 (_Where do you live?_) gains **Which languages do you speak?**: English ticked and fixed, others added from the list as removable chips. Continue saves the languages (`staff_save_languages`, the worker's own row) and then the address, which is what completes the step. Step 2 rather than a new step: the wizard's eleven steps are §10.3's, and step 2 already asks about the worker rather than their paperwork. Step 2 is editable until the documents are submitted (`canEditStep`); after that, the office records changes.

Not asked on `/apply`: that would change `submit_application_as_caller`, the rate-limited public write, and nobody can be booked before onboarding is complete anyway.

The candidate profile (`/onboarding/:id`) reads "Speaks English, Spanish" in its header facts once step 2 is answered.

### 4 · The event says in the Shift Builder

`events.required_languages text[] not null default {English}`. **Event level**, as asked: every role section of the event needs the same speakers. Panel 4 of the Shift Builder gains **Languages staff must speak**, the same chip picker. A worker must speak **every** language the event names. The event board shows a cyan pill in the Event header — _Spanish speakers_, _French & Spanish speakers_.

Like the gender on a section (ADR-0079):

- **Duplicate keeps it** — it is the client's ask for the event, not a decision about one day's people.
- **It re-confirms nobody** (`required_languages` in `SILENT_FIELDS`).
- **It is not under the §3.2 edit lock** — `event_edit_lock_guard` names the columns it freezes and this is not one; it steers who is invited next, not the event as booked.

### 5 · Two hard gates, straight after the gender gates

| Event needs besides English | `staff.languages` | Gate | Event board |
|---|---|---|---|
| nothing | anything, or null | none | as before |
| Spanish | includes Spanish | none | in the pool as usual |
| Spanish | on file, no Spanish | `language_not_spoken` | **no row**, like the other gender |
| Spanish | null | `languages_not_recorded` | Unavailable → _Languages not recorded_, so the office can record them |

A gate, not a score: §6's five weights are untouched. It sits beside the gender gates because, like them, it is what the booking asks for rather than anything about the worker's week. Every refusal names the gate: `take_offered_shift()` is restated so a take refuses `language_not_spoken` / `languages_not_recorded` rather than `not_bookable`, and the worker, office and application-accept copy all say why.

### 6 · Nothing standing is withdrawn

§3.4: auto-assign never withdraws an invitation. Adding a language to an event with people already invited leaves those invitations open; Accept then refuses by name. A confirmed booking stays until the manager withdraws it on the event board (§3.6). The Shift Builder says so when a language is added to an event with people booked.

### 7 · The office records languages on /staff/:id

The Overview card _Contacts & identity_ gets a **Languages** row: the chip picker for any office login that may write, the list as text for a viewer. A worker never asked shows "Not asked yet…" and an **English only** button, so the office can record a worker who speaks nothing else (and so is never `languages_not_recorded`).

`set_staff_languages(staff, languages)` — office logins that are not read-only; refused on a removed worker; null clears it. Its `audit_log` row (`staff.languages_set`) names the worker but **not the value**: every office role reads `audit_log`, and a GDPR removal must not leave the answer behind in it (as ADR-0079).

## Consequences

- **Everyone onboarded before this has no languages on file.** On an event that needs, say, Spanish, they are all listed under Unavailable → _Languages not recorded_ until the office records them, and only workers who finished step 2 after this change can be booked. On an English-only event nothing changes for anyone.
- **GDPR (§1.7).** `staff_wipe_report_fields` now also nulls `staff.languages` on removal. It is ordinary personal data, asked for one stated purpose (the step's hint says it), and collected from staff only — never applicants.
- **Equality.** Language is a job requirement the client states for an event, not a protected characteristic. THC still decides when a client's request is a genuine requirement of the work; the picker enforces the request, it does not judge it.
- **Wireframes.** `backoffice/shift-builder.html` (panel 4) and `staff/onboarding-1.html` (step 2) now draw the pickers. Not drawn, so this ADR is their deviation record, as ADR-0079 is for the gender additions: the event-board pill and Unavailable reason (`backoffice/event-board.html`), the staff-profile Languages row (`backoffice/staff-profile.html`) and the candidate-profile line (`backoffice/candidate.html`). `docs/08-screen-inventory.md` lists all of them.
- The Staff App does not yet let a worker change their languages after step 2 — `staff_save_languages` accepts a call at any stage, so a later Profile details screen can add it without a migration.
- `design-pass/harness` fixtures carry an event that needs Spanish and a _Languages not recorded_ worker.
