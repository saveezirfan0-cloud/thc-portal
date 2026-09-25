import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The /apply server action (§2.1) holds the SERVICE key, not the anon key.
 *
 * Both RPCs it calls are SECURITY DEFINER functions that exist for this
 * action alone: nobody signs in to apply, so an anon grant on them was the
 * world's privilege, not the applicant's. On the anon-key SSR client anyone
 * could name another connection's bucket to `apply_caller_check()` and
 * spend a college's allowance for the day (the key is HMAC(salt, address)
 * and the fallback salt is in the repository), or reach
 * `submit_application()` straight through PostgREST with a fresh pair of
 * identities each time and never meet the per-caller limit at all
 * (ADR-0024, docs/14 D2). With the key held here, the form is the only
 * door and every submission passes the limit first. The matching revoke of
 * `anon` from both functions is a migration; this pins the app's half.
 */

const mocks = vi.hoisted(() => {
  const rpc = vi.fn();
  return {
    rpc,
    createAdminClient: vi.fn(() => ({ rpc })),
    createClient: vi.fn(),
    setCookie: vi.fn(),
  };
});

vi.mock('@thc/db/admin', () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock('@thc/db/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ set: mocks.setCookie, get: () => undefined }),
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }),
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

const { apply } = await import('../actions');
const { INITIAL_STATE } = await import('../form');

const HERE = dirname(fileURLToPath(import.meta.url));

function formData(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries({
    firstName: 'Amara',
    lastName: 'Kalu',
    email: 'Amara.Kalu@example.com',
    country: 'GB',
    mobile: '07700 900123',
    dob: '1994-06-15',
    consent: 'on',
    ...over,
  })) {
    fd.set(key, value);
  }
  return fd;
}

const allowed = { data: { allowed: true, retry_after_seconds: 0 }, error: null };
const refused = { data: { allowed: false, retry_after_seconds: 30 }, error: null };
const submitted = { error: null };

const saved = { ...process.env };

describe('the /apply action and its database client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });
  afterAll(() => {
    process.env = { ...saved };
  });

  it('calls both RPCs on the service-role client and never builds the anon SSR client', async () => {
    mocks.rpc.mockResolvedValueOnce(allowed).mockResolvedValueOnce(submitted);

    await expect(apply(INITIAL_STATE, formData())).rejects.toBeInstanceOf(Redirected);

    expect(mocks.createAdminClient).toHaveBeenCalledTimes(1);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.mock.calls[0]?.[0]).toBe('apply_caller_check');
    expect(mocks.rpc.mock.calls[1]?.[0]).toBe('submit_application');
  });

  it('checks the caller first, keyed on a digest rather than an address (§1.7)', async () => {
    mocks.rpc.mockResolvedValueOnce(allowed).mockResolvedValueOnce(submitted);
    await apply(INITIAL_STATE, formData()).catch(() => undefined);

    const args = mocks.rpc.mock.calls[0]?.[1] as { p_caller_hash: string };
    expect(args.p_caller_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(args.p_caller_hash).not.toContain('203.0.113.7');
  });

  it('sends the E.164 number for the ISO country chosen, and the email lower-cased', async () => {
    mocks.rpc.mockResolvedValueOnce(allowed).mockResolvedValueOnce(submitted);
    await apply(INITIAL_STATE, formData({ country: 'IE', mobile: '085 123 4567' })).catch(
      () => undefined,
    );

    expect(mocks.rpc.mock.calls[1]?.[1]).toEqual({
      p_first_name: 'Amara',
      p_last_name: 'Kalu',
      p_email: 'amara.kalu@example.com',
      p_phone: '+353851234567',
      p_dob: '1994-06-15',
      p_consent: true,
    });
  });

  it('on success sets the short-lived cookie and redirects to the one confirmation screen', async () => {
    mocks.rpc.mockResolvedValueOnce(allowed).mockResolvedValueOnce(submitted);
    const result = await apply(INITIAL_STATE, formData()).catch((e: unknown) => e);

    expect(result).toBeInstanceOf(Redirected);
    expect((result as Redirected).to).toBe('/apply/submitted');
    expect(mocks.setCookie).toHaveBeenCalledWith(
      'thc_apply_sent_to',
      'amara.kalu@example.com',
      expect.objectContaining({ httpOnly: true, path: '/apply', maxAge: 600 }),
    );
  });

  it('a refused caller creates nothing and reads the one neutral line', async () => {
    mocks.rpc.mockResolvedValueOnce(refused);
    const state = await apply(INITIAL_STATE, formData());

    expect(state.failure).toBe(
      'Too many applications from this connection — please try again in a few minutes.',
    );
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it('a limit that cannot be checked fails open — the per-identity limits still hold underneath', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: { code: '42883', message: 'no such function' } })
      .mockResolvedValueOnce(submitted);

    await expect(apply(INITIAL_STATE, formData())).rejects.toBeInstanceOf(Redirected);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it('passes the function’s own 22023 copy through and owns every other error', async () => {
    mocks.rpc
      .mockResolvedValueOnce(allowed)
      .mockResolvedValueOnce({ error: { code: '22023', message: 'Written for the applicant.' } });
    expect((await apply(INITIAL_STATE, formData())).failure).toBe('Written for the applicant.');

    mocks.rpc
      .mockResolvedValueOnce(allowed)
      .mockResolvedValueOnce({ error: { code: '42501', message: 'permission denied' } });
    expect((await apply(INITIAL_STATE, formData())).failure).toBe(
      'Something went wrong sending your application. Please try again.',
    );
  });

  it('validates before touching the database, on the same rules as the form', async () => {
    const state = await apply(INITIAL_STATE, formData({ dob: '2015-01-01', consent: '' }));

    expect(Object.keys(state.errors).sort()).toEqual(['consent', 'dob']);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('without a service-role key says applications are not open, and calls nothing', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    const state = await apply(INITIAL_STATE, formData());

    expect(state.failure).toMatch(/not open yet/);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('the source imports the admin client and never the anon SSR client', () => {
    const source = readFileSync(join(HERE, '..', 'actions.ts'), 'utf8');
    expect(source).toMatch(/from '@thc\/db\/admin'/);
    expect(source).not.toMatch(/@thc\/db\/server/);
    expect(source).not.toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });
});
