import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The board's two roster corrections go through the database (§3.3,
 * 20260927181000). Get back used to delete the no-show and insert a `late`
 * row from here — no check-in, booking still `confirmed`, payable_shifts_v
 * paying 0. These pin the wiring: one RPC each, nothing written to
 * `violations` directly, refusals mapped to words.
 */
const state = vi.hoisted(() => ({
  rpc: vi.fn(async (_fn: string, _args: unknown) => ({
    data: null as unknown,
    error: null as null | { message: string },
  })),
  from: vi.fn((_table: string) => {
    throw new Error('the board actions must not write tables directly');
  }),
  revalidated: [] as string[],
}));

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => {
    state.revalidated.push(path);
  },
}));
vi.mock('../../db', () => ({
  eventsDb: () => ({ rpc: state.rpc, from: state.from }),
  supabaseConfigured: () => true,
}));

const { getBack, markNoShow } = await import('../actions');

beforeEach(() => {
  state.rpc.mockReset();
  state.from.mockClear();
  state.revalidated.length = 0;
});

describe('Get back (§3.3)', () => {
  it('resolves the open no-show through get_back() — the same path as the Violation log', async () => {
    state.rpc.mockResolvedValueOnce({
      data: { decision: 'resolved', wasType: 'no_show', nowType: 'late', payrollExported: false },
      error: null,
    });
    const result = await getBack('evt-1', 'bk-1');
    expect(result).toEqual({ ok: true, warning: undefined });
    expect(state.rpc).toHaveBeenCalledWith('get_back', { p_booking: 'bk-1' });
    expect(state.from).not.toHaveBeenCalled();
    expect(state.revalidated).toEqual(['/events/evt-1']);
  });

  it('carries the RULE-06 warning when this shift was already in a payroll export', async () => {
    state.rpc.mockResolvedValueOnce({
      data: { decision: 'resolved', payrollExported: true },
      error: null,
    });
    const result = await getBack('evt-1', 'bk-1');
    expect(result).toMatchObject({ ok: true });
    expect((result as { warning?: string }).warning).toMatch(/payroll/i);
  });

  it('says so when there is no no-show to get back from', async () => {
    state.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'no_open_no_show' },
    });
    expect(await getBack('evt-1', 'bk-1')).toEqual({
      error: 'This worker has no unresolved no-show to get back from.',
    });
    expect(state.revalidated).toEqual([]);
  });

  it('reports an already-resolved entry rather than pretending', async () => {
    state.rpc.mockResolvedValueOnce({ data: { decision: 'already_resolved' }, error: null });
    expect(await getBack('evt-1', 'bk-1')).toEqual({
      error: 'This no-show has already been resolved.',
    });
  });
});

describe('manual No-show (§3.3)', () => {
  it('records it through office_mark_no_show(), which holds the guards', async () => {
    state.rpc.mockResolvedValueOnce({
      data: { ok: true, already: false, payrollExported: false },
      error: null,
    });
    const result = await markNoShow('evt-1', 'bk-2');
    expect(result).toEqual({ ok: true, warning: undefined });
    expect(state.rpc).toHaveBeenCalledWith('office_mark_no_show', { p_booking: 'bk-2' });
    expect(state.from).not.toHaveBeenCalled();
    expect(state.revalidated).toEqual(['/events/evt-1']);
  });

  it('maps the window refusal to the §3.3 sentence', async () => {
    state.rpc.mockResolvedValueOnce({ data: null, error: { message: 'outside_window' } });
    expect(await markNoShow('evt-1', 'bk-2')).toEqual({
      error: 'No-show can be recorded from the shift start until two weeks after it ends (§3.3).',
    });
  });

  it.each([
    ['booking_not_confirmed: invited', /confirmed worker/],
    ['already_checked_in', /checked in/],
    ['admins_only', /Only the office/],
  ])('maps %s to words', async (raw, expected) => {
    state.rpc.mockResolvedValueOnce({ data: null, error: { message: raw } });
    const result = await markNoShow('evt-1', 'bk-2');
    expect((result as { error: string }).error).toMatch(expected);
  });

  it('warns when the payroll for this shift has already gone out', async () => {
    state.rpc.mockResolvedValueOnce({ data: { ok: true, payrollExported: true }, error: null });
    const result = await markNoShow('evt-1', 'bk-2');
    expect((result as { warning?: string }).warning).toMatch(/payroll/i);
  });
});
