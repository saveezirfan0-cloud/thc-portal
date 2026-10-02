import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canMessageWorker, staffMessageRefusal } from '../message';

/**
 * Send push from a worker's profile (ADR-0081). The action names the worker
 * and the words — nothing else; the database decides who may send, and
 * answers with the name to phone when the worker has notifications off.
 */
const state = vi.hoisted(() => ({
  user: { id: 'u-admin' } as { id: string } | null,
  role: 'admin' as string | null,
  rpc: vi.fn(async (_fn: string, _args?: unknown) => ({
    data: null as unknown,
    error: null as null | { message: string; code?: string },
  })),
  revalidated: [] as string[],
}));

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => {
    state.revalidated.push(path);
  },
}));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: (fn: string, args?: unknown) =>
      fn === 'current_app_role'
        ? Promise.resolve({ data: state.role, error: null })
        : state.rpc(fn, args),
  }),
}));
vi.mock('../../data', () => ({ supabaseConfigured: () => true }));

const { messageWorker } = await import('../messageActions');

beforeEach(() => {
  state.user = { id: 'u-admin' };
  state.role = 'admin';
  state.rpc.mockReset();
  state.revalidated.length = 0;
});

describe('messageWorker', () => {
  it('sends through send_staff_message with the worker and the words, nothing else', async () => {
    state.rpc.mockResolvedValueOnce({
      data: { ok: true, sent: 1, withoutPush: [], messageId: 'm-1' },
      error: null,
    });
    expect(await messageWorker('s-1', 'Your uniform is ready')).toEqual({
      ok: true,
      summary: 'Sent to 1 person.',
      everyoneReached: true,
    });
    expect(state.rpc).toHaveBeenCalledWith('send_staff_message', {
      p_staff: 's-1',
      p_message: 'Your uniform is ready',
    });
    expect(state.revalidated).toEqual(['/staff/s-1']);
  });

  it('names the worker to phone when they have notifications off', async () => {
    state.rpc.mockResolvedValueOnce({
      data: { ok: true, sent: 1, withoutPush: ['Aisha Khan'], messageId: 'm-1' },
      error: null,
    });
    expect(await messageWorker('s-1', 'Call the office')).toEqual({
      ok: true,
      summary:
        'Sent to 1 person. This person has notifications off and will not get it — phone them: Aisha Khan.',
      everyoneReached: false,
    });
  });

  it('refuses an empty message before reaching the database', async () => {
    expect(await messageWorker('s-1', '   ')).toEqual({
      ok: false,
      message: 'Write the message first.',
    });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('refuses a caller who is not a signed-in admin before reaching the database', async () => {
    state.role = 'staff';
    expect(await messageWorker('s-1', 'hi')).toEqual({
      ok: false,
      message: 'Only the office can do this.',
    });
    state.user = null;
    expect(await messageWorker('s-1', 'hi')).toEqual({ ok: false, message: 'Sign in to do this.' });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('turns a refusal into words', async () => {
    state.rpc.mockResolvedValueOnce({ data: { ok: false, reason: 'staff_removed' }, error: null });
    expect(await messageWorker('s-1', 'hi')).toEqual({
      ok: false,
      message: 'This worker has been removed (GDPR) — there is nobody to message.',
    });
    state.rpc.mockResolvedValueOnce({ data: null, error: { message: 'read_only' } });
    expect(await messageWorker('s-1', 'hi')).toEqual({
      ok: false,
      message: 'A view-only login cannot send messages.',
    });
    expect(state.revalidated).toEqual([]);
  });

  it('says so when the database is behind the app', async () => {
    state.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Could not find the function public.send_staff_message', code: 'PGRST202' },
    });
    const result = await messageWorker('s-1', 'hi');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/not switched on yet/);
  });
});

describe('staffMessageRefusal', () => {
  it('has words for every refusal send_staff_message gives', () => {
    for (const reason of [
      'message_required',
      'message_too_long',
      'staff_removed',
      'staff_not_found',
      'not_authorised',
      'read_only',
    ]) {
      expect(staffMessageRefusal(reason), reason).not.toMatch(/not sent \(/);
    }
    expect(staffMessageRefusal('message_too_long')).toContain('300');
  });

  it('falls back to the code for one it does not know', () => {
    expect(staffMessageRefusal('mystery')).toBe('The message was not sent (mystery).');
  });
});

describe('canMessageWorker', () => {
  it('offers Send push to a login that may write, on any profile but a removed one', () => {
    expect(canMessageWorker('compliant', true)).toBe(true);
    expect(canMessageWorker('blocked', true)).toBe(true);
    expect(canMessageWorker('documents', true)).toBe(true);
    expect(canMessageWorker('removed', true)).toBe(false);
    expect(canMessageWorker('compliant', false)).toBe(false);
  });
});
