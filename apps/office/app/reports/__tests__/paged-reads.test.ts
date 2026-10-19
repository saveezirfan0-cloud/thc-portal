import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callsTo, fakePostgrest } from '../../_lib/__tests__/fakePostgrest';

/**
 * The payroll is never short (go-live audit 17.10.2026, B1; RULE-14).
 * PostgREST cuts a set-returning RPC at 1000 rows without an error, and a
 * week at full volume is up to ~2,100 shift lines — the CSV used to stop at
 * line 1,000. Here the fake server cuts exactly as PostgREST does, and every
 * report read must still come back whole, or as an error.
 */

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@thc/db/server', () => ({ createClient: () => state.db }));

const { loadReports, readPayrollLines } = await import('../data');
const { GET } = await import('../export/route');

const pad = (n: number) => String(n).padStart(4, '0');

function line(n: number) {
  return {
    booking_id: `b-${pad(n)}`,
    shift_id: `s-${n % 40}`,
    event_id: `e-${n % 40}`,
    staff_id: `w-${pad(n)}`,
    employee_id: n,
    staff_name: `Worker ${pad(n)}`,
    sort_surname: `Surname ${pad(n)}`,
    removed: false,
    event_title: 'Gala Dinner',
    client_name: 'Acme',
    role_name: 'Waiter',
    shift_date: '2026-10-05',
    starts_at: '2026-10-05T17:00:00Z',
    ends_at: '2026-10-05T23:00:00Z',
    check_in_at: '2026-10-05T16:55:00Z',
    check_out_at: '2026-10-05T23:05:00Z',
    attempted_at: null,
    kind: 'worked',
    status: 'settled',
    no_check_out_unresolved: false,
    late_check_in: false,
    early_check_out: false,
    unpaid_break_min: 0,
    worked_min: 360,
    payable_min: 360,
    floor_applied: false,
    rate: '12.50',
    base: '75.00',
    holiday: '9.05',
    total: '84.05',
    in_export: n % 100 !== 7, // a held shift now and then stays out of the CSV
    exported_at: null,
    exported_payable_min: null,
    exported_total: null,
    changed_since_export: false,
  };
}

const LINES = Array.from({ length: 2345 }, (_, n) => line(n));
const PEOPLE = [
  ...Array.from({ length: 1203 }, (_, n) => ({
    staff_id: `w-${pad(n)}`,
    employee_id: n,
    staff_name: `Worker ${pad(n)}`,
    removed: false,
    is_total: false,
    workers: 1,
    shifts: 1,
    pending: 0,
    turned_away: 0,
    payable_min: 360,
    break_min: 0,
    base: '75.00',
    holiday: '9.05',
    total: '84.05',
    changed_since_export: 0,
  })),
  {
    staff_id: null,
    employee_id: null,
    staff_name: null,
    removed: null,
    is_total: true,
    workers: 1203,
    shifts: 1203,
    pending: 0,
    turned_away: 0,
    payable_min: 0,
    break_min: 0,
    base: '0',
    holiday: '0',
    total: '0',
    changed_since_export: 0,
  },
];
const DAYS = Array.from({ length: 1101 }, (_, n) => ({
  group_key: `g-${pad(n)}`,
  group_label: `Group ${pad(n)}`,
  is_total: false,
  events: ['Gala Dinner'],
  cancelled_events: [],
  event_count: 1,
  payable_min: 60,
  base: '10',
  holiday: '1.21',
  payroll: '11.21',
  invoicing: '20',
  margin: '8.79',
  margin_pct: '43.9',
  actual_sections: 1,
  forecast_sections: 0,
  pending: 0,
}));

let fake: ReturnType<typeof fakePostgrest>;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  fake = fakePostgrest({
    payroll_report: LINES,
    payroll_report_people: PEOPLE,
    finance_report: DAYS,
    report_sends: [],
  });
  state.db = fake;
});

const view = {
  tab: 'payroll',
  from: '2026-10-01',
  to: '2026-10-31',
  by: 'day',
  date: '2026-10-12',
};

describe('/reports Payroll tab', () => {
  it('shows every one of 2,345 shift lines and 1,204 people rows, not the first 1,000', async () => {
    const data = await loadReports(view as never);
    expect(data.problem).toBeNull();
    expect(data.lines).toHaveLength(2345);
    expect(data.lines.at(-1)?.staff_name).toBe('Worker 2344');
    expect(data.people).toHaveLength(1204);
    expect(data.people.at(-1)?.is_total).toBe(true);
  });

  it('pages the lines in payroll_report order with booking_id last, and asks for the count once', async () => {
    await loadReports(view as never);
    const pages = callsTo(fake.calls, 'payroll_report');
    expect(pages.map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    expect(pages.map((c) => c.count)).toEqual(['exact', undefined, undefined]);
    expect(pages[0]!.orders.map(([column]) => column)).toEqual([
      'removed',
      'sort_surname',
      'staff_name',
      'staff_id',
      'starts_at',
      'booking_id',
    ]);
    expect(pages[0]!.orders[1]![1]).toEqual({ ascending: true, nullsFirst: false });
  });

  it('says so, instead of showing a short list, when the server pages smaller than the count', async () => {
    state.db = fakePostgrest(
      { payroll_report: LINES, payroll_report_people: PEOPLE, report_sends: [] },
      { maxRows: 400 },
    );
    const data = await loadReports(view as never);
    expect(data.lines).toEqual([]);
    expect(data.problem).toMatch(/^Only 400 of 2,345 payroll lines came back\./);
  });

  it('says when the Monday email is switched off in Settings (ADR-0083), per tab', async () => {
    expect((await loadReports(view as never)).autoSendOff).toBe(false);
    state.db = fakePostgrest({
      payroll_report: LINES,
      payroll_report_people: PEOPLE,
      new_starter_report: [],
      report_sends: [],
      settings: [{ value: { BG08: false } }],
    });
    expect((await loadReports(view as never)).autoSendOff).toBe(true);
    // NS1 is its own switch: the New Starter tab is unaffected by BG08.
    expect((await loadReports({ ...view, tab: 'newstarter' } as never)).autoSendOff).toBe(false);
  });

  it('refuses past the ceiling rather than truncating', async () => {
    const result = await readPayrollLines(fake as never, '2026-01-01', '2026-12-31', 1500);
    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/more than 1,500 payroll lines/);
  });
});

describe('/reports Financial tab', () => {
  it('reads every group, past 1,000', async () => {
    const data = await loadReports({ ...view, tab: 'financial' } as never);
    expect(data.problem).toBeNull();
    expect(data.finance).toHaveLength(1101);
  });
});

describe('Export CSV', () => {
  const exportUrl = (report: string) =>
    new Request(
      `https://office.test/reports/export?report=${report}&from=2026-10-01&to=2026-10-31`,
    );

  it('the payroll CSV carries every in-export line of 2,345 — none lost at 1,000', async () => {
    const response = await GET(exportUrl('payroll'));
    expect(response.status).toBe(200);
    const csv = await response.text();
    const body = csv.trimEnd().split('\r\n').slice(1);
    const inExport = LINES.filter((row) => row.in_export);
    expect(body).toHaveLength(inExport.length);
    expect(inExport.length).toBeGreaterThan(2000);
    expect(csv).toContain('Worker 2344');
    // Holiday +12.07% is still its own column (§9.9).
    expect(csv).toContain('9.05');
  });

  it('a short read is an error response, never a short file', async () => {
    state.db = fakePostgrest({ payroll_report: LINES }, { maxRows: 500 });
    const response = await GET(exportUrl('payroll'));
    expect(response.status).toBe(500);
    expect(await response.text()).toMatch(/^Only 500 of 2,345 payroll lines came back\./);
  });

  it('a login without the finance permission gets 403, not a server error (ADR-0056)', async () => {
    const refusing = fakePostgrest({ payroll_report: LINES });
    state.db = {
      ...refusing,
      rpc: () => {
        const reply = Promise.resolve({
          data: null,
          error: { code: '42501', message: 'not_permitted', details: 'finance' },
        });
        const query = Object.assign(reply, {
          order: () => query,
          range: () => query,
        });
        return query;
      },
    };
    const response = await GET(exportUrl('payroll'));
    expect(response.status).toBe(403);
    expect(await response.text()).toMatch(/^Reports need the finance permission\./);
  });

  it('the financial CSV reads past 1,000 too', async () => {
    const response = await GET(exportUrl('financial'));
    expect(response.status).toBe(200);
    const body = (await response.text()).trimEnd().split('\r\n').slice(1);
    expect(body.length).toBeGreaterThanOrEqual(1101);
  });
});
