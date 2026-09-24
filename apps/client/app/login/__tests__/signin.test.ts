import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Client Portal sign-in (§1.4, `wireframes/client/login.html`): `next`
 * never leaves the portal (audit 24.09 §2.3), the default lands on /client
 * (the portal's only home), and A1–A3 are reachable without a session.
 */
const state = vi.hoisted(() => ({
  exchangeError: null as null | { status: number; message: string },
}));

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: async () => ({
        data: { user: { app_metadata: { role: 'client' } } },
        error: null,
      }),
      exchangeCodeForSession: async () => ({ error: state.exchangeError }),
    },
  }),
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));

const { signIn } = await import('../actions');
const { GET } = await import('../../auth/callback/route');
const { middleware } = await import('../../../middleware');

async function outcome(next?: string): Promise<string> {
  const fd = new FormData();
  fd.set('email', 'hannah.brooks@leonardo-stpauls.co.uk');
  fd.set('password', 'password123');
  if (next !== undefined) fd.set('next', next);
  try {
    return `RETURNED:${await signIn(null, fd)}`;
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
  state.exchangeError = null;
});

describe('signIn', () => {
  it('honours a same-origin next', async () => {
    expect(await outcome('/client/events/7')).toBe('REDIRECT:/client/events/7');
  });

  it.each(['//evil.example', '/\\evil.example', 'https://evil.example'])(
    'refuses %j',
    async (next) => {
      expect(await outcome(next)).toBe('REDIRECT:/client');
    },
  );

  it('lands on /client by default — /events is not a route in this app', async () => {
    expect(await outcome()).toBe('REDIRECT:/client');
  });
});

describe('/auth/callback', () => {
  it.each(['//evil.example', '/\\evil.example'])('never follows next=%j off-site', async (next) => {
    const res = await GET(
      new Request(
        `https://portal.thc.example/auth/callback?code=abc&next=${encodeURIComponent(next)}`,
      ),
    );
    expect(new URL(res.headers.get('location')!).origin).toBe('https://portal.thc.example');
    expect(new URL(res.headers.get('location')!).pathname).toBe('/reset');
  });
});

describe('middleware', () => {
  it.each(['/forgot', '/forgot/sent', '/reset'])('serves %s without a session', async (path) => {
    const res = await middleware(new NextRequest(`http://127.0.0.1:3002${path}`));
    expect(res.status).toBe(200);
  });
});
