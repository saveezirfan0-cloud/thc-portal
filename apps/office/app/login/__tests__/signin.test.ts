import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Back Office sign-in (§1.4, `wireframes/backoffice/login.html`):
 *
 *  - `next` never leaves the app (audit 24.09 §2.3);
 *  - a client-portal account is refused with the same words as a wrong
 *    password, not admitted and shown the 403 wrong-app page (audit §4);
 *  - "Keep me signed in on this device" (login.html:39): unticked, the
 *    auth cookies are session cookies, and stay so on refresh (ADR-0035);
 *  - A1–A3 and /auth/confirm are reachable without a session;
 *  - the matcher gates a nested path that merely ends in .png (D52).
 */
const state = vi.hoisted(() => ({
  role: 'admin' as string | undefined,
  signInError: null as null | { status: number; code: string; message: string },
  signOut: vi.fn(async (_opts?: unknown) => ({ error: null })),
  middlewareUser: null as null | { app_metadata: Record<string, unknown> },
  clientOpts: [] as unknown[],
  refresh: null as null | { name: string; value: string; options: Record<string, unknown> }[],
}));
const jar = vi.hoisted(() => ({
  set: vi.fn(),
  delete: vi.fn(),
  getAll: () => [],
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
        signInWithPassword: async () =>
          state.signInError
            ? { data: { user: null }, error: state.signInError }
            : { data: { user: { app_metadata: { role: state.role } } }, error: null },
        signOut: state.signOut,
      },
    };
  },
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    config: { cookies: { setAll: (c: NonNullable<typeof state.refresh>) => void } },
  ) => ({
    auth: {
      getUser: async () => {
        // A token refresh writes fresh auth cookies through setAll.
        if (state.refresh) config.cookies.setAll(state.refresh);
        return { data: { user: state.middlewareUser } };
      },
    },
  }),
}));

const { signIn } = await import('../actions');
const { SIGN_IN_REFUSED } = await import('../messages');
const { middleware, config } = await import('../../../middleware');
const { SESSION_ONLY_COOKIE } = await import('@thc/db');

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

async function outcome(values: Record<string, string>): Promise<string> {
  try {
    const result = await signIn(null, form(values));
    return `RETURNED:${result}`;
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
  state.role = 'admin';
  state.signInError = null;
  state.signOut.mockClear();
  state.middlewareUser = null;
  state.clientOpts = [];
  state.refresh = null;
  jar.set.mockClear();
  jar.delete.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const creds = { email: 'gisela@thehospitalitycompany.co.uk', password: 'password123' };

describe('signIn: where it sends an admin', () => {
  it('honours a same-origin next', async () => {
    expect(await outcome({ ...creds, next: '/events/42?tab=board' })).toBe(
      'REDIRECT:/events/42?tab=board',
    );
  });

  it.each([
    '//evil.example',
    '/\\evil.example',
    'https://evil.example',
    '/\t/evil.example',
    '/..//evil.com',
  ])('refuses %j and lands on the dashboard', async (next) => {
    expect(await outcome({ ...creds, next })).toBe('REDIRECT:/dashboard');
  });

  it('defaults to the dashboard', async () => {
    expect(await outcome(creds)).toBe('REDIRECT:/dashboard');
  });
});

describe('signIn: Keep me signed in on this device (login.html:39, ADR-0035)', () => {
  it('ticked: persistent cookies, and any earlier "not on this device" marker is cleared', async () => {
    expect(await outcome({ ...creds, remember: '1' })).toBe('REDIRECT:/dashboard');
    expect(state.clientOpts).toEqual([{ sessionOnly: false }]);
    expect(jar.delete).toHaveBeenCalledWith(SESSION_ONLY_COOKIE);
    expect(jar.set).not.toHaveBeenCalled();
  });

  it('unticked: session cookies, and the marker that keeps them so on refresh', async () => {
    expect(await outcome(creds)).toBe('REDIRECT:/dashboard');
    expect(state.clientOpts).toEqual([{ sessionOnly: true }]);
    const [name, value, options] = jar.set.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect([name, value]).toEqual([SESSION_ONLY_COOKIE, '1']);
    expect(options).not.toHaveProperty('maxAge');
    expect(options).not.toHaveProperty('expires');
  });

  it('a refused sign-in leaves the marker alone', async () => {
    state.signInError = { status: 400, code: 'invalid_credentials', message: 'Invalid login' };
    await outcome(creds);
    expect(jar.set).not.toHaveBeenCalled();
    expect(jar.delete).not.toHaveBeenCalled();
  });
});

describe('signIn: an account that is not an admin', () => {
  it.each(['client', 'staff', undefined])(
    'role %j gets the generic refusal and its session is dropped',
    async (role) => {
      state.role = role;
      expect(await outcome(creds)).toBe(`RETURNED:${SIGN_IN_REFUSED}`);
      expect(state.signOut).toHaveBeenCalledWith({ scope: 'local' });
    },
  );

  it('reads exactly like a wrong password', async () => {
    state.signInError = { status: 400, code: 'invalid_credentials', message: 'Invalid login' };
    const wrongPassword = await outcome(creds);
    state.signInError = null;
    state.role = 'client';
    expect(await outcome(creds)).toBe(wrongPassword);
  });
});

describe('middleware', () => {
  const at = (path: string, init?: { headers?: Record<string, string> }) =>
    middleware(new NextRequest(`http://127.0.0.1:3000${path}`, init));

  it.each(['/forgot', '/forgot/sent', '/reset', '/auth/callback', '/auth/confirm'])(
    'serves %s without a session',
    async (path) => {
      const res = await at(path);
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    },
  );

  it('the duplicate /login/forgot, /login/reset and /login/callback are gone (D12)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    for (const route of ['forgot', 'reset', 'callback']) {
      expect(fs.existsSync(path.resolve(__dirname, '..', route))).toBe(false);
    }
    expect(fs.existsSync(path.resolve(__dirname, '..', 'safeNext.ts'))).toBe(false);
  });

  it('forwards a reset link that landed on "/" to /auth/confirm, token and all (ADR-0035)', async () => {
    const res = await at('/?token_hash=abc&type=recovery&next=/reset');
    expect(res.status).toBe(307);
    const to = new URL(res.headers.get('location') ?? '');
    expect(to.pathname).toBe('/auth/confirm');
    expect(Object.fromEntries(to.searchParams)).toEqual({
      token_hash: 'abc',
      type: 'recovery',
      next: '/reset',
    });
  });

  it('still sends a sessionless visit to a private page to sign-in', async () => {
    const res = await at('/dashboard');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login?next=%2Fdashboard');
  });

  it('lets a client-held session reach /login, where the refusal is shown', async () => {
    state.middlewareUser = { app_metadata: { role: 'client' } };
    const res = await at('/login');
    expect(res.status).toBe(200);
  });

  it('still refuses a client-held session anywhere inside the app', async () => {
    state.middlewareUser = { app_metadata: { role: 'client' } };
    const res = await at('/dashboard');
    expect(res.status).toBe(403);
  });

  it('a refresh keeps an unticked sign-in on session cookies; a deletion stays a deletion', async () => {
    state.middlewareUser = { app_metadata: { role: 'admin' } };
    state.refresh = [
      { name: 'sb-x-auth-token', value: 'v', options: { path: '/', maxAge: 34560000 } },
      { name: 'sb-x-auth-token.1', value: '', options: { path: '/', maxAge: 0 } },
    ];
    const unticked = await at('/dashboard', { headers: { cookie: `${SESSION_ONLY_COOKIE}=1` } });
    const header = unticked.headers.getSetCookie();
    expect(header.find((c) => c.startsWith('sb-x-auth-token=v'))).not.toMatch(/Max-Age|Expires/i);
    expect(header.find((c) => c.startsWith('sb-x-auth-token.1='))).toMatch(/Max-Age=0/i);

    const ticked = await at('/dashboard');
    expect(ticked.headers.getSetCookie().find((c) => c.startsWith('sb-x-auth-token=v'))).toMatch(
      /Max-Age=34560000/i,
    );
  });

  it('the matcher skips top-level public files only: /staff/x.png is gated (D52)', () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    for (const skipped of ['/favicon.ico', '/logo.png', '/_next/static/x.js', '/sw.js']) {
      expect(matcher.test(skipped)).toBe(false);
    }
    for (const gated of ['/staff/x.png', '/dashboard', '/events/1/photo.jpg', '/sw.jsx', '/']) {
      expect(matcher.test(gated)).toBe(true);
    }
  });
});
