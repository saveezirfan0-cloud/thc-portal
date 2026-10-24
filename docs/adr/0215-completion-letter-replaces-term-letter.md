# ADR-0215 · A Completion Letter for a finished course sets the Term Dates Letter aside

**Status:** Accepted (ticket TK-23, Sam Barrington-Wells, 24.10.2026: "Pavan has uploaded both a completion letter and term dates letter. Why are candidates still being allowed to upload both?"). Builds on ADR-0112, ADR-0211 and ADR-0213.

## Context

The Term Dates Letter and the Completion Letter are alternatives (ADR-0112): a student uploads the one or, once graduated, the other.

The wizard still let a student who had uploaded a term letter add a Completion Letter too. Its copy said "Finished your course already? Upload this instead…". The office then had both to review.

Pavan did this on 24.10.2026, and his "Completion Letter" was in fact a CAS statement for a course ending in 2027.

## Decision

- **The database.** `submit_completion_letter()` (`20261027150000`) supersedes the student's pending or rejected Term Dates Letter when the completion date they enter has already passed. It is audited as `term_letter.set_aside` (`by: completion_letter_upload`), and nothing is sent.
  - A completion date still to come leaves the term letter in force. Such a letter can be issued before the final exam (§7).
  - A verified term letter is never touched.
- **The Staff App.** With a term letter on file, the Completion Letter row now reads: "Only if you've already finished your course: uploading this replaces your Term Dates Letter — you don't need both. Still studying? Leave this…". Without one, it ends "Still studying? Leave this."

## Consequences

- The office never has a graduate's term letter and Completion Letter both waiting.
- If that Completion Letter is then rejected, the worker is asked for a new one (ADR-0211). They can still upload a term letter instead if they have not in fact finished.
- A student whose course has not finished, like Pavan, can still have both on file. The office rejects the wrong one, as before.
