import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A database exception never reaches the event board as raw text
 * (security review, NOTE item 5): the codes the office has words for get
 * those words; anything else is logged on the server and shown as one
 * generic line. And a read-only login (ADR-0060) is stopped by the
 * server-side check in front of the RPC.
 */
const state = vi.hoisted(() => ({
  role: 'admin' as string | null,
  officeRole: 'manager' as string,
  rpc: vi.fn(async (_fn: string, _args: unknown) => ({
    data: null as unknown,
    error: null as null | { message: string },
  })),
}));

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('../../db', () => ({
  eventsDb: () => ({
    rpc: (fn: string, args: unknown) =>
      fn === 'current_app_role'
        ? Promise.resolve({ data: state.role, error: null })
        : fn === 'office_can'
          ? Promise.resolve({
              data: state.role === 'admin' && state.officeRole !== 'viewer',
              error: null,
            })
          : state.rpc(fn, args),
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
  }),
  supabaseConfigured: () => true,
}));

const { acceptApplication, cancelEvent, withdraw } = await import('../actions');

const RAW = 'duplicate key value violates unique constraint "bookings_pkey" Key (id)=(bk-1)';

beforeEach(() => {
  state.role = 'admin';
  state.officeRole = 'manager';
  state.rpc.mockReset();
});

describe('database refusals on the event board (NOTE 5)', () => {
  it('keeps the words for a code the office knows', async () => {
    state.rpc.mockResolvedValueOnce({ data: null, error: { message: 'booking_not_found' } });
    expect(await withdraw('evt-1', 'bk-1')).toEqual({ error: 'That booking no longer exists.' });
    state.rpc.mockResolvedValueOnce({ data: null, error: { message: 'not_authorised' } });
    expect(await cancelEvent('evt-1', 'Client cancelled')).toEqual({
      error: 'Only the office can do this.',
    });
  });

  it('never shows the raw text of anything else, and logs it', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const run of [
      () => withdraw('evt-1', 'bk-1'),
      () => cancelEvent('evt-1', 'Client cancelled'),
      () => acceptApplication('evt-1', 'bk-1'),
    ]) {
      state.rpc.mockResolvedValueOnce({ data: null, error: { message: RAW } });
      const result = await run();
      expect(result).toHaveProperty('error');
      const text = (result as { error: string }).error;
      expect(text).not.toContain('bookings_pkey');
      expect(text).toMatch(/Refresh the page and try again\.$/);
    }
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });

  it('a read-only login is refused before the RPC', async () => {
    state.officeRole = 'viewer';
    expect(await withdraw('evt-1', 'bk-1')).toEqual({
      error: 'Your login is read-only, so this cannot be changed.',
    });
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
