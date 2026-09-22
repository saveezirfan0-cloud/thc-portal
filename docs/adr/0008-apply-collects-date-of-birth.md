# ADR-0008 · /apply collects a date of birth, and derives the age band

**Status:** Accepted. THC answered the open point on 21.09.2026: collect the date of birth. Supersedes the "Accepted for v1" position this ADR held while the question was open.

## Context

§2.1 lists the public form's fields as First name · Surname · Email · Mobile · **Age** (select from 18) + GDPR consent. §2.12 says the duplicate check on submission matches "**email**, and **mobile number plus date of birth**".

Those cannot both hold. A form with only an age band cannot evaluate a mobile + DOB match. `wireframes/public/apply.html` already recorded it as an open point: "either DOB is added to /apply or the mobile+DOB match relies on the DOB entered later in the app (§2.5)".

`20260921150000_public_application.sql` shipped the honest interim position: `staff.dob` became nullable because the form had no date to put in it, and the duplicate check matched on **mobile alone**, described there as "the wider net of the two, so it never lets a second record through where the scope wanted one".

## What the interim position cost

Wider is safe in one direction and wrong in the other. Mobile-only matched people who are not the same person: a recycled mobile number, or two people in one household sharing a phone, each became a "returning applicant" entry naming somebody else's record — and the manager's options on that entry are Reset to candidate or reject, both of which act on the *wrong* worker.

It also left `staff.dob` empty at the point the Right to Work check (§2.6) needs it, and left the office no way to tell a 19-year-old from a 59-year-old beyond a band the applicant chose freely.

## Options

1. **Add a date of birth to /apply.** Satisfies §2.12 exactly and populates `staff.dob` from creation. Deviates from §2.1's field list and the wireframe.
2. **Derive a date from the age band** (1 January of the implied year). Puts a fabricated date of birth into the record that later drives a gov.uk right-to-work check. Never acceptable.
3. **Keep matching on mobile alone** until the wizard (§2.5) collects a date. Leaves the false matches above in place indefinitely.

## Decision

**Option 1**, implemented in `20260921170000_apply_date_of_birth.sql`.

- The form asks for a **date of birth** instead of an age band. It is an `<input type="date">`, so the phone browsers §2.1 says applicants use open their own wheel picker. No `max` attribute: capping it at today minus eighteen years would *hide* the under-18 case, and §1.7 and the wireframe both refuse it out loud.
- **The age band is derived, not asked.** `applications.age_band` and `staff.applied_age_band` both stay, so the office keeps the §2.1 datum; they are computed from the date. Asking for both permits a submission where the band says 25 and the date says 17, and then something has to decide which is true — on the field that determines whether it is legal to employ this person.
- **The §2.12 mobile arm is now exact**: `normalise(phone) = :phone AND dob = :dob`.
- `p_dob` is **required**. Missing, in the future, and implying an age over 100 are three distinct refusals; under 18 is a fourth. Age is completed years in UK time (§1.8).
- **`staff.dob` is tightened to "present unless removed".** Every candidate now has a date at insert. The column stays nullable only because a GDPR removal (§1.7) wipes personal data, and a date of birth is personal data — a stronger guarantee than the original `NOT NULL`, which could not express the exception. The constraint is added conditionally, because rows created through the previous RPC have no date and inventing one for them is what option 2 refuses.

## Consequences

The form has one field where it had one field: the date replaces the select, so the "two minutes" claim is unaffected.

§2.1's "Age (select from 18)" is no longer literally implemented. Its intent — refuse under-18s, record roughly how old an applicant is — is met by the date and the derived band. Anyone comparing the form to §2.1 line by line should be sent here.

`wireframes/public/apply.html` still draws the Age select and is now out of date on that one field. It should be updated when the wireframes are next touched.
