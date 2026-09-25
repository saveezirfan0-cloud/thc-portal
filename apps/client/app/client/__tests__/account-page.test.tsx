import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Your account" (ADR-0036): read-only details, the timesheet recipients,
 * a password change and a way to ask the office.
 *
 * Pinned here: where every value comes from (the caller's own profiles row,
 * auth.getUser() and client_account_v — never `clients`, which the client
 * role holds no policy on, ADR-0004), that the password fields are the
 * only inputs on the page (§11.1 "no editing whatsoever"), and that no
 * money reaches it.
 */
const state = vi.hoisted(() => ({
  tables: [] as string[],
  selects: [] as string[],
  filters: [] as string[],
  user: { id: 'u1', email: 'hannah.brooks@leonardo-stpauls.co.uk' } as null | {
    id: string;
    email: string;
  },
  accountError: null as null | { message: string },
}));

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('../account/actions', () => ({ changePassword: vi.fn() }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (table: string) => {
      state.tables.push(table);
      const result =
        table === 'client_account_v'
          ? state.accountError
            ? { data: null, error: state.accountError }
            : {
                data: {
                  name: 'Leonardo Hotel St Pauls',
                  contact_emails: [
                    'hannah.brooks@leonardo-stpauls.co.uk',
                    'events@leonardo-stpauls.co.uk',
                  ],
                },
                error: null,
              }
          : table === 'profiles'
            ? { data: { full_name: 'Hannah Brooks' }, error: null }
            : { data: null, error: null };
      const chain = {
        select: (columns: string) => {
          state.selects.push(`${table}:${columns}`);
          return chain;
        },
        eq: (column: string, value: string) => {
          state.filters.push(`${table}.${column}=${value}`);
          return chain;
        },
        maybeSingle: async () => result,
      };
      return chain;
    },
  }),
}));

const { loadAccount } = await import('../account/load');
const { AccountScreen } = await import('../account/AccountScreen');
const { OFFICE_EMAIL, ACCOUNT_COPY } = await import('../account/copy');
const Page = (await import('../account/page')).default;

const saved = { ...process.env };
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});
afterAll(() => {
  process.env = saved;
});
beforeEach(() => {
  state.tables = [];
  state.selects = [];
  state.filters = [];
  state.user = { id: 'u1', email: 'hannah.brooks@leonardo-stpauls.co.uk' };
  state.accountError = null;
});

async function markup(): Promise<string> {
  return renderToStaticMarkup(await Page());
}

describe('Your account · where the data comes from (ADR-0004)', () => {
  it('reads the caller’s own profile and client_account_v, never clients', async () => {
    const { account, problem } = await loadAccount();
    expect(problem).toBeNull();
    expect(account).toEqual({
      name: 'Hannah Brooks',
      email: 'hannah.brooks@leonardo-stpauls.co.uk',
      company: 'Leonardo Hotel St Pauls',
      recipients: ['hannah.brooks@leonardo-stpauls.co.uk', 'events@leonardo-stpauls.co.uk'],
    });
    expect(state.tables.sort()).toEqual(['client_account_v', 'profiles']);
    expect(state.tables).not.toContain('clients');
  });

  it('asks the view for its two named columns and adds no tenancy filter of its own', async () => {
    await loadAccount();
    expect(state.selects).toContain('client_account_v:name, contact_emails');
    expect(state.selects).toContain('profiles:full_name');
    // The only filter is "my own profile row"; the view scopes itself.
    expect(state.filters).toEqual(['profiles.id=u1']);
  });

  it('says so, rather than showing blanks as if they were the truth, when the view fails', async () => {
    state.accountError = { message: 'boom' };
    const { problem } = await loadAccount();
    expect(problem).toBe(ACCOUNT_COPY.loadFailed);
  });

  it('never reaches Supabase without a project', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    try {
      const { problem } = await loadAccount();
      expect(problem).toBe(ACCOUNT_COPY.noProject);
      expect(state.tables).toEqual([]);
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    }
  });
});

describe('Your account · the page', () => {
  it('shows the name, sign-in email, company and every recipient', async () => {
    const html = await markup();
    expect(html).toContain('Your account');
    expect(html).toContain('Hannah Brooks');
    expect(html).toContain('hannah.brooks@leonardo-stpauls.co.uk');
    expect(html).toContain('Leonardo Hotel St Pauls');
    expect(html).toContain('events@leonardo-stpauls.co.uk');
    expect(html).toContain('Timesheet emails go to');
  });

  it('has no input for the name, company or recipients: only the three password fields', async () => {
    const html = await markup();
    const names = [...html.matchAll(/<input[^>]*\bname="([^"]+)"/g)].map((m) => m[1]);
    expect(names.sort()).toEqual(['confirm', 'current', 'password']);
    for (const m of html.matchAll(/<input[^>]*>/g)) {
      expect(m[0]).toContain('type="password"');
    }
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('<select');
  });

  it('offers the office by email, with the §11.3 document-footer address', async () => {
    const html = await markup();
    expect(OFFICE_EMAIL).toBe('admin@thehospitalitycompany.co.uk');
    expect(html).toContain('Need something changed?');
    expect(html).toContain(`href="mailto:${OFFICE_EMAIL}?subject=`);
    expect(html).toContain(encodeURIComponent('Account change · Leonardo Hotel St Pauls'));
  });

  it('carries no money (§11.1)', async () => {
    const html = await markup();
    expect(html).not.toMatch(/£|\brate\b|charge|margin|pay rate/i);
  });

  it('shows a dash, not "null", for a detail that is missing', () => {
    const html = renderToStaticMarkup(
      <AccountScreen
        account={{ name: null, email: 'a@b.test', company: null, recipients: [] }}
        officeEmail={OFFICE_EMAIL}
      />,
    );
    // As a text node: React's own form-replay script contains the word.
    expect(html).not.toContain('>null<');
    expect(html).toContain('<dd class="acct-v">—</dd>');
    expect(html).toContain(`href="mailto:${OFFICE_EMAIL}?subject=Account%20change"`);
  });
});
