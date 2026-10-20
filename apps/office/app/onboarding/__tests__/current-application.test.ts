import { describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({}) }));

const { currentApplication } = await import('../data');

/** Records the PostgREST chain loadCandidate builds for the Application panel. */
function recorder() {
  const calls: [string, unknown[]][] = [];
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  for (const m of ['from', 'select', 'eq', 'or', 'order', 'limit', 'maybeSingle']) {
    chain[m] = (...args: unknown[]) => {
      calls.push([m, args]);
      return chain;
    };
  }
  return { db: chain, calls };
}

describe('currentApplication() — the Application panel reads this pass (§2.12)', () => {
  it('takes the newest application that created the record or was reset onto it', () => {
    const { db, calls } = recorder();
    currentApplication(db as never, 's-1');
    expect(calls).toEqual([
      ['from', ['applications']],
      ['select', ['created_at, consented_at, outcome, matched_on']],
      ['eq', ['staff_id', 's-1']],
      // Not an unresolved or rejected returning entry, not a duplicate_candidate.
      ['or', ['outcome.eq.candidate_created,resolution.eq.reset']],
      // Newest first: the oldest is the first pass, before any reset.
      ['order', ['created_at', { ascending: false }]],
      ['limit', [1]],
      ['maybeSingle', []],
    ]);
  });
});
