# ADR-0177 · A term letter is verified on its holiday dates; an AI "wrong document" is answered

**Status:** Accepted · 20.10.2026 · **Implements:** §2.3 ("+ Add period … the manager should not
be a hostage to OCR/recognition quality"), RULE-20, completion letter requirement §2.1–2.3 ·
**Asked by:** THC, 20.10.2026 (a student shown 20 h while, by their account, on vacation)

`apps/office/app/compliance/ReviewDialogs.tsx` (`TermLetterModal`, `ApproveModal`) ·
`apps/office/app/compliance/queue.ts` (`verifyStep` → `term_dates`, `termDatesProblem`,
`approveNeedsReading`) · `supabase/migrations/20261022100000_review_view_reads_the_ai_type_verdict.sql`

## Context

A student uploaded the same CU London "Student Status Confirmation" twice: as the University
Term Dates Letter and as the Official University Completion Letter. The letter gives stage dates,
points to a website for teaching-block dates and gives an *expected* course finish date. Nothing
on it is a vacation period or a completion.

- **Term letter.** The AI correctly read no vacation ("points to website for term dates"). The
  Compliance Verify had no place to enter or correct holiday dates: only the Onboarding
  candidate screen had §2.3's "+ Add period". Verify saved an empty list without a word, so every
  week became term time (20 h). A letter that *does* print a vacation the AI misses would
  fail the same way, and the reviewer could not fix it.
- **Completion letter.** The AI said "this is a current enrolment/status confirmation letter, not
  a completion letter" (`matchesDocType: false`). The office saw only "AI 0%" and approved it on
  the expected finish date, which releases the student from the term-time limit from that
  date. Since ADR-0163 no API role reads `compliance_docs.ai_extracted`, so the verdict never
  reached the screen.

## Decision

1. **Verify on a term letter opens on its holiday periods**, on /compliance and the staff
   profile alike (one shared dialog). Every period the AI read is shown with both ends inclusive,
   **+ Add period** adds one, **Remove** drops one, and the confirmed list is sent as
   `p_term_dates` to `compliance_verify_document`, which already accepted it. The course level
   (D32) stays beside them.
2. **For a student, "no periods" is said, never defaulted to.** Zero periods is a real answer
   (§2.3), but it puts every week in term time. Verify waits until the reviewer either enters
   periods or ticks "The letter shows no vacation". For a worker not on a student visa the
   periods set no limit, and none is simply none.
3. **The AI's "wrong kind of document" reaches the reviewer.** `compliance_doc_review_v` (owner
   rights, admin gate, ADR-0163) gains `ai_wrong_type_note`, appended. It holds the extractor's
   note when it said the upload does not match its type, and null otherwise. Both screens merge
   it into the queue row by document id.
4. **Approving a completion letter the AI flagged needs the reviewer to say they read it.** The
   dialog shows the AI's note and holds Approve until they tick "it states that the course has
   ended, and the date above is the completion date it gives — not an expected one". The AI
   informs; it does not veto. Reject stays the expected answer for a status letter.

## Consequences

- A term letter whose vacations the AI missed can be verified correctly in one step. The cap
  follows from the dates as before (RULE-20); there is still no hours field.
- These are screen guards. `compliance_verify_document` still accepts an empty list and
  `approve_completion_letter` takes no acknowledgement, so an API caller is not stopped. Both
  RPCs are admin-only, and both stamp the reviewer.
- Documents verified before this are unchanged. A wrongly approved completion letter has no
  undo in the app; correcting one is a database change with an audit entry.
