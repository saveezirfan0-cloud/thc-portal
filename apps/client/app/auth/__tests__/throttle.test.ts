import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /login and /forgot are throttled per email and per caller BEFORE Supabase
 * Auth is asked (security review 12.10; ADR-0115; 786_client_auth_throttle).
 *
 * The database decides (auth_attempt_take, service role only); here the
 * mock plays it with a limit of five so the sixth attempt is the first one
 * refused. What is asserted is the wiring: a refused attempt never reaches
 * signInWithPassword / resetPasswordForEmail, the answer says nothing about
 * the account, and only digests leave the app.
 */
const state = vi.hoisted(() => ({
  limit: 5,
  taken: 0,
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  rpcError: null as null | { code?: string; message: string },
  headers: new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }),
  signIn: vi.fn(),
  reset: vi.fn(),
  jar: [] as { name: string; value: string; options?: Record<string, unknown> }[],
}));

vi.mock('next/headers', () => ({
  headers: async () => state.headers,
  cookies: async () => ({
    getAll: () => [],
    set: (name: string, value: string, options?: Record<string, unknown>) =>
      state.jar.push({ name, value, options }),
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    auth: { signInWithPassword: state.signIn, resetPasswordForEmail: state.reset },
  }),
}));
vi.mock('@thc/db/admin', () => ({
  createAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.calls.push({ fn, args });
      if (state.rpcError) return { data: null, error: state.rpcError };
      if (state.taken >= state.limit) return { data: false, error: null };
      state.taken += 1;
      return { data: true, error: null };
    },
  }),
}));

const { signIn } = await import('../../login/actions');
const { requestReset } = await import('../../forgot/actions');
const { THROTTLED, callerAddress, callerBucket, throttleDigest } = await import('../throttle');

const EMAIL = 'Hannah.Brooks@Leonardo-StPauls.co.uk';

async function login(email = EMAIL): Promise<string> {
  const fd = new FormData();
  fd.set('email', email);
  fd.set('password', 'wrong-password-1');
  try {
    return `RETURNED:${await signIn(null, fd)}`;
  } catch (e) {
    return (e as Error).message;
  }
}

async function forgot(email = EMAIL): Promise<string> {
  const fd = new FormData();
  fd.set('email', email);
  try {
    return `RETURNED:${await requestReset(null, fd)}`;
  } catch (e) {
    return (e as Error).message;
  }
}

const saved = { ...process.env };
afterAll(() => {
  process.env = saved;
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'http://127.0.0.1:54321';
  process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'anon';
  process.env['NEXT_PUBLIC_CLIENT_URL'] = 'https://client.thc.example';
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'service-role-secret';
  state.taken = 0;
  state.calls = [];
  state.rpcError = null;
  state.jar = [];
  state.headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' });
  state.signIn.mockResolvedValue({
    data: { user: null },
    error: { status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' },
  });
  state.reset.mockResolvedValue({ error: null });
});

describe('/login is throttled before Supabase is asked', () => {
  it('the 6th+ attempt never calls signInWithPassword and gets the generic sentence', async () => {
    for (let i = 0; i < 5; i += 1) expect(await login()).toMatch(/^RETURNED:The email or password/);
    expect(state.signIn).toHaveBeenCalledTimes(5);

    expect(await login()).toBe(`RETURNED:${THROTTLED}`);
    expect(await login()).toBe(`RETURNED:${THROTTLED}`);
    expect(state.signIn).toHaveBeenCalledTimes(5);
    expect(THROTTLED).toBe('Too many attempts. Wait a few minutes and try again.');
  });

  it('sends digests only: the lower-cased email and the first-hop address, HMAC’d', async () => {
    await login();
    const call = state.calls[0]!;
    expect(call.fn).toBe('auth_attempt_take');
    expect(call.args['p_action']).toBe('login');
    expect(call.args['p_email_hash']).toBe(
      throttleDigest('service-role-secret', 'email', EMAIL.toLowerCase()),
    );
    expect(call.args['p_caller_hash']).toBe(
      throttleDigest('service-role-secret', 'caller', '203.0.113.7'),
    );
    const sent = JSON.stringify(call.args);
    expect(sent).not.toContain('203.0.113.7');
    expect(sent.toLowerCase()).not.toContain('leonardo');
    expect(call.args['p_email_hash']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a Supabase rate limit reads "wait", not "wrong password"', async () => {
    state.signIn.mockResolvedValue({
      data: { user: null },
      error: { status: 429, code: 'over_request_rate_limit', message: 'Too many requests' },
    });
    expect(await login()).toBe(`RETURNED:${THROTTLED}`);
  });

  it('fails open, logged, when the throttle cannot run (ADR-0115): no service key', async () => {
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    expect(await login()).toMatch(/^RETURNED:The email or password/);
    expect(state.calls).toEqual([]);
    expect(state.signIn).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('throttle is OFF'));
  });

  it('fails open, logged, when the call itself fails', async () => {
    state.rpcError = { code: 'PGRST202', message: 'function not found' };
    expect(await login()).toMatch(/^RETURNED:The email or password/);
    expect(state.signIn).toHaveBeenCalledTimes(1);
  });
});

describe('/forgot is throttled before Supabase is asked', () => {
  it('the 6th+ request never calls resetPasswordForEmail', async () => {
    for (let i = 0; i < 5; i += 1) expect(await forgot()).toBe('REDIRECT:/forgot/sent');
    expect(state.reset).toHaveBeenCalledTimes(5);
    expect(await forgot()).toBe(`RETURNED:${THROTTLED}`);
    expect(state.reset).toHaveBeenCalledTimes(5);
    expect(state.calls.at(-1)?.args['p_action']).toBe('reset');
  });
});

describe('the caller key', () => {
  it('is the first hop of x-forwarded-for, else x-real-ip, else none', () => {
    expect(callerAddress(new Headers({ 'x-forwarded-for': ' 198.51.100.4 , 10.0.0.1' }))).toBe(
      '198.51.100.4',
    );
    expect(callerAddress(new Headers({ 'x-real-ip': '198.51.100.5' }))).toBe('198.51.100.5');
    expect(callerAddress(new Headers())).toBeNull();
  });

  it('keys IPv6 by its /64 and an IPv4-mapped address as IPv4', () => {
    expect(callerBucket('2001:db8:abcd:12:1::5')).toBe('2001:db8:abcd:12::/64');
    expect(callerBucket('2001:0db8:abcd:0012:ffff::1')).toBe('2001:db8:abcd:12::/64');
    expect(callerBucket('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('an email and an address never share a digest', () => {
    expect(throttleDigest('k', 'email', 'x')).not.toBe(throttleDigest('k', 'caller', 'x'));
  });
});
