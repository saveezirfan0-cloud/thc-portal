import { describe, expect, it } from 'vitest';
import { reviewErrorMessage } from '../messages';

/**
 * The database raises tokens; the reviewer reads sentences. Every refusal
 * compliance_verify_document() can raise on a term letter has a mapping, so
 * the Verify press never shows the raw string.
 */
describe('what a refusal means to the manager (messages.ts)', () => {
  it('maps term_letter_expired to a plain sentence, whatever date the database appends (§4.2, 20260927181100)', () => {
    const raw = 'term_letter_expired: every term date on this letter is before 2026-09-25';
    expect(reviewErrorMessage(raw)).toBe(
      'This letter has expired: every term date on it is before today. Reject it and ask the worker for a current letter (§4.2).',
    );
    expect(reviewErrorMessage('term_letter_expired')).toBe(reviewErrorMessage(raw));
    expect(reviewErrorMessage(raw)).not.toContain('term_letter_expired');
  });

  it('keeps the term letter refusals apart from the generic expiry one', () => {
    expect(reviewErrorMessage('already_expired: 2026-09-01')).toBe(
      'This document has already expired (01.09.2026) and cannot be accepted — reject it and ask for a current one (§4.2).',
    );
    expect(reviewErrorMessage('term_dates_invalid')).toBe(
      'A holiday range needs both a start and an end date.',
    );
  });

  it('falls back to the raw string only for a token it has never seen', () => {
    expect(reviewErrorMessage('something new')).toBe('something new');
  });
});
