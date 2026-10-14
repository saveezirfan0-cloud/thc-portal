import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * The Client Portal's root error and not-found boundaries (audit item 28).
 * The portal's own branded card, no top bar (they also cover /login), and
 * never the exception's text: a customer must not see a query, let alone
 * another client's row, in an error (§11.1).
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { default: RouteError } = await import('../error');
const { default: NotFound } = await import('../not-found');
const app = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('the Client Portal’s boundaries', () => {
  it('error shows the digest and a retry, never the exception text', () => {
    const error = Object.assign(new Error('permission denied for table bookings'), {
      digest: 'c0ffee',
    });
    const html = renderToStaticMarkup(<RouteError error={error} reset={() => {}} />);
    expect(html).toContain('Something went wrong');
    expect(html).toContain('Client Portal');
    expect(html).toContain('c0ffee');
    expect(html).toContain('Try again');
    expect(html).toContain('href="/client"');
    expect(html).not.toContain('bookings');
  });

  it('not-found links back to the event list', () => {
    const html = renderToStaticMarkup(<NotFound />);
    expect(html).toContain('Page not found');
    expect(html).toContain('href="/client"');
  });

  it('use tokens only: no hard-coded colour', () => {
    for (const file of ['error.tsx', 'not-found.tsx']) {
      const src = readFileSync(join(app, file), 'utf8');
      expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    }
  });

  // ADR-0109 / ad9d6333: behind a loading boundary or an in-page <Suspense>,
  // a navigation that changes only the query string froze on the old state.
  it('the list, which navigates by query, streams nothing: no loading.tsx, no Suspense', () => {
    const list = join(app, 'client', '(list)');
    expect(existsSync(join(list, 'loading.tsx'))).toBe(false);
    expect(readFileSync(join(list, 'page.tsx'), 'utf8')).not.toMatch(/\bSuspense\b/);
  });

  it('the event page may stream its body (ADR-0134 N9) only while nothing on it navigates by query', () => {
    // The 404 is decided before the boundary (page.tsx reads the row first).
    // `?doc=` arrives by a full navigation (a plain <a> to the document
    // route, which answers 303) and leaves by history.replaceState; the only
    // router calls are refresh(). A push/replace to a query here would need
    // the Suspense taken out first.
    const dir = join(app, 'client', 'events', '[id]');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.tsx'))) {
      const src = readFileSync(join(dir, file), 'utf8');
      expect(src, file).not.toMatch(/router\.(push|replace)\(/);
      expect(src, file).not.toMatch(/<Link[^>]*href=\{?[`'"]\?/);
    }
    const page = readFileSync(join(dir, 'page.tsx'), 'utf8');
    // Every notFound() comes before the boundary opens.
    expect(page.indexOf('<Suspense')).toBeGreaterThan(-1);
    expect(page.lastIndexOf('notFound()')).toBeGreaterThan(-1);
    expect(page.lastIndexOf('notFound()')).toBeLessThan(page.indexOf('<Suspense'));
  });
});
