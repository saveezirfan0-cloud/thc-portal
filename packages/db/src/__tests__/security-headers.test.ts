import { describe, expect, it } from 'vitest';
import { securityHeaderRules, securityHeaders } from '../security-headers';

/** The headers each app's next.config.ts returns from `headers()`. */
const asMap = (app: 'office' | 'staff' | 'client', production: boolean) =>
  Object.fromEntries(securityHeaders(app, production).map((h) => [h.key, h.value]));

describe('securityHeaders', () => {
  it.each(['office', 'staff', 'client'] as const)('%s: framing, sniffing, referrer', (app) => {
    const h = asMap(app, true);
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    const csp = h['Content-Security-Policy'] ?? '';
    for (const directive of [
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ]) {
      expect(csp).toContain(directive);
    }
    // No script-src: the App Router's inline scripts would need a nonce.
    expect(csp).not.toContain('script-src');
  });

  it('the Staff App may use the location and the camera, never the microphone', () => {
    expect(asMap('staff', true)['Permissions-Policy']).toBe(
      'geolocation=(self), camera=(self), microphone=()',
    );
  });

  it.each(['office', 'client'] as const)('%s uses none of them', (app) => {
    expect(asMap(app, true)['Permissions-Policy']).toBe('geolocation=(), camera=(), microphone=()');
  });

  it('HSTS in production only (next dev is plain http)', () => {
    expect(asMap('office', true)['Strict-Transport-Security']).toBe(
      'max-age=63072000; includeSubDomains',
    );
    expect(asMap('office', false)['Strict-Transport-Security']).toBeUndefined();
  });

  it('one rule over every path, the service worker included', () => {
    const rules = securityHeaderRules('staff', true);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.source).toBe('/:path*');
  });
});
