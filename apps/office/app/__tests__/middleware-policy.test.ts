import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The middleware's ADR-0164 gates (security audit H1, M4, M2):
 *
 *  - two-step compulsory: an office login with no authenticator reaches
 *    the enrol step and sign-out, nothing else;
 *  - a sign-in lasts office_session_max_hours from the password;
 *  - every response carries the per-request, report-only script policy.
 *
 * The sign-in policy is the database's answer (`office_session_policy()`),
 * asked with GoTrue once a minute per session. The ADR-0108 session gate
 * and ADR-0057's opt-in world are held by middleware-session.test.ts.
 */
let claims: Record<string, unknown> | null = null;
let gotrueUser: {
  id: string;
  factors: { id: string; factor_type: string; status: string }[];
} | null = null;
const getUser = vi.fn(async () => ({ data: { user: gotrueUser } }));
let policy: Record<string, unknown> | null = null;
let policyError: { code: string; message: string } | null = null;
const rpc = vi.fn(async (_name: string) => ({ data: policy, error: policyError }));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getClaims: async () => ({ data: claims ? { claims } : null, error: null }),
      getUser,
    },
    rpc,
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
/** A fresh session id per sign-in: the cache is module state and outlives a test. */
function signIn(extra: Record<string, unknown> = {}) {
  claims = {
    sub: 'admin-1',
    session_id: `policy-session-${++n}`,
    aal: 'aal1',
    app_metadata: { role: 'admin' },
    ...extra,
  };
}
const get = (path: string, init?: ConstructorParameters<typeof NextRequest>[1]) =>
  middleware(new NextRequest(`http://127.0.0.1:3000${path}`, init));
const location = (res: Response) => {
  const header = res.headers.get('location');
  return header ? new URL(header) : null;
};
const verified = { id: 'f1', factor_type: 'totp', status: 'verified' };
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

beforeEach(() => {
  claims = null;
  gotrueUser = { id: 'admin-1', factors: [] };
  getUser.mockClear();
  policy = { twoStepRequired: true, sessionMaxHours: 12, sessionStartedAt: hoursAgo(1) };
  policyError = null;
  rpc.mockClear();
});

describe('two-step compulsory (audit H1)', () => {
  it('sends an aal1 admin with no authenticator to the enrol step, keeping the page as next', async () => {
    signIn();
    const res = await get('/events/42?tab=board');
    expect(res.status).toBe(307);
    expect(location(res)?.pathname).toBe('/login/enrol');
    expect(location(res)?.searchParams.get('next')).toBe('/events/42?tab=board');
  });

  it('every private path, API routes and server-action posts included, goes to the enrol step', async () => {
    for (const path of ['/dashboard', '/staff/7', '/account', '/settings', '/api/documents/1/send']) {
      signIn();
      expect(location(await get(path))?.pathname, path).toBe('/login/enrol');
    }
    signIn();
    const post = await get('/staff/7', { method: 'POST', body: 'x' });
    expect(location(post)?.pathname).toBe('/login/enrol');
  });

  it('the enrol step, the code step, sign-in and sign-out stay reachable, so nothing loops', async () => {
    signIn();
    for (const path of ['/login/enrol', '/login/enrol?next=%2Fevents', '/login/verify', '/login']) {
      expect((await get(path)).status, path).toBe(200);
    }
    // The enrol step's own server actions post to its own path.
    expect((await get('/login/enrol', { method: 'POST', body: 'x' })).status).toBe(200);
    expect((await get('/auth/signout', { method: 'POST' })).status).toBe(200);
  });

  it('a login that has an authenticator is sent to the code step, not the enrol step', async () => {
    signIn();
    gotrueUser = { id: 'admin-1', factors: [verified] };
    expect(location(await get('/events'))?.pathname).toBe('/login/verify');
  });

  it('passes once the session is at aal2', async () => {
    signIn({ aal: 'aal2' });
    gotrueUser = { id: 'admin-1', factors: [verified] };
    expect((await get('/events')).status).toBe(200);
  });

  it('asks the database once a minute per session, alongside GoTrue', async () => {
    signIn({ aal: 'aal2' });
    gotrueUser = { id: 'admin-1', factors: [verified] };
    for (const path of ['/dashboard', '/events', '/staff']) await get(path);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('office_session_policy');
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('the database cannot be asked: aal1 with no authenticator gets a retryable 503, never a page', async () => {
    signIn();
    policy = null;
    policyError = { code: '57014', message: 'canceling statement due to statement timeout' };
    const res = await get('/events');
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
    // Not remembered: the next request asks again and, answered, is sent on.
    policy = { twoStepRequired: true, sessionMaxHours: 12, sessionStartedAt: hoursAgo(1) };
    policyError = null;
    expect(location(await get('/events'))?.pathname).toBe('/login/enrol');
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('the database cannot be asked: a code step owed is still owed, and aal2 goes on', async () => {
    policy = null;
    policyError = { code: '57014', message: 'timeout' };
    signIn();
    gotrueUser = { id: 'admin-1', factors: [verified] };
    expect(location(await get('/events'))?.pathname).toBe('/login/verify');
    signIn({ aal: 'aal2' });
    expect((await get('/events')).status).toBe(200);
  });

  it('a client without the call fails the same way, closed', async () => {
    signIn();
    rpc.mockRejectedValueOnce(new TypeError('rpc is not a function'));
    expect((await get('/events')).status).toBe(503);
  });

  it('a database without the setting yet (no such function) keeps ADR-0057’s opt-in rule', async () => {
    signIn();
    policy = null;
    policyError = { code: 'PGRST202', message: 'Could not find the function' };
    expect((await get('/events')).status).toBe(200);
  });

  it('only a literal false switches it off', async () => {
    signIn();
    policy = { twoStepRequired: 'no', sessionMaxHours: 12 };
    expect(location(await get('/events'))?.pathname).toBe('/login/enrol');
    signIn();
    policy = { twoStepRequired: false, sessionMaxHours: 12 };
    expect((await get('/events')).status).toBe(200);
  });

  it('a revoked session is still a sign-in, not an enrol step', async () => {
    signIn();
    gotrueUser = null;
    expect(location(await get('/events'))?.pathname).toBe('/login');
  });
});

describe('session age (audit M4)', () => {
  it('a session signed in more than 12 hours ago is signed out on this device and sent to sign in', async () => {
    signIn({ aal: 'aal2' });
    gotrueUser = { id: 'admin-1', factors: [verified] };
    policy = { twoStepRequired: true, sessionMaxHours: 12, sessionStartedAt: hoursAgo(12.1) };
    const res = await get('/staff/7?tab=bank', {
      headers: { cookie: 'sb-abc-auth-token.0=one; sb-abc-auth-token.1=two; thc-keep-signed-in=1' },
    });
    expect(res.status).toBe(307);
    expect(location(res)?.pathname).toBe('/login');
    expect(location(res)?.searchParams.get('next')).toBe('/staff/7?tab=bank');
    expect(location(res)?.searchParams.get('expired')).toBe('12');
    const cookies = res.headers.get('set-cookie') ?? '';
    expect(cookies).toMatch(/sb-abc-auth-token\.0=;[^,]*Max-Age=0/);
    expect(cookies).toMatch(/sb-abc-auth-token\.1=;[^,]*Max-Age=0/);
    expect(cookies).not.toContain('thc-keep-signed-in');
  });

  it('inside the limit it passes', async () => {
    signIn({ aal: 'aal2' });
    gotrueUser = { id: 'admin-1', factors: [verified] };
    policy = { twoStepRequired: true, sessionMaxHours: 12, sessionStartedAt: hoursAgo(11.9) };
    expect((await get('/events')).status).toBe(200);
  });

  it('the limit is the owner’s setting', async () => {
    signIn({ aal: 'aal2' });
    gotrueUser = { id: 'admin-1', factors: [verified] };
    policy = { twoStepRequired: true, sessionMaxHours: 24, sessionStartedAt: hoursAgo(13) };
    expect((await get('/events')).status).toBe(200);
  });

  it('comes before the enrol step: an old password-only session is sent to sign in again', async () => {
    signIn();
    policy = { twoStepRequired: true, sessionMaxHours: 12, sessionStartedAt: hoursAgo(13) };
    expect(location(await get('/events'))?.pathname).toBe('/login');
  });

  it('is judged on every request, not only when the database is asked', async () => {
    signIn({ aal: 'aal2' });
    gotrueUser = { id: 'admin-1', factors: [verified] };
    policy = { twoStepRequired: true, sessionMaxHours: 1, sessionStartedAt: hoursAgo(0.99) };
    vi.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
    try {
      expect((await get('/events')).status).toBe(200);
      vi.setSystemTime(Date.now() + 60_000);
      expect(location(await get('/events'))?.pathname).toBe('/login');
      expect(rpc).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an unknown start time is not judged here (the database fails closed on it)', async () => {
    signIn({ aal: 'aal2' });
    gotrueUser = { id: 'admin-1', factors: [verified] };
    policy = { twoStepRequired: true, sessionMaxHours: 12, sessionStartedAt: null };
    expect((await get('/events')).status).toBe(200);
  });

  it('an old session can still reach the sign-in pages, so ending it cannot loop', async () => {
    signIn({ aal: 'aal2' });
    policy = { twoStepRequired: true, sessionMaxHours: 12, sessionStartedAt: hoursAgo(30) };
    expect((await get('/login?expired=12')).status).toBe(200);
  });
});

describe('Content-Security-Policy (audit M2)', () => {
  const policyOf = (res: Response) => res.headers.get('content-security-policy-report-only') ?? '';
  const nonceOf = (res: Response) => /'nonce-([A-Za-z0-9+/=]+)'/.exec(policyOf(res))?.[1];

  it('every response carries a report-only policy with a fresh nonce', async () => {
    signIn({ aal: 'aal2' });
    gotrueUser = { id: 'admin-1', factors: [verified] };
    const a = await get('/events');
    const b = await get('/events');
    expect(a.status).toBe(200);
    expect(nonceOf(a)).toBeTruthy();
    expect(nonceOf(b)).not.toBe(nonceOf(a));
    expect(policyOf(a)).toContain("'strict-dynamic'");
    expect(policyOf(a)).toContain("object-src 'none'");
    // The ENFORCED static CSP is next.config.ts's (security-headers.ts).
    expect(a.headers.get('content-security-policy')).toBeNull();
  });

  it('hands the nonce on to Next.js in the request headers', async () => {
    signIn({ aal: 'aal2' });
    gotrueUser = { id: 'admin-1', factors: [verified] };
    const res = await get('/events');
    const nonce = nonceOf(res);
    expect(res.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(res.headers.get('x-middleware-request-content-security-policy-report-only')).toContain(
      `'nonce-${nonce}'`,
    );
  });

  it('redirects and refusals carry it too', async () => {
    expect(nonceOf(await get('/dashboard'))).toBeTruthy();
    signIn({ app_metadata: { role: 'staff' } });
    const refused = await get('/dashboard');
    expect(refused.status).toBe(403);
    expect(nonceOf(refused)).toBeTruthy();
  });

  it('allows connections to this Supabase project and nothing else', async () => {
    expect(policyOf(await get('/login'))).toContain(
      "connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321;",
    );
  });

  it('lets a violation report through with no session, POST only', async () => {
    const res = await get('/api/csp-report', { method: 'POST', body: '{}' });
    expect(res.status).toBe(200);
    expect(location(res)).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
    expect(location(await get('/api/csp-report'))?.pathname).toBe('/login');
  });
});
