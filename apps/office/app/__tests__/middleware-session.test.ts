import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The session gate after ADR-0108: identity, role and assurance level come
 * from the locally verified token (`getClaims`); GoTrue (`getUser`) is asked
 * at most once a minute per session for what a token cannot say — revoked?
 * authenticator enrolled?
 */
let claims: Record<string, unknown> | null = null;
let gotrueUser: {
  id: string;
  factors: { id: string; factor_type: string; status: string }[];
} | null = null;
const getUser = vi.fn(async () => ({ data: { user: gotrueUser } }));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getClaims: async () => ({ data: claims ? { claims } : null, error: null }),
      getUser,
    },
  }),
}));

const { middleware } = await import('../../middleware');

const saved = { ...process.env };
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});
afterAll(() => {
  process.env = saved;
});

let n = 0;
/** A fresh session id per test: the cache is module state and outlives a test. */
function signIn(extra: Record<string, unknown> = {}) {
  claims = {
    sub: 'admin-1',
    session_id: `session-${++n}`,
    aal: 'aal1',
    app_metadata: { role: 'admin' },
    ...extra,
  };
}
const get = (path: string) => middleware(new NextRequest(`http://127.0.0.1:3000${path}`));
const location = (res: Response) => {
  const header = res.headers.get('location');
  return header ? new URL(header) : null;
};
const verified = { id: 'f1', factor_type: 'totp', status: 'verified' };

beforeEach(() => {
  claims = null;
  gotrueUser = { id: 'admin-1', factors: [] };
  getUser.mockClear();
});

describe('middleware · session gate', () => {
  it('sends a request with no verifiable token to /login, asking GoTrue nothing', async () => {
    const res = await get('/dashboard');
    expect(res.status).toBe(307);
    expect(location(res)?.pathname).toBe('/login');
    expect(location(res)?.searchParams.get('next')).toBe('/dashboard');
    expect(getUser).not.toHaveBeenCalled();
  });

  it('lets an admin through and asks GoTrue once per minute, not once per request', async () => {
    signIn();
    for (const path of ['/dashboard', '/events', '/staff', '/events?view=week']) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(location(res), path).toBeNull();
    }
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('asks again for a different session of the same login', async () => {
    signIn();
    await get('/dashboard');
    signIn();
    await get('/dashboard');
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it('treats a session GoTrue no longer knows as signed out', async () => {
    signIn();
    gotrueUser = null;
    const res = await get('/events');
    expect(res.status).toBe(307);
    expect(location(res)?.pathname).toBe('/login');
  });

  it('keeps refusing a revoked session on later requests inside the minute', async () => {
    signIn();
    gotrueUser = null;
    await get('/events');
    const res = await get('/staff');
    expect(location(res)?.pathname).toBe('/login');
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('sends an aal1 session with a verified authenticator to the code step', async () => {
    signIn({ aal: 'aal1' });
    gotrueUser = { id: 'admin-1', factors: [verified] };
    const res = await get('/events');
    expect(res.status).toBe(307);
    expect(location(res)?.pathname).toBe('/login/verify');
  });

  it('passes an aal2 session that has an authenticator', async () => {
    signIn({ aal: 'aal2' });
    gotrueUser = { id: 'admin-1', factors: [verified] };
    expect((await get('/events')).status).toBe(200);
  });

  it('never takes an unrecognised aal claim as aal2', async () => {
    signIn({ aal: 'aal3' });
    gotrueUser = { id: 'admin-1', factors: [verified] };
    const res = await get('/events');
    expect(location(res)?.pathname).toBe('/login/verify');
  });

  it('passes an aal1 session when the login has no authenticator (two-step is opt-in)', async () => {
    signIn({ aal: 'aal1' });
    expect((await get('/events')).status).toBe(200);
  });

  it('refuses a signed-in client or staff session with the wrong-app page', async () => {
    for (const role of ['client', 'staff', undefined]) {
      signIn({ app_metadata: role ? { role } : {} });
      const res = await get('/dashboard');
      expect(res.status, String(role)).toBe(403);
    }
    expect(getUser).not.toHaveBeenCalled();
  });

  it('does not read the role from user_metadata, which the browser can edit', async () => {
    signIn({ app_metadata: {}, user_metadata: { role: 'admin' } });
    expect((await get('/dashboard')).status).toBe(403);
  });

  it('leaves the public pages open to a signed-in session without asking GoTrue', async () => {
    signIn();
    expect((await get('/login')).status).toBe(200);
    expect(getUser).not.toHaveBeenCalled();
  });
});
