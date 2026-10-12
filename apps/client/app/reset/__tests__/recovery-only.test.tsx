import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Security review 12.10, finding 1: /reset sets a password without the
 * current one, so it accepts only a session an emailed reset link made
 * (../recovery.ts: `amr` recovery/otp, within the hour). A customer who is
 * merely signed in — a laptop left open — is refused, on the page and in
 * the action, and pointed to Your account → Change password, which checks
 * the current password and is throttled (ADR-0051).
 */
const auth = vi.hoisted(() => ({
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
const { NOT_A_RESET_SESSION, accountEmail, isRecoverySession } = await import('../recovery');

const now = () => Math.floor(Date.now() / 1000);
const session = (method: string, { age = 60, role = 'client' } = {}) => ({
  data: {
    claims: { sub: 'u1', app_metadata: { role }, amr: [{ method, timestamp: now() - age }] },
  },
  error: null,
});

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

const page = async (searchParams: { error?: string } = {}) =>
  renderToStaticMarkup(await ResetPage({ searchParams: Promise.resolve(searchParams) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  auth.updateUser.mockResolvedValue({ error: null });
  auth.signOut.mockResolvedValue({ error: null });
});

describe('setPassword accepts only a reset-link session', () => {
  it('a password-signed-in session is refused and updateUser is never called', async () => {
    auth.getClaims.mockResolvedValue(session('password'));
    expect(await submit()).toBe(`RETURNED:${NOT_A_RESET_SESSION}`);
    expect(NOT_A_RESET_SESSION).toContain('Your account → Change password');
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('a recovery session more than an hour old is refused too', async () => {
    auth.getClaims.mockResolvedValue(session('recovery', { age: 2 * 3600 }));
    expect(await submit()).toBe(`RETURNED:${NOT_A_RESET_SESSION}`);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('a fresh recovery session sets the password, signs the other devices out, lands on /client', async () => {
    auth.getClaims.mockResolvedValue(session('recovery'));
    expect(await submit()).toBe('REDIRECT:/client');
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'harbour-lights-2026' });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'others' });
  });

  it('a non-client is refused BEFORE anything changes (the middleware 403s them first anyway)', async () => {
    auth.getClaims.mockResolvedValue(session('recovery', { role: 'staff' }));
    expect(await submit()).toMatch(/^RETURNED:This reset link is for a different THC app/);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('no session: the expired-link sentence', async () => {
    auth.getClaims.mockResolvedValue({ data: null, error: null });
    expect(await submit()).toMatch(/expired or has already been used/);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('Supabase’s own error text never reaches the customer', async () => {
    auth.getClaims.mockResolvedValue(session('recovery'));
    auth.updateUser.mockResolvedValue({
      error: { status: 500, message: 'Database error updating user: pq: deadlock' },
    });
    const out = await submit();
    expect(out).toBe('RETURNED:We could not set that password. Try again, or request a new link.');
  });
});

describe('the /reset page', () => {
  it('a signed-in customer without a reset session gets the pointer, not the form', async () => {
    auth.getClaims.mockResolvedValue(session('password'));
    const html = await page();
    expect(html).not.toContain('Set a new password');
    expect(html).not.toContain('name="password"');
    expect(html).toContain('Change password');
    expect(html).toContain('href="/client/account"');
  });

  it('a reset-link session gets the form', async () => {
    auth.getClaims.mockResolvedValue(session('recovery'));
    const html = await page();
    expect(html).toContain('Set a new password');
  });

  it('names the account the reset session belongs to, as A3 does (activate.html)', async () => {
    const withEmail = session('recovery');
    Object.assign(withEmail.data.claims, { email: 'marco@leonardo-stpauls.example' });
    auth.getClaims.mockResolvedValue(withEmail);
    const html = await page();
    expect(html).toContain(
      'For <b class="mono">marco@leonardo-stpauls.example</b>. You’ll be signed in straight after.',
    );
  });

  it('leaves the line out when the session carries no address', async () => {
    auth.getClaims.mockResolvedValue(session('recovery'));
    const html = await page();
    expect(html).not.toContain('For <b');
    expect(html).toContain('You’ll be signed in straight after.');
  });

  it('no session: the expired-link variant', async () => {
    auth.getClaims.mockResolvedValue({ data: null, error: null });
    const html = await page();
    expect(html).toContain('This link has expired');
    expect(await page({ error: 'expired' })).toContain('This link has expired');
  });

  it('a link with no token says it is incomplete, not expired', async () => {
    auth.getClaims.mockResolvedValue({ data: null, error: null });
    const html = await page({ error: 'missing' });
    expect(html).toContain('This link is incomplete');
    expect(html).toContain(
      'This link is incomplete — copy the whole link from the email, or ask for a new one.',
    );
    expect(html).not.toContain('expired');
    expect(html).toContain('href="/forgot"');
  });
});

describe('isRecoverySession', () => {
  it.each([
    [{ amr: [{ method: 'recovery', timestamp: now() }] }, true],
    [{ amr: [{ method: 'otp', timestamp: now() - 120 }] }, true],
    [{ amr: [{ method: 'password', timestamp: now() }] }, false],
    [{ amr: [{ method: 'invite', timestamp: now() }] }, false],
    [{ amr: ['recovery'] }, false],
    [{ amr: [{ method: 'recovery' }] }, false],
    [{ amr: [{ method: 'recovery', timestamp: now() + 3600 }] }, false],
    [{}, false],
    [null, false],
  ])('%j → %s', (claims, expected) => {
    expect(isRecoverySession(claims)).toBe(expected);
  });
});

describe('accountEmail', () => {
  it.each([
    [{ email: 'marco@leonardo-stpauls.example' }, 'marco@leonardo-stpauls.example'],
    [{ email: '  venue@client.example ' }, 'venue@client.example'],
    [{ email: '' }, null],
    [{ email: 'not an email' }, null],
    [{ email: '<b>x</b>@a.bc' }, null],
    [{ email: 42 }, null],
    [{}, null],
    [null, null],
  ])('%j → %s', (claims, expected) => {
    expect(accountEmail(claims)).toBe(expected);
  });
});
