import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The per-account throttle at the Back Office's doors
 * (packages/db/src/auth-throttle.ts): checked BEFORE GoTrue is asked,
 * refused with the same answer a wrong password / a sent link gets (§1.7),
 * and only real guesses counted afterwards.
 */
const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
  resetPasswordForEmail: vi.fn(),
  mfa: { challengeAndVerify: vi.fn() },
}));
const throttle = vi.hoisted(() => ({
  allowed: vi.fn(),
  record: vi.fn(),
  recovery: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {}, get: () => undefined }),
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ auth }) }));
vi.mock('@thc/db/auth-throttle', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  authAttemptAllowed: throttle.allowed,
  recordAuthAttempt: throttle.record,
  recoveryRequestAllowed: throttle.recovery,
}));
vi.mock('../two-step-session', () => ({
  readTwoStep: async () => ({
    user: { id: 'u1', app_metadata: { role: 'admin' } },
    decision: 'challenge',
    totp: { id: 'factor-1' },
  }),
}));

const { signIn } = await import('../actions');
const { requestReset } = await import('../../forgot/actions');
const { verifyTwoStep } = await import('../verify/actions');
const { TOO_MANY_CODES } = await import('../verify/copy');
const { SIGN_IN_REFUSED: REFUSED } = await import('../messages');

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    return `RETURNED:${String(await run())}`;
  } catch (error) {
    return (error as Error).message;
  }
}

const saved = { ...process.env };
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  process.env['NEXT_PUBLIC_OFFICE_URL'] = 'http://127.0.0.1:3000';
});
afterAll(() => {
  process.env = saved;
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  throttle.allowed.mockResolvedValue(true);
  throttle.record.mockResolvedValue(undefined);
  throttle.recovery.mockResolvedValue(true);
  auth.signInWithPassword.mockResolvedValue({
    data: { user: { id: 'u1', app_metadata: { role: 'admin' }, factors: [] } },
    error: null,
  });
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
});

const creds = { email: ' Amara.K@Example.com ', password: 'Gala-Dinner-2026' };
// The address counts under its own, looser 'sign_in_ip' limit.
const KEYS = [sha('amara.k@example.com'), { kind: 'sign_in_ip', key: sha('ip:203.0.113.7') }];

describe('signIn: five wrong passwords per account, and per address', () => {
  it('asks under the account and the caller address before GoTrue', async () => {
    expect(await outcome(() => signIn(null, form(creds)))).toBe('REDIRECT:/dashboard');
    expect(throttle.allowed).toHaveBeenCalledWith('sign_in', KEYS);
    expect(throttle.record).not.toHaveBeenCalled();
  });

  it('over the limit: the wrong-password answer, and GoTrue is never asked', async () => {
    throttle.allowed.mockResolvedValue(false);
    expect(await outcome(() => signIn(null, form(creds)))).toBe(`RETURNED:${REFUSED}`);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('a wrong password is counted against both keys', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' },
    });
    expect(await outcome(() => signIn(null, form(creds)))).toBe(`RETURNED:${REFUSED}`);
    expect(throttle.record).toHaveBeenCalledWith('sign_in', KEYS, true);
  });

  it('an outage is not a guess and is not counted', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { status: 500, code: 'unexpected_failure', message: 'boom' },
    });
    await outcome(() => signIn(null, form(creds)));
    expect(throttle.record).not.toHaveBeenCalled();
  });
});

describe('requestReset: three links an hour per address', () => {
  it('allowed: the link is asked for', async () => {
    expect(await outcome(() => requestReset(null, form({ email: creds.email })))).toBe(
      'REDIRECT:/forgot/sent?to=amara.k%40example.com',
    );
    expect(throttle.recovery).toHaveBeenCalledWith('amara.k@example.com');
    expect(auth.resetPasswordForEmail).toHaveBeenCalled();
  });

  it('over the limit: the SAME "sent" answer, and no email', async () => {
    throttle.recovery.mockResolvedValue(false);
    expect(await outcome(() => requestReset(null, form({ email: creds.email })))).toBe(
      'REDIRECT:/forgot/sent?to=amara.k%40example.com',
    );
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe('verifyTwoStep: five wrong codes per login', () => {
  const code = () => form({ code: '123456', next: '/dashboard' });

  it('over the limit, the code is not put to GoTrue and the page says why', async () => {
    throttle.allowed.mockResolvedValue(false);
    expect(await outcome(() => verifyTwoStep(null, code()))).toBe(`RETURNED:${TOO_MANY_CODES}`);
    expect(throttle.allowed).toHaveBeenCalledWith('verify', [sha('u1')]);
    expect(auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it('a wrong code is counted against the login', async () => {
    auth.mfa.challengeAndVerify.mockResolvedValue({
      error: { status: 422, code: 'mfa_verification_failed' },
    });
    await outcome(() => verifyTwoStep(null, code()));
    expect(throttle.record).toHaveBeenCalledWith('verify', [sha('u1')], true);
  });

  it('the right code is not', async () => {
    auth.mfa.challengeAndVerify.mockResolvedValue({ error: null });
    expect(await outcome(() => verifyTwoStep(null, code()))).toBe('REDIRECT:/dashboard');
    expect(throttle.record).not.toHaveBeenCalled();
  });
});
