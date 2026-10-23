import { describe, expect, it } from 'vitest';
import { identityExpiryField, identityExpiryProblem } from '../rtw';

describe('a passport or ID card expiry on Verify', () => {
  it('is offered for a passport and a national ID card, and nothing else', () => {
    expect(identityExpiryField('passport')?.label).toBe('Passport expiry');
    expect(identityExpiryField('national_id')?.label).toBe('ID card expiry');
    expect(identityExpiryField('visa_document')).toBeNull();
    expect(identityExpiryField('birth_certificate')).toBeNull();
  });

  it('is optional, but a typed date must be a real, plausible one', () => {
    expect(identityExpiryProblem('')).toBeNull();
    expect(identityExpiryProblem('2031-04-09')).toBeNull();
    expect(identityExpiryProblem('09/04/2031')).not.toBeNull();
    expect(identityExpiryProblem('1985-01-01')).not.toBeNull();
  });
});
