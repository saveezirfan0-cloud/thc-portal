# ADR-0146 · /apply takes a full name, not a first name alone

**Status:** Accepted · **Refines:** §2.1 (Full name: first + last) · **Owner request:** 15.10.2026

## Context
§2.1 asks for the full name as a first name and a last name. `/apply` has always had two boxes, First name and Surname, and the form, the server action and `submit_application()` all refuse a blank one. A box that only has to be non-blank still lets a first name through on its own, and the office was finding workers on file with no real surname. On 15.10 the owner asked that the two names be separate and that applicants must enter both.

What gets through a "not blank" check:
- an initial, a dot or a dash in Surname ("I", "I.", ".", "-");
- the first name typed again as the surname;
- the whole name in First name, with the surname repeated in Surname.

## Decision
- **Either name** is refused when it is only spaces, punctuation and digits, or a single Latin letter once those are taken out (an initial). "Enter your surname in full, not an initial" (or first name).
- **A single letter in another script** is a whole name and passes. 王 is a common surname, so the rule is about initials, never about script.
- **A surname the same as the first name** is refused, ignoring case and spacing. "Enter your surname — it can't be the same as your first name."
- **A first name whose last word is the surname** is refused. "Enter only your first name here — your surname goes in Surname."
- Each box gets a hint under it: "As on your passport or ID" and "Your family name, in full".
- The rules run in three places, as §2.1 asks for every /apply rule:
  - the form and the server action: `nameProblems()` in `apps/staff/app/apply/form.ts`;
  - the database: `submit_application()`, restated in `20261015140000` with three extra checks (22023, so the action shows the database's wording).

## Consequences
- Short names (Jo, Ng, Li), hyphens, apostrophes, accents and non-Latin scripts all pass. vitest `form.test.ts` and pgTAP `844_apply_full_name.sql` cover both what is refused and what passes.
- The placeholder names "A"/"B" in pgTAP `120_apply` and `731_apply_referral` (which test the email, mobile, consent and date rules) are now "Ann"/"Bell", so those tests still reach the rule they test.
- Someone whose surname really is the same as their first name cannot apply through `/apply` and must contact the office. This is accepted as rare. Tell the owner if it happens; the fix would be an override that only the office can use.
- Records already on file are not changed. A worker with a wrong name fixes it with Request a change (ADR-0045), and the office checks the evidence.
- The wireframe `wireframes/public/apply.html` now shows the same two hints.
