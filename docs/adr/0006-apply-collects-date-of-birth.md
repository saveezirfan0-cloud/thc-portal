# ADR-0006 · /apply collects a date of birth, and derives the age band

**Status:** Accepted — THC answered the open point on 21.09.2026: collect the date of birth.

## Context

§2.1 lists the public form's fields as First name · Surname · Email · Mobile · **Age** (select from 18) + GDPR consent. §2.12 says the duplicate check on submission matches "**email**, and **mobile number plus date of birth**".

Those cannot both hold. A form with no date-of-birth field cannot perform a mobile + DOB match. `wireframes/public/apply.html` already recorded it as an open point: "either DOB is added to /apply or the mobile+DOB match relies on the DOB entered later in the app (§2.5)".

There was a second consequence. §2.1 also says a valid submission creates the candidate **directly in `interview_requested`** — but `0001_init.sql` declared `staff.dob` as `NOT NULL`, and the first point at which a date of birth existed was the Staff App wizard (§2.5), several stages later. So the candidate row §2.1 asks for could not be written at all.

## Options

1. **Add a date of birth to /apply.** Satisfies §2.12 exactly and keeps `staff.dob` populated from creation. Costs one field on a form whose selling point is "two minutes", and deviates from §2.1's field list and the wireframe.
2. **Invent a date from the age band** (1 January of the implied year). Puts a fabricated date of birth into a record that later drives a gov.uk right-to-work check (§2.6). Never acceptable.
3. **Hold applications in a separate table and create the candidate later.** Leaves `staff` untouched, but the onboarding kanban (§2.2) then reads candidates from two places and §2.1's "lands straight in Interview requested" stops being true.
4. **Keep the age band and match on mobile alone.** What this repo shipped first, as an explicitly interim position pending THC's answer.

## Decision

**Option 1.** THC confirmed the form should collect a date of birth.

Implemented in `20260921132000_public_application.sql` and `apps/staff/app/apply`:

- The form asks for a **date of birth**, not an age band. It is an `<input type="date">`, which opens the OS wheel picker on the phone browsers §2.1 says applicants use. No `max` attribute: capping the picker at today minus eighteen years would *hide* the under-18 case, and both §1.7 and the wireframe want it refused out loud.
- **The §2.1 age band is derived from the date, never asked.** It is still stored on `applications.age_band`, so the office keeps the datum §2.1 wanted. Asking for both invites a form where the band says 25 and the date says 17, and then something has to decide which one is true.
- The **§2.12 mobile arm is now exact**: `normalise_msisdn(phone) = :phone AND dob = :dob`. The interim mobile-only fallback is gone, along with the false matches it accepted.
- `p_dob` is a **required** parameter of `submit_application`. Absent, malformed, in the future, or implying an age over 100 are four distinct refusals; under 18 is a fifth. Age is computed as completed years in UK time, where every rule in this system is evaluated (§1.8).
- **`staff.dob` is nullable for exactly one case.** Every candidate now has a date from the moment the row exists, so the column could have stayed `NOT NULL`; it is relaxed only because a GDPR removal (§1.7) wipes personal data, and a date of birth is personal data. `dob_present_unless_removed` allows `NULL` at `removed` and nowhere else — a stronger guarantee than the `NOT NULL` it replaces, which could not express "except once anonymised".

## Consequences

The form has one more field than §2.1 lists and one fewer than it would with both, so the total question count is unchanged and the "two minutes" claim survives.

§2.1's "Age (select from 18)" is no longer literally implemented. The intent behind it — refuse under-18s, record roughly how old an applicant is — is met by the date and the derived band. A reader comparing the form to §2.1 line by line should come here.

The wireframe `wireframes/public/apply.html` still draws an Age select. It is now out of date on this one field, and should be updated when the wireframes are next touched.
