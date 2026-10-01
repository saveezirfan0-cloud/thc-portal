# ADR-0077 · The share code covers the visa; UK / Irish is passport only

**Status:** Accepted (owner request, 01.10.2026). A change to scope v1.6 §2.5 pts 1, 3, 5 and 7.

## Context

§2.5 lists the documents each right-to-work branch collects at onboarding. The owner asked for two changes:

> We don't need this section: Proof of your National Insurance number: an NI card or letter, an HMRC or DWP letter, a P60, or a payslip.
> If a Share Code is being used by the applicant, we don't need to request: visa details and expiry date - this is already covered within the Share Code check

**NI evidence** was asked for in one place only: the UK / Irish branch's alternative to a passport, "birth certificate + a document showing the NI number" (§2.5 pts 1 and 7). Under the Home Office right-to-work checks, a UK birth certificate counts only when it is paired with an official document showing the person's National Insurance number. A birth certificate on its own is not right-to-work evidence. So dropping NI evidence while keeping the birth-certificate route would leave an employer check that does not hold up.

**Visa details** were asked for in the Work visa branch (visa type dropdown, typed expiry and a visa photo or PDF) and in the Dependant / other branch (typed expiry and a visa or status document). Every branch except UK / Irish uses a share code, and the gov.uk check returns the status, the work conditions and the right-to-work-until date. §2.5 pt 4 already made the same argument for students: "No separate student visa upload — the Share Code's gov.uk check already returns visa status, work conditions, and expiry … (confirmed 04.09.2026)."

## Decision

The owner chose both of the following on 01.10.2026:

- **UK / Irish: passport only.** The birth certificate + NI evidence option is removed, so no NI evidence is collected at onboarding.
- **Work visa and Dependant / other: passport + share code.** These branches no longer have a visa type, a typed expiry or a visa / status document upload. The right-to-work expiry comes from the share-code check (§2.6), as it already does for EU / EEA and students.

The document sets are now:

| Branch | Uploads at step 4 | Share code |
|---|---|---|
| UK / Irish citizen | Passport | — |
| EU / EEA settled / pre-settled | Passport or national ID | ✓ |
| Work visa | Passport | ✓ |
| International student | Passport + University Term Dates Letter | ✓ |
| Dependant / other visa | Passport | ✓ |

In code:

- `packages/domain` `requiredDocuments(branch)` takes no document choice. `UkDocChoice`, `NI_EVIDENCE_ACCEPTED`, `VISA_TYPES`, `needsVisaType` and `needsVisaExpiry` are gone, and `RtwForm` no longer has `visaType`, `visaExpiry` or `ukChoice`.
- The Staff App step 1 (`RtwStep`) shows no document choice, visa type or expiry field. On the two visa branches it explains that the share code check covers the visa and its expiry.
- Migration `20261002105000` makes `onboarding_required_docs()` and `onboarding_documents_missing()` return the new sets. `onboarding_save_right_to_work()` keeps its signature and grants but ignores `p_visa_type`, `p_visa_expiry` and `p_uk_doc_choice`, so it no longer raises `visa_type_required`, `expiry_required`, `expiry_past` or `doc_choice_required`. Candidates who have not submitted step 4 are moved onto the new sets.
- `wireframes/staff/onboarding-1.html` shows the new step 1. pgTAP 765 and `onboarding.sql.test.ts` hold the SQL and TypeScript to the same sets.

## Consequences

- **Documents already on file are untouched.** The `doc_type` enum, the Needs review filters, the NI check (D43), the office uploads, GDPR retention (ADR-0065) and the AI extraction all keep handling `birth_certificate`, `ni_evidence`, `visa_document` and `status_document`, because existing workers have them and the office can still upload them.
- **A UK / Irish worker who already supplied a birth certificate + NI evidence is not asked for a passport.** `onboarding_documents_missing()` still accepts that pair when the worker holds it. Nobody can supply the pair any more.
- **Submitted sets stay as they were sent.** A candidate who submitted step 4 with a visa document, or with a birth certificate + NI evidence, is reviewed on what they sent.
- **The right-to-work date on the visa branches depends on the share-code check.** Until the automated gov.uk check is switched on (docs/17), the office checks each share code by hand and types the right-to-work-until date, as it already does for EU / EEA and students. A visa holder is never rostered past that date (`canRoster()`), and a missing date already holds the rota (`20260927150000`).
- **A UK / Irish candidate with no passport cannot complete onboarding in the app.** If THC wants another route for them (for example a birth certificate *with* NI evidence, as before), that reverses the first half of this ADR.
