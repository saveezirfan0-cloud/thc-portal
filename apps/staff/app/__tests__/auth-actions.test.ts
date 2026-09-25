import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The three auth server actions, with the Supabase client mocked (audit
 * 24.09): the rules each one enforces have vectors, the calls it makes do
 * not — and those calls are the behaviour (§1.4, §1.7, §2.7, §10.2).
 *
 *   activateAccount  the token is spent on submit only, after the free
 *                    rules; a spent link is a spent link unless this browser
 *                    verified it; a non-staff link is signed out and refused;
 *                    "not your name or email" is re-checked on the account.
 *   setPassword      updateUser, then every OTHER device is signed out, then
 *                    /shifts; the current password is refused by name.
 *   requestReset     the redirect is the same whether Supabase accepted the
 *                    address or not (§1.7: no account enumeration), and the
 *                    address travels in a cookie, never the URL.
 */
const auth = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
  updateUser: vi.fn(),
  resetPasswordForEmail: vi.fn(),
}));
const jar = vi.hoisted(() => ({
  store: new Map<string, string>(),
  set: vi.fn((name: string, value: string) => {
    jar.store.set(name, value);
  }),
  get: vi.fn((name: string) => (jar.store.has(name) ? { value: jar.store.get(name) } : undefined)),
  delete: vi.fn((name: string) => {
    jar.store.delete(name);
  }),
  getAll: () => [],
}));
const staffRow = vi.hoisted(() => ({
  value: null as { first_name: string; last_name: string } | null,
}));

vi.mock('next/headers', () => ({ cookies: async () => jar }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    auth,
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: staffRow.value }) }),
      }),
    }),
  }),
}));

const { activateAccount } = await import('../activate/actions');
const { setPassword } = await import('../reset/actions');
const { requestReset } = await import('../forgot/actions');

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
  jar.store.clear();
  staffRow.value = null;
});

const TOKEN = 'a'.repeat(64);
const STAFF_USER = { id: 'u1', email: 'tom.reid@example.com', app_metadata: { role: 'staff' } };

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function outcome<T>(run: () => Promise<T>): Promise<T | string> {
  try {
    return await run();
  } catch (error) {
    return (error as Error).message;
  }
}

describe('activateAccount (§2.7)', () => {
  const good = {
    token: TOKEN,
    type: 'signup',
    password: 'Gala-Dinner-2026',
    confirm: 'Gala-Dinner-2026',
  };

  it('a malformed token is a spent link, and the database is never touched', async () => {
    const state = await activateAccount({ error: null }, form({ ...good, token: 'not-a-token' }));
    expect(state.expired).toBe(true);
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('checks the free rules before spending the token', async () => {
    const state = await activateAccount(
      { error: null },
      form({ ...good, password: 'short', confirm: 'short' }),
    );
    expect(state.expired).toBeUndefined();
    expect(state.error).toBeTruthy();
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('a refused token with no retry marker is a spent link', async () => {
    auth.verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { status: 403, code: 'otp_expired' },
    });
    const state = await activateAccount({ error: null }, form(good));
    expect(state.expired).toBe(true);
    expect(auth.getUser).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('a refused token WITH this browser’s marker continues on the session it left behind', async () => {
    auth.verifyOtp.mockResolvedValue({ data: { user: STAFF_USER }, error: null });
    auth.updateUser.mockResolvedValueOnce({
      error: { status: 422, code: 'weak_password', message: 'weak' },
    });
    // First submit: verified, but the password was refused after the spend.
    const first = await activateAccount({ error: null }, form(good));
    expect(first.expired).toBeUndefined();
    expect(jar.set).toHaveBeenCalledWith(
      'thc-activation',
      expect.any(String),
      expect.objectContaining({ httpOnly: true }),
    );

    // Second submit: the token is spent; the marker lets the retry through.
    auth.verifyOtp.mockResolvedValue({ data: { user: null }, error: { status: 403 } });
    auth.getUser.mockResolvedValue({ data: { user: STAFF_USER } });
    auth.updateUser.mockResolvedValueOnce({ error: null });
    const second = await outcome(() => activateAccount({ error: null }, form(good)));
    expect(second).toBe('REDIRECT:/activate/done');
  });

  it('a link that is not for a staff account is signed out and refused', async () => {
    auth.verifyOtp.mockResolvedValue({
      data: { user: { ...STAFF_USER, app_metadata: { role: 'admin' } } },
      error: null,
    });
    const state = await activateAccount({ error: null }, form(good));
    expect(state.expired).toBe(true);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('re-checks "not your name or email" against the account once verified', async () => {
    auth.verifyOtp.mockResolvedValue({ data: { user: STAFF_USER }, error: null });
    staffRow.value = { first_name: 'Tom', last_name: 'Reid' };
    const state = await activateAccount(
      { error: null },
      form({ ...good, password: 'tom.reid@example.com1', confirm: 'tom.reid@example.com1' }),
    );
    expect(state.expired).toBeUndefined();
    expect(state.error).toMatch(/name or email/i);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});

describe('setPassword (§10.2 A3)', () => {
  it('updates, signs every OTHER device out, then goes to /shifts', async () => {
    auth.getUser.mockResolvedValue({ data: { user: STAFF_USER } });
    auth.updateUser.mockResolvedValue({ error: null });
    const result = await outcome(() =>
      setPassword(null, form({ password: 'Gala-Dinner-2026', confirm: 'Gala-Dinner-2026' })),
    );
    expect(result).toBe('REDIRECT:/shifts');
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'Gala-Dinner-2026' });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'others' });
    expect(auth.updateUser.mock.invocationCallOrder[0]).toBeLessThan(
      auth.signOut.mock.invocationCallOrder[0]!,
    );
  });

  it('names the current password when Supabase refuses it as unchanged', async () => {
    auth.getUser.mockResolvedValue({ data: { user: STAFF_USER } });
    auth.updateUser.mockResolvedValue({
      error: {
        status: 422,
        code: 'same_password',
        message: 'New password should be different from the old password.',
      },
    });
    const result = await setPassword(
      null,
      form({ password: 'Gala-Dinner-2026', confirm: 'Gala-Dinner-2026' }),
    );
    expect(result).toBe('That is the password you use now. Choose a different one.');
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('with no session the link is spent, and nothing is updated', async () => {
    auth.getUser.mockResolvedValue({ data: { user: null } });
    const result = await setPassword(
      null,
      form({ password: 'Gala-Dinner-2026', confirm: 'Gala-Dinner-2026' }),
    );
    expect(result).toMatch(/expired or has already been used/);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});

describe('requestReset (§10.2 A1, §1.7)', () => {
  it('lands on /forgot/sent with the address in a cookie, not the URL', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    const result = await outcome(() =>
      requestReset(null, form({ email: ' Amara.K@Example.com ' })),
    );
    expect(result).toBe('REDIRECT:/forgot/sent');
    expect(jar.set).toHaveBeenCalledWith(
      'thc_reset_sent_to',
      'amara.k@example.com',
      expect.objectContaining({ httpOnly: true, path: '/forgot' }),
    );
  });

  it('gives the same answer when Supabase refuses the address (rate limit, unknown account)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    auth.resetPasswordForEmail.mockResolvedValue({ error: { status: 429, message: 'rate limit' } });
    const result = await outcome(() => requestReset(null, form({ email: 'nobody@example.com' })));
    expect(result).toBe('REDIRECT:/forgot/sent');
    expect(jar.set).toHaveBeenCalled();
    error.mockRestore();
  });
});
