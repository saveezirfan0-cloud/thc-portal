import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WRONG_APP_PATH, WRONG_APP_ROLE_HEADER } from '@thc/db';

/**
 * The Staff App session gate after go-live audit H2 (the Back Office's
 * ADR-0108): identity and role come from the locally verified token
 * (`getClaims`); GoTrue (`getUser`) is asked at most once a minute per
 * session, for the one thing a token cannot say — has it been revoked?
 *
 * Every gate the middleware had is still here: public paths, the sign-out
 * bypass, the wrong-app rewrite, and failing closed with no configuration.
 */
let claims: Record<string, unknown> | null = null;
let gotrueUser: { id: string } | null = null;
const getClaims = vi.fn(async () => ({ data: claims ? { claims } : null, error: null }));
const getUser = vi.fn(async () => ({ data: { user: gotrueUser } }));
const createServerClient = vi.fn(() => ({ auth: { getClaims, getUser } }));

vi.mock('@supabase/ssr', () => ({ createServerClient: () => createServerClient() }));

const { middleware } = await import('../../middleware');

const saved = { ...process.env };
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});
afterAll(() => {
  process.env = saved;
});
afterEach(() => {
  vi.unstubAllEnvs();
});

let n = 0;
/** A fresh session id per test: the cache is module state and outlives a test. */
function signIn(role: unknown = 'staff') {
  claims = { sub: 'staff-1', session_id: `session-${++n}`, app_metadata: { role } };
}
const get = (path: string, init?: { method?: string }) =>
  middleware(new NextRequest(`http://127.0.0.1:3001${path}`, init));
const location = (res: Response) => {
  const header = res.headers.get('location');
  return header ? new URL(header) : null;
};

beforeEach(() => {
  claims = null;
  gotrueUser = { id: 'staff-1' };
  getClaims.mockClear();
  getUser.mockClear();
  createServerClient.mockClear();
});

describe('middleware · session gate', () => {
  it('no verifiable token: a working screen goes to /login, asking GoTrue nothing', async () => {
    const res = await get('/shifts');
    expect(res.status).toBe(307);
    expect(location(res)?.pathname).toBe('/login');
    expect(location(res)?.searchParams.get('next')).toBe('/shifts');
    expect(getUser).not.toHaveBeenCalled();
  });

  it('no token: the public screens still render', async () => {
    for (const path of ['/login', '/install', '/offline', '/privacy', '/apply', '/auth/confirm']) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(location(res), path).toBeNull();
    }
  });

  it('a worker is let through, and GoTrue is asked once a minute, not per request', async () => {
    signIn();
    for (const path of ['/shifts', '/shifts?tab=open', '/invites', '/radar', '/shifts/b1']) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(location(res), path).toBeNull();
    }
    expect(getClaims).toHaveBeenCalledTimes(5);
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('asks again for a different session of the same login', async () => {
    signIn();
    await get('/shifts');
    signIn();
    await get('/shifts');
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it('a session GoTrue no longer knows is signed out, and stays so without re-asking', async () => {
    signIn();
    gotrueUser = null;
    for (let i = 0; i < 2; i++) {
      const res = await get('/radar');
      expect(res.status).toBe(307);
      expect(location(res)?.pathname).toBe('/login');
      expect(location(res)?.searchParams.get('next')).toBe('/radar');
    }
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('a public path never waits on GoTrue', async () => {
    signIn();
    await get('/install');
    expect(getUser).not.toHaveBeenCalled();
  });
});

describe('middleware · the role gate, from the verified claims', () => {
  it('a Back Office or client session is answered by the wrong-app page, 403', async () => {
    for (const role of ['admin', 'client']) {
      signIn(role);
      const res = await get('/shifts');
      expect(res.status, role).toBe(403);
      expect(res.headers.get('x-middleware-rewrite'), role).toContain(WRONG_APP_PATH);
      expect(res.headers.get(`x-middleware-request-${WRONG_APP_ROLE_HEADER}`), role).toBe(role);
    }
  });

  it('a session with no role is not a worker (allow-list)', async () => {
    signIn(null);
    const res = await get('/shifts');
    expect(res.status).toBe(403);
    expect(res.headers.get(`x-middleware-request-${WRONG_APP_ROLE_HEADER}`)).toBe('none');
  });

  it('a role in user_metadata only is not read', async () => {
    claims = {
      sub: 'staff-1',
      session_id: `session-${++n}`,
      app_metadata: {},
      user_metadata: { role: 'staff' },
    };
    expect((await get('/shifts')).status).toBe(403);
  });
});

describe('middleware · what it steps aside for', () => {
  it('sign-out (POST) builds no Supabase client at all', async () => {
    signIn('admin');
    const res = await get('/auth/signout', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it('fails closed when a deployment has no Supabase configuration', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('VERCEL_ENV', 'production');
    const res = await get('/shifts');
    expect(res.status).toBe(503);
  });
});
