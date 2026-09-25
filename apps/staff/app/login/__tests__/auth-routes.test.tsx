import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Staff App's reset link (§10.2 A2 → A3; audit D12, D13; ADR-0035):
 *
 *  - /auth/confirm spends a token_hash in ANY browser — the worker's mail
 *    app, another phone, Safari when the request came from the PWA — and
 *    still takes a PKCE code;
 *  - a link GoTrue built on the Site URL is forwarded there;
 *  - A3's expired-link variant reads as the Back Office's and Portal's do;
 *  - the local safeNext.ts is gone; the shared guard decides `next`;
 *  - the matcher gates /shifts/x.png (D52).
 */
const auth = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ getAll: () => [], set: () => {} })),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ auth }) }));
vi.mock('../../reset/actions', () => ({ setPassword: vi.fn() }));

const { GET: confirm } = await import('../../auth/confirm/route');
const { middleware, config } = await import('../../../middleware');
const { default: ResetPage } = await import('../../reset/page');

const ORIGIN = 'https://staff.thc.example';
const HERE = dirname(fileURLToPath(import.meta.url));

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
  vi.spyOn(console, 'error').mockImplementation(() => {});
  auth.verifyOtp.mockResolvedValue({ error: null });
  auth.exchangeCodeForSession.mockResolvedValue({ error: null });
});

describe('/auth/confirm', () => {
  it('spends a recovery token_hash and hands off to /reset', async () => {
    const res = await confirm(
      new Request(`${ORIGIN}/auth/confirm?token_hash=th&type=recovery&next=/reset`),
    );
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'th' });
    expect(res.headers.get('location')).toBe(`${ORIGIN}/reset`);
  });

  it('still exchanges a PKCE code', async () => {
    const res = await confirm(new Request(`${ORIGIN}/auth/confirm?code=c`));
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('c');
    expect(res.headers.get('location')).toBe(`${ORIGIN}/reset`);
  });

  it('a spent link lands on the expired variant', async () => {
    auth.verifyOtp.mockResolvedValue({ error: { status: 403, message: 'expired' } });
    const res = await confirm(new Request(`${ORIGIN}/auth/confirm?token_hash=th&type=recovery`));
    expect(res.headers.get('location')).toBe(`${ORIGIN}/reset?error=expired`);
  });

  it('with neither, nothing is spent', async () => {
    const res = await confirm(new Request(`${ORIGIN}/auth/confirm`));
    expect(res.headers.get('location')).toBe(`${ORIGIN}/reset?error=missing`);
  });

  it('never follows next=/..//evil.com (D12)', async () => {
    const res = await confirm(
      new Request(
        `${ORIGIN}/auth/confirm?token_hash=th&type=recovery&next=${encodeURIComponent('/..//evil.com')}`,
      ),
    );
    expect(res.headers.get('location')).toBe(`${ORIGIN}/reset`);
  });

  it('the app-local safeNext.ts is gone: the shared guard is the only one (D12)', () => {
    expect(existsSync(join(HERE, '..', 'safeNext.ts'))).toBe(false);
  });
});

describe('middleware', () => {
  it('serves /auth/confirm without a session', async () => {
    const res = await middleware(new NextRequest('http://127.0.0.1:3001/auth/confirm'));
    expect(res.status).toBe(200);
  });

  it('forwards a reset link that landed on "/" to /auth/confirm', async () => {
    const res = await middleware(
      new NextRequest('http://127.0.0.1:3001/?token_hash=abc&type=recovery&next=/reset'),
    );
    const to = new URL(res.headers.get('location')!);
    expect(to.pathname).toBe('/auth/confirm');
    expect(to.searchParams.get('token_hash')).toBe('abc');
  });

  it('the matcher skips top-level public files and the service worker only (D52)', () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    for (const skipped of [
      '/icon-192.png',
      '/favicon.ico',
      '/sw.js',
      '/swe-worker-abc123.js',
      '/manifest.webmanifest',
    ]) {
      expect(matcher.test(skipped)).toBe(false);
    }
    for (const gated of ['/shifts/x.png', '/shifts', '/profile/details/me.jpg', '/sw.js/x']) {
      expect(matcher.test(gated)).toBe(true);
    }
  });
});

describe('A3 expired-link variant (as office and client)', () => {
  it('no session: "This link has expired" and "Request a new link"', async () => {
    auth.getUser.mockResolvedValue({ data: { user: null } });
    const html = renderToStaticMarkup(await ResetPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('<h2>This link has expired</h2>');
    expect(html).toContain('expired or has already been used');
    expect(html).toMatch(/<a href="\/forgot"[^>]*>Request a new link<\/a>/);
    expect(html).not.toContain('Set a new password');
  });

  it('a signed-in recovery session gets the form', async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const html = renderToStaticMarkup(await ResetPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('<h2>Set a new password</h2>');
  });
});
