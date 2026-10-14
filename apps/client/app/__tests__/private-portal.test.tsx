import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * Production hygiene for a private portal (R4): nothing is for a search
 * engine; a crash in the root layout still draws the branded card; the office
 * address is written once; "am I still signed in?" has a probe that reads
 * nothing.
 */
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({}) }));

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');

const { default: robots } = await import('../robots');
const { metadata } = await import('../layout');
const { config: middlewareConfig } = await import('../../middleware');
const { default: nextConfig } = await import('../../next.config');
const { default: GlobalError } = await import('../global-error');
const { GET: session } = await import('../client/session/route');
const { OFFICE_EMAIL } = await import('../client/account/copy');

describe('the portal is private', () => {
  it('robots.txt disallows everything, for every crawler', () => {
    expect(robots()).toEqual({ rules: { userAgent: '*', disallow: '/' } });
  });

  it('every page says noindex, nofollow', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('robots.txt is served without a session, so a crawler reads it rather than a redirect', () => {
    const matcher = new RegExp(`^${middlewareConfig.matcher[0]}$`);
    expect(matcher.test('/robots.txt')).toBe(false);
    expect(matcher.test('/client/robots.txt')).toBe(true);
    expect(matcher.test('/client/session')).toBe(true);
  });

  it('every response carries X-Robots-Tag, alongside the security headers', async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    expect(rules.map((r) => r.source)).toEqual(['/:path*']);
    const headers = Object.fromEntries((rules[0]?.headers ?? []).map((h) => [h.key, h.value]));
    expect(headers['X-Robots-Tag']).toBe('noindex, nofollow');
    expect(headers['X-Frame-Options']).toBe('DENY');
  });
});

describe('global-error', () => {
  it('brings its own <html> and <body>, the branded card and never the exception text', () => {
    const error = Object.assign(new Error('relation "bookings" does not exist'), {
      digest: 'beef01',
    });
    const html = renderToStaticMarkup(<GlobalError error={error} reset={() => {}} />);
    expect(html).toMatch(/^<html lang="en-GB"[^>]*><head>/);
    expect(html).toContain('<body>');
    expect(html).toContain('<title>Something went wrong · THC Client Portal</title>');
    expect(html).toContain('Something went wrong');
    expect(html).toContain('beef01');
    expect(html).toContain(`mailto:${OFFICE_EMAIL}`);
    expect(html).not.toContain('bookings');
  });

  it('uses tokens only: no hard-coded colour', () => {
    const src = readFileSync(join(APP, 'global-error.tsx'), 'utf8');
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });
});

describe('the office address is written once', () => {
  it('is the §9.12 admin sender', () => {
    expect(OFFICE_EMAIL).toBe('admin@thehospitalitycompany.co.uk');
  });

  it('no screen types it again', () => {
    for (const file of [
      'error.tsx',
      'global-error.tsx',
      'login/page.tsx',
      'forgot/sent/page.tsx',
      'forgot/actions.ts',
      'client/events/[id]/EventScreen.tsx',
      'client/(list)/page.tsx',
    ]) {
      expect(readFileSync(join(APP, file), 'utf8'), file).not.toContain('@thehospitalitycompany');
    }
  });
});

describe('GET /client/session', () => {
  it('answers 204, uncached, with nothing in the body', async () => {
    const res = session();
    expect(res.status).toBe(204);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).toBe('');
  });
});
