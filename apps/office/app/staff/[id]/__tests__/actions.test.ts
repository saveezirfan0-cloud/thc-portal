import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /staff/:id's four irreversible or cascading buttons (§9.6, §1.7, §4.3)
 * run through the service key, whose JWT has no sub — so the manager who
 * pressed them has to be passed as p_actor, or audit_log.actor is null
 * (audit D10). The id comes from the SESSION via asAdmin(), never from
 * the browser.
 */
const state = vi.hoisted(() => ({
  user: { id: 'manager-1' } as { id: string } | null,
  role: 'admin' as string | null,
}));
const adminRpc = vi.hoisted(() => vi.fn(async () => ({ error: null })));

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../data', () => ({ supabaseConfigured: () => true }));
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
    rpc: vi.fn(async () => ({ error: null })),
  }),
}));
vi.mock('@thc/db/admin', () => ({ createAdminClient: () => ({ rpc: adminRpc }) }));

const { blockWorker, removeWorker, resetToCandidate, unblockWorker } = await import('../actions');

beforeEach(() => {
  vi.clearAllMocks();
  state.user = { id: 'manager-1' };
  state.role = 'admin';
});

describe('the audit actor (§9.6, D10)', () => {
  it.each([
    ['remove_worker', () => removeWorker('s1', 'REMOVE'), { p_staff: 's1' }],
    [
      'block_worker_manually',
      () => blockWorker('s1', ' Late twice '),
      { p_staff: 's1', p_reason: 'Late twice' },
    ],
    ['unblock_worker', () => unblockWorker('s1'), { p_staff: 's1' }],
    [
      'reset_to_candidate',
      () => resetToCandidate('s1', 'Re-applied'),
      { p_staff: 's1', p_reason: 'Re-applied' },
    ],
  ])('%s is sent the signed-in manager as p_actor', async (fn, run, args) => {
    expect(await run()).toEqual({ ok: true });
    expect(adminRpc).toHaveBeenCalledWith(fn, { ...args, p_actor: 'manager-1' });
  });

  it('a non-admin session never reaches the service key', async () => {
    state.role = 'staff';
    expect(await removeWorker('s1', 'REMOVE')).toEqual({
      ok: false,
      message: 'Only the office can do this.',
    });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it('nor does no session at all', async () => {
    state.user = null;
    expect((await blockWorker('s1', 'reason')).ok).toBe(false);
    expect(adminRpc).not.toHaveBeenCalled();
  });
});
