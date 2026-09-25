# ADR-0027 · The §2.12 email arm of the duplicate check requires the date of birth

Status: accepted · 26.09.2026 · records a deviation made in 20260922183012 and never written down; raise with THC (docs/15)

## Context

- §2.12: "the public application form (§2.1) performs a duplicate check on
  submission: email, and mobile number plus date of birth. A match against an
  existing record does not create a second candidate".
- ADR-0008 tightened the mobile arm to mobile + DOB. 20260922183012 then put the
  DOB on the email arm as well, explaining in its header that email alone let an
  anonymous caller file a `returning_applicant` entry against a colleague's
  record — anyone who knows a worker's address — and put a one-click Reset to
  candidate in front of the office, which supersedes that worker's evidence. No
  ADR or open question recorded it; the office's own screen states the rule the
  scope's way while its modal states it as built.

## Decision

- **The deviation stands and is now recorded**: `submit_application()` matches
  an existing record on `dob` AND (email OR normalised mobile). A known email with
  a different date of birth is a new candidate. `120_apply` pins it.
- **Why not the scope's reading**: the match's only effect is to route the
  application to the office as a returning applicant whose record can be reset;
  an unauthenticated caller must not be able to aim that at a compliant worker
  with nothing but their email address. The DOB is the second factor the form
  already collects.
- **What THC is asked** (docs/15): confirm the reading, or ask for email-alone
  matching — in which case the match is kept but the `returning_applicant` entry
  offers Reset only after a second factor (the office confirms the DOB or the
  mobile by phone).

## Consequences

- The office alert copy "(email, or mobile + DOB)" in `OnboardingBoard.tsx`
  should read "(email + DOB, or mobile + DOB)" — a change outside this ADR's
  slice, listed for its owner.
- A returning worker who mistypes their DOB is created as a second candidate;
  the office sees two cards for one person and resolves it by rejecting the
  duplicate. Acceptable next to the alternative.
