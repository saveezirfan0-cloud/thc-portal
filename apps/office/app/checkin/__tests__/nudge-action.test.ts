import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ADR-0188 follow-up: when nudge_check_in_out() is not on the database,
 * the monitor says so and tells the manager to ring, rather than the
 * generic "That could not be saved. Refresh the page…" (23.10.2026).
 */
const rpc = vi.fn();

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }),
}));
vi.mock('../data', () => ({ supabaseConfigured: () => true }));

import { nudgeCheckInOut } from '../actions';

beforeEach(() => rpc.mockReset());

describe('nudgeCheckInOut refusals', () => {
  it('says reminders are unavailable when the function is missing', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: 'PGRST202',
        message:
          'Could not find the function public.nudge_check_in_out(p_booking) in the schema cache',
      },
    });
    const result = await nudgeCheckInOut('b1');
    expect(result).toEqual({ error: expect.stringContaining('Ring the worker instead') });
    expect(JSON.stringify(result)).not.toContain('Refresh the page');
  });

  it('keeps the specific wording for a raised reason', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'no_push_device' } });
    expect(await nudgeCheckInOut('b1')).toEqual({
      error: expect.stringContaining('has not turned on notifications'),
    });
  });

  it('returns the template when it is queued', async () => {
    rpc.mockResolvedValue({ data: { template: 'N9' }, error: null });
    expect(await nudgeCheckInOut('b1')).toEqual({ ok: true, template: 'N9' });
  });
});
