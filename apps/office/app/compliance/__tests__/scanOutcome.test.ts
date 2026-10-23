import { describe, expect, it } from 'vitest';
import { canRescan, scanOutcomeMessage } from '../messages';

describe('Retry AI scan wording', () => {
  it('offers a retry for the expiry documents only', () => {
    expect(canRescan('passport')).toBe(true);
    expect(canRescan('visa_document')).toBe(true);
    expect(canRescan('birth_certificate')).toBe(false);
    expect(canRescan('university_term_dates_letter')).toBe(false);
  });

  it('says when the expiry was read', () => {
    expect(scanOutcomeMessage({ confidence: 0.93, expiryFound: true, reasons: [] })).toContain(
      'expiry read',
    );
  });

  it('says why nothing was read', () => {
    const message = scanOutcomeMessage({
      confidence: 0,
      expiryFound: false,
      reasons: ['not_this_document_type', 'no_expiry_date'],
    });
    expect(message).toContain('(0%)');
    expect(message).toContain('right kind of document');
    expect(message).toContain('Enter the date by hand');
    expect(
      scanOutcomeMessage({ confidence: 0, expiryFound: false, reasons: ['timeout'] }),
    ).toContain('too long');
  });
});
