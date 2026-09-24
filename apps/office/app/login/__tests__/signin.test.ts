import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Back Office sign-in (§1.4, `wireframes/backoffice/login.html`):
 *
 *  - `next` never leaves the app (audit 24.09 §2.3);
 *  - a client-portal account is refused with the same words as a wrong
 *    password, not admitted and shown the 403 wrong-app page (audit §4);
 *  - A1–A3 are reachable without a session.
 */
const state = vi.hoisted(() => ({
  role: 'admin' as string | undefined,
  signInError: null as null | { status: number; code: string; message: string },
  signOut: vi.fn(async (_opts?: unknown) => ({ error: null })),
  middlewareUser: null as null | { app_metadata: Record<string, unknown> },
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
      signInWithPassword: async () =>
        state.signInError
          ? { data: { user: null }, error: state.signInError }
          : { data: { user: { app_metadata: { role: state.role } } }, error: null },
      signOut: state.signOut,
    },
  }),
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.middlewareUser } }) },
  }),
}));

const { signIn } = await import('../actions');
const { SIGN_IN_REFUSED } = await import('../messages');
const { middleware } = await import('../../../middleware');

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

  it.each(['//evil.example', '/\\evil.example', 'https://evil.example', '/\t/evil.example'])(
    'refuses %j and lands on the dashboard',
    async (next) => {
      expect(await outcome({ ...creds, next })).toBe('REDIRECT:/dashboard');
    },
  );

  it('defaults to the dashboard', async () => {
    expect(await outcome(creds)).toBe('REDIRECT:/dashboard');
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
  const at = (path: string) => middleware(new NextRequest(`http://127.0.0.1:3000${path}`));

  it.each(['/forgot', '/forgot/sent', '/reset', '/auth/callback'])(
    'serves %s without a session',
    async (path) => {
      const res = await at(path);
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    },
  );

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
});
