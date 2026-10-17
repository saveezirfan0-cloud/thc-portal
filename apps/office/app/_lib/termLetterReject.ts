/**
 * The ready-made N8 reason for a University Term Dates Letter that has run
 * out, offered in both Reject boxes (Compliance queue and the candidate
 * profile).
 *
 * The office was rejecting an out-of-date letter with a hand-typed reason,
 * and push N8 ("Document rejected — [reason]. Re-upload.") then sent the
 * worker back for another term letter. A worker whose course has ended has
 * no newer one: the route for them is the completion letter, which ADR-0112
 * already accepts in place of the term letter, and its evidence is the
 * course completion date, not the results (requirement §2.1, §2.3). The
 * reason says both, and asks for the completion date by name, because a
 * document that only states an award date lifts the cap from that date
 * instead (`completionDateKind: 'award'`).
 */
export const TERM_LETTER_RUN_OUT_REASON =
  'This letter has run out — its last date has passed or is about to, so it can’t cover your shifts. ' +
  'Still studying? Upload your current University Term Dates Letter. ' +
  'Course finished? You don’t need to wait for your results: upload your Official University Completion Letter instead ' +
  '(a final transcript or an official university email also works), showing your course completion date.';

export const TERM_LETTER_DOC_TYPE = 'university_term_dates_letter';

/** Whether the Reject box for this document offers the run-out reason. */
export function offersRunOutReason(docType: string | null | undefined): boolean {
  return docType === TERM_LETTER_DOC_TYPE;
}
