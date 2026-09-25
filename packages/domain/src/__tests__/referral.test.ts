import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  REFERRAL_CODE_PATTERN,
  isReferralCode,
  normaliseReferralCode,
  referralLink,
} from '../referral';

/** ADR-0040 (docs/18 §5). Unit tests only; the SQL half is pgTAP 650 F. */
const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  resolve(here, '../../../../supabase/migrations/20260930100100_staff_additions_schema.sql'),
  'utf8',
);

describe('isReferralCode', () => {
  it.each([
    ['ABCDEFGH', true],
    ['23456789', true],
    ['HJKMNPQR', true],
    ['ABCDEFGI', false], // I
    ['ABCDEFGO', false], // O
    ['ABCDEFG0', false], // zero
    ['ABCDEFG1', false], // one
    ['abcdefgh', false], // lower case
    ['ABCDEFG', false],
    ['ABCDEFGHJ', false],
    ['', false],
  ] as const)('%s → %s', (code, ok) => {
    expect(isReferralCode(code)).toBe(ok);
  });

  it('the alphabet has no I, O, 0 or 1 and matches the pattern', () => {
    expect(REFERRAL_CODE_ALPHABET).not.toMatch(/[IO01]/);
    expect(REFERRAL_CODE_ALPHABET).toHaveLength(32);
    const code = REFERRAL_CODE_ALPHABET.slice(0, REFERRAL_CODE_LENGTH);
    expect(isReferralCode(code)).toBe(true);
    for (const ch of REFERRAL_CODE_ALPHABET) expect(isReferralCode(ch.repeat(8))).toBe(true);
  });

  it('is the same pattern as both table CHECKs', () => {
    const found = [...sql.matchAll(/check \(code ~ '([^']+)'\)/g)].map((m) => m[1]);
    expect(found).toEqual([REFERRAL_CODE_PATTERN.source, REFERRAL_CODE_PATTERN.source]);
  });
});

describe('normaliseReferralCode — what /apply?ref= passes on', () => {
  it('trims and upper-cases a code someone typed', () => {
    expect(normaliseReferralCode('  abcdefgh ')).toBe('ABCDEFGH');
  });

  it('drops anything that cannot be a code, silently', () => {
    expect(normaliseReferralCode('not-a-code')).toBeNull();
    expect(normaliseReferralCode(null)).toBeNull();
    expect(normaliseReferralCode(undefined)).toBeNull();
  });
});

describe('referralLink', () => {
  it('is {origin}/apply?ref={code}', () => {
    expect(referralLink('https://staff.thehospitalitycompany.co.uk', 'ABCDEFGH')).toBe(
      'https://staff.thehospitalitycompany.co.uk/apply?ref=ABCDEFGH',
    );
  });

  it('does not double a trailing slash', () => {
    expect(referralLink('http://localhost:3001/', 'ABCDEFGH')).toBe(
      'http://localhost:3001/apply?ref=ABCDEFGH',
    );
  });

  it('refuses to build a link for something that is not a code', () => {
    expect(() => referralLink('https://x.test', 'abc')).toThrow(RangeError);
  });
});
