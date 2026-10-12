import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';

/**
 * Security review 12.10: every Client Portal response carries anti-framing,
 * a minimal CSP that cannot break Next's inline bootstrap, a same-origin
 * Referer, and no camera / microphone / location. And the auth cookies are
 * httpOnly here, which is safe only because this app has no browser
 * Supabase client.
 */
async function headersFor(path: string): Promise<Map<string, string>> {
  const rules = (await nextConfig.headers?.()) ?? [];
  const rule = rules.find((r) => r.source === '/:path*');
  expect(rule, `a rule covers ${path}`).toBeDefined();
  return new Map(rule!.headers.map((h) => [h.key.toLowerCase(), h.value]));
}

describe('Client Portal response headers', () => {
  it('never framed: X-Frame-Options DENY and CSP frame-ancestors none', async () => {
    const h = await headersFor('/login');
    expect(h.get('x-frame-options')).toBe('DENY');
    expect(h.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('the CSP pins base-uri, object-src and form-action, and does not restrict scripts or styles', async () => {
    const csp = (await headersFor('/client')).get('content-security-policy')!;
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self'");
    // A script-src/style-src/default-src without a nonce would block Next's inline bootstrap.
    expect(csp).not.toMatch(/script-src|style-src|default-src/);
  });

  it('Referrer-Policy same-origin, Permissions-Policy denying camera, microphone and location', async () => {
    const h = await headersFor('/auth/confirm');
    expect(h.get('referrer-policy')).toBe('same-origin');
    const permissions = h.get('permissions-policy')!;
    for (const feature of ['camera=()', 'microphone=()', 'geolocation=()']) {
      expect(permissions).toContain(feature);
    }
    expect(h.get('x-content-type-options')).toBe('nosniff');
  });

  it('opts the server Supabase client into httpOnly auth cookies', () => {
    expect(nextConfig.env?.['THC_AUTH_COOKIE_HTTP_ONLY']).toBe('1');
  });
});
