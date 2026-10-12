import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A3 (/reset) sets a password with no current password, so only a session
 * an emailed reset link made in the last 15 minutes may use it
 * (packages/db/src/recovery.ts). Any other signed-in session is sent to the
 * change-password screen that asks for the current one.
 */
const auth = vi.hoisted(() => ({
  getUser: vi.fn(),
  getClaims: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
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

const { setPassword } = await import('../actions');
const { USE_SECURITY_SETTINGS } = await import('../copy');

const NOW_S = () => Math.floor(Date.now() / 1000);
const amr = (method: string, secondsAgo: number) => ({
  data: { claims: { email: 'a@b.example', amr: [{ method, timestamp: NOW_S() - secondsAgo }] } },
  error: null,
});

async function submit(): Promise<string> {
  const fd = new FormData();
  fd.set('password', 'Gala-Dinner-2026');
  fd.set('confirm', 'Gala-Dinner-2026');
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
  auth.getUser.mockResolvedValue({ data: { user: { id: 'u1', app_metadata: { role: 'staff' } } } });
  auth.updateUser.mockResolvedValue({ error: null });
});

describe('setPassword: only a fresh reset-link session', () => {
  it('a password sign-in is refused, pointed at the change-password screen, and nothing is updated', async () => {
    auth.getClaims.mockResolvedValue(amr('password', 5));
    expect(await submit()).toBe(`RETURNED:${USE_SECURITY_SETTINGS}`);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('a recovery link opened within 15 minutes sets the password', async () => {
    auth.getClaims.mockResolvedValue(amr('recovery', 14 * 60));
    expect(await submit()).toBe('REDIRECT:/shifts');
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'Gala-Dinner-2026' });
  });

  it('the token_hash link (amr otp) counts as a recovery link', async () => {
    auth.getClaims.mockResolvedValue(amr('otp', 10));
    expect(await submit()).toBe('REDIRECT:/shifts');
  });

  it('a recovery link opened more than 15 minutes ago is refused', async () => {
    auth.getClaims.mockResolvedValue(amr('otp', 16 * 60));
    expect(await submit()).toBe(`RETURNED:${USE_SECURITY_SETTINGS}`);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('no verified claims at all reads as a spent link', async () => {
    auth.getClaims.mockResolvedValue({ data: null, error: null });
    expect(await submit()).toMatch(/^RETURNED:This link has expired/);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});
