# ADR-0201 · A passport is never verified without an expiry date

**Status:** Accepted (instruction of THC, Sam Barrington-Wells, 23.10.2026) · amends ADR-0199 (which made the passport expiry optional on Verify) · scope §2.6, §4.2, §4.3

## Context

ADR-0199 let the office type a passport's expiry on Verify when the AI read none, but left it blank-able. On 23.10.2026 Richard Palmer verified a passport the AI had read at 0% and the date box was not offered, so it went straight to Verified with no expiry. Sam's reply:

> A candidate should not be able to progress through the system without a passport expiry date being in place – either entered manually or automatically through AI. We cannot afford to have staff members on the system who do not have a Passport expiry date which is being monitored, and blocked if it becomes out of date.

The monitoring already exists: `doc_expires_on()` reads `compliance_docs.expiry_date` for a passport, so the daily job sends the N1–N4 reminders (a month, two weeks, a week, the day) and blocks on the day (§4.2, §4.3). A passport with no expiry on file is simply never watched.

## Decision

1. **Verify needs an expiry for a passport.** The Compliance queue's dialog, the candidate card and the staff profile all ask for it, pre-filled from the AI's read, and Verify stays disabled until it is a real date. The same rule is in the two server actions both Verify buttons call (`verifyDocument` in `compliance/actions.ts` and `onboarding/actions.ts`, via `passportExpiryMissing()`), so a screen that forgot the field still cannot skip it. A national ID card keeps an optional expiry (an EU candidate's alternative to a passport; Sam named passports only — **raise with THC**).
2. **Candidates progress only through Verify.** A candidate moves on when every document is verified, so no passport reaches that point without an expiry; "either entered manually or through AI" is the AI's pre-fill or the reviewer's typed date.
3. **Passports verified before this have none, and are fixed one at a time.** `set_passport_expiry(doc, expiry)` (migration `20261025100000`, pgTAP `931`, pinned in `892`): an office login sets the expiry of a pending or verified passport; a past date is refused (reject and re-upload instead), as is one more than 15 years away; audited as `document.expiry_set` with before and after. The staff profile's Documents tab shows "no expiry — not monitored" with **Add expiry** on such a passport. The next daily run then reminds and blocks from it.
4. **No database trigger yet.** A trigger refusing `review_status = 'verified'` on a passport with no expiry would also refuse every existing pgTAP fixture that verifies one, and those need each to be given a date. It is the right second line of defence and is left as a follow-up rather than guessed at blind (the local pgTAP runner needs the pgTAP extension).

## Consequences

- Passports **already verified without an expiry are not found or fixed automatically**. Find them with the query below and add each expiry from the worker's Documents tab (or have the worker re-upload):

  ```sql
  select s.employee_id, s.first_name, s.last_name, d.id as doc_id, d.reviewed_at
    from compliance_docs d join staff s on s.id = d.staff_id
   where d.doc_type = 'passport' and d.review_status = 'verified'
     and d.expiry_date is null and s.removed_at is null
   order by d.reviewed_at;
  ```

- A list of these on `/compliance` (like the "Right-to-work date missing" rows) would remove the need for the query — a follow-up.
- Retry AI scan (ADR-0199) is how a 0% read is tried again before the date is typed.
- Deploy: nothing new beyond the migration (`deploy-database` applies it) and the ADR-0199 setup.
