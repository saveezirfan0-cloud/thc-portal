import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Staff App's reset link (A2 → A3; audit D12, D13; ADR-0039):
 *
 *  - /auth/confirm spends a token_hash in ANY browser — the worker's mail
 *    app, another phone, Safari when the request came from the PWA — and
 *    still takes a PKCE code;
 *  - the middleware lets it through without a session;
 *  - the local safeNext.ts is gone; the shared guard decides `next`.
 */
const auth = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ getAll: () => [], set: () => {} })),
}));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ auth }) }));

const { GET: confirm } = await import('../../auth/confirm/route');
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
    expect(res.headers.get('location')).toBeNull();
  });
});
