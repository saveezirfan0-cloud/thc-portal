# ADR-0005 · /apply collects Age, not date of birth

**Status:** Accepted for v1 — the open point below is flagged for THC

## Context

§2.1 lists the public form's fields as First name · Surname · Email · Mobile · **Age** (select from 18) + GDPR consent. §2.12 says the duplicate check on submission matches "**email**, and **mobile number plus date of birth**".

The form has no date-of-birth field, so the two sections cannot both be satisfied as written. `wireframes/public/apply.html` already records this as an open point: "either DOB is added to /apply or the mobile+DOB match relies on the DOB entered later in the app (§2.5)".

There is a second consequence. §2.1 also says a valid submission creates the candidate **directly in `interview_requested`** — there is no "Applied" stage. But `0001_init.sql` declared `staff.dob` as `NOT NULL`, so the candidate row §2.1 asks for cannot be written at all until a date of birth exists, and the first time one exists is the Staff App wizard (§2.5), several stages later.

## Options

1. **Add a date-of-birth field to /apply.** Matches §2.12 exactly and lets `dob` stay `NOT NULL`. But it contradicts §2.1's field list and the wireframe, and asks an applicant for their DOB before they have agreed to anything.
2. **Invent a date from the age band** (e.g. 1 January of the implied year). Keeps the column non-null at the cost of putting a fabricated date of birth in a record that later drives a gov.uk right-to-work check (§2.6). Not acceptable.
3. **Hold applications in a separate table and create the candidate later.** Keeps `staff` untouched, but then the onboarding kanban (§2.2) has to read candidates from two places, and §2.1's "lands straight in Interview requested" stops being true.
4. **Let `dob` be absent for the stages that genuinely do not have one, and match on mobile alone until one exists.** (Chosen.)

## Decision

Option 4, in `0006_public_application.sql`:

- `staff.dob` becomes nullable, and a new check constraint `dob_required_from_quiz` allows it to be null **only** at `interview_requested`, `interview_completed`, `documents`, `rejected` and `removed`. The wizard (§2.5) collects the date during `documents`, the gov.uk share-code check (§2.6) needs it before any document can be verified, and the quiz only unlocks once every document is verified (§2.3) — so the constraint bites before the date could ever matter. `removed` is allowed because a GDPR removal wipes personal data (§1.7); `rejected` because a candidate can be rejected out of any stage.
- `submit_application` takes an optional `p_dob`. Left null — which is what /apply passes today — the §2.12 mobile arm matches on **mobile alone**. That is deliberately wider than "mobile + DOB": a false match is routed to a human as a returning-applicant entry and costs a manager one decision, whereas a missed match creates the second record §2.12 exists to prevent.
- The age band is kept on the `applications` row, so the office can see what the applicant actually said, and the `>= 18` gate is enforced on the band (form, server action and SQL) rather than on a date.

The parameter exists so that the day /apply does collect a date of birth, the mobile arm tightens to mobile + DOB with no signature change and no migration.

## Open point for THC

Should /apply collect a date of birth? Answering "yes" makes the §2.12 match exactly as specified and lets `dob` go back to `NOT NULL` at the `documents` boundary. Answering "no" keeps this ADR as the standing behaviour. Until THC answers, the wider match above is the safe reading.
