import { describe, expect, it, vi } from 'vitest';
import { countComplianceQueue } from '../navCounts';
import type { QueueCountClient } from '../navCounts';

/**
 * The sidebar's "Needs review" counter (§4.1) is one exact count, read by
 * compliance_review_queue_count() — never a HEAD of the queue view, which
 * made PostgREST build every item to count them (ADR-0160).
 */
function client(reply: { data: number | null; error: { message: string } | null } | Error) {
  const rpc = vi.fn((_fn: string) =>
    reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply),
  );
  return { rpc: rpc as unknown as QueueCountClient['rpc'], calls: rpc };
}

describe('countComplianceQueue', () => {
  it('asks the database for the count, by name, with no arguments', async () => {
    const fake = client({ data: 7, error: null });
    await expect(countComplianceQueue(fake)).resolves.toBe(7);
    expect(fake.calls).toHaveBeenCalledTimes(1);
    expect(fake.calls).toHaveBeenCalledWith('compliance_review_queue_count');
  });

  it('passes an empty queue through as 0 (the sidebar then draws no counter)', async () => {
    await expect(countComplianceQueue(client({ data: 0, error: null }))).resolves.toBe(0);
  });

  it('is null — no counter, never a broken page — when the read is refused or fails', async () => {
    await expect(
      countComplianceQueue(client({ data: null, error: { message: 'permission denied' } })),
    ).resolves.toBeNull();
    await expect(countComplianceQueue(client(new Error('fetch failed')))).resolves.toBeNull();
    await expect(countComplianceQueue(client({ data: null, error: null }))).resolves.toBeNull();
  });
});
