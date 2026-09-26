import { readFileSync } from 'node:fs';
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
});
