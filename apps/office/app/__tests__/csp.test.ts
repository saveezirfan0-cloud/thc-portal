import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { appearanceScript } from '@thc/ui';
import {
  APPEARANCE_SCRIPT_HASH,
  CSP_HEADER,
  contentSecurityPolicy,
  createNonce,
  readCspReports,
  supabaseOrigins,
} from '@thc/db/csp';

/**
 * The per-request script policy (ADR-0164, audit M2): the pure half.
 * The middleware half is in middleware-session.test.ts.
 */
describe('the Content-Security-Policy', () => {
  it('pins the hash of the one inline script of our own (the appearance script)', () => {
    const hash = createHash('sha256').update(appearanceScript, 'utf8').digest('base64');
    expect(APPEARANCE_SCRIPT_HASH).toBe(`'sha256-${hash}'`);
  });

  it('ships report-only: enforcing is the one constant', () => {
    expect(CSP_HEADER).toBe('content-security-policy-report-only');
  });

  it('a nonce is fresh each time and the shape Next.js reads', () => {
    const a = createNonce();
    const b = createNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });

  it('scripts: the nonce, strict-dynamic and the appearance hash — no host list, no unsafe-inline', () => {
    const policy = contentSecurityPolicy({
      app: 'office',
      nonce: 'abc123',
      supabaseUrl: 'https://dgxtqvalfiisfpbwodew.supabase.co',
    });
    const script = policy.split('; ').find((d) => d.startsWith('script-src ')) ?? '';
    expect(script).toBe(`script-src 'self' 'nonce-abc123' 'strict-dynamic' ${APPEARANCE_SCRIPT_HASH}`);
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain('report-uri /api/csp-report');
    expect(policy).not.toContain('unsafe-eval');
  });

  it('connects to the Supabase project (and its Realtime socket) only', () => {
    const policy = contentSecurityPolicy({
      app: 'office',
      nonce: 'n',
      supabaseUrl: 'https://dgxtqvalfiisfpbwodew.supabase.co/',
    });
    expect(policy).toContain(
      "connect-src 'self' https://dgxtqvalfiisfpbwodew.supabase.co wss://dgxtqvalfiisfpbwodew.supabase.co",
    );
    expect(policy).toContain(
      "img-src 'self' data: blob: https://api.mapbox.com https://tile.openstreetmap.org https://dgxtqvalfiisfpbwodew.supabase.co",
    );
  });

  it('the Staff App does not load OpenStreetMap tiles; dev adds what next dev needs', () => {
    const policy = contentSecurityPolicy({ app: 'staff', nonce: 'n', supabaseUrl: undefined, dev: true });
    expect(policy).not.toContain('openstreetmap');
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("connect-src 'self' ws:");
  });

  it('a malformed project URL adds nothing', () => {
    expect(supabaseOrigins('not a url')).toBeNull();
    expect(supabaseOrigins('javascript:alert(1)')).toBeNull();
    expect(supabaseOrigins('http://localhost:54321')).toEqual({
      http: 'http://localhost:54321',
      ws: 'ws://localhost:54321',
    });
  });
});

describe('violation reports', () => {
  it('reads both report shapes, and never keeps a query string', () => {
    expect(
      readCspReports({
        'csp-report': {
          'effective-directive': 'script-src-elem',
          'blocked-uri': 'https://evil.example/x.js?token=secret',
          'document-uri': 'https://office.example/staff/7?tab=bank#x',
          disposition: 'report',
        },
      }),
    ).toEqual([
      {
        directive: 'script-src-elem',
        blocked: 'https://evil.example/x.js',
        page: 'https://office.example/staff/7',
        disposition: 'report',
        sample: '',
      },
    ]);
    expect(
      readCspReports([
        {
          type: 'csp-violation',
          body: { effectiveDirective: 'img-src', blockedURL: 'https://x.example/a.png', documentURL: 'https://o/a' },
        },
      ])[0]?.directive,
    ).toBe('img-src');
    expect(readCspReports('garbage')).toEqual([]);
    expect(readCspReports(null)).toEqual([]);
  });
});
