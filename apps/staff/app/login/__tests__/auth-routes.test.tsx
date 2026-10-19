import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Staff App's reset link (A2 → A3; audit D12, D13; ADR-0039):
 *
 *  - /auth/confirm never spends a token_hash on GET (mail scanners open
 *    links first): it hands it to the interstitial, whose "Continue" POST
 *    spends it in ANY browser — the worker's mail app, another phone,
 *    Safari when the request came from the PWA — and it still takes a
 *    PKCE code;
 *  - the middleware lets it through without a session;
 *  - the local safeNext.ts is gone; the shared guard decides `next`.
 */
const auth = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getClaims: async () => ({ data: null, error: null }),
      getUser: async () => ({ data: { user: null } }),
    },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ getAll: () => [], set: () => {} })),
}));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ auth }) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

const { GET: confirm } = await import('../../auth/confirm/route');
const { continueReset } = await import('../../auth/confirm/continue/actions');
const { default: ContinuePage } = await import('../../auth/confirm/continue/page');
const { middleware } = await import('../../../middleware');

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

async function submit(values: Record<string, string>): Promise<string> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  try {
    await continueReset(fd);
    return 'RETURNED';
  } catch (error) {
    return (error as Error).message;
  }
}

describe('/auth/confirm', () => {
  it('GET spends nothing: a recovery token_hash goes to the interstitial', async () => {
    const res = await confirm(
      new Request(`${ORIGIN}/auth/confirm?token_hash=th&type=recovery&next=/reset`),
    );
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      `${ORIGIN}/auth/confirm/continue?token_hash=th&next=%2Freset`,
    );
  });

  it('the interstitial renders a POST button, and spends nothing either', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const html = renderToStaticMarkup(
      await ContinuePage({ searchParams: Promise.resolve({ token_hash: 'th', next: '/reset' }) }),
    );
    expect(html).toContain('name="token_hash" value="th"');
    expect(html).toContain('Continue');
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('"Continue" spends the token in this browser and hands off to /reset', async () => {
    expect(await submit({ token_hash: 'th', next: '/reset' })).toBe('REDIRECT:/reset');
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'th' });
  });

  it('still exchanges a PKCE code', async () => {
    const res = await confirm(new Request(`${ORIGIN}/auth/confirm?code=c`));
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('c');
    expect(res.headers.get('location')).toBe(`${ORIGIN}/reset`);
  });

  it('a spent link lands on the expired variant', async () => {
    auth.verifyOtp.mockResolvedValue({ error: { status: 403, message: 'expired' } });
    expect(await submit({ token_hash: 'th' })).toBe('REDIRECT:/reset?error=expired');
  });

  it('with neither, nothing is spent', async () => {
    const res = await confirm(new Request(`${ORIGIN}/auth/confirm`));
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBe(`${ORIGIN}/reset?error=missing`);
  });

  it('never follows next=/..//evil.com (D12)', async () => {
    const res = await confirm(
      new Request(
        `${ORIGIN}/auth/confirm?token_hash=th&type=recovery&next=${encodeURIComponent('/..//evil.com')}`,
      ),
    );
    expect(new URL(res.headers.get('location') ?? '').searchParams.get('next')).toBe('/reset');
    expect(await submit({ token_hash: 'th', next: '//evil.com' })).toBe('REDIRECT:/reset');
  });

  it('the app-local safeNext.ts is gone: the shared guard is the only one (D12)', () => {
    expect(existsSync(join(HERE, '..', 'safeNext.ts'))).toBe(false);
  });
});

describe('middleware', () => {
  it('serves /auth/confirm without a session', async () => {
    const res = await middleware(new NextRequest('http://127.0.0.1:3001/auth/confirm'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });
});
