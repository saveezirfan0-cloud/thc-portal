import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * The Staff App's root error and not-found boundaries (audit item 28).
 *
 * Both fail closed — phone chrome without the four tabs or the avatar,
 * because neither has a profile read behind it to say which tabs this
 * worker may have — and both speak to the worker, not to a developer.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { default: RouteError } = await import('../error');
const { default: NotFound } = await import('../not-found');
const app = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('the Staff App’s boundaries', () => {
  it('error: the worker’s words and a retry, the digest, never the exception text', () => {
    const error = Object.assign(new Error('relation "staff" does not exist: SELECT ni_number'), {
      digest: 'd1g3st',
    });
    const html = renderToStaticMarkup(<RouteError error={error} reset={() => {}} />);
    expect(html).toContain('We couldn’t load this screen');
    expect(html).toContain('Try again');
    expect(html).toContain('d1g3st');
    expect(html).toContain('admin@thehospitalitycompany.co.uk');
    expect(html).not.toContain('ni_number');
    expect(html).not.toContain('bottom-nav');
  });

  it('not-found: plain words and the way back to Shifts, no tabs', () => {
    const html = renderToStaticMarkup(<NotFound />);
    expect(html).toContain('We couldn’t find that');
    expect(html).toContain('href="/shifts"');
    expect(html).not.toContain('bottom-nav');
  });

  it('use tokens only, and never point a worker at a setup document', () => {
    for (const file of ['error.tsx', 'not-found.tsx']) {
      const src = readFileSync(join(app, file), 'utf8');
      expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
      expect(src).not.toContain('docs/04');
    }
  });
});
