import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Back Office's one reset flow (§10.2 A0 → A1 → A2 → A3; audit D12,
 * D13; ADR-0035): /forgot asks for a link that lands on /auth/confirm,
 * which takes the token_hash link in any browser (and a PKCE code as a
 * fallback) and hands off to /reset. Plus A0's own controls.
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
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ auth }) }));

const { GET: confirm } = await import('../../auth/confirm/route');
const { requestReset } = await import('../../forgot/actions');
const { LoginForm } = await import('../LoginForm');

const ORIGIN = 'https://office.thc.example';
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
  process.env['NEXT_PUBLIC_OFFICE_URL'] = `${ORIGIN}/`;
  auth.verifyOtp.mockResolvedValue({ error: null });
  auth.exchangeCodeForSession.mockResolvedValue({ error: null });
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
});

describe('GET /auth/confirm (A2 → A3)', () => {
  it('spends a recovery token_hash in this browser and hands off to /reset', async () => {
    const res = await confirm(
      new Request(`${ORIGIN}/auth/confirm?token_hash=th1&type=recovery&next=/reset`),
    );
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'th1' });
    expect(location(res)).toBe(`${ORIGIN}/reset`);
  });

  it('a spent or expired token lands on the expired-link variant', async () => {
    auth.verifyOtp.mockResolvedValue({ error: { status: 403, message: 'Token has expired' } });
    const res = await confirm(new Request(`${ORIGIN}/auth/confirm?token_hash=th1&type=recovery`));
    expect(location(res)).toBe(`${ORIGIN}/reset?error=expired`);
  });

  it('still takes a PKCE code, for a project on the default template', async () => {
    const res = await confirm(new Request(`${ORIGIN}/auth/confirm?code=c1`));
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('c1');
    expect(location(res)).toBe(`${ORIGIN}/reset`);
  });

  it('makes reset sessions only: another token type is not spent', async () => {
    const res = await confirm(new Request(`${ORIGIN}/auth/confirm?token_hash=th1&type=magiclink`));
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(location(res)).toBe(`${ORIGIN}/reset?error=missing`);
  });

  it.each(['//evil.com', '/..//evil.com', 'https://evil.com'])(
    'never follows next=%s off this origin (D12)',
    async (next) => {
      const res = await confirm(
        new Request(
          `${ORIGIN}/auth/confirm?token_hash=th1&type=recovery&next=${encodeURIComponent(next)}`,
        ),
      );
      expect(location(res)).toBe(`${ORIGIN}/reset`);
    },
  );
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

  it('asks for a link to this app’s /auth/confirm, with no query of its own', async () => {
    expect(await run('Gisela@THC.example')).toBe('REDIRECT:/forgot/sent?to=gisela%40thc.example');
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('gisela@thc.example', {
      redirectTo: `${ORIGIN}/auth/confirm`,
    });
  });

  it('refuses in production without NEXT_PUBLIC_OFFICE_URL, even with VERCEL_URL set (D13)', async () => {
    delete process.env['NEXT_PUBLIC_OFFICE_URL'];
    vi.stubEnv('VERCEL_URL', 'thc-office-abc123.vercel.app');
    vi.stubEnv('NODE_ENV', 'production');
    expect(await run('gisela@thc.example')).toBe(
      'RETURNED:Password reset is not available on this deployment yet. Contact the THC office.',
    );
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe('A0 Sign in (login.html)', () => {
  const html = renderToStaticMarkup(<LoginForm />);

  it('has a Show toggle on the password, named by its own text', () => {
    expect(html).toMatch(
      /<button type="button" class="addon"[^>]*aria-pressed="false"[^>]*>Show<\/button>/,
    );
    expect(html).toContain('type="password"');
  });

  it('has "Keep me signed in on this device", ticked by default (login.html:39)', () => {
    expect(html).toContain('Keep me signed in on this device');
    expect(html).toMatch(/<input type="checkbox"[^>]*name="remember"[^>]*checked=""[^>]*value="1"/);
  });

  it('keeps Forgot password? with the password field', () => {
    expect(html).toContain('href="/forgot"');
  });
});
