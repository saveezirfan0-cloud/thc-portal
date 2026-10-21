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

// The Documents-column cards' docs_missing, read on its own (data.ts,
// DOCS_COLUMN_FILTER): more than a page of them, so it is paged too.
const DOCS_MISSING = Array.from({ length: 1003 }, (_, n) => ({
  id: `c-${pad(n)}`,
  docs_missing: n % 2 ? ['passport', 'ni_evidence'] : [],
}));
const DOCS_SELECT = 'id, docs_missing';

let fake: ReturnType<typeof fakePostgrest>;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  fake = fakePostgrest({
    onboarding_candidates_v: (call) => (call.select === DOCS_SELECT ? DOCS_MISSING : CANDIDATES),
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
    const pages = callsTo(fake.calls, 'onboarding_candidates_v').filter(
      (call) => call.select !== DOCS_SELECT,
    );
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

  it('computes docs_missing only for the cards the Documents column can show it on', async () => {
    const data = await loadBoard();
    const board = callsTo(fake.calls, 'onboarding_candidates_v').filter(
      (call) => call.select !== DOCS_SELECT,
    );
    // The board's own read never asks for the per-row function.
    expect(board.every((call) => !call.select?.split(', ').includes('docs_missing'))).toBe(true);
    const docs = callsTo(fake.calls, 'onboarding_candidates_v').filter(
      (call) => call.select === DOCS_SELECT,
    );
    expect(docs.map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(docs[0]!.filters).toEqual([
      ['or', 'status.eq.documents,and(status.eq.rejected,rejected_from.eq.documents)'],
    ]);
    expect(docs[0]!.orders.map(([column]) => column)).toEqual(['id']);
    // Merged by id: a Documents card has its list, every other card null.
    expect(data.candidates.find((row) => row.id === 'c-0001')?.docs_missing).toEqual([
      'passport',
      'ni_evidence',
    ]);
    expect(data.candidates.find((row) => row.id === 'c-0002')?.docs_missing).toEqual([]);
    expect(data.candidates.find((row) => row.id === 'c-1001')?.docs_missing).toEqual([
      'passport',
      'ni_evidence',
    ]);
    expect(data.candidates.find((row) => row.id === 'c-1003')?.docs_missing).toBeNull();
  });
});
