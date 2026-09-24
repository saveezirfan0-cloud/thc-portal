import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * The Back Office's root loading / error / not-found boundaries (audit
 * 24.09 §4). Built from @thc/ui, with no admin chrome — the same
 * boundaries cover /login.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { default: Loading } = await import('../loading');
const { default: RouteError } = await import('../error');
const { default: NotFound } = await import('../not-found');

describe('root boundaries', () => {
  it('loading announces itself and carries no sidebar', () => {
    const html = renderToStaticMarkup(<Loading />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Loading…');
    expect(html).not.toContain('Dashboard');
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
    for (const file of ['loading.tsx', 'error.tsx', 'not-found.tsx']) {
      const src = readFileSync(join(app, file), 'utf8');
      expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    }
  });
});
