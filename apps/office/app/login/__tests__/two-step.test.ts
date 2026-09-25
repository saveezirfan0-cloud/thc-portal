import { describe, expect, it } from 'vitest';
import {
  aalFromAccessToken,
  codeError,
  deviceNameError,
  explainCodeError,
  groupSecret,
  landingAfterVerify,
  nextLevelFor,
  normaliseCode,
  twoStepDecision,
  unverifiedTotp,
  verifiedTotp,
  verifyStepPath,
} from '../two-step';

/** The pure half of two-step sign-in (ADR-0037). */

function token(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part(claims)}.signature`;
}

const totp = (status: string, id = `f-${status}`) => ({
  id,
  factor_type: 'totp',
  status,
  friendly_name: 'My phone',
  created_at: '2026-09-25T09:00:00Z',
});

describe('twoStepDecision — who types a code', () => {
  it.each([
    // [current, next, decision]
    ['aal1', 'aal1', 'pass'], // no factor: password is enough (opt-in today)
    ['aal1', 'aal2', 'verify'], // factor, password only: the code step
    ['aal2', 'aal2', 'pass'], // factor, code typed
    [null, 'aal2', 'verify'], // unreadable level is never taken as aal2
    [undefined, 'aal2', 'verify'],
    [null, 'aal1', 'pass'],
  ] as const)('current %j, next %j → %s', (currentLevel, nextLevel, decision) => {
    expect(twoStepDecision({ currentLevel, nextLevel })).toBe(decision);
  });
});

describe('nextLevelFor / verifiedTotp', () => {
  it('only a verified factor raises the bar', () => {
    expect(nextLevelFor(undefined)).toBe('aal1');
    expect(nextLevelFor([])).toBe('aal1');
    expect(nextLevelFor([totp('unverified')])).toBe('aal1');
    expect(nextLevelFor([totp('verified')])).toBe('aal2');
  });

  it('a verified factor of a type the app cannot challenge still locks, not opens', () => {
    const phone = { id: 'p', factor_type: 'phone', status: 'verified' };
    expect(nextLevelFor([phone])).toBe('aal2');
    expect(verifiedTotp([phone])).toBeNull();
  });

  it('finds the verified authenticator and the abandoned set-ups separately', () => {
    const factors = [totp('unverified', 'a'), totp('verified', 'b'), totp('unverified', 'c')];
    expect(verifiedTotp(factors)?.id).toBe('b');
    expect(unverifiedTotp(factors).map((f) => f.id)).toEqual(['a', 'c']);
  });
});

describe('aalFromAccessToken', () => {
  it('reads the aal claim', () => {
    expect(aalFromAccessToken(token({ aal: 'aal1' }))).toBe('aal1');
    expect(aalFromAccessToken(token({ aal: 'aal2', sub: 'x' }))).toBe('aal2');
  });

  it.each([
    ['no token', undefined],
    ['empty', ''],
    ['one segment', 'abc'],
    ['not base64 JSON', 'a.%%%.c'],
    ['no aal claim', token({ sub: 'x' })],
    ['an invented level', token({ aal: 'aal3' })],
  ])('%s → null (fails closed)', (_label, value) => {
    expect(aalFromAccessToken(value)).toBeNull();
  });
});

describe('the code as typed', () => {
  it('strips the spaces and dashes an app shows or a paste brings', () => {
    expect(normaliseCode(' 123 456 ')).toBe('123456');
    expect(normaliseCode('123-456')).toBe('123456');
    expect(normaliseCode(null)).toBe('');
  });

  it.each([
    ['', 'Enter the 6-digit code from your authenticator app.'],
    ['12345a', 'The code is numbers only — 6 digits, no letters.'],
    ['12345', 'The code is 6 digits long. Check you have all of them.'],
    ['1234567', 'The code is 6 digits long. Check you have all of them.'],
  ])('%j is refused before GoTrue is asked', (code, message) => {
    expect(codeError(code)).toBe(message);
  });

  it('six digits pass', () => {
    expect(codeError('012345')).toBeNull();
  });
});

describe('where the code step leads', () => {
  it('keeps a real destination and carries it in the URL', () => {
    expect(landingAfterVerify('/events/42?tab=board')).toBe('/events/42?tab=board');
    expect(verifyStepPath('/events/42?tab=board')).toBe(
      '/login/verify?next=%2Fevents%2F42%3Ftab%3Dboard',
    );
  });

  it('leaves the default out of the URL', () => {
    expect(verifyStepPath('/dashboard')).toBe('/login/verify');
  });

  it.each(['/login', '/login/verify', '/login/verify?next=/login/verify', '/auth/signout'])(
    'never lands on the sign-in pages themselves (%s), so it cannot loop',
    (next) => {
      expect(landingAfterVerify(next)).toBe('/dashboard');
      expect(verifyStepPath(next)).toBe('/login/verify');
    },
  );

  it('does not mistake a route that merely starts with the letters', () => {
    expect(landingAfterVerify('/loginsheet')).toBe('/loginsheet');
  });
});

describe('explainCodeError', () => {
  it('a wrong code says so, in words', () => {
    expect(explainCodeError({ code: 'mfa_verification_failed', status: 422 })).toMatch(
      /did not match/,
    );
  });

  it('rate limits by code or by status', () => {
    expect(explainCodeError({ code: 'over_request_rate_limit' })).toMatch(/Too many attempts/);
    expect(explainCodeError({ status: 429 })).toMatch(/Too many attempts/);
  });

  it('anything else is generic', () => {
    expect(explainCodeError({ code: 'unexpected_failure', status: 500 })).toBe(
      'That did not work. Try again in a moment.',
    );
  });
});

describe('the set-up helpers', () => {
  it('asks for a phone name of sensible length', () => {
    expect(deviceNameError('  ')).toMatch(/Give the phone a name/);
    expect(deviceNameError('x'.repeat(41))).toMatch(/under 40/);
    expect(deviceNameError('Gisela’s iPhone')).toBeNull();
  });

  it('groups the manual key in fours', () => {
    expect(groupSecret('JBSWY3DPEHPK3PXPJBSW')).toBe('JBSW Y3DP EHPK 3PXP JBSW');
    expect(groupSecret('')).toBe('');
  });
});
