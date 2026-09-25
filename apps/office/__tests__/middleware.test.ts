import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The Back Office gate (§1.4): a client never sees the back office. The
 * wrong-role branch answers with a terminal 403 and the wrong-app page — a
 * redirect to the "right" app was the ERR_TOO_MANY_REDIRECTS, because the
 * three apps are three hosts. Nothing drove that branch before this file:
 * the Playwright smoke asserts only the redirect to /login, and
 * packages/db pins only the page's HTML.
 */
type UserLike = {
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
} | null;
let sessionUser: UserLike = null;

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: sessionUser } }) },
  }),
}));

const { middleware } = await import('../middleware');

const request = (path: string) => new NextRequest(`http://127.0.0.1:3000${path}`);

describe('the Back Office role gate (§1.4)', () => {
  const saved = { ...process.env };
  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    delete process.env.VERCEL_ENV;
  });
  afterAll(() => {
    process.env = saved;
  });
  afterEach(() => {
    sessionUser = null;
  });

  it('turns a signed-in client away with the wrong-app page, not a redirect', async () => {
    sessionUser = { app_metadata: { role: 'client' } };
    const res = await middleware(request('/'));
    expect(res.status).toBe(403);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('This account is not for the Back Office');
    expect(body).toContain('Client Portal');
  });

  it('turns a worker away the same way', async () => {
    sessionUser = { app_metadata: { role: 'staff' } };
    const res = await middleware(request('/dashboard'));
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('This account is not for the Back Office');
  });

  it('admits nobody whose role is missing — an allow-list, not a deny-list', async () => {
    sessionUser = { app_metadata: {} };
    const res = await middleware(request('/'));
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('This account is not for the Back Office');
  });

  it('never reads user_metadata, which the browser can write', async () => {
    sessionUser = { app_metadata: {}, user_metadata: { role: 'admin' } };
    const res = await middleware(request('/'));
    expect(res.status).toBe(403);
  });

  it('lets an admin through (control)', async () => {
    sessionUser = { app_metadata: { role: 'admin' } };
    const res = await middleware(request('/dashboard'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('still sends a stranger to sign in with the path to come back to', async () => {
    const res = await middleware(request('/compliance'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login?next=%2Fcompliance');
  });

  it('lets a wrong-role session sign out, so it can switch accounts', async () => {
    sessionUser = { app_metadata: { role: 'client' } };
    const res = await middleware(
      new NextRequest('http://127.0.0.1:3000/auth/signout', { method: 'POST' }),
    );
    expect(res.status).toBe(200);
  });
});

/**
 * /design-system is sample copy only, but it is the admin component library
 * on the admin host, and the security brief lists every sessionless surface
 * (invariant 6). Open where it is reviewed — locally, in CI's `next start`,
 * on a Vercel preview — and gated on the production deployment.
 */
describe('/design-system is public everywhere but production', () => {
  const saved = { ...process.env };
  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  });
  afterAll(() => {
    process.env = saved;
  });
  afterEach(() => {
    sessionUser = null;
    delete process.env.VERCEL_ENV;
  });

  it('serves a logged-out visit locally and in CI (no VERCEL_ENV)', async () => {
    delete process.env.VERCEL_ENV;
    const res = await middleware(request('/design-system'));
    expect(res.status).toBe(200);
  });

  it('serves a logged-out visit on a preview deployment', async () => {
    process.env.VERCEL_ENV = 'preview';
    const res = await middleware(request('/design-system'));
    expect(res.status).toBe(200);
  });

  it('asks for a sign-in on the production deployment', async () => {
    process.env.VERCEL_ENV = 'production';
    const res = await middleware(request('/design-system'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login?next=%2Fdesign-system');
  });

  it('is an admin page there, like the rest', async () => {
    process.env.VERCEL_ENV = 'production';
    sessionUser = { app_metadata: { role: 'client' } };
    expect((await middleware(request('/design-system'))).status).toBe(403);
    sessionUser = { app_metadata: { role: 'admin' } };
    expect((await middleware(request('/design-system'))).status).toBe(200);
  });

  it('keeps /login and /auth public in production (control)', async () => {
    process.env.VERCEL_ENV = 'production';
    expect((await middleware(request('/login'))).status).toBe(200);
    expect((await middleware(request('/auth/callback'))).status).toBe(200);
  });
});
