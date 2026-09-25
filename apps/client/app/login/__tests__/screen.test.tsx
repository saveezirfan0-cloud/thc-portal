import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/** A0 against wireframes/client/login.html:62, the lead line under the heading. */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../actions', () => ({ signIn: vi.fn() }));

const { default: Page } = await import('../page');
const { LEAD } = await import('../copy');

describe('Client Portal sign-in page (login.html)', async () => {
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));

  it('carries the lead line, once, after the heading and before the form (login.html:62)', () => {
    expect(LEAD).toBe('Your events, confirmed line-ups and timesheets — read-only.');
    const heading = html.indexOf('<h2>Sign in</h2>');
    const lead = html.indexOf(`<p class="sm muted lead">${LEAD}</p>`);
    const form = html.indexOf('<form');
    expect(heading).toBeGreaterThanOrEqual(0);
    expect(lead).toBeGreaterThan(heading);
    expect(form).toBeGreaterThan(lead);
    expect(html.split(LEAD)).toHaveLength(2);
  });
});
