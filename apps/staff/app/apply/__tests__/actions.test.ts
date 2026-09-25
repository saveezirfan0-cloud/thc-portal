import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /apply's server action and its one route into the database (§2.1,
 * ADR-0024, 20260929140200).
 *
 * submit_application is service-role only now: the anon grant was the way
 * round the per-caller limit. So the action always calls
 * submit_application_as_caller with the service key, and a deployment
 * without the key refuses in words rather than falling back.
 */
const rpc = vi.hoisted(() => vi.fn(async () => ({ error: null })));
const created = vi.hoisted(() => ({ admin: 0, session: 0 }));
const jar = vi.hoisted(() => ({ set: vi.fn(), getAll: () => [] }));

vi.mock('next/headers', () => ({
  cookies: async () => jar,
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.7' }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@thc/db/admin', () => ({
  createAdminClient: () => {
    created.admin += 1;
    return { rpc };
  },
}));
vi.mock('@thc/db/server', () => ({
  createClient: () => {
    created.session += 1;
    return { rpc };
  },
}));

const { apply } = await import('../actions');
const { APPLY_UNAVAILABLE, INITIAL_STATE } = await import('../form');

const saved = { ...process.env };
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  process.env['APPLY_THROTTLE_SALT'] = 'test-salt';
});
afterAll(() => {
  process.env = saved;
});
beforeEach(() => {
  vi.clearAllMocks();
  created.admin = 0;
  created.session = 0;
});

function form(): FormData {
  const fd = new FormData();
  fd.set('firstName', 'Amara');
  fd.set('lastName', 'Kalu');
  fd.set('email', 'Amara.Kalu@Example.com ');
  fd.set('dialCode', '+44');
  fd.set('mobile', '7700 900123');
  fd.set('dob', '1998-05-04');
  fd.set('consent', 'on');
  return fd;
}

async function run(): Promise<unknown> {
  try {
    return await apply(INITIAL_STATE, form());
  } catch (error) {
    return (error as Error).message;
  }
}

describe('apply (§2.1, ADR-0024)', () => {
  it('goes through submit_application_as_caller with the service key', async () => {
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'service';
    expect(await run()).toBe('REDIRECT:/apply/submitted');
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(fn).toBe('submit_application_as_caller');
    expect(args['p_email']).toBe('amara.kalu@example.com');
    expect(args).toHaveProperty('p_caller_hash');
    expect(created.session).toBe(0);
  });

  it('never calls submit_application as anon: without the key it refuses in words', async () => {
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const state = (await run()) as { failure?: string };
    expect(state.failure).toBe(APPLY_UNAVAILABLE);
    expect(rpc).not.toHaveBeenCalled();
    expect(created.session + created.admin).toBe(0);
    expect(jar.set).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
