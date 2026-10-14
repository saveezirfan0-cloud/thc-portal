import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The column chooser's server half (ADR-0139): the layout's read of the
 * operator's choices and the action that saves one list's. Both go through
 * the two definer functions only (`my_list_columns`, `set_my_list_columns`
 * — 20261014193000, pgTAP 839), never the table.
 */

const state = vi.hoisted(() => ({
  cookies: [] as { name: string; value: string }[],
  read: { data: {} as unknown, error: null as { message: string } | null },
  write: { error: null as { message: string } | null },
  calls: [] as { fn: string; args?: Record<string, unknown> }[],
}));

const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
  state.calls.push({ fn, ...(args ? { args } : {}) });
  return fn === 'my_list_columns' ? state.read : { data: null, error: state.write.error };
});

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => state.cookies, get: () => undefined }),
}));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ rpc }) }));

const { listColumnPrefs } = await import('../listColumns');
const { saveListColumns } = await import('../listColumnsActions');

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  state.cookies = [{ name: 'sb-ref-auth-token', value: 'x' }];
  state.read = { data: {}, error: null };
  state.write = { error: null };
  state.calls = [];
});

describe('listColumnPrefs', () => {
  it('asks nobody when there is no session', async () => {
    state.cookies = [];
    expect(await listColumnPrefs()).toEqual({});
    expect(state.calls).toEqual([]);
  });

  it('reads the operator’s choices through my_list_columns and drops anything malformed', async () => {
    state.read = {
      data: {
        venues: { order: ['type', 'address'], hidden: ['address'] },
        'Bad Key': { order: [], hidden: [] },
        clients: { order: 'nope' },
      },
      error: null,
    };
    expect(await listColumnPrefs()).toEqual({
      venues: { order: ['type', 'address'], hidden: ['address'] },
    });
    expect(state.calls.map((call) => call.fn)).toEqual(['my_list_columns']);
  });

  it('reads an error as “no choice”, never a broken page', async () => {
    state.read = { data: null, error: { message: 'boom' } };
    expect(await listColumnPrefs()).toEqual({});
  });
});

describe('saveListColumns', () => {
  it('saves one list through set_my_list_columns', async () => {
    const result = await saveListColumns('staff.inactive', {
      order: ['left', 'reason'],
      hidden: ['reason'],
    });
    expect(result).toEqual({ ok: true });
    expect(state.calls).toEqual([
      {
        fn: 'set_my_list_columns',
        args: {
          p_list: 'staff.inactive',
          p_columns: { order: ['left', 'reason'], hidden: ['reason'] },
        },
      },
    ]);
  });

  it('sends null to put a list back to its default', async () => {
    await saveListColumns('venues', null);
    expect(state.calls[0]!.args).toEqual({ p_list: 'venues', p_columns: null });
  });

  it('refuses a bad list key or shape without a round trip', async () => {
    expect((await saveListColumns('Bad Key', null)).ok).toBe(false);
    expect((await saveListColumns('venues', { order: ['Type'], hidden: [] })).ok).toBe(false);
    expect((await saveListColumns('venues', 'x')).ok).toBe(false);
    expect(state.calls).toEqual([]);
  });

  it('says so when the database refuses', async () => {
    state.write = { error: { message: 'not_signed_in' } };
    expect(await saveListColumns('venues', null)).toEqual({
      ok: false,
      message: 'Your session has ended. Sign in again.',
    });
  });
});
