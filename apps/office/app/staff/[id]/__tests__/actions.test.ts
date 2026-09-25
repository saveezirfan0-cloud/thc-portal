import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The four privileged buttons on /staff/:id — Block, Unblock, Reset to
 * candidate, Remove — run through the service key, whose JWT has no
 * `sub`. Inside the database `coalesce(p_actor, auth.uid())` is therefore
 * NULL unless the action passes the manager's id (20260927160400 §4), and
 * the 27.09 security audit found every §1.7 removal and §9.6 block since
 * then recorded with no actor. Held here:
 *
 *   · each of the four calls carries `p_actor`, and it is the SESSION's
 *     user id — read through the session client, never an argument;
 *   · a caller who is not a signed-in admin never reaches the service key.
 */

const state = vi.hoisted(() => ({
  user: { id: 'u-admin' } as { id: string } | null,
  role: 'admin' as string | null,
}));

const rpc = vi.fn(async () => ({ error: null }));
const createAdminClient = vi.fn(() => ({ rpc }));

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@thc/db/admin', () => ({ createAdminClient }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: state.role ? { role: state.role } : null }),
        }),
      }),
    }),
  }),
}));
vi.mock('../../data', () => ({ supabaseConfigured: () => true }));

const { blockWorker, removeWorker, resetToCandidate, unblockWorker } = await import('../actions');

beforeEach(() => {
  state.user = { id: 'u-admin' };
  state.role = 'admin';
  rpc.mockClear();
  createAdminClient.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the privileged /staff/:id actions name the manager (§1.7, §9.6)', () => {
  it('Block passes the session user as p_actor', async () => {
    expect(await blockWorker('s1', '  Late twice  ')).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('block_worker_manually', {
      p_staff: 's1',
      p_reason: 'Late twice',
      p_actor: 'u-admin',
    });
  });

  it('Unblock passes the session user as p_actor', async () => {
    expect(await unblockWorker('s1')).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('unblock_worker', { p_staff: 's1', p_actor: 'u-admin' });
  });

  it('Reset to candidate passes the session user as p_actor', async () => {
    expect(await resetToCandidate('s1', 'Returning next season')).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('reset_to_candidate', {
      p_staff: 's1',
      p_reason: 'Returning next season',
      p_actor: 'u-admin',
    });
  });

  it('Remove passes the session user as p_actor', async () => {
    expect(await removeWorker('s1', 'remove')).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('remove_worker', { p_staff: 's1', p_actor: 'u-admin' });
  });

  it('the actor is whoever the session says, not a value from the form', async () => {
    state.user = { id: 'u-other-manager' };
    await unblockWorker('s1');
    expect(rpc).toHaveBeenCalledWith('unblock_worker', {
      p_staff: 's1',
      p_actor: 'u-other-manager',
    });
  });
});

describe('the service key is reached only by a signed-in admin', () => {
  it('refuses a non-admin session before the service client exists', async () => {
    state.role = 'staff';
    expect(await removeWorker('s1', 'REMOVE')).toEqual({
      ok: false,
      message: 'Only the office can do this.',
    });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses with no session at all', async () => {
    state.user = null;
    expect(await blockWorker('s1', 'reason')).toEqual({
      ok: false,
      message: 'Sign in to do this.',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('still checks the typed word and the reason before anything else', async () => {
    expect(await removeWorker('s1', 'delete')).toEqual({
      ok: false,
      message: 'Type REMOVE to confirm.',
    });
    expect(await blockWorker('s1', '   ')).toEqual({
      ok: false,
      message: 'A manual block needs a reason.',
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});
