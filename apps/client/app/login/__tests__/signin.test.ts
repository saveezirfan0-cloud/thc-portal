import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Client Portal sign-in (§1.4, `wireframes/client/login.html`): `next`
 * never leaves the portal (audit 24.09 §2.3), the default lands on /client
 * (the portal's only home), "Keep me signed in on this device" decides
 * session vs persistent cookies (ADR-0035), and A1–A3 and /auth/confirm are
 * reachable without a session. The matcher gates a nested path that merely
 * ends in .png (D52).
 */
const state = vi.hoisted(() => ({
  exchangeError: null as null | { status: number; message: string },
  verifyError: null as null | { status: number; message: string },
  clientOpts: [] as unknown[],
}));
const jar = vi.hoisted(() => ({ set: vi.fn(), delete: vi.fn(), getAll: () => [] }));
const auth = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  resetPasswordForEmail: vi.fn(async () => ({ error: null })),
}));

vi.mock('next/headers', () => ({ cookies: async () => jar }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@thc/db/server', () => ({
  createClient: (_jar: unknown, opts?: unknown) => {
    state.clientOpts.push(opts);
    return {
      auth: {
        signInWithPassword: async () => ({
          data: { user: { app_metadata: { role: 'client' } } },
          error: null,
        }),
        exchangeCodeForSession: async () => ({ error: state.exchangeError }),
        verifyOtp: async (args: unknown) => {
          auth.verifyOtp(args);
          return { error: state.verifyError };
        },
        resetPasswordForEmail: auth.resetPasswordForEmail,
      },
    };
  },
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));

const { signIn } = await import('../actions');
const { requestReset } = await import('../../forgot/actions');
const { GET } = await import('../../auth/callback/route');
const { GET: confirm } = await import('../../auth/confirm/route');
const { middleware, config } = await import('../../../middleware');
const { SESSION_ONLY_COOKIE } = await import('@thc/db');

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
  state.verifyError = null;
  state.clientOpts = [];
  jar.set.mockClear();
  jar.delete.mockClear();
  auth.verifyOtp.mockClear();
  auth.resetPasswordForEmail.mockClear();
  vi.unstubAllEnvs();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('signIn', () => {
  it('honours a same-origin next', async () => {
    expect(await outcome('/client/events/7')).toBe('REDIRECT:/client/events/7');
  });

  it.each(['//evil.example', '/\\evil.example', 'https://evil.example', '/..//evil.com'])(
    'refuses %j',
    async (next) => {
      expect(await outcome(next)).toBe('REDIRECT:/client');
    },
  );

  it('lands on /client by default — /events is not a route in this app', async () => {
    expect(await outcome()).toBe('REDIRECT:/client');
  });

  it('ticked "Keep me signed in": persistent cookies, the marker cleared', async () => {
    await outcome(undefined, { remember: '1' });
    expect(state.clientOpts).toEqual([{ sessionOnly: false }]);
    expect(jar.delete).toHaveBeenCalledWith(SESSION_ONLY_COOKIE);
  });

  it('unticked: session cookies, and the marker that keeps them so', async () => {
    await outcome();
    expect(state.clientOpts).toEqual([{ sessionOnly: true }]);
    expect(jar.set.mock.calls[0]?.slice(0, 2)).toEqual([SESSION_ONLY_COOKIE, '1']);
  });
});

describe('/auth/callback', () => {
  it.each(['//evil.example', '/\\evil.example', '/..//evil.com'])(
    'never follows next=%j off-site',
    async (next) => {
      const res = await GET(
        new Request(
          `https://portal.thc.example/auth/callback?code=abc&next=${encodeURIComponent(next)}`,
        ),
      );
      expect(new URL(res.headers.get('location')!).origin).toBe('https://portal.thc.example');
      expect(new URL(res.headers.get('location')!).pathname).toBe('/reset');
    },
  );
});

describe('/auth/confirm (ADR-0035, D13)', () => {
  it('spends a recovery token_hash and hands off to /reset', async () => {
    const res = await confirm(
      new Request('https://portal.thc.example/auth/confirm?token_hash=th&type=recovery'),
    );
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'th' });
    expect(res.headers.get('location')).toBe('https://portal.thc.example/reset');
  });

  it('an expired token lands on the expired-link variant', async () => {
    state.verifyError = { status: 403, message: 'expired' };
    const res = await confirm(
      new Request('https://portal.thc.example/auth/confirm?token_hash=th&type=recovery'),
    );
    expect(res.headers.get('location')).toBe('https://portal.thc.example/reset?error=expired');
  });
});

describe('requestReset', () => {
  async function run(): Promise<string> {
    const fd = new FormData();
    fd.set('email', 'hannah.brooks@leonardo-stpauls.co.uk');
    try {
      return `RETURNED:${await requestReset(null, fd)}`;
    } catch (e) {
      return (e as Error).message;
    }
  }

  it('the link lands on this portal’s /auth/confirm', async () => {
    vi.stubEnv('NEXT_PUBLIC_CLIENT_URL', 'https://portal.thc.example');
    await run();
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(
      'hannah.brooks@leonardo-stpauls.co.uk',
      { redirectTo: 'https://portal.thc.example/auth/confirm' },
    );
  });

  it('refuses in production without NEXT_PUBLIC_CLIENT_URL, even with VERCEL_URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_CLIENT_URL', '');
    vi.stubEnv('VERCEL_URL', 'thc-client-abc.vercel.app');
    vi.stubEnv('NODE_ENV', 'production');
    expect(await run()).toMatch(/^RETURNED:Password reset is not available on this deployment/);
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe('middleware', () => {
  it.each(['/forgot', '/forgot/sent', '/reset', '/auth/confirm'])(
    'serves %s without a session',
    async (path) => {
      const res = await middleware(new NextRequest(`http://127.0.0.1:3002${path}`));
      expect(res.status).toBe(200);
    },
  );

  it('forwards a reset link that landed on "/" to /auth/confirm', async () => {
    const res = await middleware(
      new NextRequest('http://127.0.0.1:3002/?token_hash=abc&type=recovery'),
    );
    expect(new URL(res.headers.get('location')!).pathname).toBe('/auth/confirm');
  });

  it('the matcher skips top-level public files only: /client/x.png is gated (D52)', () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    for (const skipped of ['/favicon.ico', '/logo.png', '/_next/static/x.js']) {
      expect(matcher.test(skipped)).toBe(false);
    }
    for (const gated of ['/client/x.png', '/client', '/client/events/1/photo.jpg']) {
      expect(matcher.test(gated)).toBe(true);
    }
  });
});
