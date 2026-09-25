import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Get back" on the event board (§3.3, audit D4).
 *
 * It is the same action as Resolve on the No-show in the §9.5 log, so it
 * is ONE call to `get_back()`, which resolves the open No-show through
 * `resolve_violation()` — registering the arrival, moving the booking to
 * worked and reclassifying the entry in one transaction. What this pins is
 * the part the action owns: no table is written from here, the refusal
 * reaches the manager in words, and the payroll warning follows the
 * database's per-booking answer.
 */
const rpc = vi.hoisted(() =>
  vi.fn(async (): Promise<{ data: unknown; error: { message: string } | null }> => ({
    data: { decision: 'resolved', nowType: 'late', payrollExported: false },
    error: null,
  })),
);
const from = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('../db', () => ({
  supabaseConfigured: () => true,
  eventsDb: () => ({ rpc, from }),
}));

const { getBack } = await import('../[id]/actions');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getBack (§3.3, D4)', () => {
  it('calls get_back() for the booking and writes no table itself', async () => {
    expect(await getBack('ev-1', 'bk-1')).toEqual({ ok: true, warning: undefined });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('get_back', { p_booking: 'bk-1' });
    // The old path deleted the No-show and inserted a Late from here.
    expect(from).not.toHaveBeenCalled();
  });

  it('refreshes the board and the check-in monitor', async () => {
    await getBack('ev-1', 'bk-1');
    expect(revalidatePath).toHaveBeenCalledWith('/events/ev-1');
    expect(revalidatePath).toHaveBeenCalledWith('/checkin');
  });

  it('keeps the payroll-exported warning, from the database’s per-booking answer (RULE-06)', async () => {
    rpc.mockResolvedValueOnce({
      data: { decision: 'resolved', nowType: 'late', payrollExported: true },
      error: null,
    });
    const result = await getBack('ev-1', 'bk-1');
    expect(result).toEqual({
      ok: true,
      warning:
        'This shift has already been included in a payroll export. This change will not add the payment — please notify Finance to pay it.',
    });
  });

  it('says so when there is no open No-show to get back', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'no_open_no_show' } });
    expect(await getBack('ev-1', 'bk-1')).toEqual({
      error: 'There is no open No-show on this booking to get back.',
    });
  });

  it('points at the Violation log once the shift has ended (D17)', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'arrived_at_required' } });
    const result = await getBack('ev-1', 'bk-1');
    expect('error' in result && result.error).toMatch(/Violation log/);
  });
});
