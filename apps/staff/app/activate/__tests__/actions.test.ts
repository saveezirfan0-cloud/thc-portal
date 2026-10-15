import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Activate my account" (../actions.ts) with Supabase mocked: once the
 * password is set, the sign-in failures counted while the account had no
 * password are cleared (20261015140000) — and on no refusal branch.
 *
 * Reported 15.10.2026: a candidate who had tried to sign in before
 * activating was then refused with "Email or password is incorrect" on the
 * password she had just set.
 */

const auth = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}));
const jar = vi.hoisted(() => ({
  values: new Map<string, string>(),
  get(name: string) {
    const value = this.values.get(name);
    return value === undefined ? undefined : { name, value };
  },
  set(name: string, value: string) {
    this.values.set(name, value);
  },
  delete(name: string) {
    this.values.delete(name);
  },
}));
const clearSignInFailures = vi.hoisted(() => vi.fn());

vi.mock('next/headers', () => ({ cookies: async () => jar }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@thc/db/time-format', () => ({ clearTimeFormatCookie: () => {} }));
vi.mock('@thc/db/auth-throttle', () => ({ clearSignInFailures }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    auth,
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { first_name: 'Marta', last_name: 'Ferré' } }),
        }),
      }),
    }),
  }),
}));

const { activateAccount } = await import('../actions');

/** GoTrue's hashed_token shape today: 56 hex characters. */
const TOKEN = 'a3f1c9e2b4d6f8a0c2e4f6a8b0d2e4f6a8c0e2f4a6b8d0f2e4a6c8e0';
const PASSWORD = 'Harbour-Lantern-2048';
const EMAIL = 'candidate@example.com';
const USER = { id: 'u-1', email: EMAIL, app_metadata: { role: 'staff' } };

async function submit(): Promise<string> {
  const fd = new FormData();
  fd.set('token', TOKEN);
  fd.set('password', PASSWORD);
  fd.set('confirm', PASSWORD);
  try {
    return `RETURNED:${JSON.stringify(await activateAccount({ error: null }, fd))}`;
  } catch (error) {
    return (error as Error).message;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  jar.values.clear();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  auth.verifyOtp.mockResolvedValue({ data: { user: USER }, error: null });
  auth.getUser.mockResolvedValue({ data: { user: null } });
  auth.updateUser.mockResolvedValue({ error: null });
  auth.signOut.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the sign-in lockout is cleared once the password is set', () => {
  it('a verified link: password set, failures cleared for that account, then /activate/done', async () => {
    expect(await submit()).toBe('REDIRECT:/activate/done');
    expect(auth.updateUser).toHaveBeenCalledWith({ password: PASSWORD });
    expect(clearSignInFailures).toHaveBeenCalledTimes(1);
    expect(clearSignInFailures).toHaveBeenCalledWith(EMAIL);
    expect(auth.updateUser.mock.invocationCallOrder[0]!).toBeLessThan(
      clearSignInFailures.mock.invocationCallOrder[0]!,
    );
  });

  it('a retry on the session this browser verified (the marker) clears it too', async () => {
    const marker = createHash('sha256').update(`activation:${TOKEN}`).digest('hex');
    jar.values.set('thc-activation', marker);
    auth.verifyOtp.mockResolvedValue({ data: { user: null }, error: { status: 403 } });
    auth.getUser.mockResolvedValue({ data: { user: USER } });
    expect(await submit()).toBe('REDIRECT:/activate/done');
    expect(clearSignInFailures).toHaveBeenCalledWith(EMAIL);
  });
});

describe('no refusal clears anything', () => {
  it('a spent link with no marker', async () => {
    auth.verifyOtp.mockResolvedValue({ data: { user: null }, error: { status: 403 } });
    expect(await submit()).toMatch(/"expired":true/);
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(clearSignInFailures).not.toHaveBeenCalled();
  });

  it('a link for an account that is not staff', async () => {
    auth.verifyOtp.mockResolvedValue({
      data: { user: { ...USER, app_metadata: { role: 'client' } } },
      error: null,
    });
    expect(await submit()).toMatch(/not for a Staff App account/);
    expect(clearSignInFailures).not.toHaveBeenCalled();
  });

  it('a password GoTrue refuses', async () => {
    auth.updateUser.mockResolvedValue({ error: { status: 500, message: 'boom' } });
    expect(await submit()).toMatch(/We could not set that password/);
    expect(clearSignInFailures).not.toHaveBeenCalled();
  });
});
