import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Client Portal sign-in (§1.4, `wireframes/client/login.html`): `next`
 * never leaves the portal (audit 24.09 §2.3), the default lands on /client
 * (the portal's only home), and A1–A3 are reachable without a session.
 */
const state = vi.hoisted(() => ({
  exchangeError: null as null | { status: number; message: string },
  signInError: null as null | { status: number; code: string; message: string },
  /** What the action wrote to the request's cookie jar. */
  written: [] as { name: string; value: string; options?: Record<string, unknown> }[],
  /** The store the Supabase client was built over — raw, or session-scoped. */
  storeGiven: null as null | {
    getAll(): { name: string; value: string }[];
    set(name: string, value: string, options?: Record<string, unknown>): void;
  },
}));

const jar = {
  getAll: () => [] as { name: string; value: string }[],
  set: (name: string, value: string, options?: Record<string, unknown>) => {
    state.written.push({ name, value, options });
  },
};

vi.mock('next/headers', () => ({ cookies: async () => jar }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@thc/db/server', () => ({
  createClient: (store: typeof state.storeGiven) => ({
    auth: {
      signInWithPassword: async () => {
        state.storeGiven = store;
        return {
          data: state.signInError ? { user: null } : { user: { app_metadata: { role: 'client' } } },
          error: state.signInError,
        };
      },
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
const { WRONG_CREDENTIALS } = await import('../copy');
const { GET } = await import('../../auth/callback/route');
const { middleware } = await import('../../../middleware');

async function outcome(next?: string, extra: Record<string, string> = {}): Promise<string> {
  const fd = new FormData();
  fd.set('email', 'hannah.brooks@leonardo-stpauls.co.uk');
  fd.set('password', 'password123');
  if (next !== undefined) fd.set('next', next);
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
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
  state.signInError = null;
  state.written = [];
  state.storeGiven = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
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

  it('answers a wrong email or password with the one generic sentence (login.html:123)', async () => {
    state.signInError = { status: 400, code: 'invalid_credentials', message: 'Invalid login' };
    expect(await outcome()).toBe(`RETURNED:${WRONG_CREDENTIALS}`);
    // Names both halves together; never one of them alone.
    expect(WRONG_CREDENTIALS).toContain('The email or password is incorrect');
    // A refused sign-in leaves the jar alone — no marker for a session that never started.
    expect(state.written).toEqual([]);
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
