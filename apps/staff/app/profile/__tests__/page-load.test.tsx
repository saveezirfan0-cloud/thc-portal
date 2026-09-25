import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

/**
 * /profile when `staff_me()` fails (audit D18). It used to say "This
 * environment has no Supabase project … docs/04" — a developer's message,
 * shown to a worker whose phone lost signal. "Could not load" and "not
 * configured" are now two answers, and the first one fails closed: no
 * sheet, so no P45 action offered on a guess, and no tabs.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));

let kind: 'problem' | 'unconfigured' = 'problem';
vi.mock('../data', () => ({
  readProfile: async () =>
    kind === 'problem' ? { kind: 'problem', message: 'timeout' } : { kind: 'unconfigured' },
}));

const { default: Page } = await import('../page');

async function render(): Promise<string> {
  return renderToStaticMarkup((await Page()) as ReactElement);
}

describe('/profile when the profile cannot be read', () => {
  it('says so in the worker’s words, with a retry, and no developer message', async () => {
    kind = 'problem';
    const html = await render();
    expect(html).toContain('We couldn’t load your profile — pull to refresh or try again.');
    expect(html).toContain('Try again');
    expect(html).not.toContain('docs/04');
    expect(html).not.toContain('Supabase');
    expect(html).not.toContain('Request my P45');
    expect(html).not.toContain('bottom-nav');
  });

  it('keeps the setup message for an environment with no project at all', async () => {
    kind = 'unconfigured';
    const html = await render();
    expect(html).toContain('docs/04');
  });
});
