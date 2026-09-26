import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Two-step sign-in, end to end with Supabase mocked (ADR-0051):
 *
 *  - sign-in sends a login with a verified authenticator to the code step,
 *    carrying `next`, after the "Keep me signed in" cookie is written;
 *  - the code step verifies against GoTrue and only then lands on `next`;
 *  - the middleware keeps an aal1 session with a factor out of every
 *    private page, and keeps the code step and sign-out reachable.
 */
function token(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'HS256' })}.${part(claims)}.sig`;
}

const verifiedTotp = {
  id: 'factor-1',
  factor_type: 'totp',
  status: 'verified',
  friendly_name: 'My phone',
  created_at: '2026-09-25T09:00:00Z',
  updated_at: '2026-09-25T09:00:00Z',
};

const state = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  factors: [] as unknown[],
  role: 'admin' as string,
  aal: 'aal1' as string,
  user: true,
  challengeAndVerify: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [...state.jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => state.jar.set(name, value),
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

function currentUser() {
  return state.user
    ? { id: 'u1', app_metadata: { role: state.role }, factors: state.factors }
    : null;
}

vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: async () => ({ data: { user: currentUser() }, error: null }),
      signOut: async () => ({ error: null }),
      getUser: async () => ({ data: { user: currentUser() } }),
      getSession: state.getSession,
      mfa: { challengeAndVerify: state.challengeAndVerify },
    },
  }),
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: currentUser() } }),
      getSession: state.getSession,
    },
  }),
}));

const { signIn } = await import('../actions');
const { verifyTwoStep } = await import('../verify/actions');
const { middleware } = await import('../../../middleware');

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    return `RETURNED:${String(await run())}`;
  } catch (error) {
    return (error as Error).message;
  }
}

const saved = { ...process.env };
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});
afterAll(() => {
  process.env = saved;
});
beforeEach(() => {
  state.jar.clear();
  state.factors = [];
  state.role = 'admin';
  state.aal = 'aal1';
  state.user = true;
  state.challengeAndVerify.mockReset();
  state.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
  state.getSession.mockReset();
  state.getSession.mockImplementation(async () => ({
    data: { session: { access_token: token({ aal: state.aal }) } },
  }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const creds = { email: 'gisela@thehospitalitycompany.co.uk', password: 'password123' };

describe('signIn with two-step on', () => {
  it('goes to the code step, not the dashboard', async () => {
    state.factors = [verifiedTotp];
    expect(await outcome(() => signIn(null, form(creds)))).toBe('REDIRECT:/login/verify');
  });

  it('carries a safe next through the code step', async () => {
    state.factors = [verifiedTotp];
    expect(await outcome(() => signIn(null, form({ ...creds, next: '/events/42' })))).toBe(
      'REDIRECT:/login/verify?next=%2Fevents%2F42',
    );
  });

  it('still drops a hostile next before it gets there', async () => {
    state.factors = [verifiedTotp];
    expect(await outcome(() => signIn(null, form({ ...creds, next: '//evil.example' })))).toBe(
      'REDIRECT:/login/verify',
    );
  });

  it('writes the Keep me signed in choice before leaving for the code step', async () => {
    state.factors = [verifiedTotp];
    await outcome(() => signIn(null, form(creds)));
    expect(state.jar.has('thc-keep-signed-in')).toBe(true);
  });

  it('an abandoned set-up (unverified factor) changes nothing', async () => {
    state.factors = [{ ...verifiedTotp, status: 'unverified' }];
    expect(await outcome(() => signIn(null, form(creds)))).toBe('REDIRECT:/dashboard');
  });

  it('a non-admin with a factor is still refused the same way, not sent on', async () => {
    state.factors = [verifiedTotp];
    state.role = 'client';
    expect(await outcome(() => signIn(null, form(creds)))).toMatch(/^RETURNED:Email or password/);
  });
});

describe('verifyTwoStep — the code step', () => {
  beforeEach(() => {
    state.factors = [verifiedTotp];
  });

  it('refuses a malformed code without asking GoTrue', async () => {
    expect(await outcome(() => verifyTwoStep(null, form({ code: '12ab56' })))).toBe(
      'RETURNED:The code is numbers only — 6 digits, no letters.',
    );
    expect(state.challengeAndVerify).not.toHaveBeenCalled();
  });

  it('verifies the authenticator with the code as typed, spaces removed, then lands on next', async () => {
    expect(
      await outcome(() => verifyTwoStep(null, form({ code: '123 456', next: '/events/42' }))),
    ).toBe('REDIRECT:/events/42');
    expect(state.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'factor-1', code: '123456' });
  });

  it('a wrong code stays on the step with plain words', async () => {
    state.challengeAndVerify.mockResolvedValue({
      data: null,
      error: { status: 422, code: 'mfa_verification_failed', message: 'Invalid TOTP code' },
    });
    expect(await outcome(() => verifyTwoStep(null, form({ code: '000000' })))).toBe(
      'RETURNED:That code did not match. Codes change every 30 seconds — type the one showing now.',
    );
  });

  it.each(['//evil.example', 'https://evil.example', '/login/verify'])(
    'next %j lands on the dashboard',
    async (next) => {
      expect(await outcome(() => verifyTwoStep(null, form({ code: '123456', next })))).toBe(
        'REDIRECT:/dashboard',
      );
    },
  );

  it('an already-verified session is waved on without spending a code', async () => {
    state.aal = 'aal2';
    expect(await outcome(() => verifyTwoStep(null, form({ code: '123456' })))).toBe(
      'REDIRECT:/dashboard',
    );
    expect(state.challengeAndVerify).not.toHaveBeenCalled();
  });

  it('no session → back to the sign-in form', async () => {
    state.user = false;
    expect(await outcome(() => verifyTwoStep(null, form({ code: '123456' })))).toBe(
      'REDIRECT:/login',
    );
  });

  it('a factor this screen cannot challenge says so rather than letting them through', async () => {
    state.factors = [{ ...verifiedTotp, factor_type: 'phone' }];
    expect(await outcome(() => verifyTwoStep(null, form({ code: '123456' })))).toMatch(
      /^RETURNED:Your login is protected by a kind of second step/,
    );
  });
});

describe('middleware with two-step on', () => {
  const at = (path: string, init?: { method?: string }) =>
    middleware(new NextRequest(`http://127.0.0.1:3000${path}`, init));

  beforeEach(() => {
    state.factors = [verifiedTotp];
  });

  it.each(['/dashboard', '/staff/7', '/account', '/api/something'])(
    'a password-only session is sent from %s to the code step',
    async (path) => {
      const res = await at(path);
      expect(res.status).toBe(307);
      const location = new URL(res.headers.get('location') ?? '');
      expect(location.pathname).toBe('/login/verify');
    },
  );

  it('keeps the page (and its query) as next', async () => {
    const res = await at('/events/42?tab=board');
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.searchParams.get('next')).toBe('/events/42?tab=board');
  });

  it.each(['/login', '/login/verify', '/forgot', '/reset', '/auth/callback'])(
    'serves %s, so the code step and the way out never loop',
    async (path) => {
      const res = await at(path);
      expect(res.status).toBe(200);
    },
  );

  it('lets sign-out through', async () => {
    const res = await at('/auth/signout', { method: 'POST' });
    expect(res.status).toBe(200);
  });

  it('passes once the code has been typed (aal2)', async () => {
    state.aal = 'aal2';
    const res = await at('/dashboard');
    expect(res.status).toBe(200);
  });

  it('an unreadable session token is treated as not verified', async () => {
    state.getSession.mockResolvedValue({ data: { session: { access_token: 'garbage' } } });
    const res = await at('/dashboard');
    expect(new URL(res.headers.get('location') ?? '').pathname).toBe('/login/verify');
  });

  it('a login without a verified factor never pays for the session read', async () => {
    state.factors = [{ ...verifiedTotp, status: 'unverified' }];
    const res = await at('/dashboard');
    expect(res.status).toBe(200);
    expect(state.getSession).not.toHaveBeenCalled();
  });

  it('the role gate still comes first: a client with a factor gets the wrong-app page', async () => {
    state.role = 'client';
    const res = await at('/dashboard');
    expect(res.status).toBe(403);
  });
});
