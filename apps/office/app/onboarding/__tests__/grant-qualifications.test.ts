import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Qualify at clients" on a candidate (§9.6): one grant per client × role.
 * They ran in batches of eight, each batch waiting for its slowest call
 * before the next began; now eight are in flight at a time, a new one
 * starting as each lands (`_lib/pool.ts`, go-live audit M5). The first
 * refusal still ends the run and is the one the manager reads.
 */
const state = vi.hoisted(() => ({ inFlight: 0, peak: 0, calls: 0, refuse: '' }));
const rpc = vi.fn(async (_fn: string, args: { p_client: string; p_role: string }) => {
  state.calls += 1;
  state.inFlight += 1;
  state.peak = Math.max(state.peak, state.inFlight);
  // Uneven call times: a batch would wait for the slowest of each eight.
  await new Promise((resolve) => setTimeout(resolve, args.p_role === 'r-0' ? 6 : 1));
  state.inFlight -= 1;
  return `${args.p_client}:${args.p_role}` === state.refuse
    ? { error: { message: 'role_not_held' } }
    : { error: null };
});

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ rpc }) }));
vi.mock('@thc/db/admin', () => ({ createAdminClient: vi.fn() }));

const { grantClientQualifications } = await import('../actions');

const CLIENTS = Array.from({ length: 6 }, (_, n) => `c-${n}`);
const ROLES = ['r-0', 'r-1', 'r-2', 'r-3'];

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  rpc.mockClear();
  Object.assign(state, { inFlight: 0, peak: 0, calls: 0, refuse: '' });
});

describe('grantClientQualifications', () => {
  it('grants every client × role pair, eight at a time', async () => {
    expect(await grantClientQualifications('w-1', CLIENTS, ROLES)).toEqual({ ok: true });
    expect(state.calls).toBe(24);
    expect(state.peak).toBe(8);
    expect(rpc).toHaveBeenCalledWith('grant_client_qualification', {
      p_staff: 'w-1',
      p_client: 'c-5',
      p_role: 'r-3',
    });
  });

  it('stops at the first refusal and says why', async () => {
    state.refuse = 'c-1:r-1';
    const result = await grantClientQualifications('w-1', CLIENTS, ROLES);
    expect(result.ok).toBe(false);
    expect(state.calls).toBeLessThan(24);
  });
});
