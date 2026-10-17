import { describe, expect, it } from 'vitest';
import { TERM_LETTER_RUN_OUT_REASON, offersRunOutReason } from '../termLetterReject';

describe('the run-out reason for a term letter (ADR-0112)', () => {
  it('is offered on a University Term Dates Letter and nothing else', () => {
    expect(offersRunOutReason('university_term_dates_letter')).toBe(true);
    expect(offersRunOutReason('university_completion_letter')).toBe(false);
    expect(offersRunOutReason('passport')).toBe(false);
    expect(offersRunOutReason(null)).toBe(false);
    expect(offersRunOutReason(undefined)).toBe(false);
  });

  it('sends a student for the current letter and a graduate for completion evidence', () => {
    expect(TERM_LETTER_RUN_OUT_REASON).toContain('current University Term Dates Letter');
    expect(TERM_LETTER_RUN_OUT_REASON).toContain('Official University Completion Letter');
    // The three evidence forms the completion upload accepts (requirement §2.1).
    expect(TERM_LETTER_RUN_OUT_REASON).toContain('final transcript');
    expect(TERM_LETTER_RUN_OUT_REASON).toContain('official university email');
  });

  it('asks for the completion date, not the results or the award date', () => {
    // An award-only date lifts the cap from the award, so the worker is told
    // which date the document must show — and that results are not needed.
    expect(TERM_LETTER_RUN_OUT_REASON).toContain('course completion date');
    expect(TERM_LETTER_RUN_OUT_REASON).toContain('don’t need to wait for your results');
  });
});
