import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Accepting a Client Portal invitation — /auth/invite (ADR-0049 §3), with
 * the Supabase client mocked.
 *
 * The one-time token is spent by `verifyOtp` on submit, so everything that
 * can refuse the form without the database refuses it FIRST: a weak or
 * mismatched password, a token that is not one. A Back Office (or Staff
 * App) invitation opened here is signed straight out again and refused —
 * the Client Portal admits `app_metadata.role = client` and nothing else.
 */

const auth = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}));
const createClient = vi.hoisted(() => vi.fn());

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@thc/db/server', () => ({ createClient }));
// The middleware's own client: nobody is signed in when an invitee opens the link.
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

const { acceptInvite } = await import('../actions');
const { middleware } = await import('../../../../middleware');

/** GoTrue's hashed_token shape today: 56 hex characters. */
const TOKEN = 'a3f1c9e2b4d6f8a0c2e4f6a8b0d2e4f6a8c0e2f4a6b8d0f2e4a6c8e0';
const PASSWORD = 'Harbour-Lantern-2048';
const HOME = '/client';
const OWN_ROLE = 'client';

const INCOMPLETE = 'This link is incomplete. Open it again from the message you were sent.';
const EXPIRED =
  'This invitation has expired or has already been used. Ask the THC office for a new link.';
const WRONG_APP =
  'This invitation is for a different THC app. Open the link you were sent for that app.';

function form(
  fields: Partial<Record<'token' | 'type' | 'password' | 'confirm', string>>,
): FormData {
  const fd = new FormData();
  const all = { token: TOKEN, password: PASSWORD, confirm: PASSWORD, ...fields };
  for (const [key, value] of Object.entries(all)) if (value !== undefined) fd.set(key, value);
  return fd;
}

/** What the action did: the message it returned, or where it redirected. */
async function submit(fields: Parameters<typeof form>[0] = {}): Promise<string> {
  try {
    return `RETURNED:${await acceptInvite(null, form(fields))}`;
  } catch (error) {
    return (error as Error).message;
  }
}

function signedInAs(role: string | undefined): void {
  auth.verifyOtp.mockResolvedValue({
    data: { user: { id: 'u-new', app_metadata: role === undefined ? {} : { role } } },
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  createClient.mockReturnValue({ auth });
  signedInAs(OWN_ROLE);
  auth.updateUser.mockResolvedValue({ error: null });
  auth.signOut.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the password is checked before the token is spent', () => {
  it.each([
    [{ password: 'short1', confirm: 'short1' }, 'Use at least 10 characters.'],
    [{ password: 'no-numbers-here', confirm: 'no-numbers-here' }, 'Include at least one number.'],
    [{ confirm: `${PASSWORD}!` }, 'Passwords don’t match.'],
    [{ password: '', confirm: '' }, 'Passwords don’t match.'],
  ])('%j is refused and verifyOtp is never called', async (fields, message) => {
    expect(await submit(fields)).toBe(`RETURNED:${message}`);
    expect(createClient).not.toHaveBeenCalled();
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('a weak password on a malformed link reports the password — the order is password, then token', async () => {
    expect(await submit({ token: 'nope', password: 'short1', confirm: 'short1' })).toBe(
      'RETURNED:Use at least 10 characters.',
    );
  });
});

describe('a malformed token is refused without asking GoTrue', () => {
  it.each([
    ['empty', ''],
    ['too short', 'abc123'],
    ['a path', `${TOKEN.slice(0, 40)}/../../x`],
    ['a query', `${TOKEN}?next=//evil.example`],
    ['a dot', `${TOKEN.slice(0, 40)}.evil`],
    ['too long', 'a'.repeat(201)],
  ])('%s', async (_label, token) => {
    expect(await submit({ token })).toBe(`RETURNED:${INCOMPLETE}`);
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('a missing token field is the same refusal', async () => {
    const fd = new FormData();
    fd.set('password', PASSWORD);
    fd.set('confirm', PASSWORD);
    expect(await acceptInvite(null, fd)).toBe(INCOMPLETE);
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });
});

it('says so, without a call, when there is no Supabase project', async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
  expect(await submit()).toBe(
    'RETURNED:Setting a password is not available yet — this environment has no Supabase project.',
  );
  expect(auth.verifyOtp).not.toHaveBeenCalled();
});

describe('verifying the token', () => {
  it.each([
    [undefined, 'invite'],
    ['invite', 'invite'],
    ['magiclink', 'magiclink'],
    // Anything else is an invite: a hand-edited link cannot pick another OTP type.
    ['recovery', 'invite'],
    ['email_change', 'invite'],
  ])('type=%j is verified as %s, by token_hash', async (type, expected) => {
    await submit(type === undefined ? {} : { type });
    expect(auth.verifyOtp).toHaveBeenCalledTimes(1);
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: expected, token_hash: TOKEN });
  });

  it('an expired or used token is refused and no password is set', async () => {
    auth.verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { status: 403, message: 'Token has expired or is invalid' },
    });
    expect(await submit()).toBe(`RETURNED:${EXPIRED}`);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('a verify that returns no user is treated the same', async () => {
    auth.verifyOtp.mockResolvedValue({ data: { user: null }, error: null });
    expect(await submit()).toBe(`RETURNED:${EXPIRED}`);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});

describe('an invitation for another app', () => {
  it.each([['admin'], ['staff'], [undefined]])(
    'role %j: signed out locally, refused, and no password is set',
    async (role) => {
      signedInAs(role);
      expect(await submit()).toBe(`RETURNED:${WRONG_APP}`);
      expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
      expect(auth.updateUser).not.toHaveBeenCalled();
    },
  );
});

describe('success', () => {
  it(`sets the password on the new session and lands on ${HOME}`, async () => {
    expect(await submit()).toBe(`REDIRECT:${HOME}`);
    expect(auth.updateUser).toHaveBeenCalledWith({ password: PASSWORD });
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(auth.verifyOtp.mock.invocationCallOrder[0]!).toBeLessThan(
      auth.updateUser.mock.invocationCallOrder[0]!,
    );
  });

  it('a breached password after the token is spent points to Forgot password', async () => {
    auth.updateUser.mockResolvedValue({
      error: { status: 422, message: 'Password is known to be weak (pwned)' },
    });
    expect(await submit()).toBe(
      'RETURNED:That password has appeared in a known data breach. Choose a different one — then use “Forgot password” on the sign-in screen, as this link is now used.',
    );
  });

  it('any other failure to save the password also points to Forgot password, without redirecting', async () => {
    auth.updateUser.mockResolvedValue({ error: { status: 500, message: 'boom' } });
    expect(await submit()).toBe(
      'RETURNED:Your login is ready but the password could not be saved. Use “Forgot password” on the sign-in screen to set one.',
    );
  });
});

describe('the link lands without a session', () => {
  it('the middleware serves /auth/invite to a signed-out visitor rather than sending them to /login', async () => {
    const res = await middleware(
      new NextRequest(`http://127.0.0.1:3002/auth/invite?token=${TOKEN}`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });
});
