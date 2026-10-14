import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Client Portal's session gate (§1.4), end to end through middleware():
 *
 *   · no session → /login?next=<path + query> (security review 12.10: a
 *     lapse on /client/events/:id/document?kind=signout came back to the
 *     allocation sheet, the route's default);
 *   · signed in with another role → the 403 wrong-app page, never a
 *     redirect (the three apps are three hosts);
 *   · a signed-in customer opening /login → /client;
 *   · no Supabase configuration in production → 503, never an open gate;
 *   · POST /auth/signout → straight through, before any Supabase client;
 *   · refreshed auth cookies are written httpOnly (no browser client here).
 */
const state = vi.hoisted(() => ({
  user: null as null | { app_metadata?: Record<string, unknown> },
  built: 0,
  refresh: [] as { name: string; value: string; options: Record<string, unknown> }[],
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    { cookies }: { cookies: { setAll: (toSet: unknown[]) => void } },
  ) => {
    state.built += 1;
    return {
      auth: {
        getUser: async () => {
          if (state.refresh.length) cookies.setAll(state.refresh);
          return { data: { user: state.user } };
        },
      },
    };
  },
}));

const { middleware } = await import('../../middleware');

const ORIGIN = 'https://portal.thc.example';
const get = (path: string, init?: { method?: string }) =>
  middleware(new NextRequest(`${ORIGIN}${path}`, init));

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  state.user = null;
  state.built = 0;
  state.refresh = [];
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('no session', () => {
  it('sends a portal page to /login with next = path', async () => {
    const res = await get('/client');
    expect(res.status).toBe(307);
    const to = new URL(res.headers.get('location')!);
    expect(to.pathname).toBe('/login');
    expect(to.searchParams.get('next')).toBe('/client');
  });

  it('keeps the query string in next, so the right document comes back', async () => {
    const res = await get('/client/events/e1/document?kind=signout');
    const to = new URL(res.headers.get('location')!);
    expect(to.pathname).toBe('/login');
    expect(to.searchParams.get('next')).toBe('/client/events/e1/document?kind=signout');
    // and the original query is not left on the /login URL itself
    expect(to.searchParams.get('kind')).toBeNull();
  });

  it.each(['/login', '/forgot', '/forgot/sent', '/reset', '/auth/confirm'])(
    'serves %s',
    async (path) => {
      expect((await get(path)).status).toBe(200);
    },
  );
});

describe('signed in', () => {
  it('a customer reaches the portal', async () => {
    state.user = { app_metadata: { role: 'client' } };
    expect((await get('/client/events/e1')).status).toBe(200);
  });

  it('a customer opening /login goes to /client', async () => {
    state.user = { app_metadata: { role: 'client' } };
    const res = await get('/login?next=/client/events/e1');
    expect(res.status).toBe(307);
    const to = new URL(res.headers.get('location')!);
    expect(to.pathname).toBe('/client');
    expect(to.search).toBe('');
  });

  it.each(['staff', 'admin'])(
    'a %s login gets the 403 wrong-app page, on any path',
    async (role) => {
      state.user = { app_metadata: { role } };
      for (const path of ['/client', '/login', '/reset']) {
        const res = await get(path);
        expect(res.status, path).toBe(403);
        // ADR-0138: answered by the app's own /wrong-app card, the refused
        // role on the request — a rewrite, never a redirect.
        expect(new URL(res.headers.get('x-middleware-rewrite')!).pathname).toBe('/wrong-app');
        expect(res.headers.get('x-middleware-request-x-thc-wrong-app-role')).toBe(role);
        expect(res.headers.get('location')).toBeNull();
      }
    },
  );

  it('a role only in user_metadata (writable by the user) is not a client', async () => {
    state.user = { app_metadata: {}, user_metadata: { role: 'client' } } as never;
    expect((await get('/client')).status).toBe(403);
  });

  it('writes refreshed auth cookies httpOnly', async () => {
    state.user = { app_metadata: { role: 'client' } };
    state.refresh = [
      { name: 'sb-x-auth-token', value: 'fresh', options: { path: '/', httpOnly: false } },
    ];
    const res = await get('/client');
    expect(res.headers.get('set-cookie')).toMatch(/sb-x-auth-token=fresh;.*HttpOnly/i);
  });

  it('carries refreshed cookies on the /login → /client redirect too', async () => {
    state.user = { app_metadata: { role: 'client' } };
    state.refresh = [{ name: 'sb-x-auth-token', value: 'fresh', options: { path: '/' } }];
    const res = await get('/login');
    expect(res.headers.get('set-cookie')).toMatch(/sb-x-auth-token=fresh/);
  });
});

describe('sign-out and configuration', () => {
  it('POST /auth/signout passes straight through, without building a Supabase client', async () => {
    state.user = { app_metadata: { role: 'staff' } };
    const res = await get('/auth/signout', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(state.built).toBe(0);
  });

  it('GET /auth/signout gets no such exemption', async () => {
    state.user = { app_metadata: { role: 'staff' } };
    expect((await get('/auth/signout')).status).toBe(403);
  });

  it('missing Supabase configuration in production answers 503, never an open gate', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    vi.stubEnv('NODE_ENV', 'production');
    const res = await get('/client');
    expect(res.status).toBe(503);
    expect(state.built).toBe(0);
  });

  it('and on any Vercel deployment, preview included', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect((await get('/client')).status).toBe(503);
  });
});
