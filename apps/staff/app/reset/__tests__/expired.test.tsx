import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A3's expired-link variant (wireframes/staff/auth.html), drawn as the Back
 * Office and Client Portal draw it: its own heading, one line of why, and
 * a "Request a new link" button back to /forgot.
 */
const auth = vi.hoisted(() => ({ getUser: vi.fn(), getClaims: vi.fn() }));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ getAll: () => [], set: () => {} })),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ auth }) }));
vi.mock('../actions', () => ({ setPassword: vi.fn() }));

const { default: ResetPage } = await import('../page');

const saved = { ...process.env };
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});
afterAll(() => {
  process.env = saved;
});
beforeEach(() => {
  vi.clearAllMocks();
});

async function render(searchParams: { error?: string }): Promise<string> {
  return renderToStaticMarkup(await ResetPage({ searchParams: Promise.resolve(searchParams) }));
}

describe('/reset', () => {
  it('no session: "This link has expired" and a "Request a new link" button', async () => {
    auth.getClaims.mockResolvedValue({ data: null, error: null });
    const html = await render({});
    expect(html).toContain('<h2>This link has expired</h2>');
    expect(html).toContain('expired or has already been used');
    expect(html).toMatch(/<a href="\/forgot" class="btn block">Request a new link<\/a>/);
    expect(html).not.toContain('Set a new password');
    expect(html).not.toContain('Send me a new link');
  });

  it('a link that could not be opened reads the same way, with one alert', async () => {
    auth.getClaims.mockResolvedValue({ data: null, error: null });
    const html = await render({ error: 'expired' });
    expect(html).toContain('<h2>This link has expired</h2>');
    expect(html).toContain('That link could not be opened.');
    expect(html).not.toContain('already been used');
    expect(html).toContain('Request a new link');
  });

  it('a signed-in recovery session gets the form, naming the account', async () => {
    auth.getClaims.mockResolvedValue({
      data: {
        claims: {
          email: 'amara.k@example.com',
          amr: [{ method: 'otp', timestamp: Math.floor(Date.now() / 1000) - 30 }],
        },
      },
    });
    const html = await render({});
    expect(html).toContain('<h2>Set a new password</h2>');
    expect(html).toContain('You are signing in as <b class="cyan">amara.k@example.com</b>.');
    expect(html).not.toContain('Request a new link');
  });

  it('a password sign-in is not a reset link: the expired card, and where to go instead', async () => {
    auth.getClaims.mockResolvedValue({
      data: { claims: { amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }] } },
    });
    const html = await render({});
    expect(html).toContain('<h2>This link has expired</h2>');
    expect(html).toContain('Profile → Security settings');
    expect(html).not.toContain('Set a new password');
  });

  it('a reset link opened more than 15 minutes ago is spent too', async () => {
    auth.getClaims.mockResolvedValue({
      data: {
        claims: { amr: [{ method: 'otp', timestamp: Math.floor(Date.now() / 1000) - 16 * 60 }] },
      },
    });
    const html = await render({});
    expect(html).toContain('<h2>This link has expired</h2>');
  });
});
