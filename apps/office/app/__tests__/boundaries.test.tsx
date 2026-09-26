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

  it('has no loading.tsx where streaming breaks the page (PR #79 CI)', async () => {
    // Three ways a segment loading boundary broke a screen in CI:
    //  - /events: query-only navigation froze on the old period (above);
    //  - a page that calls notFound(): the 200 is already sent by the time
    //    the fallback streams, so an unknown id answered 200, not 404;
    //  - /dashboard: the fallback's top bar and the page's were in the
    //    document together while it swapped, so the zone note was twice.
    const { existsSync, readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const app = join(dirname(fileURLToPath(import.meta.url)), '..');
    expect(existsSync(join(app, 'events', 'loading.tsx'))).toBe(false);
    expect(existsSync(join(app, 'dashboard', 'loading.tsx'))).toBe(false);

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== 'node_modules' && !name.startsWith('.')) walk(path);
          continue;
        }
        if (name !== 'page.tsx') continue;
        if (!/\bnotFound\(/.test(readFileSync(path, 'utf8'))) continue;
        if (existsSync(join(dir, 'loading.tsx'))) offenders.push(dir.slice(app.length) || '/');
      }
    };
    walk(app);
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
