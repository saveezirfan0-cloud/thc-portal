import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A1's action (§10.2) against §1.7: the worker's address rides a short-lived
 * httpOnly cookie to A2, never the query string — the shape `/apply` already
 * uses, so it stays out of browser history, Vercel's request logs and any
 * Referer the next screen sends. And the outcome is the same whether the
 * address exists, the request failed or Auth rate-limited it.
 */
const mocks = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  setCookie: vi.fn(),
}));

vi.mock('@thc/db/server', () => ({
  createClient: vi.fn(() => ({ auth: { resetPasswordForEmail: mocks.resetPasswordForEmail } })),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ set: mocks.setCookie, get: () => undefined }),
}));

class Redirected extends Error {
  constructor(readonly to: string) {
    super(`redirect(${to})`);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

const { requestReset } = await import('../actions');
const { RESET_LINK_HOURS, RESET_LINK_VALIDITY, SENT_TO_COOKIE, SENT_TO_MAX_AGE } =
  await import('../copy');

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..', '..', '..');

function form(email: string): FormData {
  const fd = new FormData();
  fd.set('email', email);
  return fd;
}

async function run(email: string): Promise<{ redirectedTo: string | null; result: unknown }> {
  try {
    const result = await requestReset(null, form(email));
    return { redirectedTo: null, result };
  } catch (e) {
    if (e instanceof Redirected) return { redirectedTo: e.to, result: undefined };
    throw e;
  }
}

const saved = { ...process.env };

describe('requestReset (A1 → A2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'http://127.0.0.1:54321';
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'anon';
    process.env['NEXT_PUBLIC_STAFF_URL'] = 'https://staff.example.com/';
    mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
  });
  afterAll(() => {
    process.env = { ...saved };
  });

  it('redirects to a bare /forgot/sent — no address in the URL', async () => {
    const { redirectedTo } = await run('Amara.K@example.com');
    expect(redirectedTo).toBe('/forgot/sent');
  });

  it('hands the address to A2 in a short-lived httpOnly cookie scoped to /forgot', async () => {
    await run('  Amara.K@example.com ');
    expect(mocks.setCookie).toHaveBeenCalledTimes(1);
    const [name, value, options] = mocks.setCookie.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(name).toBe(SENT_TO_COOKIE);
    expect(name).toBe('thc_reset_sent_to');
    expect(value).toBe('amara.k@example.com');
    expect(options).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/forgot',
      maxAge: SENT_TO_MAX_AGE,
    });
    expect(SENT_TO_MAX_AGE).toBe(600);
  });

  it('asks Auth for the recovery mail with the app callback that hands off to A3', async () => {
    await run('amara.k@example.com');
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith('amara.k@example.com', {
      redirectTo: 'https://staff.example.com/auth/callback?next=/reset',
    });
  });

  it('looks identical when Auth refuses — the same redirect and the same cookie (§1.7)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.resetPasswordForEmail.mockResolvedValue({
      error: { status: 429, message: 'over email send rate limit' },
    });
    const { redirectedTo } = await run('nobody@example.com');
    expect(redirectedTo).toBe('/forgot/sent');
    expect(mocks.setCookie).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('returns the one validation message for a blank or malformed address, and sends nothing', async () => {
    for (const bad of ['', '   ', 'not-an-email']) {
      const { redirectedTo, result } = await run(bad);
      expect(redirectedTo).toBeNull();
      expect(result).toBe('Enter the email address you signed up with.');
    }
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });
});

describe('the reset link validity the screens quote', () => {
  it('is the project OTP expiry, one figure derived from one constant', () => {
    // Supabase Auth has one "Email OTP Expiration" for invite, magic-link and
    // recovery mail alike; this repo sets it to a day (OWNER-TODO §1,
    // docs/16 §1.1). The copy is derived from the same number.
    const toml = readFileSync(join(REPO, 'supabase', 'config.toml'), 'utf8');
    expect(toml).toMatch(new RegExp(`^otp_expiry = ${RESET_LINK_HOURS * 3600}$`, 'm'));
    expect(RESET_LINK_VALIDITY).toBe('24 hours');
  });

  it('is never hard-coded in a /forgot screen', () => {
    for (const file of ['ForgotForm.tsx', 'sent/page.tsx']) {
      const source = readFileSync(join(HERE, '..', file), 'utf8');
      expect(source, file).not.toMatch(/\d+ minutes|\d+ hours/);
      expect(source, file).toContain('RESET_LINK_VALIDITY');
    }
  });
});
