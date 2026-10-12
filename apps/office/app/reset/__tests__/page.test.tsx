import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A3 on the Back Office (§10.2, wireframes/public/activate.html): the
 * expired-link variant, the form for a session a reset link made, and —
 * security review 12.10 — a pointer to My profile → Password for any other
 * signed-in session, never the form (setPassword refuses that session too;
 * recovery-only.test.ts).
 */
const auth = vi.hoisted(() => ({ getClaims: vi.fn() }));

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

const now = () => Math.floor(Date.now() / 1000);
const session = (method: string, age = 60) => ({
  data: { claims: { sub: 'u1', amr: [{ method, timestamp: now() - age }] } },
  error: null,
});

async function render(searchParams: { error?: string } = {}): Promise<string> {
  return renderToStaticMarkup(await ResetPage({ searchParams: Promise.resolve(searchParams) }));
}

describe('/reset (Back Office)', () => {
  it('no session: "This link has expired" and a "Request a new link" button', async () => {
    auth.getClaims.mockResolvedValue({ data: null, error: null });
    const html = await render();
    expect(html).toContain('This link has expired');
    expect(html).toMatch(/<a href="\/forgot" class="btn block">Request a new link<\/a>/);
    expect(html).not.toContain('Set a new password');
  });

  it('a link that could not be opened reads as expired too', async () => {
    auth.getClaims.mockResolvedValue(session('recovery'));
    const html = await render({ error: 'expired' });
    expect(html).toContain('This link has expired');
    expect(html).not.toContain('Set a new password');
  });

  it('a recovery session gets the form', async () => {
    auth.getClaims.mockResolvedValue(session('recovery'));
    const html = await render();
    expect(html).toContain('Set a new password');
    expect(html).not.toContain('already signed in');
  });

  it('an emailed one-time code counts as a reset session', async () => {
    auth.getClaims.mockResolvedValue(session('otp'));
    expect(await render()).toContain('Set a new password');
  });

  it('a password sign-in gets a pointer to My profile, not the form', async () => {
    auth.getClaims.mockResolvedValue(session('password'));
    const html = await render();
    expect(html).toContain('already signed in');
    expect(html).toContain('My profile → Password');
    expect(html).toMatch(/<a href="\/account" class="btn block">Go to My profile<\/a>/);
    expect(html).not.toContain('Set a new password');
    expect(html).not.toContain('name="password"');
  });

  it('a recovery session older than an hour is an ordinary one', async () => {
    auth.getClaims.mockResolvedValue(session('recovery', 2 * 3600));
    const html = await render();
    expect(html).toContain('already signed in');
    expect(html).not.toContain('Set a new password');
  });
});
