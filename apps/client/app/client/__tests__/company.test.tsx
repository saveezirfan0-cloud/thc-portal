import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * "Signed in as <company>" (§11.1, `wireframes/client/events.html`).
 *
 * The name used to be read from `clients`, where the client role has no
 * policy (ADR-0004), so it was always null on the live DB (audit 24.09
 * §2.2). It now comes from `client_company_v`; this pins the source so a
 * later edit cannot quietly go back to the table.
 */
const tables: string[] = [];

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('../data', () => ({ supabaseConfigured: () => true }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1', email: 'hannah@example.com' } } }),
    },
    from: (table: string) => {
      tables.push(table);
      const row =
        table === 'client_company_v'
          ? { name: 'Leonardo Hotel St Pauls' }
          : table === 'profiles'
            ? { full_name: 'Hannah Brooks' }
            : null;
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: row, error: null }),
      };
      return chain;
    },
  }),
}));

const ClientPortalLayout = (await import('../layout')).default;

describe('the Client Portal top bar names the company', () => {
  it('reads it from client_company_v, never from clients', async () => {
    const markup = renderToStaticMarkup(await ClientPortalLayout({ children: <span /> }));
    expect(markup).toContain('Signed in as');
    expect(markup).toContain('Leonardo Hotel St Pauls');
    expect(markup).toContain('Hannah Brooks');
    expect(tables).toContain('client_company_v');
    expect(tables).not.toContain('clients');
  });
});
