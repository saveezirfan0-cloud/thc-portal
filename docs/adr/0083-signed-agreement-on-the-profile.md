# ADR-0083 · The signed agreement on the profile

**Status:** Accepted (owner request, 02.10.2026, after confirming the Staff App shows no holiday pay anywhere: "make the fixes"). An addition to scope v1.6 that delivers a promise the wizard already makes.

## Context

At 10/11 the wizard tells the worker "A copy of the signed agreement is kept on your profile" (`wireframes/staff/onboarding-3.html`, `ContractStep.tsx`). Nothing on the profile showed one. Once signed, the agreement could not be opened again from the app.

That matters most for holiday pay. §9.8 and §9.5 keep the +12.07% off every worker screen: the shift card, check-out, earnings history and "Paid so far" all show the base rate only. The only place a worker learns about holiday pay is the agreement. THC's own contract (20260930140100), clause 9 "HOLIDAYS", says that holiday "shall accrue at the rate of 12.07% of hours worked" and sets out how it is booked and paid. A worker saw that once, while signing, and could not find it again.

## Decision

**`/profile/agreement`, "Signed agreement"**: a read-only screen with the signature stamp, then the whole text.

- **The version signed, not the current one.** `my_contract()` (20261002113000) returns the version in `staff.contract_version`. `onboarding_state()` gives the wizard `current_contract_version()` because that is what a candidate is about to sign. A worker who signed the September placeholder signed that text, and a later version is not their agreement. Published versions are immutable, so the text is exactly what was agreed.
- **The stamp** is formatted by the database in UK time, the way `onboarding_state()` does it, and shown as it comes. It is an audit record (§1.8).
- **The text is drawn by the wizard's own component** (`ContractText`, moved out of `ContractStep` with its CSS). The copy reads as the thing signed: bold clause headings and nothing else interpreted. A version still marked `is_placeholder` carries the same note as at 10/11.
- **No summary, no figure.** The screen does not restate the holiday clause, show a rate or calculate an accrual. §9.8 still holds everywhere else, and the hub row says "Your contract, including holiday pay", with no number. The worker reads the terms in THC's words.
- **Who:** wherever Payment information is reachable (`canReachAgreement()` = `canReachPayments()`). That is a working worker, a document-locked worker and a leaver: a leaver's agreement does not stop existing, and their final holiday pay is owed under it (§10.6 step 7). A candidate in the wizard has no row. A removed worker is refused (`account_closed`).
- **The hub row** sits after Payment information. 10/11's line now ends "…kept on your profile, under Signed agreement."

`my_contract()` has ADR-0031's shape: security definer, caller resolved by `staff_caller()` and never passed, pinned search_path, EXECUTE revoked from public and anon. No table policy changes. `contract_versions` was already readable by any signed-in role.

Tests: pgTAP 771; `apps/staff/app/profile/__tests__/agreement.test.tsx` (screen, states, loader) and `profile-hub.test.tsx` (the row, leaver, candidate); `onboarding/__tests__/screens.test.tsx` (10/11's line).

## Not done

- **No holiday balance or accrual figure in the app.** §9.8 says the worker sees the base rate only. Holiday taken is not recorded in this system (clause 9.4 routes requests to payroll@ by email), so a balance would be a guess. Showing one would be a scope change for THC to decide.
- **No PDF download of the agreement.** The screen is the copy. §11.3's documents do not include it.
- **The wording of THC's contract is unchanged.** Clause 9.3's holiday year reads "31 March to 1 April" and "(SI 1988/1833)" cites the wrong year. Both are THC's own slips, kept character for character (20260930140100). Correcting them needs THC to publish a new version, which workers would then sign.
