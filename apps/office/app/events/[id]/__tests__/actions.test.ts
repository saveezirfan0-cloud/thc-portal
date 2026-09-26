import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The board's two roster corrections go through the database (§3.3,
 * 20260928110200). Get back used to delete the no-show and insert a `late`
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

const { declineCover, getBack, markNoShow, openOfferToPool } = await import('../actions');

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

  it('after the shift has ended, sends the manager to Resolve for the arrival (D17)', async () => {
    state.rpc.mockResolvedValueOnce({ data: null, error: { message: 'arrived_at_required' } });
    expect(await getBack('evt-1', 'bk-1')).toEqual({
      error:
        'The shift has ended — use Resolve in the violation log to enter the arrival and finish.',
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
      error: 'No-show can be recorded from the shift start until two weeks after it ends.',
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

describe('cover requests (ADR-0046)', () => {
  it('Open to pool is one RPC, office_open_offer_to_pool()', async () => {
    state.rpc.mockResolvedValueOnce({ data: { ok: true, expiresAt: 'x' }, error: null });
    expect(await openOfferToPool('evt-1', 'off-1')).toEqual({ ok: true });
    expect(state.rpc).toHaveBeenCalledWith('office_open_offer_to_pool', { p_offer: 'off-1' });
    expect(state.from).not.toHaveBeenCalled();
    expect(state.revalidated).toEqual(['/events/evt-1']);
  });

  it('says why when the request is no longer open', async () => {
    state.rpc.mockResolvedValueOnce({ data: { ok: false, reason: 'offer_not_open' }, error: null });
    expect(await openOfferToPool('evt-1', 'off-1')).toEqual({
      error: 'This request is no longer open — the worker withdrew it, it lapsed, or it was taken.',
    });
  });

  it('Decline sends the trimmed note, or none, through office_decline_cover()', async () => {
    state.rpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    expect(await declineCover('evt-1', 'off-2', '  Covered in-house  ')).toEqual({ ok: true });
    expect(state.rpc).toHaveBeenCalledWith('office_decline_cover', {
      p_offer: 'off-2',
      p_note: 'Covered in-house',
    });
    state.rpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    await declineCover('evt-1', 'off-2', '   ');
    expect(state.rpc).toHaveBeenLastCalledWith('office_decline_cover', {
      p_offer: 'off-2',
      p_note: null,
    });
    expect(state.from).not.toHaveBeenCalled();
  });

  it('a non-admin is told so', async () => {
    state.rpc.mockResolvedValueOnce({ data: null, error: { message: 'not_authorised' } });
    expect(await declineCover('evt-1', 'off-2', '')).toEqual({
      error: 'Only the office can act on a cover request.',
    });
  });
});
