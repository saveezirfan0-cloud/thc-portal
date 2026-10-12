import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PASSWORD_MIN_LENGTH } from '@thc/domain';

/**
 * Change password on "Your account" (ADR-0051; security review 12.10).
 *
 * The rules are /reset's (@thc/domain password.ts). One attempt is claimed
 * and counted in a single call (password_check_begin) before the current
 * password is re-verified on a cookie-less `verifier` client against the
 * SESSION's email. The change then runs on the verifier's brand-new session
 * — which the device adopts first — because Supabase refuses a password
 * change from a session over 24 hours old (`secure_password_change`).
 */
type AuthErr = null | { status?: number; code?: string; message: string };

const FRESH = { access_token: 'fresh-access', refresh_token: 'fresh-refresh' };

const state = vi.hoisted(() => ({
  user: { id: 'u1', email: 'hannah.brooks@leonardo-stpauls.co.uk' } as null | {
    id: string;
    email?: string;
  },
  verifyError: null as AuthErr,
  verifySession: null as unknown,
  adoptError: null as AuthErr,
  updateError: null as AuthErr,
  othersSignOutError: null as AuthErr,
  verifiedWith: [] as { email: string; password: string }[],
  verifierOptions: [] as unknown[],
  verifierSignOuts: [] as unknown[],
  verifierUpdates: [] as unknown[],
  adopted: [] as unknown[],
  deviceSignOuts: [] as unknown[],
  // password_check_begin (20261012120200): an attempt id, or null past the limit.
  attempt: 41 as unknown,
  beginError: null as null | { code?: string; message: string },
  releaseError: null as null | { code?: string; message: string },
  rpcs: [] as { fn: string; args?: unknown }[],
}));

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    rpc: async (fn: string, args?: unknown) => {
      state.rpcs.push({ fn, args });
      if (fn === 'password_check_begin') {
        return { data: state.beginError ? null : state.attempt, error: state.beginError };
      }
      if (fn === 'password_check_release') return { data: null, error: state.releaseError };
      throw new Error(`unexpected rpc ${fn}`);
    },
    auth: {
      getUser: async () => ({ data: { user: state.user } }),
      setSession: async (tokens: unknown) => {
        state.adopted.push(tokens);
        return { data: {}, error: state.adoptError };
      },
      signOut: async (opts: unknown) => {
        state.deviceSignOuts.push(opts);
        return { error: null };
      },
      // The cookie-bound client must never re-verify (it would replace this
      // device's cookies with no "keep me signed in" choice) nor change the
      // password (its session may be weeks old: reauthentication_needed).
      signInWithPassword: async () => {
        throw new Error('re-verification must not run on the cookie-bound client');
      },
      updateUser: async () => {
        throw new Error('the change must run on the fresh verifier session');
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
          return state.verifyError
            ? { data: { session: null }, error: state.verifyError }
            : { data: { session: state.verifySession }, error: null };
        },
        updateUser: async (attrs: unknown) => {
          state.verifierUpdates.push(attrs);
          return { data: {}, error: state.updateError };
        },
        signOut: async (opts: { scope?: string }) => {
          state.verifierSignOuts.push(opts);
          return { error: opts?.scope === 'others' ? state.othersSignOutError : null };
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

const released = () => state.rpcs.filter((r) => r.fn === 'password_check_release');

const saved = { ...process.env };
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});
afterAll(() => {
  process.env = saved;
});
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  state.user = { id: 'u1', email: 'hannah.brooks@leonardo-stpauls.co.uk' };
  state.verifyError = null;
  state.verifySession = { ...FRESH };
  state.adoptError = null;
  state.updateError = null;
  state.othersSignOutError = null;
  state.verifiedWith = [];
  state.verifierOptions = [];
  state.verifierSignOuts = [];
  state.verifierUpdates = [];
  state.adopted = [];
  state.deviceSignOuts = [];
  state.attempt = 41;
  state.beginError = null;
  state.releaseError = null;
  state.rpcs = [];
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
    expect(state.rpcs).toEqual([]);
  });

  it('refuses a new password that is the current one', async () => {
    const out = await changePassword(null, valid({ current: GOOD }));
    expect(out.message).toBe(PASSWORD_COPY.samePassword);
    expect(state.verifierUpdates).toEqual([]);
  });

  it('says so when the environment is not connected', async () => {
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
    expect(state.adopted).toEqual([]);
    expect(state.verifierUpdates).toEqual([]);
    expect(state.verifierSignOuts).toEqual([]);
  });

  it('tells a rate-limited caller to wait, not that the password is wrong', async () => {
    state.verifyError = { status: 429, code: 'over_request_rate_limit', message: 'Too many' };
    const out = await changePassword(null, valid());
    expect(out.message).toBe(PASSWORD_COPY.tooMany);
    expect(state.verifierUpdates).toEqual([]);
  });

  it('refuses a signed-out caller without trying anything', async () => {
    state.user = null;
    const out = await changePassword(null, valid());
    expect(out.message).toBe(PASSWORD_COPY.signedOut);
    expect(state.verifiedWith).toEqual([]);
    expect(state.rpcs).toEqual([]);
  });
});

describe('Change password · the change runs on the fresh session (secure_password_change)', () => {
  it('adopts the verified session on this device, changes the password on it, then signs out the others', async () => {
    const out = await changePassword(null, valid());
    expect(out).toEqual({ ok: true, message: PASSWORD_COPY.changed, round: 1 });
    // The device now holds the fresh session (cookies written through the
    // cookie-bound client, so "keep me signed in" is honoured)…
    expect(state.adopted).toEqual([FRESH]);
    // …the change is made on that fresh session, never the device's old one…
    expect(state.verifierUpdates).toEqual([{ password: GOOD }]);
    // …and 'others' is sent from it, so this device stays signed in.
    expect(state.verifierSignOuts).toEqual([{ scope: 'others' }]);
    expect(state.deviceSignOuts).toEqual([]);
  });

  it('a device session over 24 hours old no longer matters: nothing is asked of it but to adopt', async () => {
    // The cookie-bound mock throws on updateUser; reaching ok proves it was never used.
    const out = await changePassword(null, valid());
    expect(out.ok).toBe(true);
  });

  it('changes nothing when the device cannot take the fresh session', async () => {
    state.adoptError = { status: 500, message: 'cookie write failed' };
    const out = await changePassword(null, valid());
    expect(out).toEqual({ ok: false, message: PASSWORD_COPY.failed, round: 0 });
    expect(state.verifierUpdates).toEqual([]);
    expect(state.verifierSignOuts).toEqual([{ scope: 'local' }]);
  });

  it('changes nothing when the check returns no session', async () => {
    state.verifySession = null;
    const out = await changePassword(null, valid());
    expect(out.message).toBe(PASSWORD_COPY.failed);
    expect(state.adopted).toEqual([]);
    expect(state.verifierUpdates).toEqual([]);
  });

  it('password changed but other devices kept: ok, with tone "warning" and the honest message', async () => {
    state.othersSignOutError = { status: 500, message: 'Database error' };
    const out = await changePassword(null, valid());
    expect(out).toEqual({
      ok: true,
      message: PASSWORD_COPY.changedOthersKept,
      round: 1,
      tone: 'warning',
    });
    expect(out.message).not.toBe(PASSWORD_COPY.changed);
    expect(state.verifierUpdates).toEqual([{ password: GOOD }]);
  });

  it('a plain success carries no tone', async () => {
    const out = await changePassword(null, valid());
    expect(out.tone).toBeUndefined();
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
    [{ status: 500, message: 'Database error: relation "auth.users" …' }, 'failed'],
  ] as const)('maps a Supabase refusal (%o) to its sentence, never its text', async (error, key) => {
    state.updateError = error;
    const out = await changePassword(null, valid());
    expect(out.ok).toBe(false);
    expect(out.message).toBe(PASSWORD_COPY[key]);
    expect(out.message).not.toContain(error.message);
    expect(state.verifierSignOuts).toEqual([]);
  });
});

describe('Change password · 5 counted attempts per account per 15 minutes, claimed atomically', () => {
  it('claims the attempt on the caller’s own session before re-verifying', async () => {
    await changePassword(null, valid());
    expect(state.rpcs[0]?.fn).toBe('password_check_begin');
    expect(state.verifiedWith).toHaveLength(1);
  });

  it('past the limit says "too many" and never calls signInWithPassword', async () => {
    state.attempt = null;
    const out = await changePassword(null, valid());
    expect(out).toEqual({ ok: false, message: PASSWORD_COPY.tooMany, round: 0 });
    expect(state.verifiedWith).toEqual([]);
    expect(state.verifierOptions).toEqual([]);
    expect(state.verifierUpdates).toEqual([]);
  });

  it('fails closed when the attempt cannot be claimed', async () => {
    state.beginError = { code: 'PGRST202', message: 'function not found' };
    const out = await changePassword(null, valid());
    expect(out).toEqual({ ok: false, message: PASSWORD_COPY.failed, round: 0 });
    expect(state.verifiedWith).toEqual([]);
  });

  it('a wrong current password leaves the attempt counted (no release)', async () => {
    state.verifyError = { status: 400, code: 'invalid_credentials', message: 'Invalid login' };
    await changePassword(null, valid());
    expect(released()).toEqual([]);
  });

  it('an older Auth server’s wrong-password answer (no code) still counts', async () => {
    state.verifyError = { status: 400, message: 'Invalid login credentials' };
    const out = await changePassword(null, valid());
    expect(out.message).toBe(PASSWORD_COPY.currentWrong);
    expect(released()).toEqual([]);
  });

  it('a correct current password releases its attempt', async () => {
    const out = await changePassword(null, valid());
    expect(out.ok).toBe(true);
    expect(released()).toEqual([{ fn: 'password_check_release', args: { p_attempt: 41 } }]);
  });

  it.each([
    ['Supabase’s own rate limit', { status: 429, code: 'over_request_rate_limit', message: 'x' }],
    ['a network or server failure', { status: 500, message: 'upstream error' }],
    ['any other 400', { status: 400, code: 'validation_failed', message: 'bad email' }],
  ] as const)('%s is released, not counted as a wrong password', async (_, error) => {
    state.verifyError = error;
    const out = await changePassword(null, valid());
    expect(out.message).not.toBe(PASSWORD_COPY.currentWrong);
    expect(released()).toHaveLength(1);
  });

  it('a lost release still lets the change through (the slot stays counted: fails closed)', async () => {
    state.releaseError = { message: 'connection reset' };
    const out = await changePassword(null, valid());
    expect(out.ok).toBe(true);
  });
});
