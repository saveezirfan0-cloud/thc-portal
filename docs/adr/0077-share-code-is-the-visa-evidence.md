# ADR-0077 · The share-code check is the visa evidence: no visa upload, no typed expiry, no NI evidence at onboarding

**Status:** Accepted (owner decision, THC, 01.10.2026). A deliberate change from scope v1.6 §2.5 points 1, 3, 5 and 7.

## Context

§2.5 lists what each right-to-work branch collects in the onboarding wizard:

- **1 UK / Irish:** passport, OR birth certificate + a document showing the NI number (the NI evidence list is §2.5 pt 7).
- **3 Work visa:** passport + share code + visa type (dropdown) + expiry (typed date) + an upload of the visa.
- **5 Dependant / other:** passport + share code + a visa / status document (upload) + expiry.

The gov.uk share-code check (ADR-0025, `rtw_check`, `20260928100000`) already returns the right-to-work-until date. That date goes onto the verified `share_code_report`, and from there to `staff.right_to_work_until`. The N1–N4 reminders, CL4, the weekly cap's hard stop and `can_roster_staff()` all read it. §2.5 pt 4 already applied the same reasoning to the student visa on 04.09.2026: "a visa upload adds no compliance value on top of it". For the work visa and dependant branches, the visa copy and the typed expiry are a second, weaker source for a date the check already gives us.

THC, 01.10.2026:

> share code is covering this bit, so we won't need them to upload the visa etc, and we will need NI number but not the other stuff at step 4 documents.

The owner then clarified two points the same day:

- the **visa type** question on step 1 stays exactly as it is;
- the **NI number** at step 7 (HMRC) stays **optional**, as §2.8 has it.

## Decision

For every worker who onboards from now on:

- **Step 1 (Right to work):** no branch asks for a typed visa or status expiry. The Work visa branch keeps its visa type dropdown, which is still required, with the same four options, in `rtwErrors()` and in `onboarding_save_right_to_work()`. The share code, its format check and the automated gov.uk check do not change, and every branch except UK / Irish still requires the share code. The branch picker now reads:
  - UK / Irish: "Passport — or your birth certificate. No share code."
  - Work visa: "Passport + share code + your visa type."
  - Dependant / other: "Passport + your gov.uk share code."
- **Step 4 (Documents),** per branch:

  | Branch | Documents |
  |---|---|
  | UK / Irish | passport, **or** birth certificate (on its own, with no NI evidence) |
  | EU / EEA | passport or national ID (unchanged) |
  | Work visa | passport (no `visa_document`) |
  | International student | passport + University Term Dates Letter, with the optional completion letter (unchanged) |
  | Dependant / other | passport (no `status_document`) |

- **NI number:** it is typed at step 7 and stays optional (§2.8, unchanged). No NI document is collected at onboarding.

Where it lives:

- `packages/domain/src/onboarding.ts`: `requiredDocuments()`, `RTW_BRANCHES`, `rtwErrors()` and `rtwFooterHint()`. `needsVisaExpiry()` and `RtwForm.visaExpiry` are removed, and so is `NI_EVIDENCE_ACCEPTED`, which had no other reader.
- `apps/staff/app/onboarding/_components/RtwStep.tsx`: the expiry field is gone, and the UK toggle reads "Birth certificate".
- Migration `20261002105000_share_code_is_the_visa_evidence.sql` redefines three functions:
  - `onboarding_required_docs()`. `onboarding_accepted_docs()`, `onboarding_attach_document()`, `onboarding_submit_documents()` and step 1's dropped-uploads sweep all read it, so they follow without being redefined. A wizard upload of `visa_document`, `status_document` or `ni_evidence` is now refused with `doc_not_for_branch`.
  - `onboarding_save_right_to_work()`. It no longer raises `expiry_required` / `expiry_past`. `p_visa_expiry` stays in the signature so the RPC, its grant and the generated types keep their shape, but the function ignores it: `onboarding_progress.visa_expiry` is written as null.
  - `onboarding_documents_missing()`. The Back Office board, the candidate profile, the quiz gate and the Staff App Documents hub all read it. It no longer returns the tokens `visa_document`, `status_document` or `ni_evidence`.
- The Back Office candidate panel's per-branch line (`RTW_REQUIRED`) and the `staff/onboarding-1.html` wireframe were updated to match.

## What is kept, deliberately

No data is deleted, and nothing in the schema is narrowed:

- The `doc_type` values `visa_document`, `status_document` and `ni_evidence` stay. So do the columns `onboarding_progress.visa_type` / `visa_expiry`.
- Rows that are already uploaded keep working exactly as before:
  - A pending row is still verified or rejected in Compliance and on the candidate profile.
  - A verified visa or status document still counts towards `rtw_evidence_until()`, which takes the earliest date, and still gets its N1–N4 reminders.
  - A worker who holds such a document can still renew it from the Documents hub. `submit_document_upload()` accepts a type the worker already has on file.
  - The NI re-check on `ni_evidence` (ADR-0040), right-to-work evidence retention after removal (ADR-0065), and the GDPR scrub lists all name types, not requirements, so they are unchanged.
- The Claude extractor's handling of these types stays, for the rows on file.

## Consequences

- **For a new Work visa or Dependant / other worker, the right-to-work date comes from the share-code check alone.** The rule that every non-UK branch must have a dated (or, for EU settled status, explicitly no-time-limit) verified right-to-work record does not change (`compliance_docs_rtw_date_guard`, `20260927150000`). The office still cannot verify a work visa or dependant worker's share-code report without a date.
- **A new worker's expiry reminders name the share code** ("Right to work · share code"), never a visa document. The renewal is a new share code from the Documents hub.
- **One edge case for workers already mid-wizard.** Suppose a worker uploaded a visa, status document or NI evidence before this change, submitted step 4, and the office then rejects that document. The wizard no longer lists it, so the worker cannot re-upload it from the wizard. The rejected row still blocks the quiz (`compliance_blockers`), as every rejected document does. Today the only office action that clears it is Reset to candidate. The lighter fix is an admin data change that marks that one row `superseded`. So: verify, rather than reject, any such document still pending for a candidate. A pending row in the same position is simply verified. If this happens in practice, an office "no longer required" action is the follow-up.
- §2.5 pt 7's NI evidence list no longer drives anything at onboarding. The office can still review the NI evidence rows that are already on file.
