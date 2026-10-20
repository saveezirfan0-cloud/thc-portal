import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A3 (/reset) sets a password with no current password, so only a session
 * an emailed reset link made in the last 15 minutes may use it
 * (packages/db/src/recovery.ts). Any other signed-in session is sent to the
 * change-password screen that asks for the current one.
 */
const auth = vi.hoisted(() => ({
  getUser: vi.fn(),
  getClaims: vi.fn(),
  getSession: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
  mfa: { challengeAndVerify: vi.fn() },
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ auth }) }));
const clearSignInFailures = vi.hoisted(() => vi.fn());
const throttle = vi.hoisted(() => ({
  authAttemptAllowed: vi.fn(async () => true),
  recordAuthAttempt: vi.fn(async () => {}),
  userKey: vi.fn(async (id: string) => `user:${id}`),
}));
vi.mock('@thc/db/auth-throttle', () => ({ clearSignInFailures, ...throttle }));

const { setPassword } = await import('../actions');
const { default: ResetPage } = await import('../page');
const { USE_ACCOUNT_SCREEN, SAME_PASSWORD, RESET_CODE_HINT, otherApp } = await import('../copy');
const { TOO_MANY_CODES } = await import('../../login/verify/copy');

const NOW_S = () => Math.floor(Date.now() / 1000);
const amr = (method: string, secondsAgo: number) => ({
  data: { claims: { email: 'a@b.example', amr: [{ method, timestamp: NOW_S() - secondsAgo }] } },
  error: null,
});

/** A token GoTrue has accepted, as far as `aalFromAccessToken` reads it. */
const tokenAt = (aal: 'aal1' | 'aal2') =>
  `h.${Buffer.from(JSON.stringify({ aal })).toString('base64url')}.s`;
const TOTP = { id: 'f1', factor_type: 'totp', status: 'verified' };
/** An admin with a verified authenticator, on the aal1 session a reset link makes. */
const withTwoStep = () => {
  auth.getUser.mockResolvedValue({
    data: {
      user: { id: 'u1', email: 'a@b.example', app_metadata: { role: 'admin' }, factors: [TOTP] },
    },
  });
  auth.getSession.mockResolvedValue({ data: { session: { access_token: tokenAt('aal1') } } });
};

async function submit(code?: string): Promise<string> {
  const fd = new FormData();
  fd.set('password', 'Gala-Dinner-2026');
  fd.set('confirm', 'Gala-Dinner-2026');
  if (code !== undefined) fd.set('code', code);
  try {
    return `RETURNED:${await setPassword(null, fd)}`;
  } catch (error) {
    return (error as Error).message;
  }
}

const saved = { ...process.env };
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});
afterAll(() => {
  process.env = saved;
});
beforeEach(() => {
  vi.clearAllMocks();
  auth.getUser.mockResolvedValue({
    data: { user: { id: 'u1', email: 'a@b.example', app_metadata: { role: 'admin' } } },
  });
  auth.updateUser.mockResolvedValue({ error: null });
  auth.mfa.challengeAndVerify.mockResolvedValue({ error: null });
  throttle.authAttemptAllowed.mockResolvedValue(true);
});

describe('setPassword: only a fresh reset-link session', () => {
  it('a password sign-in is refused, pointed at the change-password screen, and nothing is updated', async () => {
    auth.getClaims.mockResolvedValue(amr('password', 5));
    expect(await submit()).toBe(`RETURNED:${USE_ACCOUNT_SCREEN}`);
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(clearSignInFailures).not.toHaveBeenCalled();
  });

  it('a recovery link opened within 15 minutes sets the password', async () => {
    auth.getClaims.mockResolvedValue(amr('recovery', 14 * 60));
    expect(await submit()).toBe('REDIRECT:/dashboard');
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'Gala-Dinner-2026' });
  });

  it('clears the sign-in failures counted before the reset, after the password is set', async () => {
    auth.getClaims.mockResolvedValue(amr('otp', 10));
    expect(await submit()).toBe('REDIRECT:/dashboard');
    expect(clearSignInFailures).toHaveBeenCalledTimes(1);
    expect(clearSignInFailures).toHaveBeenCalledWith('a@b.example');
    expect(auth.updateUser.mock.invocationCallOrder[0]!).toBeLessThan(
      clearSignInFailures.mock.invocationCallOrder[0]!,
    );
  });

  it('a password that is not saved clears nothing', async () => {
    auth.getClaims.mockResolvedValue(amr('otp', 10));
    auth.updateUser.mockResolvedValue({ error: { status: 500, message: 'boom' } });
    expect(await submit()).toMatch(/^RETURNED:/);
    expect(clearSignInFailures).not.toHaveBeenCalled();
  });

  describe('a login that is not an admin is refused BEFORE anything changes', () => {
    const asRole = (role: string | undefined) =>
      auth.getUser.mockResolvedValue({
        data: {
          user: {
            id: 'u2',
            email: 'w@b.example',
            app_metadata: role === undefined ? {} : { role },
          },
        },
      });
    // Only the two this block sets: the file's own Supabase variables (set in
    // beforeAll) must survive it.
    const KEYS = ['NEXT_PUBLIC_OFFICE_URL', 'NEXT_PUBLIC_STAFF_URL'] as const;
    const savedEnv = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    beforeEach(() => {
      auth.getClaims.mockResolvedValue(amr('otp', 10));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      delete process.env['NEXT_PUBLIC_OFFICE_URL'];
      delete process.env['NEXT_PUBLIC_STAFF_URL'];
    });
    afterEach(() => {
      for (const k of KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k];
      }
    });
    const nothingChanged = () => {
      expect(auth.updateUser).not.toHaveBeenCalled();
      expect(auth.signOut).not.toHaveBeenCalled();
      expect(clearSignInFailures).not.toHaveBeenCalled();
    };

    it('a worker is told the Staff App is theirs, at its address', async () => {
      asRole('staff');
      process.env['NEXT_PUBLIC_OFFICE_URL'] = 'https://office.example.com';
      process.env['NEXT_PUBLIC_STAFF_URL'] = 'https://staff.example.com/';
      expect(await submit()).toBe(`RETURNED:${otherApp('staff', 'https://staff.example.com/')}`);
      expect(otherApp('staff', 'https://staff.example.com/')).toContain(
        'open it at https://staff.example.com and sign in',
      );
      nothingChanged();
    });

    it('a worker with no Staff App address configured is told the app, not a place', async () => {
      asRole('staff');
      const text = otherApp('staff');
      expect(text).toContain('Your login is for the Staff App — open it and sign in there.');
      expect(text).not.toContain(' at ');
      expect(await submit()).toBe(`RETURNED:${text}`);
      nothingChanged();
    });

    it('a worker is never sent to the Back Office when the Staff App address is wrong', async () => {
      asRole('staff');
      process.env['NEXT_PUBLIC_OFFICE_URL'] = 'https://office.example.com';
      process.env['NEXT_PUBLIC_STAFF_URL'] = 'https://office.example.com';
      const result = await submit();
      expect(result).toBe(`RETURNED:${otherApp('staff')}`);
      expect(result).not.toContain('office.example.com');
      nothingChanged();
    });

    it.each([['client'], [undefined]])(
      'a %s login gets the neutral line and no app is named (§1.4)',
      async (role) => {
        asRole(role);
        process.env['NEXT_PUBLIC_STAFF_URL'] = 'https://staff.example.com';
        const result = await submit();
        expect(result).toBe(`RETURNED:${otherApp(role)}`);
        expect(result).toContain('This reset link is for a different THC app.');
        expect(result).not.toMatch(/Staff App|Client Portal|staff\.example\.com/);
        nothingChanged();
      },
    );
  });

  it('the password already set is said plainly, not as a failure', async () => {
    auth.getClaims.mockResolvedValue(amr('otp', 10));
    auth.updateUser.mockResolvedValue({
      error: {
        status: 422,
        code: 'same_password',
        message: 'New password should be different from the old password.',
      },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await submit()).toBe(`RETURNED:${SAME_PASSWORD}`);
    expect(clearSignInFailures).not.toHaveBeenCalled();
  });

  it('any other failure stays generic and never shows Supabase’s text', async () => {
    auth.getClaims.mockResolvedValue(amr('otp', 10));
    auth.updateUser.mockResolvedValue({ error: { status: 500, message: 'pq: deadlock' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await submit()).toBe(
      'RETURNED:We could not set that password. Try again, or request a new link.',
    );
  });

  it('the token_hash link (amr otp) counts as a recovery link', async () => {
    auth.getClaims.mockResolvedValue(amr('otp', 10));
    expect(await submit()).toBe('REDIRECT:/dashboard');
  });

  it('a recovery link opened more than 15 minutes ago is refused', async () => {
    auth.getClaims.mockResolvedValue(amr('otp', 16 * 60));
    expect(await submit()).toBe(`RETURNED:${USE_ACCOUNT_SCREEN}`);
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(clearSignInFailures).not.toHaveBeenCalled();
  });

  it('no verified claims at all reads as a spent link', async () => {
    auth.getClaims.mockResolvedValue({ data: null, error: null });
    expect(await submit()).toMatch(/^RETURNED:This link has expired/);
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(clearSignInFailures).not.toHaveBeenCalled();
  });
});

describe('setPassword: a login with two-step gives its code too (insufficient_aal)', () => {
  beforeEach(() => {
    auth.getClaims.mockResolvedValue(amr('otp', 10));
    withTwoStep();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('the code is checked first, then the password is set', async () => {
    expect(await submit('123 456')).toBe('REDIRECT:/dashboard');
    expect(auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f1', code: '123456' });
    expect(auth.mfa.challengeAndVerify.mock.invocationCallOrder[0]!).toBeLessThan(
      auth.updateUser.mock.invocationCallOrder[0]!,
    );
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'Gala-Dinner-2026' });
  });

  it('no code: asked for, nothing sent to GoTrue', async () => {
    expect(await submit()).toBe('RETURNED:Enter the 6-digit code from your authenticator app.');
    expect(auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('a wrong code is counted, said plainly, and the password is not changed', async () => {
    auth.mfa.challengeAndVerify.mockResolvedValue({
      error: { status: 422, code: 'mfa_verification_failed' },
    });
    expect(await submit('000000')).toMatch(/^RETURNED:That code did not match/);
    expect(throttle.recordAuthAttempt).toHaveBeenCalledWith('verify', ['user:u1'], true);
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(clearSignInFailures).not.toHaveBeenCalled();
  });

  it('too many wrong codes: refused before GoTrue is asked', async () => {
    throttle.authAttemptAllowed.mockResolvedValue(false);
    expect(await submit('123456')).toBe(`RETURNED:${TOO_MANY_CODES}`);
    expect(auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('a stale link is refused before any code is tried', async () => {
    auth.getClaims.mockResolvedValue(amr('otp', 16 * 60));
    expect(await submit('123456')).toBe(`RETURNED:${USE_ACCOUNT_SCREEN}`);
    expect(auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it('a session already at aal2 is not asked again', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: tokenAt('aal2') } } });
    expect(await submit()).toBe('REDIRECT:/dashboard');
    expect(auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });
});

describe('/reset renders the form only for that session', () => {
  const render = async () =>
    renderToStaticMarkup(await ResetPage({ searchParams: Promise.resolve({}) }));

  it('a fresh reset link: the form, naming the account it is for', async () => {
    auth.getClaims.mockResolvedValue(amr('otp', 30));
    const html = await render();
    expect(html).toContain('Set a new password');
    expect(html).toContain('Setting a new password for <b class="mono">a@b.example</b>.');
  });

  it('a password sign-in: the expired card and where to go instead', async () => {
    auth.getClaims.mockResolvedValue(amr('password', 30));
    const html = await render();
    expect(html).toContain('This link has expired');
    expect(html).toContain('Request a new link');
    expect(html).toContain(USE_ACCOUNT_SCREEN);
    expect(html).not.toContain('Save new password');
  });

  it('a login with two-step: the code field and why it is there', async () => {
    auth.getClaims.mockResolvedValue(amr('otp', 30));
    withTwoStep();
    const html = await render();
    expect(html).toContain('name="code"');
    expect(html).toContain('6-digit code');
    expect(html).toContain(RESET_CODE_HINT.replace(/’/g, '&#x27;').slice(0, 40));
  });

  it('a login without two-step: no code field', async () => {
    auth.getClaims.mockResolvedValue(amr('otp', 30));
    expect(await render()).not.toContain('name="code"');
  });

  it('a stale reset link: the expired card', async () => {
    auth.getClaims.mockResolvedValue(amr('recovery', 20 * 60));
    expect(await render()).toContain('This link has expired');
  });
});
