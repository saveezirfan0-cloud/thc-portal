import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the Client Portal's A3 adds on top of the recovery-only gate
 * (ADR-0115, ./recovery-gate.test.ts): another app's login is refused
 * before anything changes, Supabase's refusals read in the customer's
 * words, and a link cut short says so instead of "expired".
 */
const auth = vi.hoisted(() => ({
  getUser: vi.fn(),
  getClaims: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ auth }) }));

const { setPassword } = await import('../actions');
const { default: ResetPage } = await import('../page');
const { OTHER_APP } = await import('../copy');

const now = () => Math.floor(Date.now() / 1000);
const recovery = {
  data: { claims: { amr: [{ method: 'recovery', timestamp: now() - 60 }] } },
  error: null,
};
const asRole = (role: string) => ({ data: { user: { id: 'u1', app_metadata: { role } } } });

async function submit(): Promise<string> {
  const fd = new FormData();
  fd.set('password', 'harbour-lights-2026');
  fd.set('confirm', 'harbour-lights-2026');
  try {
    return `RETURNED:${await setPassword(null, fd)}`;
  } catch (e) {
    return (e as Error).message;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  auth.getUser.mockResolvedValue(asRole('client'));
  auth.getClaims.mockResolvedValue(recovery);
  auth.updateUser.mockResolvedValue({ error: null });
  auth.signOut.mockResolvedValue({ error: null });
});

describe('setPassword', () => {
  it('a fresh reset sets the password, signs the other devices out, lands on /client', async () => {
    expect(await submit()).toBe('REDIRECT:/client');
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'others' });
  });

  it('a non-client is refused BEFORE anything changes', async () => {
    auth.getUser.mockResolvedValue(asRole('staff'));
    expect(await submit()).toBe(`RETURNED:${OTHER_APP}`);
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('the same password again is said plainly', async () => {
    auth.updateUser.mockResolvedValue({
      error: { status: 422, code: 'same_password', message: 'New password should be different' },
    });
    expect(await submit()).toBe(
      'RETURNED:Choose a new password that is different from your current one.',
    );
  });

  it('Supabase’s own error text never reaches the customer', async () => {
    auth.updateUser.mockResolvedValue({
      error: { status: 500, message: 'Database error updating user: pq: deadlock' },
    });
    expect(await submit()).toBe(
      'RETURNED:We could not set that password. Try again, or request a new link.',
    );
  });
});

describe('the /reset page', () => {
  it('a link with no token says it is incomplete, not expired', async () => {
    auth.getClaims.mockResolvedValue({ data: null, error: null });
    const html = renderToStaticMarkup(
      await ResetPage({ searchParams: Promise.resolve({ error: 'missing' }) }),
    );
    expect(html).toContain(
      'This link is incomplete — copy the whole link from the email, or ask for a new one.',
    );
    expect(html).not.toContain('expired');
    expect(html).toContain('href="/forgot"');
  });
});
