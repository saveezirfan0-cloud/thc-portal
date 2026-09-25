import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PASSWORD_MIN_LENGTH } from '@thc/domain';

/**
 * Change password on "Your account" (ADR-0036).
 *
 * The rules are /reset's (@thc/domain password.ts). The current password is
 * re-verified server-side against the SESSION's email on a cookie-less
 * client before updateUser runs on the caller's own session; nothing is
 * changed when that check fails.
 */
type AuthErr = null | { status?: number; code?: string; message: string };

const state = vi.hoisted(() => ({
  user: { id: 'u1', email: 'hannah.brooks@leonardo-stpauls.co.uk' } as null | {
    id: string;
    email?: string;
  },
  verifyError: null as AuthErr,
  updateError: null as AuthErr,
  verifiedWith: [] as { email: string; password: string }[],
  verifierOptions: [] as unknown[],
  verifierSignOuts: [] as unknown[],
  updates: [] as unknown[],
  sessionSignOuts: [] as unknown[],
}));

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user } }),
      updateUser: async (attrs: unknown) => {
        state.updates.push(attrs);
        return { data: {}, error: state.updateError };
      },
      signOut: async (opts: unknown) => {
        state.sessionSignOuts.push(opts);
        return { error: null };
      },
      // The cookie-bound client must never be the one that re-verifies:
      // signing in on it would replace this device's session cookies.
      signInWithPassword: async () => {
        throw new Error('re-verification must not run on the cookie-bound client');
      },
    },
  }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, _key: string, options: unknown) => {
    state.verifierOptions.push(options);
    return {
      auth: {
        signInWithPassword: async (creds: { email: string; password: string }) => {
          state.verifiedWith.push(creds);
          return { data: {}, error: state.verifyError };
        },
        signOut: async (opts: unknown) => {
          state.verifierSignOuts.push(opts);
          return { error: null };
        },
      },
    };
  },
}));

const { changePassword } = await import('../account/actions');
const { PASSWORD_COPY } = await import('../account/copy');

const GOOD = 'harbour-lights-2026';
const CURRENT = 'old-password-1';

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const valid = (over: Record<string, string> = {}) =>
  form({ current: CURRENT, password: GOOD, confirm: GOOD, ...over });

const saved = { ...process.env };
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});
afterAll(() => {
  process.env = saved;
});
beforeEach(() => {
  state.user = { id: 'u1', email: 'hannah.brooks@leonardo-stpauls.co.uk' };
  state.verifyError = null;
  state.updateError = null;
  state.verifiedWith = [];
  state.verifierOptions = [];
  state.verifierSignOuts = [];
  state.updates = [];
  state.sessionSignOuts = [];
});

describe('Change password · the rules are /reset’s', () => {
  it('asks for the current password first', async () => {
    const out = await changePassword(null, valid({ current: '' }));
    expect(out).toEqual({ ok: false, message: PASSWORD_COPY.currentMissing, round: 0 });
    expect(state.verifiedWith).toEqual([]);
  });

  it.each([
    ['too short', 'short1', 'short1', `Use at least ${PASSWORD_MIN_LENGTH} characters.`],
    ['no number', 'no-digits-here', 'no-digits-here', 'Include at least one number.'],
    ['mismatch', GOOD, `${GOOD}x`, 'Passwords don’t match.'],
  ])('refuses %s with the /reset message, before any network call', async (_, p, c, message) => {
    const out = await changePassword(null, valid({ password: p, confirm: c }));
    expect(out.ok).toBe(false);
    expect(out.message).toBe(message);
    expect(state.verifiedWith).toEqual([]);
    expect(state.updates).toEqual([]);
  });

  it('refuses a new password that is the current one', async () => {
    const out = await changePassword(null, valid({ current: GOOD }));
    expect(out.message).toBe(PASSWORD_COPY.samePassword);
    expect(state.updates).toEqual([]);
  });

  it('says so when the environment has no Supabase project', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    try {
      const out = await changePassword(null, valid());
      expect(out.message).toBe(PASSWORD_COPY.noProject);
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    }
  });
});

describe('Change password · the current password is re-verified server-side', () => {
  it('checks it against the session’s email, not anything from the form, on a cookie-less client', async () => {
    const fd = valid();
    fd.set('email', 'attacker@example.com');
    await changePassword(null, fd);
    expect(state.verifiedWith).toEqual([
      { email: 'hannah.brooks@leonardo-stpauls.co.uk', password: CURRENT },
    ]);
    expect(state.verifierOptions[0]).toMatchObject({
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  it('changes nothing when the current password is wrong', async () => {
    state.verifyError = { status: 400, code: 'invalid_credentials', message: 'Invalid login' };
    const out = await changePassword(null, valid());
    expect(out).toEqual({ ok: false, message: PASSWORD_COPY.currentWrong, round: 0 });
    expect(state.updates).toEqual([]);
    expect(state.sessionSignOuts).toEqual([]);
  });

  it('tells a rate-limited caller to wait, not that the password is wrong', async () => {
    state.verifyError = { status: 429, code: 'over_request_rate_limit', message: 'Too many' };
    const out = await changePassword(null, valid());
    expect(out.message).toBe(PASSWORD_COPY.tooMany);
    expect(state.updates).toEqual([]);
  });

  it('refuses a signed-out caller without trying anything', async () => {
    state.user = null;
    const out = await changePassword(null, valid());
    expect(out.message).toBe(PASSWORD_COPY.signedOut);
    expect(state.verifiedWith).toEqual([]);
  });
});

describe('Change password · the change', () => {
  it('updates this session’s password, ends the check’s session and signs out other devices', async () => {
    const out = await changePassword(null, valid());
    expect(out).toEqual({ ok: true, message: PASSWORD_COPY.changed, round: 1 });
    expect(state.updates).toEqual([{ password: GOOD }]);
    expect(state.verifierSignOuts).toEqual([{ scope: 'local' }]);
    expect(state.sessionSignOuts).toEqual([{ scope: 'others' }]);
  });

  it('counts successful rounds so the form clears after each one', async () => {
    const first = await changePassword(null, valid());
    const refused = await changePassword(first, valid({ current: '' }));
    expect(refused.round).toBe(1);
    const second = await changePassword(refused, valid());
    expect(second.round).toBe(2);
  });

  it.each([
    [{ code: 'same_password', message: 'New password should be different' }, 'samePassword'],
    [{ code: 'reauthentication_needed', message: 'Reauthentication needed' }, 'reauth'],
    [{ code: 'weak_password', message: 'Password is known to be weak' }, 'breached'],
    [{ status: 500, message: 'Database error' }, 'failed'],
  ] as const)('maps a Supabase refusal (%o) to its message', async (error, key) => {
    state.updateError = error;
    const out = await changePassword(null, valid());
    expect(out.ok).toBe(false);
    expect(out.message).toBe(PASSWORD_COPY[key]);
    expect(state.sessionSignOuts).toEqual([]);
  });
});
