import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callsTo, fakePostgrest } from '../../_lib/__tests__/fakePostgrest';

/**
 * Radar and the audit-trail CSV are read whole (go-live audit 17.10.2026,
 * H6/H7). PostgREST cuts a view at 1000 rows without an error: the audit
 * trail is oldest-first, so the cut lost the NEWEST verifications; Radar's
 * "All N" and tab counts came out short.
 */

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@thc/db/server', () => ({ createClient: () => state.db }));
vi.mock('../checksData', () => ({
  loadCheckMonitor: async () => ({ checks: [], waiting: [], runs: [], now: '', problem: null }),
}));
vi.mock('../../_lib/rtwCheckData', () => ({
  loadRtwCheckEnabled: async () => false,
  loadRtwChecksForDocuments: async () => new Map(),
  loadDobClaimsForDocuments: async () => new Map(),
}));

const { loadAuditTrail, loadCompliance } = await import('../data');

const pad = (n: number) => String(n).padStart(4, '0');
const RADAR = Array.from({ length: 2210 }, (_, n) => ({
  staff_id: `w-${pad(n)}`,
  doc_id: `d-${pad(n)}`,
  days_left: n - 30,
}));
const TRAIL = Array.from({ length: 3001 }, (_, n) => ({
  id: n + 1,
  at: `2026-10-${String(1 + (n % 28)).padStart(2, '0')}T09:00:00Z`,
  record_type: 'rtw',
  event: 'verified',
}));

let fake: ReturnType<typeof fakePostgrest>;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  fake = fakePostgrest({
    compliance_radar_v: RADAR,
    compliance_evidence_audit_v: TRAIL,
    compliance_review_queue_v: [],
    rota_guard_warnings_v: [],
    settings: [],
  });
  state.db = fake;
});

describe('Radar', () => {
  it('reads all 2,210 dated documents, so the tab counts add up', async () => {
    const data = await loadCompliance();
    expect(data.problem).toBeNull();
    expect(data.radar).toHaveLength(2210);
    const pages = callsTo(fake.calls, 'compliance_radar_v');
    expect(pages).toHaveLength(3);
    expect(pages[0]!.orders.map(([column]) => column)).toEqual(['days_left', 'doc_id']);
  });
});

describe('the audit-trail CSV', () => {
  it('carries all 3,001 rows — the newest included', async () => {
    const { rows, problem } = await loadAuditTrail();
    expect(problem).toBeNull();
    expect(rows).toHaveLength(3001);
    expect(rows.at(-1)?.id).toBe(3001);
    const pages = callsTo(fake.calls, 'compliance_evidence_audit_v');
    expect(pages.map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
      [3000, 3999],
    ]);
  });

  it('a trail that moves under the read is a problem, never a file with gaps', async () => {
    state.db = fakePostgrest(
      {
        compliance_evidence_audit_v: (c) =>
          // A row repeated across the boundary: the order moved under the read.
          c.range && c.range[0] > 0 ? [TRAIL[0]!, ...TRAIL] : TRAIL,
      },
      {},
    );
    const { rows, problem } = await loadAuditTrail();
    expect(rows).toEqual([]);
    expect(problem).toMatch(/audit trail rows changed while they were being read/);
  });
});
