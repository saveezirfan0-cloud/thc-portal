import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { appearanceScript } from '@thc/ui';
import { APPEARANCE_SCRIPT_HASH } from '@thc/db/csp';

/**
 * The Staff App's per-request script policy (ADR-0164, audit M2): the same
 * report-only policy as the Back Office, with the nonce handed to Next.js
 * on the request. The session gate itself is middleware-session.test.ts.
 */
let claims: Record<string, unknown> | null = null;
const getClaims = vi.fn(async () => ({ data: claims ? { claims } : null, error: null }));
const getUser = vi.fn(async () => ({ data: { user: { id: 'staff-1' } } }));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getClaims, getUser } }),
}));

const { middleware } = await import('../../middleware');

const saved = { ...process.env };
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abcdefghijklmnopqrst.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});
afterAll(() => {
  process.env = saved;
});

let n = 0;
beforeEach(() => {
  claims = { sub: 'staff-1', session_id: `csp-session-${++n}`, app_metadata: { role: 'staff' } };
  getClaims.mockClear();
  getUser.mockClear();
});

const get = (path: string, init?: { method?: string; body?: string }) =>
  middleware(new NextRequest(`http://127.0.0.1:3001${path}`, init));
const policyOf = (res: Response) => res.headers.get('content-security-policy-report-only') ?? '';
const nonceOf = (res: Response) => /'nonce-([A-Za-z0-9+/=]+)'/.exec(policyOf(res))?.[1];

describe('Staff App · Content-Security-Policy', () => {
  it('a working screen carries a report-only policy with a fresh nonce, handed on to Next.js', async () => {
    const a = await get('/shifts');
    const b = await get('/shifts');
    expect(a.status).toBe(200);
    const nonce = nonceOf(a);
    expect(nonce).toBeTruthy();
    expect(nonceOf(b)).not.toBe(nonce);
    expect(a.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(policyOf(a)).toContain("'strict-dynamic'");
  });

  it('connects to the project (and its Realtime socket); images from Storage and Mapbox', async () => {
    const policy = policyOf(await get('/shifts'));
    expect(policy).toContain(
      "connect-src 'self' https://abcdefghijklmnopqrst.supabase.co wss://abcdefghijklmnopqrst.supabase.co;",
    );
    expect(policy).toContain(
      "img-src 'self' data: blob: https://api.mapbox.com https://abcdefghijklmnopqrst.supabase.co;",
    );
    expect(policy).toContain("worker-src 'self'");
  });

  it('the screens that render before a session carry it too', async () => {
    claims = null;
    for (const path of ['/login', '/apply', '/offline', '/install']) {
      expect(nonceOf(await get(path)), path).toBeTruthy();
    }
    // and a refusal
    claims = { sub: 'a', session_id: 'x', app_metadata: { role: 'admin' } };
    const refused = await get('/shifts');
    expect(refused.status).toBe(403);
    expect(nonceOf(refused)).toBeTruthy();
  });

  it('lets a violation report through with no session, POST only', async () => {
    claims = null;
    const res = await get('/api/csp-report', { method: 'POST', body: '{}' });
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(getClaims).not.toHaveBeenCalled();
    expect((await get('/api/csp-report')).status).toBe(307);
  });

  it('allows the appearance script by its hash (it renders before the nonce could reach it)', () => {
    const hash = createHash('sha256').update(appearanceScript, 'utf8').digest('base64');
    expect(APPEARANCE_SCRIPT_HASH).toBe(`'sha256-${hash}'`);
  });
});
