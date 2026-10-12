import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

/**
 * What every response of this app carries (next.config.ts `headers()`,
 * packages/db/src/security-headers.ts), and what sign-out clears.
 */
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({ auth: { signOut: async () => ({ error: null }) } }),
}));

const { default: config } = await import('../../../next.config');
const { POST: signOut } = await import('../signout/route');

describe('next.config headers()', () => {
  it('every path gets the security headers; no X-Powered-By', async () => {
    expect(config.poweredByHeader).toBe(false);
    const rules = (await config.headers?.()) ?? [];
    expect(rules.map((r) => r.source)).toEqual(['/:path*']);
    const headers = Object.fromEntries((rules[0]?.headers ?? []).map((h) => [h.key, h.value]));
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(headers['Permissions-Policy']).toBe('geolocation=(self), camera=(self), microphone=()');
  });

  it('the service worker no longer stores every page a signed-in worker opens', () => {
    const source = readFileSync(new URL('../../../next.config.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/cacheOnNavigation: false/);
  });
});

describe('POST /auth/signout', () => {
  it('clears this origin’s HTTP cache with the session, and nothing else', async () => {
    const res = await signOut(
      new Request('https://app.thc.example/auth/signout', { method: 'POST' }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('Clear-Site-Data')).toBe('"cache"');
  });
});
