import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// `prefetch` is a next/link prop, not a DOM attribute, so the stand-in has
// to swallow it rather than hand React a boolean it will complain about.
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    prefetch: _prefetch,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    prefetch?: boolean;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The bar's identity block needs a session; this test is about the chrome,
// not about who is in it. With no project configured the layout takes its
// own "not signed in" path and never reaches Supabase.
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({}) }));
vi.mock('../data', () => ({ supabaseConfigured: () => false }));

const ClientPortalLayout = (await import('../layout')).default;

/**
 * The top bar is the whole of the Client Portal's chrome (§11.1: top bar,
 * no sidebar). If the appearance switch is not in it, a customer has no way
 * to reach it at all — ADR-0007 promises one user-facing switch.
 */
describe('the Client Portal top bar', () => {
  it('carries the appearance switch', async () => {
    const markup = renderToStaticMarkup(await ClientPortalLayout({ children: <span /> }));
    expect(markup).toContain('aria-label="Appearance"');
    expect(markup).toContain('>Light<');
    expect(markup).toContain('>Dark<');
  });

  it('still shows the sign-out link beside it', async () => {
    const markup = renderToStaticMarkup(await ClientPortalLayout({ children: <span /> }));
    expect(markup).toContain('Sign out');
  });
});
