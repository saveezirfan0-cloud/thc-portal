import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callsTo, fakePostgrest } from '../_lib/__tests__/fakePostgrest';

/**
 * The Back Office lists that still read in one request (go-live audit
 * 17.10.2026, second wave). PostgREST answers at most `max_rows` (1000) rows
 * per request — table, view or RPC — and past it the reply is simply
 * shorter. `fakePostgrest` cuts the same way, so a loader that does not page
 * comes back short here exactly as it would in production:
 *
 *   · /compliance's review queue (oldest first: the cut lost the newest);
 *   · the dashboard's ten-day list and short-staffed panel (M11);
 *   · the /clients and /roles directories and the /events client filter;
 *   · the client card's qualified staff and events (M2).
 *
 * Each read closes its order with a unique column, so pages cannot skip or
 * repeat a row at a boundary.
 */
const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@thc/db/server', () => ({ createClient: () => state.db }));
vi.mock('../compliance/checksData', () => ({
  loadCheckMonitor: async () => ({ checks: [], waiting: [], runs: [], now: '', problem: null }),
}));

const pad = (n: number) => String(n).padStart(5, '0');
const many = <T>(count: number, row: (n: number) => T): T[] =>
  Array.from({ length: count }, (_, n) => row(n));

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
});

const lastColumn = (orders: [string, unknown?][]) => orders.at(-1)?.[0];

describe('/compliance review queue', () => {
  it('lists all 1,400 items to review, the newest included', async () => {
    const queue = many(1400, (n) => ({
      kind: n % 2 ? 'document' : 'declaration',
      item_id: `i-${pad(n)}`,
      staff_id: `w-${pad(n)}`,
      submitted_at: `2026-10-${String(1 + (n % 28)).padStart(2, '0')}T09:00:00Z`,
      item_type: 'passport',
    }));
    const fake = fakePostgrest({
      compliance_review_queue_v: queue,
      compliance_radar_v: [],
      rota_guard_warnings_v: [],
      settings: [],
    });
    state.db = fake;
    const { loadCompliance } = await import('../compliance/data');
    const data = await loadCompliance();
    expect(data.problem).toBeNull();
    expect(data.queue).toHaveLength(1400);
    const pages = callsTo(fake.calls, 'compliance_review_queue_v');
    expect(pages.map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(pages[0]!.orders.map(([column]) => column)).toEqual(['submitted_at', 'kind', 'item_id']);
  });
});

describe('/dashboard lists', () => {
  it('the ten-day list keeps every role section past row 1,000', async () => {
    const rows = many(1250, (n) => ({
      shift_id: `s-${pad(n)}`,
      event_id: `e-${pad(Math.floor(n / 5))}`,
      event_title: 'Gala',
      event_date: '2099-07-03',
      client_name: 'Acme',
      venue_name: 'Hall',
      po_number: null,
      cancelled_at: null,
      role_name: 'Waiter',
      starts_at: '2099-07-03T16:00:00Z',
      ends_at: '2099-07-03T22:00:00Z',
      event_starts_at: '2099-07-03T16:00:00Z',
      event_ends_at: '2099-07-03T22:00:00Z',
      headcount: 4,
      buffer: 0,
      confirmed: 2,
      open_positions: 2,
      margin_per_hour: '3.00',
    }));
    const fake = fakePostgrest({
      dashboard_kpis_v: [{ as_of: '2099-07-01T09:00:00Z' }],
      dashboard_week_finance_v: [],
      dashboard_upcoming_v: rows,
    });
    state.db = fake;
    const { loadDashboard } = await import('../dashboard/data');
    const data = await loadDashboard();
    expect(data.upcoming).toHaveLength(250);
    const sections = data.upcoming.reduce((sum, event) => sum + event.roles.length, 0);
    expect(sections).toBe(1250);
    const pages = callsTo(fake.calls, 'dashboard_upcoming_v');
    expect(pages).toHaveLength(2);
    expect(lastColumn(pages[0]!.orders)).toBe('shift_id');
  });

  it('the short-staffed panel keeps every short section', async () => {
    const rows = many(1100, (n) => ({
      shift_id: `s-${pad(n)}`,
      event_id: `e-${pad(n)}`,
      event_title: 'Gala',
      event_date: '2099-07-03',
      client_name: 'Acme',
      venue_name: 'Hall',
      role_name: 'Waiter',
      starts_at: '2099-07-03T16:00:00Z',
      ends_at: '2099-07-03T22:00:00Z',
      headcount: 4,
      confirmed: 1,
      open_positions: 3,
    }));
    const fake = fakePostgrest({ dashboard_short_staffed_v: rows });
    state.db = fake;
    const { loadShortStaffed } = await import('../dashboard/short-staffed-data');
    const { roles, problem } = await loadShortStaffed();
    expect(problem).toBeNull();
    expect(roles).toHaveLength(1100);
    const pages = callsTo(fake.calls, 'dashboard_short_staffed_v');
    expect(pages.map((c) => c.orders.map(([column]) => column))[0]).toEqual([
      'starts_at',
      'shift_id',
    ]);
  });
});

describe('directories', () => {
  it('/clients lists every client', async () => {
    const fake = fakePostgrest({
      clients_directory_v: many(1300, (n) => ({ id: `c-${pad(n)}`, name: `Client ${pad(n)}` })),
    });
    state.db = fake;
    const { loadClients } = await import('../clients/data');
    const { clients, problem } = await loadClients();
    expect(problem).toBeNull();
    expect(clients).toHaveLength(1300);
    expect(callsTo(fake.calls, 'clients_directory_v')[0]!.orders.map(([c]) => c)).toEqual([
      'name',
      'id',
    ]);
  });

  it('/roles lists every role', async () => {
    const fake = fakePostgrest({
      role_directory_v: many(1001, (n) => ({ id: `r-${pad(n)}`, name: `Role ${pad(n)}` })),
    });
    state.db = fake;
    const { loadRoles } = await import('../roles/data');
    const { roles, problem } = await loadRoles();
    expect(problem).toBeNull();
    expect(roles).toHaveLength(1001);
  });

  it('the /events client filter offers every client', async () => {
    const fake = fakePostgrest({
      clients: many(1200, (n) => ({ id: `c-${pad(n)}`, name: `Client ${pad(n)}` })),
    });
    state.db = fake;
    const { loadClientNames } = await import('../events/data');
    const { clients, unavailable } = await loadClientNames();
    expect(unavailable).toBeUndefined();
    expect(clients).toHaveLength(1200);
  });
});

describe('the client card', () => {
  it('reads every qualified worker and every event of the client', async () => {
    const fake = fakePostgrest({
      clients_directory_v: [{ id: 'c-1', name: 'Acme' }],
      clients: [{ name_badges: false }],
      clients_rate_card_v: [],
      client_rate_cards: [],
      clients_qualified_staff_v: many(1100, (n) => ({
        staff_id: `w-${pad(n)}`,
        display_name: `Worker ${pad(n)}`,
        photo_path: null,
      })),
      clients_event_list_v: many(1500, (n) => ({ id: `e-${pad(n)}`, event_date: '2026-01-01' })),
      roles: [],
      role_rates_v: [],
      clients_shift_requirements_v: [],
      clients_quiz_results_v: [],
      clients_worker_requests_v: [],
    });
    state.db = fake;
    const { loadClientCard } = await import('../clients/[id]/data');
    const data = await loadClientCard('c-1');
    expect(data.problem).toBeNull();
    expect(data.qualified).toHaveLength(1100);
    expect(data.events).toHaveLength(1500);
    expect(lastColumn(callsTo(fake.calls, 'clients_event_list_v')[0]!.orders)).toBe('id');
    expect(lastColumn(callsTo(fake.calls, 'clients_qualified_staff_v')[0]!.orders)).toBe(
      'staff_id',
    );
  });
});

describe('the queue’s share-code checks and date-of-birth claims', () => {
  it('are read in chunks of 100 document ids, never one URL for the whole queue', async () => {
    const ids = many(250, (n) => `d-${pad(n)}`);
    const fake = fakePostgrest({ rtw_checks_latest_v: [], share_code_dob_claims_v: [] });
    const { DOCUMENT_CHUNK, loadDobClaimsForDocuments, loadRtwChecksForDocuments } =
      await import('../_lib/rtwCheckData');
    await loadRtwChecksForDocuments(fake, ids);
    await loadDobClaimsForDocuments(fake, ids);
    expect(DOCUMENT_CHUNK).toBe(100);
    for (const source of ['rtw_checks_latest_v', 'share_code_dob_claims_v']) {
      const calls = callsTo(fake.calls, source);
      expect(calls).toHaveLength(3);
      const sent = calls.flatMap((c) => c.filters.find(([op]) => op === 'in')![2] as string[]);
      expect(sent).toEqual(ids);
    }
  });
});
