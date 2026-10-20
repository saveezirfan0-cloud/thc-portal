import { describe, expect, it } from 'vitest';
import { isPhoneQuery, phoneMatches } from '../phoneSearch';

describe('phoneMatches', () => {
  const stored = '+447700900456';

  it('matches the national, international and partial shapes', () => {
    for (const q of [
      '07700 900456',
      '07700-900-456',
      '(07700) 900456',
      '+44 7700 900456',
      '0044 7700 900456',
      '447700900456',
      '7700 900456',
      '0456',
    ]) {
      expect(phoneMatches(stored, q), q).toBe(true);
    }
  });

  it('matches a number stored as typed, not E.164', () => {
    expect(phoneMatches('07700 900456', '+44 7700 900456')).toBe(true);
    expect(phoneMatches('07700 900456', '900456')).toBe(true);
  });

  it('needs at least four digits and a phone-shaped query', () => {
    expect(isPhoneQuery('456')).toBe(false);
    expect(isPhoneQuery('THC-00873')).toBe(false);
    expect(isPhoneQuery('Amara')).toBe(false);
    expect(phoneMatches(stored, '456')).toBe(false);
  });

  it('does not match another number or a missing phone', () => {
    expect(phoneMatches(stored, '07700 900999')).toBe(false);
    expect(phoneMatches(null, '07700 900456')).toBe(false);
    expect(phoneMatches(undefined, '07700 900456')).toBe(false);
  });
});
