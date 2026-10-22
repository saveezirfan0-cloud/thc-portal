# ADR-0187 · A graduate is asked for the Completion Letter only, and the completion date is never typed

**Status:** Accepted · Amends §2.5 pt 4 and the completion letter requirement §2.2 · Builds on ADR-0112, ADR-0183, ADR-0033 · **Owner request:** 23.10.2026

## Context

Two things the office had to work around:

1. **Both letters uploaded.** Step 4 listed a University Term Dates Letter for every International student, with a "graduated? you only need the Completion Letter" notice above it (ADR-0112). Graduates still uploaded both, and the office had to remember to verify only the completion letter, reject the term letter never, and so on. A graduate should only be told to upload the Completion Letter; the Term Dates Letter is not required of them.
2. **The office typed the completion date.** `approve_completion_letter(doc, completion_date, visa_expiry)` made the reviewer enter the course completion date. §4.5 says "nobody types a number — verifying the document is the whole action", and the date is already on the letter, which the AI reads (ADR-0033).

## Decision

### Worker: say whether the course is finished, then one letter

Step 4 of the wizard, for a Student-visa candidate, opens with **"Have you finished your course?"** — *Still studying* / *Finished my course*:

- **Still studying** → the University Term Dates Letter row; no Completion Letter row.
- **Finished** → the Official University Completion Letter row, marked required; **no Term Dates Letter row**, hint, reminder or Submit gate.
- **Not answered** → neither letter is shown, and Submit says "Tell us whether you've finished your course to continue".

The answer is not stored. It opens on whichever letter the candidate has already uploaded, so a reload shows the same screen. The database needs no change for it: `onboarding_submit_documents()` and `onboarding_documents_missing()` already accept a Completion Letter that is pending or verified in place of the term letter (ADR-0112). A rejected Completion Letter is asked for again, never a Term Dates Letter. The review hub shows the Completion Letter row only to a candidate who sent one. The branch card on step 1 and the term-letter row hint no longer tell a graduate to "skip" anything; they say what each case uploads.

### Office: the date comes from the letter

- `approve_completion_letter(doc, visa_expiry)` replaces the three-argument function (dropped, so no API caller can still pass a date). The date applied is `compliance_docs.completion_date` — what `record_document_extraction()` read off the letter — else `completion_date_claimed`, the date supplied with the upload. Neither → `completion_date_unreadable`; an implausible one (before 2000 or more than five years ahead) → `completion_date_implausible`. The office rejects such a letter with a reason asking for a clearer copy.
- Where the read and the worker's date disagree the read is used. The row was already flagged "completion date differs from the worker's" (20261012121300), and the dialog says so.
- `completion_letter_date(doc)` (reviewer only) tells the Approve dialog which date will apply and where it came from. The dialog shows it read-only; Approve is disabled when there is none.
- The visa expiry is still confirmed by the reviewer (unchanged).

## Consequences

- The "both letters uploaded" case stops arising for new candidates. For one that does arise (a legacy row, or an upload made from Documents after onboarding), nothing changes: approving the completion letter supersedes the term letter on its own (ADR-0112), and the office no longer types a date.
- **The office's own upload (D47) still takes a date** with the file, because an office-uploaded letter is not run through the AI reader today. That date is the "supplied with the upload" fallback. Running office uploads through the reader would remove the field; not done here.
- **No stored "course finished" fact.** If the office later wants to report on who said what, or to chase a graduate who answered "Finished" and never uploaded, it needs a column; today the Submit gate is the chase.
- Deviates from `wireframes/staff/onboarding-1.html` (no question, term letter row always shown) and from §2.2 "reviewer confirms/enters the course completion date". This ADR is the record.
