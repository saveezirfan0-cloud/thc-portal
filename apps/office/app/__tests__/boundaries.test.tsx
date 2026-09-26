import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * The Back Office's root error / not-found boundaries (audit 24.09 §4).
 * Built from @thc/ui, with no admin chrome — the same boundaries cover
 * /login.
 *
 * There is deliberately NO root loading.tsx. One was added with these and
 * broke /events: on Next 15.5, a root loading boundary left same-page
 * navigations that only change the query (the calendar's Previous/Next,
 * the List/Calendar toggle) stuck on the old period in a production build.
 * `office.events.spec.ts` caught it in CI; the test below keeps it out.
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

describe('root boundaries', () => {
  it('has no root loading.tsx, which freezes query-only navigation on /events', async () => {
    const { existsSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const app = join(dirname(fileURLToPath(import.meta.url)), '..');
    expect(existsSync(join(app, 'loading.tsx'))).toBe(false);
  });

  it('has no loading.tsx where streaming breaks the page, in either web app (PR #79 CI)', async () => {
    // A segment loading boundary wraps its page AND every page beneath it,
    // and on Next 15.5 it broke three things in CI:
    //  - a page that navigates by query only (?view=, ?resolved=, filters):
    //    the navigation froze on the old state (/events, /checkin);
    //  - a page beneath that calls notFound(): the 200 was already sent when
    //    the fallback streamed, so an unknown id answered 200, not 404
    //    (/staff/:id under /staff, /client/events/:id under /client);
    //  - /dashboard: both top bars were in the document during the swap.
    // So a loading.tsx may only sit where its page reads no searchParams
    // and nothing at or below it calls notFound().
    const { existsSync, readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const office = join(dirname(fileURLToPath(import.meta.url)), '..');
    const client = join(office, '..', '..', 'client', 'app');
    expect(existsSync(join(office, 'dashboard', 'loading.tsx'))).toBe(false);

    const pagesUnder = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return name.startsWith('.') ? [] : pagesUnder(path);
        return name === 'page.tsx' ? [path] : [];
      });
    const loadingFiles = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return name.startsWith('.') ? [] : loadingFiles(path);
        return name === 'loading.tsx' ? [dir] : [];
      });

    const offenders: string[] = [];
    for (const root of [office, client]) {
      for (const dir of loadingFiles(root)) {
        const own = join(dir, 'page.tsx');
        const readsQuery = existsSync(own) && /searchParams/.test(readFileSync(own, 'utf8'));
        const notFoundBelow = pagesUnder(dir).some((page) =>
          /\bnotFound\(/.test(readFileSync(page, 'utf8')),
        );
        if (readsQuery || notFoundBelow) offenders.push(dir.slice(root.length) || '/');
      }
    }
    expect(offenders).toEqual([]);
  });

  it('error shows the digest, never the exception text', () => {
    const error = Object.assign(new Error('relation "secret_table" does not exist'), {
      digest: 'abc123',
    });
    const html = renderToStaticMarkup(<RouteError error={error} reset={() => {}} />);
    expect(html).toContain('Something went wrong');
    expect(html).toContain('abc123');
    expect(html).not.toContain('secret_table');
    expect(html).toContain('Try again');
  });

  it('not-found links back to the dashboard', () => {
    const html = renderToStaticMarkup(<NotFound />);
    expect(html).toContain('Page not found');
    expect(html).toContain('href="/dashboard"');
  });

  it('uses tokens only: no hard-coded colour in any of them', async () => {
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const app = join(dirname(fileURLToPath(import.meta.url)), '..');
    for (const file of ['error.tsx', 'not-found.tsx']) {
      const src = readFileSync(join(app, file), 'utf8');
      expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    }
  });
});
