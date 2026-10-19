import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TAKEN_POPUP_SENTENCE } from '@thc/domain';

/**
 * RULE-03 (§3.4): "Sorry, this shift has been taken — someone confirmed
 * first." Found 19.10.2026 on the running stack: the popup opened and was
 * gone in the same frame, because accept_invite had just closed the
 * invitation and the action revalidated /invites, whose re-render no longer
 * held the card the dialog lived in. The same took "Sorry, this shift is now
 * full" off Radar, and the "1 overlapping invitation was withdrawn" note off
 * Invites. A press with something to say does not revalidate; ActionButton
 * refreshes once the worker has read it.
 */
const rpc = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('../db', () => ({
  staffDb: () => ({ rpc }),
  supabaseConfigured: () => true,
}));

const actions = await import('../actions');

const answer = (data: Record<string, unknown>) => rpc.mockResolvedValue({ data, error: null });

beforeEach(() => {
  rpc.mockReset();
  revalidatePath.mockReset();
});

describe('a press with something to say leaves the screen alone', () => {
  it('Accept, taken: the RULE-03 popup, and no re-render under it', async () => {
    answer({ ok: false, reason: 'taken' });
    const result = await actions.acceptInvite('b1');
    expect('refusal' in result && result.refusal.title).toBe(TAKEN_POPUP_SENTENCE);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('Accept that withdrew an overlapping invitation: the note, and no re-render', async () => {
    answer({ ok: true, withdrawn: 1 });
    const result = await actions.acceptInvite('b1');
    expect(result).toEqual({
      ok: true,
      note: '1 overlapping invitation was withdrawn automatically.',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ['apply, full', () => actions.applyForShift('s1'), { ok: false, reason: 'full' }],
    ['cancel, too late', () => actions.cancelShift('b1'), { ok: false, reason: 'too_late' }],
    ['ready, deadline', () => actions.markReady('b1'), { ok: false, reason: 'deadline_passed' }],
    ['decline, gone', () => actions.declineInvite('b1'), { ok: false, reason: 'not_invited' }],
    ['withdraw, gone', () => actions.withdrawApplication('b1'), { ok: false }],
  ])('%s', async (_name, press, data) => {
    answer(data);
    const result = await press();
    expect('refusal' in result).toBe(true);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('a clean success refreshes every list at once', () => {
  it.each([
    ['accept', () => actions.acceptInvite('b1'), { ok: true, withdrawn: 0 }],
    ['decline', () => actions.declineInvite('b1'), { ok: true }],
    ['apply', () => actions.applyForShift('s1'), { ok: true, bookingId: 'b9' }],
    ['ready', () => actions.markReady('b1'), { ok: true }],
    ['cancel', () => actions.cancelShift('b1'), { ok: true }],
  ])('%s', async (_name, press, data) => {
    answer(data);
    expect(await press()).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith('/invites');
    expect(revalidatePath).toHaveBeenCalledWith('/shifts');
    expect(revalidatePath).toHaveBeenCalledWith('/radar');
  });
});
