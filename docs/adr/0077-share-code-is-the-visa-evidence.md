# ADR-0077 · The share-code check is the visa evidence: no visa or status upload and no typed expiry at onboarding

**Status:** Accepted (owner decision, THC, 01.10.2026). A deliberate change from scope v1.6 §2.5 points 3 and 5. · **Amends:** [ADR-0014](0014-onboarding-wizard-seams-and-deviations.md) (the step 4 document sets), [ADR-0018](0018-right-to-work-date-on-verify.md) (on the work visa and dependant branches, the right-to-work date now comes from the share code report alone for new workers), [ADR-0065](0065-right-to-work-evidence-held-after-removal.md) (new workers on branches 3 and 5 have no visa or status document to hold) · **Code:** migration `20261002105000_share_code_is_the_visa_evidence.sql`; pgTAP `765` (and `390` updated)

## Context

§2.5 lists what each right-to-work branch collects in the onboarding wizard:

- **1 UK / Irish:** passport, OR birth certificate + a document showing the NI number. The list of accepted NI documents is §2.5 pt 7.
- **3 Work visa:** passport + share code + visa type (dropdown) + expiry (typed date) + an upload of the visa.
- **5 Dependant / other:** passport + share code + a visa / status document (upload) + expiry.

The gov.uk share-code check (ADR-0025, `rtw_check`, `20260928100000`) already returns the right-to-work-until date. That date goes onto the verified `share_code_report` and from there to `staff.right_to_work_until`. The N1–N4 reminders, CL4, the weekly cap's hard stop and `can_roster_staff()` all read it. §2.5 pt 4 already used the same argument for the student visa on 04.09.2026: "a visa upload adds no compliance value on top of it". For the work visa and dependant branches, the visa copy and the typed expiry are a second, weaker source for a date the check already provides.

THC, 01.10.2026:

> share code is covering this bit, so we won't need them to upload the visa etc, and we will need NI number but not the other stuff at step 4 documents.

The owner then settled three points:

- The **visa type** question on step 1 stays exactly as it is.
- The **NI number** at step 7 (HMRC) stays **optional**, as §2.8 has it.
- The **NI document stays on the UK / Irish birth-certificate route.** That branch has no share code, and under the Home Office's List A a UK birth certificate is acceptable evidence only together with an official document showing the NI number (ADR-0065). So on that route the NI document is half of the right-to-work evidence, not a payroll extra. The share code cannot stand in for it.

## Decision

For every worker who onboards from now on:

- **Step 1 (Right to work):** no branch asks for a typed visa or status expiry.
  - The Work visa branch keeps its visa type dropdown. It is still required, with the same four options, in `rtwErrors()` and in `onboarding_save_right_to_work()`.
  - The share code, its format check and the automated gov.uk check are unchanged. Every branch except UK / Irish still requires the share code.
  - In the branch picker, Work visa reads "Passport + share code + your visa type." and Dependant / other reads "Passport + your gov.uk share code.". UK / Irish is unchanged.
- **Step 4 (Documents),** per branch:

  | Branch | Step 4 documents |
  |---|---|
  | UK / Irish | passport, **or** birth certificate + NI evidence (unchanged, List A) |
  | EU / EEA | passport or national ID (unchanged) |
  | Work visa | passport (no `visa_document`) |
  | International student | passport + University Term Dates Letter, with the optional completion letter (unchanged) |
  | Dependant / other | passport (no `status_document`) |

- **NI number:** typed at step 7 and optional (§2.8, unchanged). The only NI document collected is on the birth-certificate route, as before. ADR-0014's "NI evidence is required only on branch 1's birth-certificate route" still holds.

Where it lives:

- `packages/domain/src/onboarding.ts`: `requiredDocuments()`, `RTW_BRANCHES`, `rtwErrors()` and `rtwFooterHint()`. `needsVisaExpiry()` and `RtwForm.visaExpiry` are removed.
- `apps/staff/app/onboarding/_components/RtwStep.tsx`: the expiry field is removed.
- Migration `20261002105000_share_code_is_the_visa_evidence.sql` redefines three functions:
  - `onboarding_required_docs()`. `onboarding_accepted_docs()`, `onboarding_attach_document()`, `onboarding_submit_documents()` and step 1's dropped-uploads sweep all read it, so they follow without being redefined. A wizard upload of `visa_document` or `status_document` is now refused with `doc_not_for_branch`.
  - `onboarding_save_right_to_work()`. It no longer raises `expiry_required` / `expiry_past`. `p_visa_expiry` stays in the signature so the RPC, its grant and the generated types keep their shape. The function ignores it and writes `onboarding_progress.visa_expiry` as null.
  - `onboarding_documents_missing()`. The Back Office board, the candidate profile, the quiz gate and the Staff App Documents hub all read it. It no longer returns `visa_document` or `status_document`, and still returns `ni_evidence` on the birth-certificate route.
- The Back Office candidate panel's per-branch line (`RTW_REQUIRED`) and the `staff/onboarding-1.html` and `backoffice/onboarding.html` wireframes were updated to match.

### Candidates already in the wizard (one-off, in the same migration)

Some candidates uploaded a visa or status document before this change. If the office rejected one, the wizard can no longer offer the re-upload, and the rejected row would block the quiz for ever (`compliance_blockers`).

The migration therefore marks a row as `superseded` when **all** of these hold:

- it is a `visa_document` or `status_document`, or an `ni_evidence` anywhere except the UK birth-certificate route;
- it is **pending or rejected**;
- the worker is still in onboarding: `interview_requested`, `interview_completed` or `documents`.

Superseded rows are kept read-only, like any other (§2.12). Nothing is deleted.

The migration then runs the §2.3 gate (`onboarding_advance_if_ready`) for each candidate it touched. The row trigger reacts only to a Verify, so without this a candidate whose last blocker was superseded would sit in Documents with nothing outstanding. Such a candidate now moves to Quiz and is sent E12 (ADR-0075), exactly as a Verify would have done.

The step does not touch:

- verified rows;
- NI evidence on the birth-certificate route;
- workers past the documents stage, whose pending documents (for example a renewal from the Documents hub) are still reviewed.

## What is kept, deliberately

- The `doc_type` values `visa_document` and `status_document` stay, and so do the columns `onboarding_progress.visa_type` / `visa_expiry`.
- Existing rows keep working:
  - A verified visa or status document still counts towards `rtw_evidence_until()` (the earliest date wins) and still gets its N1–N4 reminders.
  - A worker who holds one can still renew it from the Documents hub. `submit_document_upload()` accepts a type the worker already has on file.
  - The office reviews the pending documents of workers past onboarding as before.
- The NI re-check on `ni_evidence` (ADR-0040), right-to-work evidence retention after removal (ADR-0065) and the GDPR scrub lists name document types, not requirements, so they are unchanged.
- The Claude extractor's handling of these types stays, for the rows on file.

## Consequences

- **For a new Work visa or Dependant / other worker, the right-to-work date comes from the share-code check alone.** The rule that a non-UK branch needs a dated verified right-to-work record does not change (`compliance_docs_rtw_date_guard`, `20260927150000`). EU settled status may instead carry the explicit "no time limit" confirmation. The office still cannot verify a work visa or dependant worker's share-code report without a date.
- **A new worker's expiry reminders name the share code** ("Right to work · share code"), never a visa document. To renew, the worker enters a new share code from the Documents hub.
- **The one-off can move a candidate on.** If a superseded document was a candidate's last blocker, the migration advances them to Quiz and queues E12 when it runs.
