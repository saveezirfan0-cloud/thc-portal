# ADR-0104 · SpudBros Express staff are onboarding-only; THC shifts are a switch

**Status:** Accepted · **Refines:** Scope §2.1, §2.12, §3.3, §3.4, §10.1 · **Follows:** ADR-0076, ADR-0042 · **Owner request:** 07.10.2026 · **Refined by:** ADR-0105 (the invite list decides the group; `/apply/spudbros` is the fallback)

## Context
SpudBros Express staff are brought onto the platform for their Right to Work check and onboarding only. Their shifts, rota and messages stay on Connecteam. A few of them also work THC's own shifts. The onboarding email already tells them so ("Our Staff App is for your onboarding only… Your profile with us will be marked: SpudBros Express Staff Only – scheduling on Connecteam"). Until now every compliant worker was in the auto-assign pool and could be invited.

SpudBros staff are emailed separately from a list, and their application and onboarding must be able to diverge from THC's own in future.

## Decision
- **Two columns on `staff`** — `spudbros_express` and `thc_shifts_enabled`. "Onboarding only" is the pair `spudbros_express and not thc_shifts_enabled`, named once in `staff_onboarding_only(uuid)`. Neither column is compliance: status, documents, the contract, caps and the right-to-work stop behave exactly as for anyone.
- **Three places it bites**, the last one unbypassable:
  1. `auto_assign_candidates()` returns **no row** for an onboarding-only worker (like a candidate), so they never reach the board, an invitation, an offer or auto-assign. No new gate name: they are not "unavailable", they are not in the pool.
  2. `staff_me()` carries `onboardingOnly`; the Staff App's `appLock()` gains a sixth case, `connecteam`: Profile (Documents inside it) stays open, Shifts / Invites / Radar close. A lapsed document still outranks it (`documents`).
  3. A `BEFORE INSERT/UPDATE` trigger on `bookings` refuses any insert, and any update that moves a row onto a worker/shift or into `invited` / `applied` / `confirmed` (the RPCs revive a closed row in place), for them (`onboarding_only_worker`), so a direct write, psql or a path not yet built cannot roster them. Cancel / close / unchanged-status updates on existing rows stay allowed. `staff_onboarding_only()` is service-role only — it would otherwise tell any signed-in user whether someone they can name is SpudBros staff.
- **Marking.** A separate public page `/apply/spudbros` sends a hidden `source=spudbros`; `submit_application_as_caller` gains a 9th argument `p_source`, and `record_application_source()` marks **only the candidate that call created** — never a returning-applicant match (§2.12), so a live worker cannot be closed out from a public form (the rule ADR-0047's security finding #5 set for referrals). Unlike a referral, a database that does not know `p_source` fails the application rather than retrying without it: an unmarked SpudBros applicant would be open to THC shifts. The office can also mark or unmark anyone from `/staff/:id`.
- **The exception.** `set_staff_scheduling(staff, spudbros, thc_shifts)` — any office login that is not read-only, audited, refused on a removed worker — switches THC shifts on or off for one person. Making someone onboarding-only while they hold an upcoming invitation, application or confirmed shift is refused (`has_upcoming_shifts`): the office moves those first.
- **Visible label.** The office profile header and Overview, and the Staff App's profile, carry "SpudBros Express Staff Only – scheduling on Connecteam" (the email's words); a person with THC shifts on reads "SpudBros Express · also works THC shifts".
- **A different onboarding.** Step 11 "How it works" describes THC invitations, the 12:00 "I'm ready" and check-in — none of which an onboarding-only worker will meet — so they get three cards about their documents and Connecteam instead, and land on Profile, not Shifts.
- **Payroll ID.** Unchanged: ADR-0076 turns a payroll code into the Employee ID at contract signature by exact name match; a SpudBros person on the list is matched the same way.

## Consequences
- `/apply/spudbros` is a second public entry. Anyone can use it, and the result is only that they are onboarding-only until the office switches THC shifts on; it grants nothing.
- Nothing is withdrawn when the switch is flipped: that is why it refuses while shifts are upcoming.
- The Radar RPCs still answer if called directly; the app lock is what hides them and the table trigger is what stops a booking.
- Not covered yet: a filter or badge for SpudBros staff in the Staff directory and on the onboarding board, and a different set of onboarding steps. Both read from the same marker when asked.
- pgTAP `779_spudbros_express_staff.sql`; `522` and `731` are updated to the 9-argument signature.
