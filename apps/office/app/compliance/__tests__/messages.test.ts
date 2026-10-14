import { describe, expect, it, vi } from 'vitest';
import { reviewErrorMessage } from '../messages';

/**
 * The database raises tokens; the reviewer reads sentences. Every refusal
 * compliance_verify_document() can raise on a term letter has a mapping, so
 * the Verify press never shows the raw string.
 */
describe('what a refusal means to the manager (messages.ts)', () => {
  it('maps term_letter_expired to a plain sentence, whatever date the database appends (§4.2, 20260928110300)', () => {
    const raw = 'term_letter_expired: every term date on this letter is before 2026-09-25';
    expect(reviewErrorMessage(raw)).toBe(
      'This letter has expired: every term date on it is before today. Reject it and ask the worker for a current letter.',
    );
    expect(reviewErrorMessage('term_letter_expired')).toBe(reviewErrorMessage(raw));
    expect(reviewErrorMessage(raw)).not.toContain('term_letter_expired');
  });

  it('keeps the term letter refusals apart from the generic expiry one', () => {
    expect(reviewErrorMessage('already_expired: 2026-09-01')).toBe(
      'This document has already expired (01.09.2026) and cannot be accepted — reject it and ask for a current one.',
    );
    expect(reviewErrorMessage('term_dates_invalid')).toBe(
      'A holiday range needs both a start and an end date.',
    );
  });

  // Release audit D-M5: the fallback used to be the raw string. A sentence
  // the database wrote for people is still shown; a token or a Postgres
  // template never is (_lib/dbError).
  it('falls back to a sentence, never to a raw token or template', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(reviewErrorMessage('Something new from the database')).toBe(
      'Something new from the database.',
    );
    expect(reviewErrorMessage('some_new_token')).not.toContain('some_new_token');
    expect(reviewErrorMessage('permission denied for table compliance_docs')).not.toContain(
      'compliance_docs',
    );
    quiet.mockRestore();
  });
});
