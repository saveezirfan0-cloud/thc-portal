import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/** A0 against wireframes/client/login.html:62-65. */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../actions', () => ({ signIn: vi.fn() }));

const { default: Page } = await import('../page');

describe('Client Portal sign-in (login.html)', async () => {
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));

  it('carries the lead line under the heading (login.html:62)', () => {
    expect(html).toContain('<h2>Sign in</h2>');
    expect(html).toContain('Your events, confirmed line-ups and timesheets — read-only.');
  });

  it('has the password’s Show addon, named by its own text', () => {
    expect(html).toMatch(/<button type="button" class="addon"[^>]*>Show<\/button>/);
  });

  it('has "Keep me signed in on this device", ticked by default (login.html:65)', () => {
    expect(html).toContain('Keep me signed in on this device');
    expect(html).toMatch(/<input type="checkbox"[^>]*name="remember"[^>]*checked=""/);
  });

  it('puts Forgot password? on the password label’s row', () => {
    expect(html).toMatch(/<div class="row"><label[^>]*>Password<\/label><a[^>]*href="\/forgot"/);
  });
});
