import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Withdraw and Invite on the event board (§3.3, §3.4).
 *
 *   * Withdraw is ONE database call, `withdraw_booking()` (20260930110300):
 *     it decides N10b or N10d from the row itself and queues the push in the
 *     same transaction. The action no longer updates `bookings` or queues a
 *     notification itself, and takes no `wasConfirmed` flag from the page
 *     (audit D38).
 *   * Both are refused on the server before the RPC for anyone who is not an
 *     admin (claim 2b): a server action is a public endpoint.
 */
const state = vi.hoisted(() => ({
  role: 'admin' as string | null,
  rpc: vi.fn(async (_fn: string, _args: unknown) => ({
    data: null as unknown,
    error: null as null | { message: string },
  })),
  tablesWritten: [] as string[],
  revalidated: [] as string[],
}));

function profiles() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({
      data: state.role ? { role: state.role } : null,
      error: null,
    }),
  };
  return chain;
}

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => {
    state.revalidated.push(path);
  },
}));
vi.mock('../../db', () => ({
  eventsDb: () => ({
    rpc: state.rpc,
    auth: {
      getUser: async () =>
        state.role === null
          ? { data: { user: null }, error: { message: 'no session' } }
          : { data: { user: { id: 'user-1' } }, error: null },
    },
    from: (table: string) => {
      if (table === 'profiles') return profiles();
      state.tablesWritten.push(table);
      throw new Error(`the board actions must not touch ${table} directly`);
    },
  }),
  supabaseConfigured: () => true,
}));

const { inviteWorker, withdraw } = await import('../actions');

beforeEach(() => {
  state.role = 'admin';
  state.rpc.mockReset();
  state.tablesWritten.length = 0;
  state.revalidated.length = 0;
});

describe('Withdraw (§3.3, D38)', () => {
  it('is one withdraw_booking() call — no table write, no second notification call', async () => {
    state.rpc.mockResolvedValueOnce({
      data: { ok: true, was: 'confirmed', notified: 'N10b' },
      error: null,
    });
    await expect(withdraw('evt-1', 'bk-1')).resolves.toEqual({ ok: true });
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.rpc).toHaveBeenCalledWith('withdraw_booking', { p_booking: 'bk-1' });
    expect(state.tablesWritten).toEqual([]);
    expect(state.revalidated).toEqual(['/events/evt-1']);
  });

  it('says why the database refused, in the manager’s words', async () => {
    state.rpc.mockResolvedValueOnce({
      data: { ok: false, reason: 'checked_in', status: 'worked' },
      error: null,
    });
    const result = await withdraw('evt-1', 'bk-1');
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/checked in/i);
  });

  it('refuses a non-admin before reaching the database (claim 2b)', async () => {
    state.role = 'staff';
    const result = await withdraw('evt-1', 'bk-1');
    expect(result).toEqual({ error: 'Only the office can do this.' });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('refuses a signed-out caller before reaching the database', async () => {
    state.role = null;
    const result = await withdraw('evt-1', 'bk-1');
    expect(result).toEqual({ error: 'Sign in to do this.' });
    expect(state.rpc).not.toHaveBeenCalled();
  });
});

describe('Invite from the Potential pool (§3.4, claim 2b)', () => {
  it('goes through office_invite_worker() for an admin', async () => {
    state.rpc.mockResolvedValueOnce({ data: { invited: true, bookingId: 'bk-9' }, error: null });
    await expect(inviteWorker('evt-1', 'sh-1', 'st-1')).resolves.toEqual({ ok: true });
    expect(state.rpc).toHaveBeenCalledWith('office_invite_worker', {
      p_shift: 'sh-1',
      p_staff: 'st-1',
    });
  });

  it('is refused on the server for a client, before the RPC', async () => {
    state.role = 'client';
    const result = await inviteWorker('evt-1', 'sh-1', 'st-1');
    expect(result).toEqual({ error: 'Only the office can do this.' });
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
