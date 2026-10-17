import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "+ Add staff" on a client card (§9.7): one grant per worker × role, run
 * eight at a time instead of one after another (go-live audit M5), each
 * refused or granted on its own and every refusal still reported.
 */

const state = vi.hoisted(() => ({ inFlight: 0, peak: 0 }));
const rpc = vi.fn(async (_fn: string, args: { p_staff: string; p_role: string }) => {
  state.inFlight += 1;
  state.peak = Math.max(state.peak, state.inFlight);
  await new Promise((resolve) => setTimeout(resolve, 1));
  state.inFlight -= 1;
  return args.p_staff === 'w-3' && args.p_role === 'r-2'
    ? { error: { code: 'P0001', message: 'This worker does not hold that role.' } }
    : { error: null };
});

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ rpc }) }));

const { qualifyStaff } = await import('../actions');

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  rpc.mockClear();
  state.inFlight = 0;
  state.peak = 0;
});

describe('qualifyStaff', () => {
  const staff = Array.from({ length: 12 }, (_, n) => `w-${n}`);

  it('grants every worker × role pair, at most eight at a time', async () => {
    const result = await qualifyStaff('c-1', staff, ['r-1', 'r-2', 'r-3'], ' trial ');
    expect(rpc).toHaveBeenCalledTimes(36);
    expect(state.peak).toBe(8);
    expect(rpc).toHaveBeenCalledWith('grant_client_qualification', {
      p_staff: 'w-11',
      p_client: 'c-1',
      p_role: 'r-3',
      p_note: 'trial',
    });
    // The one refusal is reported, the other 35 grants stand.
    expect(result).toEqual({ ok: false, message: 'This worker does not hold that role.' });
  });

  it('is ok when every pair is granted', async () => {
    expect(await qualifyStaff('c-1', ['w-1'], ['r-1'], '')).toEqual({ ok: true });
  });
});
