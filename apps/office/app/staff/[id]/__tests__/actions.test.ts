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
  officeRole: 'manager' as string,
  /** Calls made through the SESSION client, other than the role checks. */
  sessionCalls: [] as [string, unknown][],
}));

const rpc = vi.fn(async (..._args: unknown[]) => ({ error: null as null | { message: string } }));
const createAdminClient = vi.fn(() => ({ rpc }));

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@thc/db/admin', () => ({ createAdminClient }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    // The admin check asks current_app_role() (20261001200500).
    // ADR-0060: and office_can('write') before the service key — false for a viewer.
    rpc: async (fn: string, args?: unknown) => {
      if (fn === 'current_app_role') return { data: state.role ?? null, error: null };
      if (fn === 'office_can') {
        return { data: state.role === 'admin' && state.officeRole !== 'viewer', error: null };
      }
      state.sessionCalls.push([fn, args]);
      return { data: null, error: null };
    },
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
  state.officeRole = 'manager';
  state.sessionCalls = [];
  rpc.mockClear();
  rpc.mockImplementation(async () => ({ error: null }));
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

  it('Unblock on a rejected declaration’s hold says who may lift it (ADR-0180)', async () => {
    rpc.mockImplementation(async (...args: unknown[]) =>
      args[0] === 'unblock_worker'
        ? { error: { message: 'criminal_records_reviewer_only' } }
        : { error: null },
    );
    expect(await unblockWorker('s1')).toEqual({
      ok: false,
      message:
        'Only office users allowed to review criminal records can lift this — use Reverse rejection.',
    });
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

describe('a read-only login never reaches the service key (ADR-0060)', () => {
  it('refuses a viewer before the service client exists, in its own words', async () => {
    state.officeRole = 'viewer';
    expect(await removeWorker('s1', 'REMOVE')).toEqual({
      ok: false,
      message: 'Your login is read-only, so this cannot be changed.',
    });
    expect(await blockWorker('s1', 'Late twice')).toMatchObject({ ok: false });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('a database refusal reaches the screen in words, never raw (NOTE 5)', () => {
  const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => undefined);

  it('maps a known code to the office’s copy', async () => {
    rpc.mockImplementation(async () => ({ error: { message: 'not_resettable: compliant' } }));
    expect(await resetToCandidate('s1', 'Returning')).toEqual({
      ok: false,
      message: 'Reset to candidate is only possible on a blocked, rejected or inactive record.',
    });
  });

  it('turns an unknown one into a generic line and logs it on the server', async () => {
    const spy = quiet();
    rpc.mockImplementation(async () => ({
      error: { message: 'duplicate key value violates unique constraint "staff_pkey" (id)=(s1)' },
    }));
    const result = await unblockWorker('s1');
    expect(result).toEqual({
      ok: false,
      message: 'This could not be saved. Refresh the page and try again.',
    });
    expect(JSON.stringify(result)).not.toContain('staff_pkey');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('Bar from a client (ADR-0146)', () => {
  it('calls bar_from_client through the session, with the reason trimmed', async () => {
    const { barFromClient } = await import('../actions');
    expect(await barFromClient('s1', 'c1', '  Client asked  ')).toEqual({ ok: true });
    expect(state.sessionCalls).toEqual([
      ['bar_from_client', { p_staff: 's1', p_client: 'c1', p_reason: 'Client asked' }],
    ]);
    // The session's own client, never the service key: the definer checks
    // the office login itself (20261015150000).
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses before the database without a client or a reason', async () => {
    const { barFromClient } = await import('../actions');
    expect(await barFromClient('s1', '', 'Client asked')).toEqual({
      ok: false,
      message: 'Choose a client.',
    });
    expect(await barFromClient('s1', 'c1', '  ')).toEqual({
      ok: false,
      message: 'Do not return needs a reason.',
    });
  });
});
