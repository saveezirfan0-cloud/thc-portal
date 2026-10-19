import { describe, expect, it } from 'vitest';
import {
  LEGACY_POLICY,
  parseOfficePolicy,
  readOfficePolicy,
  sessionExpired,
} from '../office-policy';
import { ENROL_PATH, enrolStepPath, twoStepDecision } from '../two-step';
import { sessionEndedNotice } from '../copy';

/** ADR-0164: the pure pieces of the compulsory two-step and the session cap. */
describe('twoStepDecision with two-step compulsory', () => {
  it('no authenticator, below aal2: enrol', () => {
    expect(twoStepDecision({ currentLevel: 'aal1', nextLevel: 'aal1', required: true })).toBe('enrol');
    expect(twoStepDecision({ currentLevel: null, nextLevel: 'aal1', required: true })).toBe('enrol');
  });
  it('an authenticator, below aal2: the code step, required or not', () => {
    expect(twoStepDecision({ currentLevel: 'aal1', nextLevel: 'aal2', required: true })).toBe('verify');
    expect(twoStepDecision({ currentLevel: 'aal1', nextLevel: 'aal2' })).toBe('verify');
  });
  it('at aal2: through', () => {
    expect(twoStepDecision({ currentLevel: 'aal2', nextLevel: 'aal1', required: true })).toBe('pass');
  });
  it('optional (ADR-0057): no authenticator passes at aal1', () => {
    expect(twoStepDecision({ currentLevel: 'aal1', nextLevel: 'aal1', required: false })).toBe('pass');
    expect(twoStepDecision({ currentLevel: 'aal1', nextLevel: 'aal1' })).toBe('pass');
  });
});

describe('enrolStepPath', () => {
  it('carries next, never a sign-in page', () => {
    expect(enrolStepPath('/dashboard')).toBe(ENROL_PATH);
    expect(enrolStepPath('/events/4?tab=board')).toBe('/login/enrol?next=%2Fevents%2F4%3Ftab%3Dboard');
    expect(enrolStepPath('/login/enrol')).toBe(ENROL_PATH);
  });
});

describe('parseOfficePolicy', () => {
  it('reads the database’s answer', () => {
    expect(
      parseOfficePolicy({
        twoStepRequired: false,
        sessionMaxHours: 8,
        sessionStartedAt: '2026-10-19T08:00:00Z',
      }),
    ).toEqual({
      twoStepRequired: false,
      sessionMaxHours: 8,
      sessionStartedAt: Date.parse('2026-10-19T08:00:00Z'),
    });
  });
  it('anything odd is the safe value: required, 12 hours', () => {
    expect(parseOfficePolicy(null)).toEqual({
      twoStepRequired: true,
      sessionMaxHours: 12,
      sessionStartedAt: null,
    });
    expect(parseOfficePolicy({ twoStepRequired: 'false', sessionMaxHours: -1 }).twoStepRequired).toBe(true);
  });
});

describe('sessionExpired', () => {
  const policy = { twoStepRequired: true, sessionMaxHours: 12, sessionStartedAt: 0 };
  it('after the limit, not at it', () => {
    expect(sessionExpired(policy, 12 * 3_600_000)).toBe(false);
    expect(sessionExpired(policy, 12 * 3_600_000 + 1)).toBe(true);
  });
  it('never on an unknown start or a database without the setting', () => {
    expect(sessionExpired({ ...policy, sessionStartedAt: null }, 1e15)).toBe(false);
    expect(sessionExpired({ ...LEGACY_POLICY, sessionStartedAt: 0 }, 1e15)).toBe(false);
  });
});

describe('readOfficePolicy', () => {
  it('a missing function is the old rule set; any other failure is "could not tell"', async () => {
    const missing = { rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'x' } }) };
    expect(await readOfficePolicy(missing as never)).toEqual({ ok: true, policy: LEGACY_POLICY });
    const slow = { rpc: async () => ({ data: null, error: { code: '57014', message: 'x' } }) };
    expect(await readOfficePolicy(slow as never)).toEqual({ ok: false });
    const thrown = {
      rpc: async () => {
        throw new Error('network');
      },
    };
    expect(await readOfficePolicy(thrown as never)).toEqual({ ok: false });
  });
});

describe('sessionEndedNotice', () => {
  it('says how long a sign-in lasts', () => {
    expect(sessionEndedNotice('12')).toBe(
      'For security, a Back Office sign-in lasts 12 hours. Sign in again to carry on where you were.',
    );
    expect(sessionEndedNotice('1')).toContain('lasts 1 hour.');
    expect(sessionEndedNotice('nonsense')).toContain('lasts a set time.');
  });
});
