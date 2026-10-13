import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';

/**
 * The Client Portal's auth cookies are written httpOnly (ADR-0120), which is
 * safe only because this app has no browser Supabase client. The response
 * headers themselves are packages/db/src/security-headers.ts's, held by its
 * own test and by ../auth/__tests__/security.test.ts.
 */
describe('Client Portal next.config', () => {
  it('opts the server Supabase client into httpOnly auth cookies', () => {
    expect(nextConfig.env?.['THC_AUTH_COOKIE_HTTP_ONLY']).toBe('1');
  });

  it('still serves the shared security headers on every path', async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const keys = rules.find((r) => r.source === '/:path*')?.headers.map((h) => h.key) ?? [];
    expect(keys).toContain('X-Frame-Options');
    expect(keys).toContain('Content-Security-Policy');
  });
});
