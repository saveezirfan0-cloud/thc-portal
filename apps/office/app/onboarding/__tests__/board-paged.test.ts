import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callsTo, fakePostgrest } from '../../_lib/__tests__/fakePostgrest';

/**
 * The onboarding board shows every candidate (go-live audit 17.10.2026, H3).
 * With the invite roster in, the pipeline is ~1,300 cards; read in one
 * request, PostgREST cut it at 1000, newest stage first — the OLDEST
 * candidates vanished from the board without a word.
 */

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@thc/db/server', () => ({ createClient: () => state.db }));

const { loadBoard } = await import('../data');

const pad = (n: number) => String(n).padStart(4, '0');
const CANDIDATES = Array.from({ length: 1310 }, (_, n) => ({
  id: `c-${pad(n)}`,
  display_name: `Candidate ${pad(n)}`,
  photo_path: null,
  status: 'interview_requested',
  stage_entered_at: new Date(Date.UTC(2026, 9, 17) - n * 60_000).toISOString(),
}));
const RETURNING = Array.from({ length: 1005 }, (_, n) => ({
  application_id: `a-${pad(n)}`,
  staff_id: `s-${pad(n)}`,
  applied_at: '2026-10-01T09:00:00Z',
}));

let fake: ReturnType<typeof fakePostgrest>;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  fake = fakePostgrest({
    onboarding_candidates_v: CANDIDATES,
    onboarding_returning_v: RETURNING,
    roles: [],
    application_referrals: [],
    onboarding_chaser_state: [],
  });
  state.db = fake;
});

describe('onboarding loadBoard', () => {
  it('puts all 1,310 candidates on the board — the oldest included', async () => {
    const data = await loadBoard();
    expect(data.problem).toBeNull();
    expect(data.candidates).toHaveLength(1310);
    expect(data.candidates.at(-1)?.id).toBe('c-1309');
    expect(data.returning).toHaveLength(1005);
  });

  it('pages by stage then id, so no card is lost at a page boundary', async () => {
    await loadBoard();
    const pages = callsTo(fake.calls, 'onboarding_candidates_v');
    expect(pages.map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(pages[0]!.orders.map(([column]) => column)).toEqual(['stage_entered_at', 'id']);
    expect(callsTo(fake.calls, 'onboarding_returning_v')[0]!.orders.map(([c]) => c)).toEqual([
      'applied_at',
      'application_id',
    ]);
  });
});
