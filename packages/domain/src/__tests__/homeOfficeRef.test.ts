import { describe, expect, it } from 'vitest';
import {
  homeOfficeCheckLatest,
  homeOfficeCheckUntil,
  homeOfficeRefError,
  isValidHomeOfficeRef,
  normaliseHomeOfficeRef,
} from '../homeOfficeRef';

/**
 * The Home Office reference (ADR-0182). The same examples are run against
 * the SQL twins in pgTAP 919, and onboarding.sql.test.ts holds the two
 * patterns to one literal.
 */
describe('the Home Office reference', () => {
  it('is stored trimmed, upper case, with single inner spaces', () => {
    expect(normaliseHomeOfficeRef('  abc 123456 ')).toBe('ABC 123456');
    expect(normaliseHomeOfficeRef('u1234567 /  001')).toBe('U1234567 / 001');
    expect(normaliseHomeOfficeRef(null)).toBe('');
  });

  it('reads every Unicode space a phone or PDF pastes as a space (pgTAP 919 runs these in SQL)', () => {
    expect(normaliseHomeOfficeRef('ABC\u00a0123456')).toBe('ABC 123456');
    expect(normaliseHomeOfficeRef('\u202fU1234567\u00a0/\u2009001\u3000')).toBe('U1234567 / 001');
    expect(isValidHomeOfficeRef('ABC\u00a0123456')).toBe(true);
    expect(normaliseHomeOfficeRef('\ufeffABC123456')).toBe('ABC123456');
  });

  it.each([
    ['ABC123456', 'an Application Registration Card number'],
    ['1234-5678-9012-3456', 'a 16-digit application number with dashes'],
    ['u1234567/001', 'a Home Office file reference, in lower case'],
    ['GWF012345678', 'a visa application reference'],
  ])('accepts %s (%s)', (ref) => {
    expect(isValidHomeOfficeRef(ref)).toBe(true);
    expect(homeOfficeRefError(ref)).toBeNull();
  });

  it.each([
    ['ABCDEFGH', 'no digit'],
    ['A123', 'too short'],
    ['A1'.repeat(16), 'over 30 characters'],
    ['ABC#12345', 'a character a reference never has'],
    ['-ABC12345', 'starting with a dash'],
  ])('refuses %s (%s)', (ref) => {
    expect(isValidHomeOfficeRef(ref)).toBe(false);
    expect(homeOfficeRefError(ref)).toMatch(/exactly as the Home Office wrote it/);
  });

  it('asks for it when blank', () => {
    expect(homeOfficeRefError('   ')).toBe('Enter your Home Office reference.');
    expect(isValidHomeOfficeRef(undefined)).toBe(false);
  });
});

describe('the six months of a Home Office check result', () => {
  // The same vectors run against home_office_check_until() in pgTAP 920.
  it.each([
    ['2026-10-21', '2027-04-21'],
    ['2026-08-31', '2027-02-28'],
    ['2027-08-31', '2028-02-29'],
    ['2026-12-31', '2027-06-30'],
    ['2026-07-15', '2027-01-15'],
    ['2026-02-28', '2026-08-28'],
  ])('approved %s → right to work until %s', (approved, until) => {
    expect(homeOfficeCheckUntil(approved)).toBe(until);
  });

  it('the latest end date the office may type is a year on, clamped the same way', () => {
    expect(homeOfficeCheckLatest('2026-10-21')).toBe('2027-10-21');
    expect(homeOfficeCheckLatest('2028-02-29')).toBe('2029-02-28');
  });

  it('is null for a date that does not exist', () => {
    expect(homeOfficeCheckUntil('2026-02-30')).toBeNull();
    expect(homeOfficeCheckUntil('')).toBeNull();
  });
});
