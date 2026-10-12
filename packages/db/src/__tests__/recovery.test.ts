import { describe, expect, it } from 'vitest';
import {
  RECOVERY_WINDOW_SECONDS,
  isRecentRecoverySession,
  readRecoverySession,
  shownEmail,
} from '../recovery';

/**
 * A3 (/reset) sets a password from the session alone, so the session must
 * be one a reset link made in the last 15 minutes (packages/db/src/recovery.ts).
 */
const NOW = Date.UTC(2026, 9, 12, 10, 0, 0);
const secondsAgo = (s: number) => Math.floor(NOW / 1000) - s;

describe('isRecentRecoverySession', () => {
  it('a token_hash link (amr otp) opened a minute ago passes', () => {
    expect(
      isRecentRecoverySession({ amr: [{ method: 'otp', timestamp: secondsAgo(60) }] }, NOW),
    ).toBe(true);
  });

  it('a PKCE recovery link (amr recovery) passes', () => {
    expect(
      isRecentRecoverySession({ amr: [{ method: 'recovery', timestamp: secondsAgo(5) }] }, NOW),
    ).toBe(true);
  });

  it('a password sign-in never passes, however recent', () => {
    expect(
      isRecentRecoverySession({ amr: [{ method: 'password', timestamp: secondsAgo(1) }] }, NOW),
    ).toBe(false);
    expect(
      isRecentRecoverySession(
        {
          amr: [
            { method: 'totp', timestamp: secondsAgo(1) },
            { method: 'password', timestamp: secondsAgo(2) },
          ],
        },
        NOW,
      ),
    ).toBe(false);
  });

  it('a recovery link opened more than 15 minutes ago is stale', () => {
    const at = (s: number) => ({ amr: [{ method: 'otp', timestamp: secondsAgo(s) }] });
    expect(isRecentRecoverySession(at(RECOVERY_WINDOW_SECONDS), NOW)).toBe(true);
    expect(isRecentRecoverySession(at(RECOVERY_WINDOW_SECONDS + 1), NOW)).toBe(false);
  });

  it('unreadable claims fail closed', () => {
    for (const claims of [
      null,
      undefined,
      'otp',
      {},
      { amr: 'otp' },
      { amr: ['otp'] },
      { amr: [{ method: 'otp' }] },
      { amr: [{ method: 'otp', timestamp: '1760263200' }] },
      { amr: [{ method: 'otp', timestamp: secondsAgo(-3600) }] },
    ]) {
      expect(isRecentRecoverySession(claims, NOW)).toBe(false);
    }
  });
});

describe('readRecoverySession', () => {
  const reader = (result: unknown) => ({
    auth: { getClaims: async () => result as { data: { claims: object } | null } },
  });

  it('no verified claims → none', async () => {
    expect(await readRecoverySession(reader({ data: null, error: null }), NOW)).toEqual({
      state: 'none',
      email: null,
    });
  });

  it('a getClaims that throws → none', async () => {
    const broken = {
      auth: {
        getClaims: async (): Promise<{ data: null }> => {
          throw new Error('jwks unreachable');
        },
      },
    };
    expect((await readRecoverySession(broken, NOW)).state).toBe('none');
  });

  it('a password session → other, with its email', async () => {
    const claims = {
      email: 'a@b.example',
      amr: [{ method: 'password', timestamp: secondsAgo(1) }],
    };
    expect(await readRecoverySession(reader({ data: { claims } }), NOW)).toEqual({
      state: 'other',
      email: 'a@b.example',
    });
  });

  it('a fresh reset link → recent', async () => {
    const claims = { email: 'a@b.example', amr: [{ method: 'otp', timestamp: secondsAgo(1) }] };
    expect((await readRecoverySession(reader({ data: { claims } }), NOW)).state).toBe('recent');
  });
});

describe('shownEmail (A2 reads ?to= back)', () => {
  it('an address is shown', () => {
    expect(shownEmail('gisela@thc.example')).toBe('gisela@thc.example');
    expect(shownEmail(' a.b+c@d-e.co.uk ')).toBe('a.b+c@d-e.co.uk');
  });

  it('anything else is not', () => {
    for (const value of [
      undefined,
      null,
      '',
      'Call 0800 123 456 to verify your account',
      'a@b',
      'a b@c.example',
      'x@y.example <script>',
      `${'a'.repeat(250)}@b.example`,
    ]) {
      expect(shownEmail(value)).toBeNull();
    }
  });
});
