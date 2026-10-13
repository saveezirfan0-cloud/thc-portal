import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Client Portal's reset flow (A1 → A2 → A3; audit D13; ADR-0039):
 * /forgot asks for a link to this app's /auth/confirm, which never spends
 * the token_hash on GET: its interstitial's "Continue" POST does, in any
 * browser (a PKCE code is still exchanged), and hands off to /reset.
 */
const auth = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  resetPasswordForEmail: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ getAll: () => [], set: () => {} })),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ auth }) }));
// The per-account throttle is held by its own tests (packages/db, ../../login/__tests__/throttle.test.ts).
vi.mock('@thc/db/auth-throttle', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  recoveryRequestAllowed: async () => true,
}));

const { GET: confirm } = await import('../../auth/confirm/route');
const { continueReset } = await import('../../auth/confirm/continue/actions');
const { requestReset } = await import('../actions');

const ORIGIN = 'https://client.thc.example';
const location = (res: Response) => res.headers.get('location');

const saved = { ...process.env };
afterAll(() => {
  process.env = saved;
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'http://127.0.0.1:54321';
  process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'anon';
  process.env['NEXT_PUBLIC_CLIENT_URL'] = ORIGIN;
  auth.verifyOtp.mockResolvedValue({ error: null });
  auth.exchangeCodeForSession.mockResolvedValue({ error: null });
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
});

describe('GET /auth/confirm', () => {
  it('GET spends nothing; "Continue" spends the token_hash and hands off to /reset', async () => {
    const res = await confirm(
      new Request(`${ORIGIN}/auth/confirm?token_hash=th&type=recovery&next=/reset`),
    );
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(location(res)).toBe(`${ORIGIN}/auth/confirm/continue?token_hash=th&next=%2Freset`);

    const fd = new FormData();
    fd.set('token_hash', 'th');
    fd.set('next', '/reset');
    await expect(continueReset(fd)).rejects.toThrow('REDIRECT:/reset');
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'th' });
  });

  it('"Continue" with a spent token lands on the expired variant', async () => {
    auth.verifyOtp.mockResolvedValue({ error: { status: 403, message: 'expired' } });
    const fd = new FormData();
    fd.set('token_hash', 'th');
    await expect(continueReset(fd)).rejects.toThrow('REDIRECT:/reset?error=expired');
  });

  it('still takes a PKCE code', async () => {
    const res = await confirm(new Request(`${ORIGIN}/auth/confirm?code=c`));
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('c');
    expect(location(res)).toBe(`${ORIGIN}/reset`);
  });

  it('a spent link lands on the expired variant', async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: { status: 400, message: 'bad' } });
    const res = await confirm(new Request(`${ORIGIN}/auth/confirm?code=c`));
    expect(location(res)).toBe(`${ORIGIN}/reset?error=expired`);
  });

  it('never follows next off this origin', async () => {
    const res = await confirm(
      new Request(
        `${ORIGIN}/auth/confirm?token_hash=th&type=recovery&next=${encodeURIComponent('//evil.com')}`,
      ),
    );
    expect(new URL(location(res) ?? '').searchParams.get('next')).toBe('/reset');
    const fd = new FormData();
    fd.set('token_hash', 'th');
    fd.set('next', '//evil.com');
    await expect(continueReset(fd)).rejects.toThrow('REDIRECT:/reset');
  });
});

describe('requestReset (A1)', () => {
  async function run(email: string): Promise<string> {
    const fd = new FormData();
    fd.set('email', email);
    try {
      return `RETURNED:${await requestReset(null, fd)}`;
    } catch (e) {
      return (e as Error).message;
    }
  }

  it('asks for a link to this app’s /auth/confirm', async () => {
    expect(await run('venue@client.example')).toBe(
      'REDIRECT:/forgot/sent?to=venue%40client.example',
    );
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('venue@client.example', {
      redirectTo: `${ORIGIN}/auth/confirm`,
    });
  });

  it('the same outcome when Supabase refuses (no account enumeration)', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: { status: 429, message: 'rate' } });
    expect(await run('nobody@client.example')).toBe(
      'REDIRECT:/forgot/sent?to=nobody%40client.example',
    );
  });

  it('refuses in production without NEXT_PUBLIC_CLIENT_URL, even with VERCEL_URL set (D13)', async () => {
    delete process.env['NEXT_PUBLIC_CLIENT_URL'];
    vi.stubEnv('VERCEL_URL', 'thc-client-abc123.vercel.app');
    vi.stubEnv('NODE_ENV', 'production');
    expect(await run('venue@client.example')).toBe(
      'RETURNED:Password reset is not available on this deployment yet. Email admin@thehospitalitycompany.co.uk.',
    );
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});
