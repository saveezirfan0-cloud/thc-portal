import { describe, expect, it, vi } from 'vitest';

/**
 * Audit D18 on the office's change-request reads (ADR-0044): a read that
 * failed is never an empty queue, and a count that failed is never 0.
 */
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({}) }));
vi.mock('../../../_lib/photos', () => ({ signStaffPhotos: async () => new Map() }));

const { countPendingChangeRequests, readChangeRequests } = await import('../data');
type Client = Parameters<typeof readChangeRequests>[0];

const failedRpc = {
  rpc: async () => ({ data: null, error: { message: 'canceling statement due to timeout' } }),
} as unknown as Client;

const counting = (answer: () => Promise<{ count: number | null; error: unknown }>) =>
  ({
    from: () => ({ select: () => ({ eq: answer }) }),
  }) as unknown as Client;

describe('readChangeRequests()', () => {
  it('reports a failed read as a problem, not an empty queue', async () => {
    expect(await readChangeRequests(failedRpc, { staffId: 's1' })).toEqual({
      rows: [],
      problem: 'canceling statement due to timeout',
    });
  });

  it('is a real empty list only when the read succeeded', async () => {
    const ok = { rpc: async () => ({ data: [], error: null }) } as unknown as Client;
    expect(await readChangeRequests(ok)).toEqual({ rows: [], problem: null });
  });
});

describe('countPendingChangeRequests()', () => {
  it('is null — never 0 — when the count fails', async () => {
    expect(
      await countPendingChangeRequests(
        counting(async () => ({ count: null, error: { message: 'permission denied' } })),
      ),
    ).toBeNull();
    expect(
      await countPendingChangeRequests(
        counting(async () => {
          throw new Error('fetch failed');
        }),
      ),
    ).toBeNull();
  });

  it('is the count, 0 included, when the read succeeded', async () => {
    expect(
      await countPendingChangeRequests(counting(async () => ({ count: 3, error: null }))),
    ).toBe(3);
    expect(
      await countPendingChangeRequests(counting(async () => ({ count: 0, error: null }))),
    ).toBe(0);
  });
});
