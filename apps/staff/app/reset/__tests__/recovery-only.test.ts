import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Security review 12.10, finding 1: /reset changes the password without
 * the current one, so only a session an emailed reset link made may use it
 * (../recovery.ts). A password sign-in posting the action is refused and
 * updateUser is never called.
 */
const auth = vi.hoisted(() => ({
  getClaims: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ auth }) }));

const { setPassword } = await import('../actions');
const { NOT_A_RESET_SESSION, isRecoverySession } = await import('../recovery');

const now = () => Math.floor(Date.now() / 1000);
const claims = (method: string, age = 60) => ({
  data: { claims: { sub: 'u1', amr: [{ method, timestamp: now() - age }] } },
  error: null,
});

async function submit(): Promise<string> {
  const fd = new FormData();
  fd.set('password', 'harbour-lights-2026');
  fd.set('confirm', 'harbour-lights-2026');
  try {
    return `RETURNED:${await setPassword(null, fd)}`;
  } catch (e) {
    return (e as Error).message;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  auth.updateUser.mockResolvedValue({ error: null });
  auth.signOut.mockResolvedValue({ error: null });
});

describe('Staff App /reset accepts only a reset-link session', () => {
  it('refuses a password-signed-in session and never calls updateUser', async () => {
    auth.getClaims.mockResolvedValue(claims('password'));
    expect(await submit()).toBe(`RETURNED:${NOT_A_RESET_SESSION}`);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('refuses a stale recovery session', async () => {
    auth.getClaims.mockResolvedValue(claims('recovery', 2 * 3600));
    expect(await submit()).toBe(`RETURNED:${NOT_A_RESET_SESSION}`);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('a fresh recovery session sets the password and signs the other devices out', async () => {
    auth.getClaims.mockResolvedValue(claims('recovery'));
    expect(await submit()).toBe('REDIRECT:/shifts');
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'harbour-lights-2026' });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'others' });
  });

  it('no session: the expired-link sentence, nothing changed', async () => {
    auth.getClaims.mockResolvedValue({ data: null, error: null });
    expect(await submit()).toMatch(/expired or has already been used/);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it.each([
    [{ amr: [{ method: 'otp', timestamp: now() }] }, true],
    [{ amr: [{ method: 'invite', timestamp: now() }] }, false],
    [{ amr: ['recovery'] }, false],
    [{ amr: [{ method: 'recovery' }] }, false],
    [{}, false],
    [null, false],
  ])('isRecoverySession(%j) is %s', (c, expected) => {
    expect(isRecoverySession(c)).toBe(expected);
  });
});
