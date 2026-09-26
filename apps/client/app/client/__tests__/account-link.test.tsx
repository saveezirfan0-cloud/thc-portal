import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * The top bar's account menu reaches "Your account" (ADR-0051). The menu
 * is the portal's only chrome (§11.1: top bar, no sidebar), so a page it
 * does not link to is a page nobody finds.
 */
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
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({}) }));
vi.mock('../data', () => ({ supabaseConfigured: () => false }));

const ClientPortalLayout = (await import('../layout')).default;

describe('the account menu', () => {
  it('links to /client/account inside the menu panel', async () => {
    const html = renderToStaticMarkup(await ClientPortalLayout({ children: <span /> }));
    const menu = html.slice(html.indexOf('id="client-account"'));
    expect(menu).toMatch(/<a href="\/client\/account"[^>]*>Account<\/a>/);
  });
});
